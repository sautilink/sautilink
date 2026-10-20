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
const miniflareRequire = createRequire(miniflareEntry);
const { Miniflare, convertV4MiniflareOptions } = await import(pathToFileURL(miniflareEntry).href);
const WebSocket = miniflareRequire('ws');
const hubPath = join(root, 'src/dm-realtime-hub.js');
const hubSha256 = createHash('sha256').update(await readFile(hubPath)).digest('hex');
const scratch = await mkdtemp(join(resolve(tmpdir()), 'sautilink-realtime-runtime-'));
const clients = [];
const checks = [];
let runtime;
let runtimeStarted = false;
let outboundAttempts = 0;
let failed;
const started = Date.now();
const delay = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms));

// This synthetic entry point is written only into an isolated temporary bundle.
// It must never be included in a deployable Worker. It has no auth credentials,
// remote bindings, hosted resources or private data and binds only to loopback.
const fixture = `
export { DmRealtimeHub } from ${JSON.stringify(hubPath.replaceAll('\\', '/'))};
const USER = '11111111-1111-4111-8111-111111111111';
const PEER = '22222222-2222-4222-8222-222222222222';
const CONVERSATION = '33333333-3333-4333-8333-333333333333';
export default { async fetch(request, env) {
  const url = new URL(request.url);
  if (url.hostname !== '127.0.0.1') return new Response('Local fixture only', {status:403});
  const match = url.pathname.match(/^\\/(connect|revoke)\\/([a-z0-9-]{1,60})$/);
  if (!match) return new Response('Not found', {status:404});
  const [, action, name] = match;
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
  const result = { socket, events, opened: withTimeout(opened, 'WebSocket upgrade'),
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
  runtime = new Miniflare(convertV4MiniflareOptions({ name: 'sautilink-realtime-runtime-local',
    scriptPath: join(scratch, 'fixture.mjs'), modules: true, compatibilityDate: '2026-08-17',
    host: '127.0.0.1', port: 0, inspectorHost: '127.0.0.1',
    durableObjects: { DM_REALTIME_HUB: { className: 'DmRealtimeHub', useSQLite: true } },
    resourcePersistencePath: join(scratch, 'state'), resourceTmpPath: join(scratch, 'tmp'),
    outboundService: async () => { outboundAttempts++; throw new Error('Hosted network access is disabled in runtime verification'); },
    cf: false, telemetry: { enabled: false }, logRequests: false,
  }));
  const origin = await runtime.ready;
  runtimeStarted = true;
  assert.equal(origin.hostname, '127.0.0.1');
  function connect(name, { actor = 'one', ms = 20000, ...query } = {}) {
    const url = new URL(`/connect/${name}`, origin);
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

  const expires = connect('deadline', { ms: 2500 });
  await ready(expires);
  const survivor = connect('deadline', { actor: 'two' });
  await ready(survivor);
  await survivor.wait(event => event.type === 'presence' && event.peer_online === true, 'short-lease peer online');
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
  assert.equal(outboundAttempts, 0, 'The fixture must never contact hosted resources');
  assert.equal(createHash('sha256').update(await readFile(hubPath)).digest('hex'), hubSha256,
    'The reviewed Hub source must remain unchanged during runtime verification');
} catch (error) {
  failed = error;
} finally {
  for (const { socket } of clients) socket.terminate();
  if (runtime) await runtime.dispose().catch(error => { failed ||= error; });
  // The only recursive cleanup target is the newly created, verified temp child.
  assert.equal(dirname(resolve(scratch)), resolve(tmpdir()));
  assert.ok(basename(scratch).startsWith('sautilink-realtime-runtime-'));
  await rm(scratch, { recursive: true, force: true });
}

const report = { ok: !failed, local_only: true, real_workerd_runtime: true, runtime_started: runtimeStarted,
  synthetic_data_only: true, hosted_network_requests: outboundAttempts,
  hub_sha256: hubSha256,
  elapsed_ms: Date.now() - started, checks };
console.log(JSON.stringify(report, null, 2));
if (failed) throw failed;
