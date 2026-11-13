import { authenticate, readRoomActionBody, roomUuid } from './room-post-approval-api.js';

const SUPABASE = 'https://rggpyiterdbbugluejcs.supabase.co';
const PUBLIC_KEY = 'sb_publishable_omJ-5Mem-K4vgm6WLXRzJQ_jeGs65ca';
const modes = new Set(['meeting', 'host', 'viewer']);
const encode = (bytes) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const utf8 = new TextEncoder();
const staff = new Set(['owner', 'admin', 'moderator']);
const settingValues = {
  privacy: ['public', 'private'],
  join_policy: ['open', 'approval', 'private'],
  post_permission: ['all_members', 'staff_only'],
  invite_permission: ['all_members', 'staff_only'],
};

function response(status, payload) {
  return Response.json(payload, { status, headers: {
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Authorization',
  } });
}

function error(status, code) {
  return response(status, { ok: false, error: { code } });
}

function mayHost(role) {
  return role === 'owner' || role === 'admin';
}

async function memberships(session, roomId) {
  const query = new URLSearchParams({
    select: 'circle_id,member_role,room:social_circles!inner(name)',
    member_id: 'eq.' + session.user.id,
    order: 'circle_id.asc',
    limit: roomId ? '1' : '100',
  });
  if (roomId) query.set('circle_id', 'eq.' + roomId);
  return (await readRows(session, 'social_circle_members', query)).filter((row) =>
    roomUuid(row?.circle_id) && typeof row.room?.name === 'string'
    && ['owner', 'admin', 'moderator', 'member'].includes(row.member_role));
}

async function readRows(session, table, query, options = {}) {
  const result = await fetch(SUPABASE + '/rest/v1/' + table + '?' + query, {
    signal: AbortSignal.timeout(8000),
    ...options,
    headers: { apikey: PUBLIC_KEY, Authorization: session.auth, Accept: 'application/json', ...options.headers },
  });
  if (!result.ok) throw new Error('Room query failed');
  const rows = await result.json();
  if (!Array.isArray(rows)) throw new Error('Invalid Room response');
  return rows;
}

const roomFields = 'id,name,slug,description,privacy,join_policy,post_permission,invite_permission,member_count,updated_at';

async function roomDetail(session, env, roomId, role) {
  const [rooms, messages, members] = await Promise.all([
    readRows(session, 'social_circles', new URLSearchParams({ select: roomFields, id: 'eq.' + roomId, limit: '1' })),
    readRows(session, 'social_posts', new URLSearchParams({
      select: 'id,author_id,body,created_at,media_count,author:social_profiles!social_posts_author_id_fkey(username,display_name)',
      circle_id: 'eq.' + roomId, visibility: 'eq.circle', reply_to_post_id: 'is.null',
      post_status: 'eq.published', deleted_at: 'is.null',
      order: 'created_at.desc,id.desc', limit: '50',
    })),
    readRows(session, 'social_circle_members', new URLSearchParams({
      select: 'member_role,profile:social_profiles!social_circle_members_member_id_fkey(display_name,username)',
      circle_id: 'eq.' + roomId, order: 'member_id.asc', limit: '100',
    })),
  ]);
  const [room] = rooms;
  if (!room) return error(404, 'ROOM_UNAVAILABLE');
  return response(200, { ok: true, room: {
    ...room, can_manage: mayHost(role), can_post: room.post_permission !== 'staff_only' || staff.has(role),
    sessions_available: Boolean(liveKitConfig(env)),
  }, messages: messages.reverse().map((message) => ({
    id: message.id, body: message.body, created_at: message.created_at,
    author: message.author?.display_name || message.author?.username || '',
    mine: message.author_id === session.user.id, media_count: message.media_count,
  })), members: members.map((member) => ({
    name: member.profile?.display_name || member.profile?.username || '', role: member.member_role,
  })) });
}

async function saveRoom(request, env, session, roomId) {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return error(415, 'JSON_REQUIRED');
  }
  const body = await readRoomActionBody(request, { limit: 8192 });
  if (body.response) return body.response;
  const input = body.payload;
  const name = typeof input?.name === 'string' ? input.name.trim() : '';
  const description = typeof input?.description === 'string' ? input.description.trim() : null;
  const version = input?.updated_at;
  if (!name || [...name].length > 80 || description === null || [...description].length > 1000
    || typeof version !== 'string' || !Number.isFinite(Date.parse(version))
    || Object.entries(settingValues).some(([field, values]) => !values.includes(input[field]))
    || (input.privacy === 'private' && input.join_policy === 'open')) return error(400, 'INVALID_ROOM_SETTINGS');

  if (!env.SAUTI_CREATE_LIMITER?.limit) return error(503, 'DESKTOP_ROOMS_UNAVAILABLE');
  if (!(await env.SAUTI_CREATE_LIMITER.limit({ key: 'desktop-settings:' + session.user.id }))?.success) {
    return error(429, 'RATE_LIMITED');
  }
  const payload = { name, description, updated_at: new Date().toISOString() };
  for (const field of Object.keys(settingValues)) payload[field] = input[field];
  const rows = await readRows(session, 'social_circles', new URLSearchParams({
    id: 'eq.' + roomId, updated_at: 'eq.' + version, select: roomFields,
  }), { method: 'PATCH', body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' } });
  return rows.length ? response(200, { ok: true, room: rows[0] }) : error(409, 'ROOM_SETTINGS_CHANGED');
}

function liveKitConfig(env) {
  try {
    const url = new URL(env.SAUTILINK_DESKTOP_LIVEKIT_URL);
    if (url.protocol === 'wss:' && !url.username && !url.password && !url.search && !url.hash
      && typeof env.SAUTILINK_DESKTOP_LIVEKIT_KEY === 'string' && env.SAUTILINK_DESKTOP_LIVEKIT_KEY
      && typeof env.SAUTILINK_DESKTOP_LIVEKIT_SECRET === 'string' && env.SAUTILINK_DESKTOP_LIVEKIT_SECRET.length >= 32) {
      return url.toString();
    }
  } catch { /* missing or invalid endpoint */ }
  return null;
}

async function participantToken(env, accountId, roomId, mode) {
  const key = await crypto.subtle.importKey('raw', utf8.encode(env.SAUTILINK_DESKTOP_LIVEKIT_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: env.SAUTILINK_DESKTOP_LIVEKIT_KEY, sub: accountId, nbf: now - 5, exp: now + 300,
    video: {
      roomJoin: true, room: 'sautilink-' + (mode === 'meeting' ? 'meeting-' : 'live-') + roomId,
      canPublish: mode !== 'viewer', canSubscribe: true, canPublishData: false,
    },
  };
  const data = encode(utf8.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))) + '.'
    + encode(utf8.encode(JSON.stringify(payload)));
  return data + '.' + encode(new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8.encode(data))));
}

export async function handleDesktopRoomsRequest(request, env) {
  const path = new URL(request.url).pathname;
  const listing = path === '/api/desktop/rooms';
  const detail = path.match(/^\/api\/desktop\/rooms\/([^/]+)\/(detail|settings)$/);
  if (!listing && !detail && path !== '/api/desktop/rooms/join') return null;
  if (request.method !== (listing || detail?.[2] === 'detail' ? 'GET' : 'POST')) return error(405, 'METHOD_NOT_ALLOWED');
  try {
    const session = await authenticate(request);
    if (!session) return error(401, 'AUTH_REQUIRED');

    if (listing) {
      const rows = await memberships(session);
      return response(200, { ok: true, rooms: rows.map((row) => ({
        id: row.circle_id, name: row.room.name, can_host: mayHost(row.member_role),
      })) });
    }
    if (detail) {
      const id = roomUuid(detail[1]);
      if (!id) return error(400, 'INVALID_ROOM_REQUEST');
      const [member] = await memberships(session, id);
      if (!member) return error(403, 'ROOM_ACCESS_DENIED');
      if (detail[2] === 'detail') return await roomDetail(session, env, id, member.member_role);
      if (!mayHost(member.member_role)) return error(403, 'ROOM_ACCESS_DENIED');
      return await saveRoom(request, env, session, id);
    }

    if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      return error(415, 'JSON_REQUIRED');
    }
    const body = await readRoomActionBody(request, { limit: 2048 });
    if (body.response) return body.response;
    const mode = body.payload?.mode;
    const roomId = roomUuid(body.payload?.room_id);
    if (!roomId || !modes.has(mode)) return error(400, 'INVALID_ROOM_REQUEST');
    const limiter = env.SAUTI_CREATE_LIMITER;
    if (!limiter?.limit) return error(503, 'DESKTOP_ROOMS_UNAVAILABLE');
    if (!(await limiter.limit({ key: 'desktop-room:' + session.user.id }))?.success) {
      return error(429, 'RATE_LIMITED');
    }
    const [membership] = await memberships(session, roomId);
    if (!membership || (mode === 'host' && !mayHost(membership.member_role))) {
      return error(403, 'ROOM_ACCESS_DENIED');
    }
    const url = liveKitConfig(env);
    if (!url) return error(503, 'LIVEKIT_UNAVAILABLE');
    return response(200, { ok: true, url, token: await participantToken(env, session.user.id, roomId, mode) });
  } catch {
    return error(503, 'DESKTOP_ROOMS_UNAVAILABLE');
  }
}
