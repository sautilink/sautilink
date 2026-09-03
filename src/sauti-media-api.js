import { inspectImageBytes } from './profile-media-api.js';

const SUPABASE_URL = 'https://rggpyiterdbbugluejcs.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_omJ-5Mem-K4vgm6WLXRzJQ_jeGs65ca';
const IMAGE_LIMIT = 8 * 1024 * 1024;
const VIDEO_LIMIT = 25 * 1024 * 1024;
const MAX_VIDEO_DURATION_MS = 90_000;
const MAX_DIMENSION = 8192;
const UPLOAD_TTL_MS = 60 * 60 * 1000;

const TYPES = {
  'image/jpeg': { kind: 'image', extension: 'jpg', limit: IMAGE_LIMIT },
  'image/png': { kind: 'image', extension: 'png', limit: IMAGE_LIMIT },
  'image/webp': { kind: 'image', extension: 'webp', limit: IMAGE_LIMIT },
  'video/mp4': { kind: 'video', extension: 'mp4', limit: VIDEO_LIMIT },
};

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

async function consumeLimit(binding, key) {
  if (!binding?.limit) return { ready: false, allowed: false };
  const result = await binding.limit({ key });
  return { ready: true, allowed: Boolean(result?.success) };
}

function uuid(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)
    ? normalized
    : '';
}

function fixed16(value) {
  return Math.max(0, Math.round(value / 65536));
}

function boxType(bytes, offset) {
  if (offset + 8 > bytes.length) return '';
  return String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
}

function boxSize(view, bytes, offset) {
  if (offset + 8 > bytes.length) return 0;
  const size32 = view.getUint32(offset, false);
  if (size32 === 0) return bytes.length - offset;
  if (size32 === 1) {
    if (offset + 16 > bytes.length) return 0;
    const high = view.getUint32(offset + 8, false);
    const low = view.getUint32(offset + 12, false);
    const value = high * 2 ** 32 + low;
    return Number.isSafeInteger(value) ? value : 0;
  }
  return size32;
}

function findBoxes(bytes, start, end, wanted) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const found = [];
  let offset = start;
  while (offset + 8 <= end) {
    const size = boxSize(view, bytes, offset);
    if (size < 8 || offset + size > end) break;
    const type = boxType(bytes, offset);
    if (wanted.has(type)) found.push({ type, offset, size, header: view.getUint32(offset, false) === 1 ? 16 : 8 });
    offset += size;
  }
  return found;
}

export function inspectMp4Bytes(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 32) return null;
  const top = findBoxes(bytes, 0, bytes.length, new Set(['ftyp', 'moov']));
  if (!top.some((box) => box.type === 'ftyp')) return null;
  const moov = top.find((box) => box.type === 'moov');
  if (!moov) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const children = findBoxes(bytes, moov.offset + moov.header, moov.offset + moov.size, new Set(['mvhd', 'trak']));
  const mvhd = children.find((box) => box.type === 'mvhd');
  if (!mvhd) return null;

  const mvhdBase = mvhd.offset + mvhd.header;
  const version = bytes[mvhdBase];
  const timing = mvhdBase + 4;
  let timescale = 0;
  let duration = 0;
  if (version === 0 && timing + 16 <= bytes.length) {
    timescale = view.getUint32(timing + 8, false);
    duration = view.getUint32(timing + 12, false);
  } else if (version === 1 && timing + 28 <= bytes.length) {
    timescale = view.getUint32(timing + 16, false);
    const high = view.getUint32(timing + 20, false);
    const low = view.getUint32(timing + 24, false);
    duration = high * 2 ** 32 + low;
  }
  if (!timescale || !duration || !Number.isSafeInteger(duration)) return null;
  const durationMs = Math.round((duration / timescale) * 1000);

  let width = 0;
  let height = 0;
  for (const trak of children.filter((box) => box.type === 'trak')) {
    const trackBoxes = findBoxes(bytes, trak.offset + trak.header, trak.offset + trak.size, new Set(['tkhd']));
    const tkhd = trackBoxes[0];
    if (!tkhd) continue;
    const base = tkhd.offset + tkhd.header;
    const tkVersion = bytes[base];
    const data = base + 4;
    const dimensionOffset = tkVersion === 1 ? data + 84 : data + 72;
    if (dimensionOffset + 8 > bytes.length) continue;
    const w = fixed16(view.getUint32(dimensionOffset, false));
    const h = fixed16(view.getUint32(dimensionOffset + 4, false));
    if (w * h > width * height) {
      width = w;
      height = h;
    }
  }
  if (!width || !height) return null;
  if (width > MAX_DIMENSION || height > MAX_DIMENSION || durationMs > MAX_VIDEO_DURATION_MS) return null;
  return { contentType: 'video/mp4', width, height, durationMs };
}

async function selectMedia(id, auth = '') {
  const params = new URLSearchParams({
    id: `eq.${id}`,
    select: 'id,owner_id,post_id,object_key,media_kind,content_type,size_bytes,width,height,duration_ms,alt_text,position,upload_status,expires_at,finalized_at',
    limit: '1',
  });
  const response = await fetch(`${SUPABASE_URL}/rest/v1/social_post_media?${params}`, {
    headers: supabaseHeaders(auth),
  });
  if (!response.ok) return null;
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function insertPending(session, row) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/social_post_media?select=id,object_key,media_kind,content_type,size_bytes,upload_status,expires_at`, {
    method: 'POST',
    headers: {
      ...supabaseHeaders(session.auth),
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(row),
  });
  if (!response.ok) return null;
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function patchMedia(session, id, patch) {
  const params = new URLSearchParams({ id: `eq.${id}`, owner_id: `eq.${session.user.id}`, select: 'id,upload_status,finalized_at' });
  const response = await fetch(`${SUPABASE_URL}/rest/v1/social_post_media?${params}`, {
    method: 'PATCH',
    headers: {
      ...supabaseHeaders(session.auth),
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(patch),
  });
  if (!response.ok) return null;
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function deleteMediaRow(session, id) {
  const params = new URLSearchParams({ id: `eq.${id}`, owner_id: `eq.${session.user.id}`, post_id: 'is.null', select: 'id' });
  const response = await fetch(`${SUPABASE_URL}/rest/v1/social_post_media?${params}`, {
    method: 'DELETE',
    headers: { ...supabaseHeaders(session.auth), Prefer: 'return=representation' },
  });
  if (!response.ok) return false;
  const rows = await response.json().catch(() => []);
  return Boolean(Array.isArray(rows) && rows[0]?.id);
}


async function cleanupExpiredOwnerUploads(session, env) {
  const params = new URLSearchParams({
    owner_id: `eq.${session.user.id}`,
    post_id: 'is.null',
    expires_at: `lt.${new Date().toISOString()}`,
    select: 'id,object_key',
    limit: '12',
  });
  const response = await fetch(`${SUPABASE_URL}/rest/v1/social_post_media?${params}`, {
    headers: supabaseHeaders(session.auth),
  });
  if (!response.ok) return;

  const rows = await response.json().catch(() => []);
  if (!Array.isArray(rows) || !rows.length) return;

  await Promise.all(rows.map(async (row) => {
    if (row?.object_key) await env.SAUTI_MEDIA.delete(row.object_key).catch(() => {});
    if (!row?.id) return;
    const deleteParams = new URLSearchParams({
      id: `eq.${row.id}`,
      owner_id: `eq.${session.user.id}`,
      post_id: 'is.null',
    });
    await fetch(`${SUPABASE_URL}/rest/v1/social_post_media?${deleteParams}`, {
      method: 'DELETE',
      headers: supabaseHeaders(session.auth),
    }).catch(() => {});
  }));
}

async function beginUpload(request, env) {
  if (!env.SAUTI_MEDIA) return apiError(503, 'MEDIA_NOT_READY', 'Post media is not enabled yet.');
  const session = await authenticate(request);
  if (!session) return apiError(401, 'AUTH_REQUIRED', 'Sign in before adding media.');

  await cleanupExpiredOwnerUploads(session, env);

  const limited = await consumeLimit(env.SAUTI_MEDIA_BEGIN_LIMITER, session.user.id);
  if (!limited.ready) return apiError(503, 'RATE_LIMIT_NOT_READY', 'Media uploads are not ready yet.');
  if (!limited.allowed) return apiError(429, 'RATE_LIMITED', 'You are starting uploads too quickly.');

  const payload = await request.json().catch(() => null);
  const contentType = String(payload?.content_type || '').toLowerCase();
  const sizeBytes = Number(payload?.size_bytes || 0);
  const type = TYPES[contentType];
  if (!type) return apiError(415, 'UNSUPPORTED_MEDIA', 'Use JPEG, PNG, WebP or MP4 media.');
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > type.limit) {
    return apiError(413, 'FILE_TOO_LARGE', type.kind === 'video' ? 'Videos must be 25 MB or smaller.' : 'Images must be 8 MB or smaller.');
  }

  const id = crypto.randomUUID();
  const objectKey = `sauti/${session.user.id}/${id}.${type.extension}`;
  const expiresAt = new Date(Date.now() + UPLOAD_TTL_MS).toISOString();
  const row = await insertPending(session, {
    id,
    owner_id: session.user.id,
    object_key: objectKey,
    media_kind: type.kind,
    content_type: contentType,
    size_bytes: sizeBytes,
    upload_status: 'pending',
    expires_at: expiresAt,
  });
  if (!row) return apiError(409, 'UPLOAD_BEGIN_FAILED', 'The media upload could not be started.');

  return json(201, {
    ok: true,
    data: {
      id,
      upload_url: `/api/sauti-media/upload/${id}`,
      finalize_url: `/api/sauti-media/finalize/${id}`,
      expires_at: expiresAt,
    },
  });
}

async function uploadMedia(request, env, id) {
  if (!env.SAUTI_MEDIA) return apiError(503, 'MEDIA_NOT_READY', 'Post media is not enabled yet.');
  const session = await authenticate(request);
  if (!session) return apiError(401, 'AUTH_REQUIRED', 'Sign in before uploading media.');

  const row = await selectMedia(id, session.auth);
  if (!row || row.owner_id !== session.user.id || row.post_id || row.upload_status !== 'pending') {
    return apiError(404, 'UPLOAD_NOT_FOUND', 'This upload is unavailable.');
  }
  if (Date.parse(row.expires_at) < Date.now()) return apiError(410, 'UPLOAD_EXPIRED', 'This upload expired. Add the file again.');

  const declared = TYPES[row.content_type];
  const contentType = String(request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (!declared || contentType !== row.content_type) return apiError(415, 'CONTENT_TYPE_MISMATCH', 'The uploaded file type changed.');

  const contentLength = Number(request.headers.get('Content-Length') || 0);
  if (contentLength && contentLength !== Number(row.size_bytes)) return apiError(400, 'SIZE_MISMATCH', 'The uploaded file size changed.');

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength !== Number(row.size_bytes) || bytes.byteLength > declared.limit) {
    return apiError(400, 'SIZE_MISMATCH', 'The uploaded file size changed.');
  }

  let inspected;
  if (declared.kind === 'image') {
    inspected = inspectImageBytes(bytes);
    if (!inspected || inspected.contentType !== row.content_type || inspected.width > MAX_DIMENSION || inspected.height > MAX_DIMENSION) {
      return apiError(415, 'INVALID_MEDIA_BYTES', 'The image contents are invalid or unsupported.');
    }
    inspected.durationMs = null;
  } else {
    inspected = inspectMp4Bytes(bytes);
    if (!inspected) return apiError(415, 'INVALID_VIDEO', 'Use a valid MP4 video up to 90 seconds.');
  }

  try {
    await env.SAUTI_MEDIA.put(row.object_key, bytes, {
      httpMetadata: { contentType: row.content_type },
      customMetadata: {
        ownerId: session.user.id,
        mediaId: id,
        validated: 'true',
        mediaKind: row.media_kind,
        width: String(inspected.width),
        height: String(inspected.height),
        durationMs: inspected.durationMs == null ? '' : String(inspected.durationMs),
      },
    });
  } catch {
    return apiError(502, 'R2_UPLOAD_FAILED', 'The media could not be stored. Try again.');
  }

  const patched = await patchMedia(session, id, {
    width: inspected.width,
    height: inspected.height,
    duration_ms: inspected.durationMs,
    upload_status: 'uploaded',
  });
  if (!patched) {
    await env.SAUTI_MEDIA.delete(row.object_key).catch(() => {});
    return apiError(409, 'UPLOAD_METADATA_FAILED', 'The upload could not be recorded.');
  }

  return json(200, { ok: true, data: { id, width: inspected.width, height: inspected.height, duration_ms: inspected.durationMs } });
}

async function finalizeUpload(request, env, id) {
  if (!env.SAUTI_MEDIA) return apiError(503, 'MEDIA_NOT_READY', 'Post media is not enabled yet.');
  const session = await authenticate(request);
  if (!session) return apiError(401, 'AUTH_REQUIRED', 'Sign in before finalizing media.');

  const row = await selectMedia(id, session.auth);
  if (!row || row.owner_id !== session.user.id || row.post_id || !['uploaded', 'ready'].includes(row.upload_status)) {
    return apiError(404, 'UPLOAD_NOT_FOUND', 'This upload is unavailable.');
  }
  if (row.upload_status === 'ready') return json(200, { ok: true, data: { id, ready: true } });

  const object = await env.SAUTI_MEDIA.head(row.object_key);
  if (
    !object ||
    object.size !== Number(row.size_bytes) ||
    object.customMetadata?.ownerId !== session.user.id ||
    object.customMetadata?.mediaId !== id ||
    object.customMetadata?.validated !== 'true'
  ) {
    return apiError(409, 'FINALIZE_VALIDATION_FAILED', 'The stored media failed validation.');
  }

  const finalizedAt = new Date().toISOString();
  const patched = await patchMedia(session, id, { upload_status: 'ready', finalized_at: finalizedAt });
  if (!patched) return apiError(409, 'FINALIZE_FAILED', 'The media could not be finalized.');

  return json(200, {
    ok: true,
    data: {
      id,
      ready: true,
      media_kind: row.media_kind,
      content_type: row.content_type,
      width: row.width,
      height: row.height,
      duration_ms: row.duration_ms,
      preview_url: `/api/sauti-media/${id}`,
    },
  });
}

async function removeUpload(request, env, id) {
  if (!env.SAUTI_MEDIA) return apiError(503, 'MEDIA_NOT_READY', 'Post media is not enabled yet.');
  const session = await authenticate(request);
  if (!session) return apiError(401, 'AUTH_REQUIRED', 'Sign in before removing media.');
  const row = await selectMedia(id, session.auth);
  if (!row || row.owner_id !== session.user.id || row.post_id) return apiError(404, 'MEDIA_NOT_FOUND', 'This media is unavailable.');
  const deleted = await deleteMediaRow(session, id);
  if (!deleted) return apiError(409, 'MEDIA_REMOVE_FAILED', 'The media could not be removed.');
  await env.SAUTI_MEDIA.delete(row.object_key).catch(() => {});
  return json(200, { ok: true, data: { id, removed: true } });
}

async function serveMedia(request, env, id) {
  if (!env.SAUTI_MEDIA) return apiError(503, 'MEDIA_NOT_READY', 'Post media is not enabled yet.');
  const row = await selectMedia(id, authorization(request));
  if (!row || !['ready', 'attached'].includes(row.upload_status)) return apiError(404, 'MEDIA_NOT_FOUND', 'This media is unavailable.');
  const object = await env.SAUTI_MEDIA.get(row.object_key);
  if (!object) return apiError(404, 'MEDIA_NOT_FOUND', 'This media is unavailable.');
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Cache-Control', 'private, no-store, max-age=0');
  headers.set('Content-Security-Policy', "default-src 'none'");
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Content-Disposition', 'inline');
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
  return new Response(object.body, { status: 200, headers });
}

export async function handleSautiMediaRequest(request, env) {
  const url = new URL(request.url);

  if (url.pathname === '/api/sauti-media/status' && request.method === 'GET') {
    return json(200, { ok: true, data: { ready: Boolean(env.SAUTI_MEDIA) } });
  }
  if (url.pathname === '/api/sauti-media/begin' && request.method === 'POST') return beginUpload(request, env);

  let match = url.pathname.match(/^\/api\/sauti-media\/upload\/([0-9a-f-]{36})$/i);
  if (match && request.method === 'PUT') return uploadMedia(request, env, uuid(match[1]));

  match = url.pathname.match(/^\/api\/sauti-media\/finalize\/([0-9a-f-]{36})$/i);
  if (match && request.method === 'POST') return finalizeUpload(request, env, uuid(match[1]));

  match = url.pathname.match(/^\/api\/sauti-media\/([0-9a-f-]{36})$/i);
  if (match && (request.method === 'GET' || request.method === 'HEAD')) return serveMedia(request, env, uuid(match[1]));
  if (match && request.method === 'DELETE') return removeUpload(request, env, uuid(match[1]));

  return null;
}
