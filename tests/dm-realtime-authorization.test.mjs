import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { handleDmRealtimeRequest } from '../src/dm-realtime-api.js';

const USER = '11111111-1111-4111-8111-111111111111';
const PEER = '22222222-2222-4222-8222-222222222222';
const CONVERSATION = '33333333-3333-4333-8333-333333333333';
const SESSION = '44444444-4444-4444-8444-444444444444';
const NOW = 1_790_000_000_000;
const LEASE = 30_000;
const HTTPResponse = globalThis.Response;
const source = (await readFile(new URL('../src/dm-realtime-hub.js', import.meta.url), 'utf8')).replace(
  "import { DurableObject } from 'cloudflare:workers';",
  'class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }',
);
// Only the runtime base class is substituted; tests execute the actual Hub methods.
const { DmRealtimeHub } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

async function controlled(run) {
  const previous = { fetch: globalThis.fetch, Response: globalThis.Response,
    WebSocketPair: globalThis.WebSocketPair, now: Date.now };
  let now = NOW;
  Date.now = () => now;
  globalThis.fetch = async () => { throw new Error('Unexpected network request: offline test'); };
  try { await run({ advance(ms) { now += ms; }, now: () => now }); }
  finally { Object.assign(globalThis, { fetch: previous.fetch, Response: previous.Response,
    WebSocketPair: previous.WebSocketPair }); Date.now = previous.now; }
}

function jwt({ sub = USER, exp = (NOW + 3_600_000) / 1000, session_id = SESSION } = {}) {
  return ['eyJhbGciOiJFUzI1NiJ9', Buffer.from(JSON.stringify({ sub, exp, session_id })).toString('base64url'),
    'synthetic-signature-for-offline-tests-only'].join('.');
}

function request(token = jwt()) {
  return new Request(`https://sautilink.invalid/api/dm-realtime/${CONVERSATION}`, {
    headers: { Upgrade: 'websocket', 'Sec-WebSocket-Protocol': `sautilink-dm-v1, sautilink-auth.${token}` },
  });
}

function apiFixture({ result = { allowed: true, code: 'OK', conversation_id: CONVERSATION,
  user_id: USER, peer_id: PEER }, authStatus = 200, rpcStatus = 200, beforeRpcReply = () => {} } = {}) {
  const calls = [];
  const internal = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(input);
    calls.push({ url, init });
    assert.equal(url.origin, 'https://database.invalid');
    assert.equal(init.redirect, 'error');
    if (url.pathname === '/auth/v1/user') return HTTPResponse.json({ id: USER }, { status: authStatus });
    assert.equal(url.pathname, '/rest/v1/rpc/dm_realtime_authorize_v1');
    assert.equal(init.method, 'POST');
    assert.deepEqual(JSON.parse(init.body), { p_conversation_id: CONVERSATION });
    beforeRpcReply();
    return HTTPResponse.json(result, { status: rpcStatus });
  };
  return { calls, internal, env: { DM_REALTIME_SUPABASE_URL: 'https://database.invalid',
    DM_REALTIME_SUPABASE_KEY: 'synthetic-public-key', DM_REALTIME_HUB: { getByName(id) {
      assert.equal(id, CONVERSATION);
      return { async fetch(value) { internal.push(value); return HTTPResponse.json({ forwarded: true }); } };
    } } } };
}

test('valid reciprocal authorization forwards only IDs and a 30 second lease, never the JWT', async () => controlled(async () => {
  const fixture = apiFixture();
  const token = jwt();
  const response = await handleDmRealtimeRequest(request(token), fixture.env);
  assert.equal(response.status, 200);
  assert.equal(fixture.calls.length, 2);
  assert.equal(fixture.internal.length, 1);
  const forwarded = fixture.internal[0];
  assert.equal(new URL(forwarded.url).pathname, '/connect');
  assert.equal(forwarded.headers.get('X-Sauti-Authorization-Expires-At'), String(NOW + LEASE));
  assert.equal(forwarded.headers.get('X-Sauti-Authorization-Checked-At'), String(NOW));
  assert.equal(forwarded.headers.get('X-Sauti-User-ID'), USER);
  assert.equal(forwarded.headers.get('X-Sauti-Peer-ID'), PEER);
  assert.equal(forwarded.headers.get('Authorization'), null);
  assert.equal(forwarded.headers.get('Sec-WebSocket-Protocol'), 'sautilink-dm-v1');
  assert.ok(!JSON.stringify([...forwarded.headers]).includes(token));
}));

test('JWT expiration shortens the lease and expired or invalid claims cannot open a socket', async () => controlled(async () => {
  const fixture = apiFixture();
  await handleDmRealtimeRequest(request(jwt({ exp: (NOW + 5000) / 1000 })), fixture.env);
  assert.equal(fixture.internal[0].headers.get('X-Sauti-Authorization-Expires-At'), String(NOW + 5000));
  for (const token of [jwt({ exp: NOW / 1000 }), jwt({ sub: PEER }), jwt({ session_id: 'invalid' }),
    jwt({ exp: '2000000000' }), 'synthetic-token-that-is-not-a-valid-jwt-at-all']) {
    const rejected = apiFixture();
    assert.equal((await handleDmRealtimeRequest(request(token), rejected.env)).status, 401);
    assert.equal(rejected.calls.length, 1);
    assert.equal(rejected.internal.length, 0);
  }
}));

test('peer or viewer opt-out and either direction block revoke only a validated participant pair', async () => controlled(async () => {
  for (const code of ['ACTIVITY_STATUS_DISABLED', 'MESSAGING_BLOCKED']) {
    const fixture = apiFixture({ result: { allowed: false, code, conversation_id: CONVERSATION,
      user_id: USER, peer_id: PEER } });
    const response = await handleDmRealtimeRequest(request(), fixture.env);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, code);
    assert.equal(fixture.internal.length, 1);
    assert.equal(new URL(fixture.internal[0].url).pathname, '/revoke');
    assert.equal(fixture.internal[0].method, 'POST');
    assert.equal(fixture.internal[0].headers.get('X-Sauti-Peer-ID'), PEER);
  }
}));

test('nonmembers, revoked sessions and malformed RPC data cannot connect or invalidate another thread', async () => controlled(async () => {
  for (const result of [null, {}, { allowed: 'true' }, { allowed: true, conversation_id: CONVERSATION,
    user_id: PEER, peer_id: USER }, { allowed: false, code: 'AUTH_REQUIRED' },
    { allowed: false, code: 'CONVERSATION_UNAVAILABLE' }, { allowed: false, code: 'ACTIVITY_STATUS_DISABLED',
      conversation_id: SESSION, user_id: USER, peer_id: PEER }]) {
    const fixture = apiFixture({ result });
    const response = await handleDmRealtimeRequest(request(), fixture.env);
    assert.ok(response.status === 401 || response.status === 403);
    assert.equal(fixture.internal.length, 0);
  }
}));

test('provider failures and a slow handshake fail closed rather than lengthening authorization', async () => controlled(async ({ advance }) => {
  const failed = apiFixture({ rpcStatus: 503 });
  assert.equal((await handleDmRealtimeRequest(request(), failed.env)).status, 403);
  assert.equal(failed.internal.length, 0);
  const slow = apiFixture({ beforeRpcReply: () => advance(LEASE + 1) });
  assert.equal((await handleDmRealtimeRequest(request(), slow.env)).status, 401);
  assert.equal(slow.internal.length, 0);
  globalThis.fetch = async () => { throw new Error('offline'); };
  assert.equal((await handleDmRealtimeRequest(request(), failed.env)).status, 401);
}));

class Socket {
  readyState = 1;
  sent = [];
  state = null;
  closeCode = null;
  serializeAttachment(value) { this.state = structuredClone(value); }
  deserializeAttachment() { return structuredClone(this.state); }
  send(value) { this.sent.push(JSON.parse(value)); }
  close(code) { this.closeCode = code; this.readyState = 3; }
}

function hubFixture() {
  const sockets = [];
  const data = new Map();
  const reads = [];
  const context = { getWebSockets: () => sockets,
    acceptWebSocket(socket) { sockets.push(socket); },
    storage: { alarmAt: null,
      async put(key, value) { data.set(key, structuredClone(value)); },
      async get(key) { reads.push(key); return structuredClone(data.get(key)); },
      async delete(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) data.delete(key); },
      async list({ prefix }) { return new Map([...data].filter(([key]) => key.startsWith(prefix))); },
      async setAlarm(at) { this.alarmAt = at; }, async deleteAlarm() { this.alarmAt = null; } } };
  globalThis.WebSocketPair = class { constructor() { this[0] = new Socket(); this[1] = new Socket(); } };
  globalThis.Response = class extends HTTPResponse { constructor(body, options) {
    if (options?.status === 101) return { status: 101, webSocket: options.webSocket, headers: new Headers(options.headers) };
    super(body, options);
  } };
  return { sockets, data, reads, context, hub: new DmRealtimeHub(context, {}) };
}

function connect({ userId = USER, peerId = PEER, deadline = Date.now() + LEASE, checkedAt = Date.now() } = {}) {
  return new Request('https://durable.internal/connect', { headers: { Upgrade: 'websocket',
    'Sec-WebSocket-Protocol': 'sautilink-dm-v1', 'X-Sauti-Conversation-ID': CONVERSATION,
    'X-Sauti-User-ID': userId, 'X-Sauti-Peer-ID': peerId,
    'X-Sauti-Authorization-Checked-At': String(checkedAt),
    'X-Sauti-Authorization-Expires-At': String(deadline) } });
}

test('hibernating Hub stores no credentials and enforces its independently bounded deadline', async () => controlled(async () => {
  const fixture = hubFixture();
  const response = await fixture.hub.fetch(connect());
  assert.equal(response.status, 101);
  assert.equal(fixture.context.storage.alarmAt, NOW + LEASE);
  assert.deepEqual(fixture.data.get(`last-seen:${USER}`), { at: NOW, authorizationExpiresAt: NOW + LEASE });
  assert.deepEqual(Object.keys(fixture.sockets[0].state).sort(), ['authorizationCheckedAt', 'authorizationExpiresAt', 'connectedAt',
    'conversationId', 'lastEventAt', 'peerId', 'userId'].sort());
  const restored = new DmRealtimeHub(fixture.context, {});
  await restored.webSocketMessage(fixture.sockets[0], JSON.stringify({ type: 'ping' }));
  assert.equal(fixture.sockets[0].sent.at(-1).type, 'pong');
  for (const deadline of [NOW, NOW + LEASE + 1, NaN]) {
    assert.equal((await restored.fetch(connect({ deadline }))).status, 401);
  }
  assert.equal(fixture.sockets.length, 1);
}));

test('expired sockets cannot send typing or pong and alarm deletes their persisted presence', async () => controlled(async ({ advance }) => {
  const fixture = hubFixture();
  await fixture.hub.fetch(connect());
  const socket = fixture.sockets[0];
  advance(LEASE);
  const start = socket.sent.length;
  await fixture.hub.webSocketMessage(socket, JSON.stringify({ type: 'ping' }));
  assert.equal(socket.closeCode, 1008);
  assert.ok(!socket.sent.slice(start).some((event) => event.type === 'pong' || event.typing === true));
  await fixture.hub.alarm();
  assert.equal(fixture.data.size, 0);
  assert.equal(fixture.context.storage.alarmAt, null);
}));

test('typing/presence target only the current reciprocal participant with a fresh lease', async () => controlled(async ({ advance }) => {
  const fixture = hubFixture();
  await fixture.hub.fetch(connect({ deadline: NOW + 1000 }));
  advance(200);
  await fixture.hub.fetch(connect({ userId: PEER, peerId: USER }));
  const [first, second] = fixture.sockets;
  await fixture.hub.webSocketMessage(first, JSON.stringify({ type: 'typing', typing: true }));
  assert.equal(second.sent.at(-1).typing, true);
  advance(801);
  const count = first.sent.length;
  await fixture.hub.webSocketMessage(second, JSON.stringify({ type: 'typing', typing: true }));
  assert.equal(first.closeCode, 1008);
  assert.ok(!first.sent.slice(count).some((event) => event.typing === true || event.peer_online === true));
  await fixture.hub.broadcastPresence();
  assert.equal(second.sent.at(-1).peer_online, false);
  assert.equal(second.sent.at(-1).peer_last_seen_at, null);
}));

test('legacy bare timestamps and old attachments never regain authorization after deployment/hibernation', async () => controlled(async () => {
  const fixture = hubFixture();
  fixture.data.set(`last-seen:${PEER}`, NOW - 60_000);
  const legacy = new Socket();
  legacy.state = { userId: PEER, peerId: USER, conversationId: CONVERSATION, connectedAt: NOW - 60_000 };
  fixture.sockets.push(legacy);
  await fixture.hub.fetch(connect());
  assert.equal(legacy.closeCode, 1008);
  assert.equal(fixture.data.has(`last-seen:${PEER}`), false);
  assert.equal(fixture.sockets[1].sent.at(-1).peer_last_seen_at, null);
}));

test('validated privacy/block revoke clears both dates, closes all sockets and never reads last-seen', async () => controlled(async () => {
  const fixture = hubFixture();
  await fixture.hub.fetch(connect());
  await fixture.hub.fetch(connect({ userId: PEER, peerId: USER }));
  fixture.reads.length = 0;
  const response = await fixture.hub.fetch(new Request('https://durable.internal/revoke', {
    method: 'POST', headers: { 'X-Sauti-Conversation-ID': CONVERSATION,
      'X-Sauti-User-ID': USER, 'X-Sauti-Peer-ID': PEER } }));
  assert.equal(response.status, 204);
  assert.equal(fixture.data.has(`last-seen:${USER}`), false);
  assert.equal(fixture.data.has(`last-seen:${PEER}`), false);
  assert.deepEqual(fixture.reads, []);
  assert.equal(fixture.context.storage.alarmAt, null);
  for (const socket of fixture.sockets) {
    assert.equal(socket.closeCode, 1008);
    assert.equal(socket.sent.at(-1).peer_last_seen_at, null);
    await fixture.hub.webSocketClose(socket);
  }
  assert.deepEqual([...fixture.data.keys()], ['authorization-revoked-at']);
}));

test('a handshake authorized before revocation cannot restore presence, including across hibernation', async () => controlled(async ({ advance }) => {
  const fixture = hubFixture();
  const startedBeforeRevoke = connect();
  advance(100);
  await fixture.hub.fetch(new Request('https://durable.internal/revoke', {
    method: 'POST', headers: { 'X-Sauti-Conversation-ID': CONVERSATION,
      'X-Sauti-User-ID': USER, 'X-Sauti-Peer-ID': PEER } }));
  const restored = new DmRealtimeHub(fixture.context, {});
  assert.equal((await restored.fetch(startedBeforeRevoke)).status, 401);
  assert.equal(fixture.sockets.length, 0);
  advance(1);
  assert.equal((await restored.fetch(connect())).status, 101);
}));

test('revocation during acceptance closes the socket and erases any in-flight last-seen write', async () => controlled(async () => {
  const fixture = hubFixture();
  const put = fixture.context.storage.put;
  let revoked = false;
  fixture.context.storage.put = async (key, value) => {
    await put(key, value);
    if (key.startsWith('last-seen:') && !revoked) {
      revoked = true;
      await fixture.hub.fetch(new Request('https://durable.internal/revoke', {
        method: 'POST', headers: { 'X-Sauti-Conversation-ID': CONVERSATION,
          'X-Sauti-User-ID': USER, 'X-Sauti-Peer-ID': PEER } }));
    }
  };
  await fixture.hub.fetch(connect());
  assert.equal(fixture.sockets[0].closeCode, 1008);
  assert.ok(!fixture.sockets[0].sent.some((event) => event.type === 'ready' || event.peer_online === true));
  assert.deepEqual([...fixture.data.keys()], ['authorization-revoked-at']);
}));

test('normal close retains recency only within its lease and an idle alarm erases it', async () => controlled(async ({ advance }) => {
  const fixture = hubFixture();
  await fixture.hub.fetch(connect());
  advance(500);
  const socket = fixture.sockets[0];
  socket.readyState = 3;
  await fixture.hub.webSocketClose(socket);
  assert.equal(fixture.data.get(`last-seen:${USER}`).at, NOW + 500);
  assert.equal(fixture.context.storage.alarmAt, NOW + LEASE);
  advance(LEASE);
  await new DmRealtimeHub(fixture.context, {}).alarm();
  assert.equal(fixture.data.size, 0);
  assert.equal(fixture.context.storage.alarmAt, null);
}));

test('hibernation close acknowledges a half-open transport before storage and never reflects the client reason', async () => controlled(async ({ advance }) => {
  const fixture = hubFixture();
  await fixture.hub.fetch(connect());
  advance(500);
  const socket = fixture.sockets[0];
  socket.readyState = 2;
  const replies = [];
  socket.close = (code, reason) => { replies.push({ code, reason }); socket.readyState = 3; };
  const put = fixture.context.storage.put;
  fixture.context.storage.put = async (...args) => {
    assert.equal(socket.readyState, 3, 'The close reply must not wait for durable storage');
    return put(...args);
  };
  await fixture.hub.webSocketClose(socket, 4001, 'untrusted client reason '.repeat(100), true);
  assert.deepEqual(replies, [{ code:4001, reason:'' }]);
  assert.equal(fixture.data.get(`last-seen:${USER}`).at, NOW + 500);
  assert.equal(fixture.context.storage.alarmAt, NOW + LEASE);
}));

test('reserved or invalid close codes use a safe reply and a disconnected transport cannot skip presence cleanup', async () => controlled(async ({ advance }) => {
  for (const code of [undefined, NaN, 999, 1004, 1005, 1006, 1008, 1015, 2999, 5000, '4001']) {
    const fixture = hubFixture();
    await fixture.hub.fetch(connect({ deadline:Date.now() + 500 }));
    const socket = fixture.sockets[0];
    socket.readyState = 2;
    socket.close = (replyCode, reason) => {
      assert.equal(replyCode, 1000);
      assert.equal(reason, '');
      socket.readyState = 3;
      throw new Error('Transport already detached');
    };
    advance(500);
    await fixture.hub.webSocketClose(socket, code, 'private client text', false);
    assert.equal(fixture.data.size, 0);
    assert.equal(fixture.context.storage.alarmAt, null);
  }
}));

test('expiry during a storage await suppresses stale metadata before it reaches the socket', async () => controlled(async ({ advance }) => {
  const fixture = hubFixture();
  await fixture.hub.fetch(connect({ deadline: NOW + 1000 }));
  fixture.data.set(`last-seen:${PEER}`, { at: NOW - 500, authorizationExpiresAt: NOW + 500 });
  const get = fixture.context.storage.get;
  fixture.context.storage.get = async (key) => { const value = await get(key); advance(1100); return value; };
  const socket = fixture.sockets[0];
  socket.sent.length = 0;
  await fixture.hub.broadcastPresence();
  assert.equal(socket.closeCode, 1008);
  assert.ok(socket.sent.every((event) => !event.peer_last_seen_at && event.peer_online !== true));
}));

test('malformed, oversized and rate-limited events cannot amplify durable storage work', async () => controlled(async () => {
  const fixture = hubFixture();
  await fixture.hub.fetch(connect());
  const socket = fixture.sockets[0];
  const list = fixture.context.storage.list;
  let scans = 0;
  fixture.context.storage.list = async (...args) => { scans++; return list(...args); };
  for (const event of ['{', 'x'.repeat(1025), new Uint8Array(20), '{}', '{"type":"typing","typing":"true"}']) {
    await fixture.hub.webSocketMessage(socket, event);
  }
  assert.equal(scans, 0);
  await fixture.hub.webSocketMessage(socket, '{"type":"ping"}');
  assert.equal(scans, 1);
  await fixture.hub.webSocketMessage(socket, '{"type":"ping"}');
  assert.equal(scans, 1);
}));
