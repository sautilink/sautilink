import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { handleDesktopRoomsRequest } from '../src/desktop-rooms-api.js';
import router from '../src/asset-router.js';

const account = '129e39f7-d5b1-48a7-8e3b-1d04309e69d9';
const room = '5b55a04d-3e7a-4057-b92c-1cc9a12675d1';
const env = {
  SAUTILINK_DESKTOP_LIVEKIT_URL: 'wss://rtc.example.test',
  SAUTILINK_DESKTOP_LIVEKIT_KEY: 'test',
  SAUTILINK_DESKTOP_LIVEKIT_SECRET: 'local-test-key-with-at-least-32-characters',
  SAUTI_CREATE_LIMITER: { limit: async () => ({ success: true }) },
};
const endpoint = 'https://sautilink.test/api/desktop/rooms';
const headers = { Authorization: 'Bearer account-token', 'Content-Type': 'application/json' };
const join = (mode, extra = {}) => new Request(endpoint + '/join', {
  method: 'POST', headers, body: JSON.stringify({ room_id: room, mode, ...extra }),
});

function mockSupabase(t, role) {
  t.mock.method(globalThis, 'fetch', async (input, options) => {
    const url = new URL(input);
    assert.equal(options.headers.Authorization, headers.Authorization);
    if (url.pathname === '/auth/v1/user') return Response.json({ id: account });
    assert.equal(url.pathname, '/rest/v1/social_circle_members');
    assert.equal(url.searchParams.get('member_id'), 'eq.' + account);
    if (url.searchParams.has('circle_id')) assert.equal(url.searchParams.get('circle_id'), 'eq.' + room);
    return Response.json(role ? [{ circle_id: room, member_role: role, room: { name: 'Room A' } }] : []);
  });
}

test('the asset router routes Windows Rooms and protects them from anonymous access', async () => {
  for (const request of [new Request(endpoint), new Request(endpoint + '/' + room + '/detail'), new Request(endpoint + '/join', { method: 'POST' })]) {
    const result = await router.fetch(request, {}, {});
    assert.equal(result.status, 401);
    assert.equal(result.headers.get('Cache-Control'), 'no-store');
    assert.equal((await result.json()).error.code, 'AUTH_REQUIRED');
  }
});

test('Rooms listing reports membership and hosting ability', async (t) => {
  mockSupabase(t, 'owner');
  const response = await handleDesktopRoomsRequest(new Request(endpoint, { headers }), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual((await response.json()).rooms, [{ id: room, name: 'Room A', can_host: true }]);
});

test('member cannot host by sending a role in the body', async (t) => {
  mockSupabase(t, 'member');
  assert.equal((await handleDesktopRoomsRequest(join('host', { role: 'owner' }), env)).status, 403);
  const response = await handleDesktopRoomsRequest(join('viewer'), env);
  assert.equal(response.status, 200);
  const data = await response.json();
  const [header, payload, signature] = data.token.split('.');
  assert.equal(signature, createHmac('sha256', env.SAUTILINK_DESKTOP_LIVEKIT_SECRET).update(header + '.' + payload).digest('base64url'));
  const jwt = JSON.parse(Buffer.from(payload, 'base64url'));
  assert.equal(jwt.sub, account);
  assert.ok(jwt.exp - Math.floor(Date.now() / 1000) <= 300);
  assert.deepEqual(jwt.video, { roomJoin: true, room: 'sautilink-live-' + room,
    canPublish: false, canSubscribe: true, canPublishData: false });
  const meeting = await (await handleDesktopRoomsRequest(join('meeting'), env)).json();
  const meetingGrant = JSON.parse(Buffer.from(meeting.token.split('.')[1], 'base64url')).video;
  assert.equal(meetingGrant.room, 'sautilink-meeting-' + room);
  assert.equal(meetingGrant.canPublish, true);
});

test('admin can host and no membership means no join', async (t) => {
  await t.test('admin', async (t) => {
    mockSupabase(t, 'admin');
    const data = await (await handleDesktopRoomsRequest(join('host'), env)).json();
    const grant = JSON.parse(Buffer.from(data.token.split('.')[1], 'base64url')).video;
    assert.equal(grant.canPublish, true);
    assert.equal(grant.room, 'sautilink-live-' + room);
    const unavailable = await handleDesktopRoomsRequest(join('host'), { ...env, SAUTILINK_DESKTOP_LIVEKIT_SECRET: '' });
    assert.equal(unavailable.status, 503);
    assert.equal((await unavailable.json()).error.code, 'LIVEKIT_UNAVAILABLE');
  });
  await t.test('nonmember', async (t) => {
    mockSupabase(t, null);
    assert.equal((await handleDesktopRoomsRequest(join('viewer'), env)).status, 403);
    assert.equal((await handleDesktopRoomsRequest(new Request(endpoint), env)).status, 401);
  });
});

const roomVersion = '2026-11-13T10:00:00.000Z';
const detail = () => new Request(endpoint + '/' + room + '/detail', { headers });
const changes = {
  name: 'Room mpya', description: 'Maelezo', privacy: 'private', join_policy: 'approval',
  post_permission: 'staff_only', invite_permission: 'all_members',
};
const settings = (overrides = {}) => new Request(endpoint + '/' + room + '/settings', {
  method: 'POST', headers, body: JSON.stringify({ ...changes, updated_at: roomVersion, ...overrides }),
});

test('Room detail requires membership', async (t) => {
  mockSupabase(t, null);
  assert.equal((await handleDesktopRoomsRequest(detail(), env)).status, 403);
});

test('Room detail returns recent published messages, participant names, and permissions', async (t) => {
  const other = '6040fc9d-06bf-4402-ac9d-1628f81982db';
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (input, options) => {
    const url = new URL(input);
    const table = url.pathname.split('/').at(-1);
    const query = url.searchParams;
    requests.push({ table, query, authorization: options.headers.Authorization });
    if (table === 'user') return Response.json({ id: account });
    if (table === 'social_circles') return Response.json([{ ...changes, id: room, updated_at: roomVersion }]);
    if (table === 'social_circle_members' && query.has('member_id')) {
      return Response.json([{ circle_id: room, member_role: 'member', room: { name: 'Room mpya' } }]);
    }
    if (table === 'social_circle_members') return Response.json([{ member_role: 'admin', profile: { display_name: 'Amina' } }]);
    if (table === 'social_posts') return Response.json([
      { id: 'newer', body: 'Pili', author_id: account, media_count: 0, author: { username: 'me' } },
      { id: 'older', body: 'Kwanza', author_id: other, media_count: 1, author: { display_name: 'Amina' } },
    ]);
    return new Response(null, { status: 500 });
  });
  const result = await handleDesktopRoomsRequest(detail(), env);
  assert.equal(result.status, 200);
  const data = await result.json();
  assert.equal(data.room.can_manage, false);
  assert.equal(data.room.can_post, false);
  assert.equal(data.room.sessions_available, true);
  assert.deepEqual(data.members, [{ name: 'Amina', role: 'admin' }]);
  assert.deepEqual(data.messages.map(({ id, author, mine }) => ({ id, author, mine })), [
    { id: 'older', author: 'Amina', mine: false }, { id: 'newer', author: 'me', mine: true },
  ]);
  assert.ok(requests.every(({ authorization }) => authorization === headers.Authorization));
  const posts = requests.find(({ table }) => table === 'social_posts').query;
  assert.equal(posts.get('circle_id'), 'eq.' + room);
  assert.equal(posts.get('post_status'), 'eq.published');
  assert.equal(posts.get('deleted_at'), 'is.null');
  assert.equal(posts.get('limit'), '50');
  const chatOnly = await handleDesktopRoomsRequest(detail(), { ...env, SAUTILINK_DESKTOP_LIVEKIT_URL: '' });
  assert.equal(chatOnly.status, 200);
  assert.equal((await chatOnly.json()).room.sessions_available, false);
});

test('only Owner and Admin can edit settings', async (t) => {
  mockSupabase(t, 'moderator');
  assert.equal((await handleDesktopRoomsRequest(settings({ role: 'owner' }), env)).status, 403);
});

test('settings update validates privacy and rejects a stale version', async (t) => {
  let write = null;
  let version = roomVersion;
  t.mock.method(globalThis, 'fetch', async (input, options) => {
    const url = new URL(input);
    if (url.pathname === '/auth/v1/user') return Response.json({ id: account });
    if (url.pathname === '/rest/v1/social_circle_members') {
      return Response.json([{ circle_id: room, member_role: 'admin', room: { name: 'Room A' } }]);
    }
    write = { url, options, body: JSON.parse(options.body) };
    if (url.searchParams.get('updated_at') !== 'eq.' + version) return Response.json([]);
    version = write.body.updated_at;
    return Response.json([{ id: room, ...write.body }]);
  });
  assert.equal((await handleDesktopRoomsRequest(settings({ join_policy: 'open' }), env)).status, 400);
  assert.equal(write, null);
  assert.equal((await handleDesktopRoomsRequest(settings({ owner_id: account }), env)).status, 200);
  assert.equal(write.options.headers.Authorization, headers.Authorization);
  assert.equal(write.options.method, 'PATCH');
  assert.equal(write.url.pathname, '/rest/v1/social_circles');
  assert.equal(write.url.searchParams.get('id'), 'eq.' + room);
  assert.deepEqual(write.body, { ...changes, updated_at: version });
  assert.equal((await handleDesktopRoomsRequest(settings(), env)).status, 409);
});
