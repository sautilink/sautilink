import { inspectImageBytes } from './profile-media-api.js';

const SUPABASE_URL = 'https://rggpyiterdbbugluejcs.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_omJ-5Mem-K4vgm6WLXRzJQ_jeGs65ca';
const COVER_LIMIT = 10 * 1024 * 1024;
const CONTENT_TYPES = {
  'image/jpeg': { extension: 'jpg' },
  'image/png': { extension: 'png' },
  'image/webp': { extension: 'webp' },
};
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{2,49}$/;

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function apiError(status, code, message) {
  return json(status, { ok: false, error: { code, message } });
}

function authorization(request) {
  const value = request.headers.get('Authorization') || '';
  return /^Bearer\s+[^\s]+$/i.test(value) ? value : '';
}

function supabaseHeaders(auth = '') {
  const headers = { apikey: SUPABASE_PUBLISHABLE_KEY, Accept: 'application/json' };
  if (auth) headers.Authorization = auth;
  return headers;
}

async function authenticate(request) {
  const auth = authorization(request);
  if (!auth) return null;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: supabaseHeaders(auth) });
  if (!response.ok) return null;
  const user = await response.json().catch(() => null);
  return user?.id ? { auth, user } : null;
}

async function roomById(id, auth) {
  const params = new URLSearchParams({
    id: `eq.${id}`,
    select: 'id,owner_id,slug,privacy,cover_key',
    limit: '1',
  });
  const response = await fetch(`${SUPABASE_URL}/rest/v1/social_circles?${params}`, { headers: supabaseHeaders(auth) });
  if (!response.ok) return null;
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function roomBySlug(slug, auth) {
  const params = new URLSearchParams({
    slug: `eq.${slug}`,
    select: 'id,owner_id,slug,privacy,cover_key',
    limit: '1',
  });
  const response = await fetch(`${SUPABASE_URL}/rest/v1/social_circles?${params}`, { headers: supabaseHeaders(auth) });
  if (!response.ok) return null;
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function memberRole(roomId, userId, auth) {
  const params = new URLSearchParams({
    circle_id: `eq.${roomId}`,
    member_id: `eq.${userId}`,
    select: 'member_role',
    limit: '1',
  });
  const response = await fetch(`${SUPABASE_URL}/rest/v1/social_circle_members?${params}`, { headers: supabaseHeaders(auth) });
  if (!response.ok) return '';
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? String(rows[0]?.member_role || '') : '';
}

async function canManage(room, session) {
  if (!room || !session) return false;
  if (room.owner_id === session.user.id) return true;
  return (await memberRole(room.id, session.user.id, session.auth)) === 'admin';
}

async function patchCoverKey(roomId, auth, coverKey) {
  const params = new URLSearchParams({ id: `eq.${roomId}`, select: 'id,cover_key' });
  const response = await fetch(`${SUPABASE_URL}/rest/v1/social_circles?${params}`, {
    method: 'PATCH',
    headers: {
      ...supabaseHeaders(auth),
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({ cover_key: coverKey, updated_at: new Date().toISOString() }),
  });
  if (!response.ok) return null;
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows[0] || null : null;
}

function coverRoute(pathname) {
  const match = pathname.match(/^\/api\/room-media\/([a-z0-9][a-z0-9-]{2,49})\/cover$/);
  return match ? match[1] : '';
}

async function serveCover(request, env, slug) {
  if (!env.PROFILE_MEDIA) return apiError(503, 'MEDIA_NOT_READY', 'Room media is not enabled yet.');
  const session = await authenticate(request);
  if (!session) return apiError(401, 'AUTH_REQUIRED', 'Sign in to view this Room cover.');

  const room = await roomBySlug(slug, session.auth);
  if (!room?.cover_key) return apiError(404, 'MEDIA_NOT_FOUND', 'This Room does not have a cover photo.');

  const object = await env.PROFILE_MEDIA.get(room.cover_key);
  if (!object) return apiError(404, 'MEDIA_NOT_FOUND', 'This Room cover photo is unavailable.');

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Cache-Control', 'private, no-store, max-age=0');
  headers.set('Content-Security-Policy', "default-src 'none'");
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Content-Disposition', 'inline');
  if (!headers.get('Content-Type')) headers.set('Content-Type', 'application/octet-stream');
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
  return new Response(object.body, { status: 200, headers });
}

async function uploadCover(request, env) {
  if (!env.PROFILE_MEDIA) return apiError(503, 'MEDIA_NOT_READY', 'Room media is not enabled yet.');
  const session = await authenticate(request);
  if (!session) return apiError(401, 'AUTH_REQUIRED', 'Sign in before changing a Room cover photo.');

  const contentLength = Number(request.headers.get('Content-Length') || '0');
  if (contentLength > COVER_LIMIT + 65536) return apiError(413, 'FILE_TOO_LARGE', 'Room cover photos must be 10 MB or smaller.');

  let form;
  try {
    form = await request.formData();
  } catch {
    return apiError(400, 'INVALID_FORM', 'The cover upload request is invalid.');
  }

  const roomId = String(form.get('room_id') || '').trim().toLowerCase();
  const file = form.get('file');
  if (!/^[0-9a-f-]{36}$/.test(roomId)) return apiError(400, 'INVALID_ROOM', 'Choose a valid Room.');
  if (!(file instanceof File)) return apiError(400, 'FILE_REQUIRED', 'Choose a cover photo.');
  if (!CONTENT_TYPES[file.type]) return apiError(415, 'UNSUPPORTED_IMAGE', 'Use a JPEG, PNG or WebP image.');
  if (file.size < 1 || file.size > COVER_LIMIT) return apiError(413, 'FILE_TOO_LARGE', 'Room cover photos must be 10 MB or smaller.');

  const room = await roomById(roomId, session.auth);
  if (!room || !(await canManage(room, session))) return apiError(403, 'ROOM_ADMIN_REQUIRED', 'Only Room owners and admins can change the cover photo.');

  const bytes = new Uint8Array(await file.arrayBuffer());
  const inspected = inspectImageBytes(bytes);
  if (!inspected || inspected.contentType !== file.type) {
    return apiError(415, 'INVALID_IMAGE_BYTES', 'The file contents do not match a supported image format.');
  }
  if (inspected.width < 600 || inspected.height < 200) {
    return apiError(422, 'COVER_TOO_SMALL', 'Choose a cover photo at least 600 × 200 pixels.');
  }

  const extension = CONTENT_TYPES[file.type].extension;
  const objectKey = `rooms/${room.id}/cover/${crypto.randomUUID()}.${extension}`;
  const oldKey = room.cover_key;

  try {
    await env.PROFILE_MEDIA.put(objectKey, bytes, {
      httpMetadata: { contentType: file.type },
      customMetadata: {
        roomId: room.id,
        uploadedBy: session.user.id,
        slot: 'room-cover',
        width: String(inspected.width),
        height: String(inspected.height),
      },
    });

    const updated = await patchCoverKey(room.id, session.auth, objectKey);
    if (!updated) {
      await env.PROFILE_MEDIA.delete(objectKey).catch(() => {});
      return apiError(409, 'MEDIA_FINALIZE_FAILED', 'The cover photo was uploaded but could not be attached to the Room.');
    }
    if (oldKey && oldKey !== objectKey) await env.PROFILE_MEDIA.delete(oldKey).catch(() => {});

    return json(200, {
      ok: true,
      data: { slug: room.slug, width: inspected.width, height: inspected.height, contentType: file.type },
    });
  } catch {
    await env.PROFILE_MEDIA.delete(objectKey).catch(() => {});
    return apiError(502, 'MEDIA_UPLOAD_FAILED', 'The Room cover photo could not be stored. Try again.');
  }
}

async function removeCover(request, env) {
  if (!env.PROFILE_MEDIA) return apiError(503, 'MEDIA_NOT_READY', 'Room media is not enabled yet.');
  const session = await authenticate(request);
  if (!session) return apiError(401, 'AUTH_REQUIRED', 'Sign in before changing a Room cover photo.');
  const payload = await request.json().catch(() => null);
  const roomId = String(payload?.room_id || '').trim().toLowerCase();
  if (!/^[0-9a-f-]{36}$/.test(roomId)) return apiError(400, 'INVALID_ROOM', 'Choose a valid Room.');

  const room = await roomById(roomId, session.auth);
  if (!room || !(await canManage(room, session))) return apiError(403, 'ROOM_ADMIN_REQUIRED', 'Only Room owners and admins can remove the cover photo.');
  if (!room.cover_key) return json(200, { ok: true, data: { removed: false } });

  const updated = await patchCoverKey(room.id, session.auth, null);
  if (!updated) return apiError(409, 'MEDIA_REMOVE_FAILED', 'The Room cover photo could not be removed.');
  await env.PROFILE_MEDIA.delete(room.cover_key).catch(() => {});
  return json(200, { ok: true, data: { removed: true } });
}

export async function handleRoomMediaRequest(request, env) {
  const url = new URL(request.url);
  const slug = coverRoute(url.pathname);
  if (slug && (request.method === 'GET' || request.method === 'HEAD')) return serveCover(request, env, slug);
  if (url.pathname === '/api/room-media/upload' && request.method === 'POST') return uploadCover(request, env);
  if (url.pathname === '/api/room-media/remove' && request.method === 'DELETE') return removeCover(request, env);
  return null;
}
