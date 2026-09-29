import { inspectImageBytes } from './profile-media-api.js';

const SUPABASE_URL = 'https://rggpyiterdbbugluejcs.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_omJ-5Mem-K4vgm6WLXRzJQ_jeGs65ca';
const COVER_LIMIT = 10 * 1024 * 1024;
const COVER_VARIANT_WIDTHS = Object.freeze([480, 960, 1440]);
const COVER_EDGE_TTL_SECONDS = 31536000;
const COVER_BROWSER_TTL_SECONDS = 604800;
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

function normalizeCoverWidth(value) {
  const requested = Math.max(1, Number(value) || 960);
  return COVER_VARIANT_WIDTHS.reduce((best, candidate) => (
    Math.abs(candidate - requested) < Math.abs(best - requested) ? candidate : best
  ));
}

function coverVersionToken(room) {
  const leaf = String(room?.cover_key || '').split('/').pop() || '';
  return leaf.replace(/\.[^.]+$/, '').slice(0, 80);
}

function coverVariantEtag(room, width) {
  const version = coverVersionToken(room) || String(room?.id || 'room');
  return `"room-cover-${version}-${width}"`;
}

function requestHasEtag(request, etag) {
  return String(request.headers.get('If-None-Match') || '')
    .split(',')
    .map((value) => value.trim())
    .includes(etag);
}

function coverClientHeaders(contentType, etag, width, immutable = false) {
  const headers = new Headers();
  headers.set('Content-Type', contentType || 'image/webp');
  headers.set(
    'Cache-Control',
    immutable
      ? `private, max-age=${COVER_BROWSER_TTL_SECONDS}, stale-while-revalidate=86400, immutable`
      : 'private, max-age=3600, stale-while-revalidate=86400',
  );
  headers.set('ETag', etag);
  headers.set('Vary', 'Authorization');
  headers.set('Content-Security-Policy', "default-src 'none'");
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Content-Disposition', 'inline');
  headers.set('X-Sauti-Room-Cover-Variant', `w=${width}`);
  return headers;
}

function coverVariantCacheKey(request, room, width) {
  const url = new URL(request.url);
  url.search = '';
  url.searchParams.set('w', String(width));
  url.searchParams.set('v', coverVersionToken(room) || 'legacy');
  return new Request(url.toString(), { method: 'GET' });
}

async function serveOriginalCover(request, env, room, width, etag, immutable, cachedObject = null) {
  const object = cachedObject || await env.PROFILE_MEDIA.get(room.cover_key);
  if (!object) return apiError(404, 'MEDIA_NOT_FOUND', 'This Room cover photo is unavailable.');

  const headers = coverClientHeaders(
    object.httpMetadata?.contentType || 'application/octet-stream',
    etag,
    width,
    immutable,
  );
  headers.set('X-Sauti-Room-Cover-Cache', 'BYPASS');
  headers.set('X-Sauti-Room-Cover-Variant', `original;requested=${width}`);
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
  return new Response(object.body, { status: 200, headers });
}

async function serveCover(request, env, slug) {
  if (!env.PROFILE_MEDIA) return apiError(503, 'MEDIA_NOT_READY', 'Room media is not enabled yet.');
  const session = await authenticate(request);
  if (!session) return apiError(401, 'AUTH_REQUIRED', 'Sign in to view this Room cover.');

  const room = await roomBySlug(slug, session.auth);
  if (!room?.cover_key) return apiError(404, 'MEDIA_NOT_FOUND', 'This Room does not have a cover photo.');

  const url = new URL(request.url);
  const width = normalizeCoverWidth(url.searchParams.get('w'));
  const version = coverVersionToken(room);
  const immutable = Boolean(version && url.searchParams.get('v') === version);
  const etag = coverVariantEtag(room, width);
  const clientHeaders = coverClientHeaders('image/webp', etag, width, immutable);

  if (requestHasEtag(request, etag)) return new Response(null, { status: 304, headers: clientHeaders });
  if (request.method === 'HEAD' && env.IMAGES) return new Response(null, { status: 200, headers: clientHeaders });

  if (!env.IMAGES) return serveOriginalCover(request, env, room, width, etag, immutable);

  const cache = globalThis.caches?.default;
  const cacheKey = coverVariantCacheKey(request, room, width);
  if (cache && request.method === 'GET') {
    const cached = await cache.match(cacheKey).catch(() => null);
    if (cached) {
      const headers = coverClientHeaders(cached.headers.get('Content-Type') || 'image/webp', etag, width, immutable);
      headers.set('X-Sauti-Room-Cover-Cache', 'HIT');
      return new Response(cached.body, { status: 200, headers });
    }
  }

  const original = await env.PROFILE_MEDIA.get(room.cover_key);
  if (!original) return apiError(404, 'MEDIA_NOT_FOUND', 'This Room cover photo is unavailable.');

  const sourceWidth = Math.max(1, Number(original.customMetadata?.width || width));
  const targetWidth = Math.max(1, Math.min(width, sourceWidth));

  try {
    const output = await env.IMAGES
      .input(original.body)
      .transform({ width: targetWidth, fit: 'scale-down' })
      .output({ format: 'image/webp', quality: 84, anim: true });
    const transformed = output.response();
    if (!transformed.ok) return serveOriginalCover(request, env, room, width, etag, immutable, original);

    const edgeHeaders = new Headers();
    edgeHeaders.set('Content-Type', transformed.headers.get('Content-Type') || 'image/webp');
    edgeHeaders.set('Cache-Control', `public, max-age=${COVER_EDGE_TTL_SECONDS}, immutable`);
    edgeHeaders.set('ETag', etag);
    edgeHeaders.set('X-Sauti-Room-Cover-Variant', `w=${width};source=${sourceWidth};target=${targetWidth}`);
    const edgeResponse = new Response(transformed.body, { status: 200, headers: edgeHeaders });

    if (cache && request.method === 'GET') await cache.put(cacheKey, edgeResponse.clone()).catch(() => {});

    const headers = coverClientHeaders(edgeHeaders.get('Content-Type') || 'image/webp', etag, width, immutable);
    headers.set('X-Sauti-Room-Cover-Cache', 'MISS');
    headers.set('X-Sauti-Room-Cover-Variant', edgeHeaders.get('X-Sauti-Room-Cover-Variant'));
    return new Response(edgeResponse.body, { status: 200, headers });
  } catch {
    return serveOriginalCover(request, env, room, width, etag, immutable, original);
  }
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
