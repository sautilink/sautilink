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
const workerdVersion = miniflareRequire('workerd/package.json').version;
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
let upstreamControl;
const diagnostics = [];
const started = Date.now();
const delay = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms));

// This synthetic entry point is written only into an isolated temporary bundle.
// It must never be included in a deployable Worker. It has no auth credentials,
// remote bindings, hosted resources or private data and binds only to loopback.
const fixture = `
import { DurableObject } from 'cloudflare:workers';
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
        authorizedSessions:this.sessions().map(({state})=>state),
        lastSeen:[...await this.ctx.storage.list({prefix:'last-seen:'})]});
    }
    return super.fetch(request);
  }
}
// Independent control: no Hub inheritance, authorization or presence code. It
// isolates the pinned workerd server-first hibernatable close release behavior.
export class UpstreamCloseControl extends DurableObject {
  async fetch(request) {
    if (new URL(request.url).pathname === '/diagnostic') {
      return Response.json({now:Date.now(),alarmFiredAt:await this.ctx.storage.get('alarm-fired-at'),
        closeCallback:await this.ctx.storage.get('close-callback'),sockets:this.ctx.getWebSockets().length});
    }
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].send(JSON.stringify({type:'ready',fixture:'independent-upstream-close-control'}));
    await this.ctx.storage.setAlarm(Date.now()+250);
    return new Response(null,{status:101,webSocket:pair[0],headers:{'Sec-WebSocket-Protocol':'sautilink-dm-v1'}});
  }
  async alarm() {
    await this.ctx.storage.put('alarm-fired-at',Date.now());
    for (const socket of this.ctx.getWebSockets()) socket.close(1008,'Synthetic control closure');
  }
  async webSocketClose(socket,code) {
    socket.close(code);
    await this.ctx.storage.put('close-callback',{code,readyState:socket.readyState});
  }
}
const USER = '11111111-1111-4111-8111-111111111111';
const PEER = '22222222-2222-4222-8222-222222222222';
const CONVERSATION = '33333333-3333-4333-8333-333333333333';
export default { async fetch(request, env) {
  const url = new URL(request.url);
  if (url.hostname !== '127.0.0.1') return new Response('Local fixture only', {status:403});
  if (url.pathname === '/control/connect' || url.pathname === '/control/diagnostic') {
    const path = url.pathname.endsWith('/diagnostic') ? '/diagnostic' : '/connect';
    return env.UPSTREAM_CLOSE_CONTROL.getByName('server-first-close').fetch(new Request('https://durable.internal'+path,request));
  }
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
    closedOrDelay: ms => Promise.race([closed,delay(ms).then(()=>null)]),
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

async function acknowledged1008(value, label, verifyServer, {control = false} = {}) {
  // This deadline is about the actual protocol exchange. Neither an authorization
  // probe nor client cleanup can substitute for the server Close and client ACK.
  await withTimeout((async () => {
    while (!value.socket._closeFrameReceived || !value.socket._closeFrameSent) {
      const snapshot = value.probe();
      assert.equal(snapshot.error,undefined,`${label}: no transport error before Close acknowledgement`);
      if (value.socket.readyState === WebSocket.CLOSED)
        assert.fail(`${label}: transport ended before both Close frames were exchanged`);
      await delay(5);
    }
  })(), `${label} Close1008 and reciprocal acknowledgement`);
  assert.equal(value.probe().closeCode,1008,`${label}: server must use authorization close code1008`);

  // RFC6455§5.5.1 requires server TCP shutdown, but permits a client to close its
  // transport after the handshake. Give the server a reasonable EOF interval.
  const terminal = await value.closedOrDelay(500);
  const evidence = await verifyServer();
  if (terminal) {
    assert.equal(terminal.code,1008);
    diagnostics.push({phase:label,protocol_close:'1008_and_ack',server_tcp_shutdown:'complete',server:evidence});
    if (control) upstreamControl = {transport:'complete',server:evidence};
    return;
  }

  // Exact pinned upstream defect only. An independent no-Hub control must prove
  // the same shape before the Hub can use this path. All authorization/presence
  // assertions above run before any client-initiated TCP teardown.
  assert.equal(miniflareVersion,'5.20260820.0-alpha','Investigate changed Miniflare transport behavior');
  assert.equal(workerdVersion,'1.20260820.1','Investigate changed workerd transport behavior');
  const snapshot = value.probe();
  assert.equal(snapshot.error,undefined);
  assert.equal(snapshot.closeCode,1008);
  assert.equal(snapshot.closeFrameReceived,true);
  assert.equal(snapshot.closeFrameSent,true);
  assert.equal(snapshot.readyState,WebSocket.CLOSING);
  assert.equal(snapshot.tcpWritableEnded,true);
  assert.equal(snapshot.tcpReadableEnded,false);
  assert.equal(snapshot.tcpDestroyed,false);
  if (!control) assert.equal(upstreamControl?.transport,'retained_after_handshake',
    'Hub transport retention must also reproduce without any Hub code');
  const issue = 'Pinned workerd retains server TCP after acknowledged server-first hibernatable Close; RFC-permitted client cleanup required';
  if (!diagnosticIssues.includes(issue)) diagnosticIssues.push(issue);
  diagnostics.push({phase:label,protocol_close:'1008_and_ack',server_tcp_shutdown:'upstream_retained_after_handshake',
    client_before_cleanup:snapshot,server:evidence,independent_control:control});
  if (control) upstreamControl = {transport:'retained_after_handshake',client:snapshot,server:evidence};
  value.socket.terminate();
  assert.equal((await value.closed()).code,1008,`${label}: client teardown must reach terminal Close1008`);
  assert.equal(value.probe().tcpDestroyed,true);
  checks.push(`${label}: Close1008 and ACK verified before RFC-permitted client TCP cleanup (explicit upstream defect)`);
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
    // Exercise a real workerd user-service socket directly. This also rules out
    // Miniflare's separately configured entry Worker as the sole explanation of
    // the independently reproduced upstream hibernatable close release defect.
    unsafeDirectSockets: [{ host:'127.0.0.1', port:0 }],
    durableObjects: { DM_REALTIME_HUB: { className: 'DmRealtimeHub', useSQLite: true },
      UPSTREAM_CLOSE_CONTROL: {className:'UpstreamCloseControl',useSQLite:true} },
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
  async function hubState(name) {
    const response = await withTimeout(fetch(new URL(`/diagnostic/${name}`,origin),{redirect:'error'}),
      `${name} authorization state probe`);
    assert.equal(response.status,200);
    return response.json();
  }
  const userId = '11111111-1111-4111-8111-111111111111';
  const peerId = '22222222-2222-4222-8222-222222222222';
  function assertExcluded(state,ids) {
    assert.ok(Array.isArray(state.authorizedSessions),'Actual Hub sessions must be probed');
    for (const id of ids) {
      assert.ok(!state.authorizedSessions.some(value=>value.userId === id),'Closed user must not retain an authorized Hub session');
      assert.ok(!state.sockets.some(value=>value.attachment?.userId === id &&
        value.attachment.authorizationExpiresAt > state.now),'Closed user must not retain a future authorization attachment');
      assert.ok(!state.lastSeen.some(([key])=>key === `last-seen:${id}`),'Closed user must not retain a last-seen record');
    }
  }

  const controlUrl = new URL('/control/connect',origin);
  controlUrl.protocol = 'ws:';
  const control = client(controlUrl);
  await ready(control);
  await acknowledged1008(control,'independent_no_hub_control',async () => {
    // The separate tiny Object must itself run its alarm and close handler. No
    // inherited Hub behavior can make this control reproduce the same defect.
    return withTimeout((async () => {
      while (true) {
        const response = await fetch(new URL('/control/diagnostic',origin),{redirect:'error'});
        assert.equal(response.status,200);
        const state = await response.json();
        if (state.closeCallback) {
          assert.ok(Number.isSafeInteger(state.alarmFiredAt) && state.alarmFiredAt <= state.now);
          assert.equal(state.closeCallback.code,1008);
          assert.equal(state.closeCallback.readyState,3);
          assert.equal(state.sockets,0);
          return state;
        }
        await delay(5);
      }
    })(),'independent control close handler');
  },{control:true});
  checks.push('independent no-Hub Durable Object alarm and close callback verify pinned transport behavior');

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
  await acknowledged1008(expires,'expired_lease',async () => {
    const offline = await survivor.wait(event => event.type === 'presence' && event.peer_online === false,
      'expired peer removed',afterExpiry);
    assert.equal(offline.peer_last_seen_at,null);
    const state = await hubState('deadline');
    assert.ok(state.now >= scheduled.alarm,'The scheduled lease deadline must actually pass');
    assertExcluded(state,[userId]);
    assert.ok(survivor.events.slice(afterExpiry).filter(event=>event.type === 'presence')
      .every(event=>event.peer_online === false && event.peer_last_seen_at === null),
    'No expired online state or timestamp may be delivered before client cleanup');
    return state;
  });
  checks.push('actual Durable Object alarm sends Close1008, receives ACK and removes expired authorization and peer metadata');

  const renewed = connect('deadline');
  await ready(renewed);
  await renewed.wait(event => event.type === 'presence' && event.peer_online === true, 'reconnected peer online');
  checks.push('a freshly authorized connection works after lease expiry');

  // Capture the old proof before revocation, rather than relative to a later
  // client-cleanup clock that can vary on a loaded CI runner.
  const preRevocationCheckedAt = Date.now()-2000;
  const revoke = await fetch(new URL('/revoke/deadline', origin), { method: 'POST', redirect: 'error' });
  assert.equal(revoke.status, 204);
  for (const [index,value] of [renewed,survivor].entries()) {
    await acknowledged1008(value,`revoked_client_${index+1}`,async () => {
      const finalPresence = value.events.filter(event => event.type === 'presence').at(-1);
      assert.equal(finalPresence.peer_online,false);
      assert.equal(finalPresence.peer_last_seen_at,null);
      const state = await hubState('deadline');
      assertExcluded(state,[userId,peerId]);
      assert.equal(state.authorizedSessions.length,0);
      assert.equal(state.lastSeen.length,0);
      return state;
    });
  }
  checks.push('privacy/block revocation sends Close1008 to both clients, receives ACKs and clears authorization and visible presence');

  const stale = connect('deadline', { checkedAt: preRevocationCheckedAt, deadline: Date.now() + 5000 });
  assert.equal((await stale.opened).status, 401);
  const expired = connect('already-expired', { checkedAt: Date.now() - 3000, deadline: Date.now() - 2000 });
  assert.equal((await expired.opened).status, 401);
  checks.push('pre-revocation and already-expired upgrade requests are rejected with 401');

  await delay(5);
  const fresh = connect('deadline');
  await ready(fresh);
  checks.push('fresh reciprocal authorization can reconnect after revocation');

  assert.equal(outboundAttempts, 0, 'The fixture must never contact hosted resources');
  assert.equal(createHash('sha256').update(await readFile(hubPath)).digest('hex'), hubSha256,
    'The reviewed Hub source must remain unchanged during runtime verification');
} catch (error) {
  failed = error;
  diagnostics.push({phase:'failed_client_snapshot',clients:clients.map(value=>value.probe())});
  if (runtimeStarted && runtimeOrigin) {
    for (const name of ['deadline','pair']) {
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
  workerd_version:workerdVersion,upstream_control:upstreamControl,
  synthetic_data_only: true, hosted_network_requests: outboundAttempts,
  hub_sha256: hubSha256,
  elapsed_ms: Date.now() - started, checks, diagnostics };
console.log(JSON.stringify(report, null, 2));
if (failed) throw failed;
