import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
// Resolve the actual runtime shipped with pinned Wrangler, including when npm
// installs its transitive dependencies in a nested node_modules directory.
const wranglerRequire = createRequire(require.resolve('wrangler/package.json'));
const miniflareEntry = wranglerRequire.resolve('miniflare');
const miniflareVersion = wranglerRequire('miniflare/package.json').version;
const miniflareRequire = createRequire(miniflareEntry);
const { Miniflare, convertV4MiniflareOptions } = await import(pathToFileURL(miniflareEntry).href);
const WebSocket = miniflareRequire('ws');
const hubPath = join(root, 'src/dm-realtime-hub.js');
const hubSha256 = createHash('sha256').update(await readFile(hubPath)).digest('hex');
const scratch = await mkdtemp(join(resolve(tmpdir()), 'sautilink-realtime-runtime-'));
const clients = [];
const checks = [];
const diagnosticIssues = [];
let runtime;
let runtimeOrigin;
let runtimeStarted = false;
let outboundAttempts = 0;
let failed;
const diagnostics = [];
const started = Date.now();
const delay = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms));

// This synthetic entry point is written only into an isolated temporary bundle.
// It must never be included in a deployable Worker. It has no auth credentials,
// remote bindings, hosted resources or private data and binds only to loopback.
const fixture = `
import { DmRealtimeHub as ReviewedDmRealtimeHub } from ${JSON.stringify(hubPath.replaceAll('\\', '/'))};
// Probe routes exist only in this synthetic temporary bundle. Inherited security
// methods execute unchanged; the timed wait performs no diagnostic requests, so
// probes cannot wake an idle Object and make the required alarm test pass.
export class DmRealtimeHub extends ReviewedDmRealtimeHub {
  async alarm() {
    console.log(JSON.stringify({runtime_probe:'alarm_enter',now:Date.now(),alarm:await this.ctx.storage.getAlarm()}));
    try { await super.alarm(); }
    finally { console.log(JSON.stringify({runtime_probe:'alarm_exit',now:Date.now(),alarm:await this.ctx.storage.getAlarm()})); }
  }
  async webSocketClose(socket, code, reason, wasClean) {
    console.log(JSON.stringify({runtime_probe:'close_enter',now:Date.now(),code,readyState:socket.readyState}));
    await super.webSocketClose(socket, code, reason, wasClean);
    console.log(JSON.stringify({runtime_probe:'close_exit',now:Date.now(),code,readyState:socket.readyState}));
  }
  async fetch(request) {
    if (new URL(request.url).pathname === '/__runtime_probe') {
      return Response.json({now:Date.now(),alarm:await this.ctx.storage.getAlarm(),
        sockets:this.ctx.getWebSockets().map(socket=>({readyState:socket.readyState,attachment:socket.deserializeAttachment()})),
        lastSeen:[...await this.ctx.storage.list({prefix:'last-seen:'})]});
    }
    return super.fetch(request);
  }
}
const USER = '11111111-1111-4111-8111-111111111111';
const PEER = '22222222-2222-4222-8222-222222222222';
const CONVERSATION = '33333333-3333-4333-8333-333333333333';
export default { async fetch(request, env) {
  const url = new URL(request.url);
  if (url.hostname !== '127.0.0.1') return new Response('Local fixture only', {status:403});
  const match = url.pathname.match(/^\\/(connect|revoke|diagnostic)\\/([a-z0-9-]{1,60})$/);
  if (!match) return new Response('Not found', {status:404});
  const [, action, name] = match;
  if (action === 'diagnostic') {
    return env.DM_REALTIME_HUB.getByName(name).fetch(new Request('https://durable.internal/__runtime_probe'));
  }
  const reverse = url.searchParams.get('actor') === 'two';
  const headers = new Headers({ 'X-Sauti-Conversation-ID': CONVERSATION,
    'X-Sauti-User-ID': reverse ? PEER : USER, 'X-Sauti-Peer-ID': reverse ? USER : PEER });
  if (action === 'revoke') {
    if (request.method !== 'POST') return new Response('Use POST', {status:405});
    return env.DM_REALTIME_HUB.getByName(name).fetch(new Request('https://durable.internal/revoke', {method:'POST',headers}));
  }
  const now = Date.now();
  headers.set('Upgrade','websocket');
  headers.set('Sec-WebSocket-Protocol','sautilink-dm-v1');
  headers.set('X-Sauti-Authorization-Checked-At',String(url.searchParams.has('checkedAt') ? Number(url.searchParams.get('checkedAt')) : now));
  headers.set('X-Sauti-Authorization-Expires-At',String(url.searchParams.has('deadline') ? Number(url.searchParams.get('deadline')) : now + Number(url.searchParams.get('ms') || 20000)));
  return env.DM_REALTIME_HUB.getByName(name).fetch(new Request('https://durable.internal/connect', {headers}));
} };`;

function withTimeout(promise, label, timeout = 7000) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Realtime runtime timeout: ${label}`)), timeout);
  })]).finally(() => clearTimeout(timer));
}

function client(url) {
  assert.equal(url.hostname, '127.0.0.1');
  const socket = new WebSocket(url, 'sautilink-dm-v1', { handshakeTimeout: 7000 });
  const events = [];
  const waiting = new Set();
  let closeResult;
  let error;
  let resolveClose;
  const closed = new Promise(resolveClosed => { resolveClose = resolveClosed; });
  const opened = new Promise((resolveOpened, rejectOpened) => {
    socket.once('open', () => resolveOpened({ status: 101 }));
    socket.once('unexpected-response', (_request, response) => {
      response.resume();
      resolveOpened({ status: response.statusCode });
      socket.terminate();
    });
    socket.once('error', rejectOpened);
  });
  socket.on('error', value => { error = value; for (const check of waiting) check(); });
  socket.on('message', data => {
    try { events.push(JSON.parse(data.toString('utf8'))); }
    catch { error = new Error('Realtime Hub returned malformed JSON'); }
    for (const check of waiting) check();
  });
  socket.on('close', (code, reason) => {
    closeResult = { code, reason: reason.toString('utf8') };
    resolveClose(closeResult);
    for (const check of waiting) check();
  });
  const result = { socket, events, probe: () => ({url:url.pathname,now:Date.now(),readyState:socket.readyState,
      closeFrameReceived:socket._closeFrameReceived,closeFrameSent:socket._closeFrameSent,
      tcpReadableEnded:socket._socket?.readableEnded,tcpWritableEnded:socket._socket?.writableEnded,
      tcpDestroyed:socket._socket?.destroyed,
      closeCode:socket._closeCode,closeResult,error:error?.message,events:events.slice(-10)}),
    opened: withTimeout(opened, 'WebSocket upgrade'),
    closed: () => withTimeout(closed, 'WebSocket close'),
    wait(predicate, label, after = 0) {
      return withTimeout(new Promise((resolveEvent, rejectEvent) => {
        const check = () => {
          const found = events.slice(after).find(predicate);
          if (found) { waiting.delete(check); resolveEvent(found); }
          else if (error || closeResult) {
            waiting.delete(check);
            rejectEvent(error || new Error(`Socket closed before ${label}: ${closeResult.code}`));
          }
        };
        waiting.add(check);
        check();
      }), label).finally(() => waiting.clear());
    } };
  clients.push(result);
  return result;
}

try {
  await build({ stdin: { contents: fixture, resolveDir: root, sourcefile: 'local-only-realtime-runtime-fixture.mjs' },
    bundle: true, platform: 'neutral', format: 'esm', external: ['cloudflare:workers'],
    outfile: join(scratch, 'fixture.mjs'), logLevel: 'warning' });
  const runtimeOptions = convertV4MiniflareOptions({ name: 'sautilink-realtime-runtime-local',
    // Miniflare names modules relative to modulesRoot. The temporary bundle is
    // outside the checkout, so the default cwd root would create a ../ module
    // name that workerd correctly rejects as escaping its starting directory.
    rootPath: scratch, modulesRoot: scratch,
    scriptPath: join(scratch, 'fixture.mjs'), modules: true, compatibilityDate: '2026-08-17',
    host: '127.0.0.1', port: 0, inspectorHost: '127.0.0.1',
    // The ordinary Miniflare entry Worker adds a forwarding context pinned to
    // compatibilityDate 2025-03-17, before automatic close replies. Bind a real
    // workerd HTTP socket directly to our production-date fixture so the required
    // transport gate tests the reviewed Worker rather than Miniflare's wrapper.
    unsafeDirectSockets: [{ host:'127.0.0.1', port:0 }],
    durableObjects: { DM_REALTIME_HUB: { className: 'DmRealtimeHub', useSQLite: true } },
    resourcePersistencePath: join(scratch, 'state'), resourceTmpPath: join(scratch, 'tmp'),
    outboundService: async () => { outboundAttempts++; throw new Error('Hosted network access is disabled in runtime verification'); },
    cf: false, telemetry: { enabled: false }, logRequests: false,
  });
  const manifest = runtimeOptions.workers[0].config.manifest;
  assert.equal(manifest.mainModule, 'fixture.mjs');
  assert.deepEqual(Object.keys(manifest.modules), ['fixture.mjs']);
  runtime = new Miniflare(runtimeOptions);
  const entryOrigin = await runtime.ready;
  const origin = await runtime.unsafeGetDirectURL('sautilink-realtime-runtime-local');
  runtimeOrigin = origin;
  runtimeStarted = true;
  assert.equal(origin.hostname, '127.0.0.1');
  assert.equal(entryOrigin.hostname, '127.0.0.1');
  assert.notEqual(origin.port, entryOrigin.port);
  diagnostics.push({phase:'runtime_endpoints',required:'direct_workerd_user_worker',
    user_worker_compatibility_date:'2026-08-17',miniflare_entry_compatibility_date:'2025-03-17'});
  function connect(name, { actor = 'one', ms = 20000, ...query } = {}, endpoint = origin) {
    const url = new URL(`/connect/${name}`, endpoint);
    url.protocol = 'ws:';
    for (const [key, value] of Object.entries({ actor, ms, ...query })) url.searchParams.set(key, String(value));
    return client(url);
  }
  async function ready(value) {
    assert.equal((await value.opened).status, 101);
    await value.wait(event => event.type === 'ready', 'ready event');
  }

  const first = connect('pair');
  await ready(first);
  const second = connect('pair', { actor: 'two' });
  await ready(second);
  await first.wait(event => event.type === 'presence' && event.peer_online === true, 'first peer online');
  await second.wait(event => event.type === 'presence' && event.peer_online === true, 'second peer online');
  checks.push('two real WebSocket clients receive ready and reciprocal presence');

  first.socket.send(JSON.stringify({ type: 'typing', typing: true }));
  await second.wait(event => event.type === 'typing' && event.typing === true, 'typing propagation');
  await delay(150);
  const stopAt = second.events.length;
  first.socket.send(JSON.stringify({ type: 'typing', typing: false }));
  await second.wait(event => event.type === 'typing' && event.typing === false, 'typing stopped', stopAt);
  checks.push('typing true and false traverse the actual Hub');

  const beforeClientClose = second.events.length;
  first.socket.close(4001, 'Synthetic client closure');
  assert.equal((await first.closed()).code, 4001);
  await second.wait(event => event.type === 'presence' && event.peer_online === false,
    'client-initiated closure removes online presence', beforeClientClose);
  checks.push('client-initiated close completes its actual transport handshake and removes online presence');

  const expires = connect('deadline', { ms: 2500 });
  await ready(expires);
  const survivor = connect('deadline', { actor: 'two' });
  await ready(survivor);
  await survivor.wait(event => event.type === 'presence' && event.peer_online === true, 'short-lease peer online');
  const scheduledProbe = await fetch(new URL('/diagnostic/deadline', origin), { redirect: 'error' });
  assert.equal(scheduledProbe.status, 200);
  const scheduled = await scheduledProbe.json();
  diagnostics.push({phase:'before_expiry_wait',object:'deadline',...scheduled});
  assert.ok(scheduled.alarm > scheduled.now, 'The short-lease alarm must be scheduled in the future');
  assert.equal(scheduled.alarm, Math.min(...scheduled.sockets.map(value=>value.attachment.authorizationExpiresAt)),
    'The earliest socket authorization deadline must be the scheduled alarm');
  const afterExpiry = survivor.events.length;
  const expiredClose = await expires.closed();
  assert.equal(expiredClose.code, 1008);
  const offline = await survivor.wait(event => event.type === 'presence' && event.peer_online === false, 'expired peer removed', afterExpiry);
  assert.equal(offline.peer_last_seen_at, null);
  checks.push('actual Durable Object alarm closes expired lease with 1008 and removes peer metadata');

  const renewed = connect('deadline');
  await ready(renewed);
  await renewed.wait(event => event.type === 'presence' && event.peer_online === true, 'reconnected peer online');
  checks.push('a freshly authorized connection works after lease expiry');

  const revoke = await fetch(new URL('/revoke/deadline', origin), { method: 'POST', redirect: 'error' });
  assert.equal(revoke.status, 204);
  for (const value of [renewed, survivor]) {
    assert.equal((await value.closed()).code, 1008);
    const finalPresence = value.events.filter(event => event.type === 'presence').at(-1);
    assert.equal(finalPresence.peer_online, false);
    assert.equal(finalPresence.peer_last_seen_at, null);
  }
  checks.push('privacy/block revocation closes both real clients and clears visible presence');

  const stale = connect('deadline', { checkedAt: Date.now() - 2000, deadline: Date.now() + 5000 });
  assert.equal((await stale.opened).status, 401);
  const expired = connect('already-expired', { checkedAt: Date.now() - 3000, deadline: Date.now() - 2000 });
  assert.equal((await expired.opened).status, 401);
  checks.push('pre-revocation and already-expired upgrade requests are rejected with 401');

  await delay(5);
  const fresh = connect('deadline');
  await ready(fresh);
  checks.push('fresh reciprocal authorization can reconnect after revocation');

  // Retain the older Miniflare entry proxy as an explicit diagnostic. Its only
  // tolerated divergence is the already-observed TCP half-close after both
  // close frames, provided real Hub authorization/presence cleanup succeeded.
  // Direct workerd deadlines/revocation above must still complete cleanly.
  const proxyExpires = connect('entry-proxy-deadline', {ms:2500}, entryOrigin);
  await ready(proxyExpires);
  const proxySurvivor = connect('entry-proxy-deadline', {actor:'two'}, entryOrigin);
  await ready(proxySurvivor);
  await proxySurvivor.wait(event=>event.type === 'presence' && event.peer_online === true, 'entry-proxy peer online');
  const afterProxyExpiry = proxySurvivor.events.length;
  try {
    assert.equal((await proxyExpires.closed()).code, 1008);
    diagnostics.push({phase:'miniflare_entry_proxy',transport_close:'complete'});
  } catch (error) {
    if (error.message !== 'Realtime runtime timeout: WebSocket close') throw error;
    assert.equal(miniflareVersion,'5.20260820.0-alpha',
      'A different Miniflare version requires investigation of any transport failure');
    const snapshot = proxyExpires.probe();
    assert.equal(snapshot.closeCode,1008);
    assert.equal(snapshot.closeFrameReceived,true);
    assert.equal(snapshot.closeFrameSent,true);
    assert.equal(snapshot.readyState,2);
    assert.equal(snapshot.tcpWritableEnded,true);
    assert.equal(snapshot.tcpReadableEnded,false);
    const probe = await fetch(new URL('/diagnostic/entry-proxy-deadline', origin), {redirect:'error'});
    assert.equal(probe.status,200);
    const state = await probe.json();
    assert.ok(!state.sockets.some(value=>value.attachment?.userId === '11111111-1111-4111-8111-111111111111' &&
      value.attachment.authorizationExpiresAt > state.now));
    assert.ok(!state.lastSeen.some(([key])=>key === 'last-seen:11111111-1111-4111-8111-111111111111'));
    diagnosticIssues.push('Miniflare 5 entry wrapper leaves TCP half-open after acknowledged server close; direct workerd closes cleanly');
    diagnostics.push({phase:'miniflare_entry_proxy',transport_close:'half_open_after_both_close_frames',
      expected_diagnostic_only:true,client:snapshot,server:state});
  }
  const proxyOffline = await proxySurvivor.wait(event=>event.type === 'presence' && event.peer_online === false,
    'entry-proxy expired peer removed',afterProxyExpiry);
  assert.equal(proxyOffline.peer_last_seen_at,null);
  assert.equal(outboundAttempts, 0, 'The fixture must never contact hosted resources');
  assert.equal(createHash('sha256').update(await readFile(hubPath)).digest('hex'), hubSha256,
    'The reviewed Hub source must remain unchanged during runtime verification');
} catch (error) {
  failed = error;
  diagnostics.push({phase:'failed_client_snapshot',clients:clients.map(value=>value.probe())});
  if (runtimeStarted && runtimeOrigin) {
    for (const name of ['deadline','pair','entry-proxy-deadline']) {
      try {
        const response = await withTimeout(fetch(new URL(`/diagnostic/${name}`, runtimeOrigin), { redirect:'error' }),
          `failure diagnostic ${name}`, 2000);
        diagnostics.push({phase:'after_failure',object:name,status:response.status,...await response.json()});
      } catch (probeError) { diagnostics.push({phase:'after_failure',object:name,error:probeError.message}); }
    }
  }
} finally {
  for (const { socket } of clients) socket.terminate();
  if (runtime) await runtime.dispose().catch(error => { failed ||= error; });
  // The only recursive cleanup target is the newly created, verified temp child.
  assert.equal(dirname(resolve(scratch)), resolve(tmpdir()));
  assert.ok(basename(scratch).startsWith('sautilink-realtime-runtime-'));
  await rm(scratch, { recursive: true, force: true });
}

const report = { ok: !failed, local_only: true, real_workerd_runtime: true, runtime_started: runtimeStarted,
  required_websocket_endpoint:'direct_workerd_user_worker',diagnostic_issues:diagnosticIssues,
  miniflare_version:miniflareVersion,
  synthetic_data_only: true, hosted_network_requests: outboundAttempts,
  hub_sha256: hubSha256,
  elapsed_ms: Date.now() - started, checks, diagnostics };
console.log(JSON.stringify(report, null, 2));
if (failed) throw failed;
