import { inspectImageBytes } from './profile-media-api.js';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 8192;
const MAX_VOICE_DURATION_MS = 5 * 60 * 1000;
const UPLOAD_TTL_MS = 60 * 60 * 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MESSAGE_ID_PATTERN = /^\d{1,20}$/;

const PHOTO_TYPES = Object.freeze({
  'image/jpeg': { extension: 'jpg' },
  'image/png': { extension: 'png' },
  'image/webp': { extension: 'webp' },
});

const VOICE_TYPES = Object.freeze({
  'audio/webm': { extension: 'webm' },
  'audio/ogg': { extension: 'ogg' },
  'audio/mp4': { extension: 'm4a' },
});

const FILE_TYPES = Object.freeze({
  'application/pdf': { extension: 'pdf', signature: 'pdf' },
  'text/plain': { extension: 'txt', signature: 'text' },
  'text/csv': { extension: 'csv', signature: 'text' },
  'application/rtf': { extension: 'rtf', signature: 'rtf' },
  'application/msword': { extension: 'doc', signature: 'ole' },
  'application/vnd.ms-excel': { extension: 'xls', signature: 'ole' },
  'application/vnd.ms-powerpoint': { extension: 'ppt', signature: 'ole' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { extension: 'docx', signature: 'zip' },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { extension: 'xlsx', signature: 'zip' },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': { extension: 'pptx', signature: 'zip' },
});

function json(status, payload, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
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

function config(env) {
  const url = String(env.DM_MEDIA_SUPABASE_URL || '').replace(/\/$/, '');
  const key = String(env.DM_MEDIA_SUPABASE_KEY || '');
  return /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url) && key
    ? { url, key }
    : null;
}

function supabaseHeaders(env, auth = '', extra = {}) {
  const current = config(env);
  if (!current) return null;
  return {
    apikey: current.key,
    Accept: 'application/json',
    ...(auth ? { Authorization: auth } : {}),
    ...extra,
  };
}

async function authenticate(request, env) {
  const auth = authorization(request);
  const current = config(env);
  const headers = supabaseHeaders(env, auth);
  if (!auth || !current || !headers) return null;

  const response = await fetch(`${current.url}/auth/v1/user`, { headers });
  if (!response.ok) return null;
  const user = await response.json().catch(() => null);
  return user?.id ? { auth, user } : null;
}

async function consumeLimit(binding, key) {
  if (!binding?.limit) return { ready: false, allowed: false };
  const result = await binding.limit({ key });
  return { ready: true, allowed: Boolean(result?.success) };
}

function normalizeUuid(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return UUID_PATTERN.test(normalized) ? normalized : '';
}

function contentType(request) {
  return String(request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
}

function decodeFileName(value) {
  try {
    const decoded = decodeURIComponent(String(value || ''));
    const base = decoded.split(/[\\/]/).pop() || '';
    return base
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180);
  } catch {
    return '';
  }
}

function fileExtension(name) {
  const match = String(name || '').toLowerCase().match(/\.([a-z0-9]{1,8})$/);
  return match ? match[1] : '';
}

function ascii(bytes, offset, length) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function isZip(bytes) {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && [0x03, 0x05, 0x07].includes(bytes[2]);
}

function isOle(bytes) {
  const signature = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  return bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value);
}

function looksTextual(bytes) {
  const sample = bytes.subarray(0, Math.min(bytes.length, 8192));
  return !sample.some((value) => value === 0x00);
}

function validDocumentBytes(bytes, descriptor) {
  switch (descriptor?.signature) {
    case 'pdf': return bytes.length >= 5 && ascii(bytes, 0, 5) === '%PDF-';
    case 'zip': return isZip(bytes);
    case 'ole': return isOle(bytes);
    case 'rtf': return bytes.length >= 5 && ascii(bytes, 0, 5) === '{\\rtf';
    case 'text': return looksTextual(bytes);
    default: return false;
  }
}

function validVoiceBytes(bytes, type) {
  if (type === 'audio/webm') {
    return bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  }
  if (type === 'audio/ogg') return bytes.length >= 4 && ascii(bytes, 0, 4) === 'OggS';
  if (type === 'audio/mp4') return bytes.length >= 12 && ascii(bytes, 4, 4) === 'ftyp';
  return false;
}

async function readBoundedBody(request, expectedSize) {
  const lengthHeader = Number(request.headers.get('Content-Length') || 0);
  if (lengthHeader && (!Number.isSafeInteger(lengthHeader) || lengthHeader < 1 || lengthHeader > MAX_FILE_BYTES)) {
    throw new Error('FILE_TOO_LARGE');
  }
  if (!request.body) throw new Error('EMPTY_FILE');

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value?.byteLength) continue;
    total += value.byteLength;
    if (total > MAX_FILE_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Error('FILE_TOO_LARGE');
    }
    chunks.push(value);
  }

  if (total < 1) throw new Error('EMPTY_FILE');
  if (expectedSize && total !== expectedSize) throw new Error('SIZE_MISMATCH');

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function selectConversation(env, conversationId, auth) {
  const current = config(env);
  const headers = supabaseHeaders(env, auth);
  if (!current || !headers) return null;
  const params = new URLSearchParams({
    select: 'id,member_one_id,member_two_id',
    id: `eq.${conversationId}`,
    limit: '1',
  });
  const response = await fetch(`${current.url}/rest/v1/dm_conversations?${params}`, { headers });
  if (!response.ok) return null;
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function selectAttachment(env, id, auth) {
  const current = config(env);
  const headers = supabaseHeaders(env, auth);
  if (!current || !headers) return null;
  const params = new URLSearchParams({
    select: 'id,conversation_id,message_id,owner_id,media_kind,object_key,content_type,original_name,size_bytes,duration_ms,width,height,upload_status,expires_at,finalized_at,created_at',
    id: `eq.${id}`,
    limit: '1',
  });
  const response = await fetch(`${current.url}/rest/v1/dm_message_attachments?${params}`, { headers });
  if (!response.ok) return null;
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function insertPendingAttachment(env, session, row) {
  const current = config(env);
  const headers = supabaseHeaders(env, session.auth, {
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  });
  if (!current || !headers) return null;
  const response = await fetch(`${current.url}/rest/v1/dm_message_attachments`, {
    method: 'POST',
    headers,
    body: JSON.stringify(row),
  });
  if (!response.ok) return null;
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function patchPendingAttachment(env, session, id, patch) {
  const current = config(env);
  const headers = supabaseHeaders(env, session.auth, {
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  });
  if (!current || !headers) return null;
  const params = new URLSearchParams({ id: `eq.${id}`, owner_id: `eq.${session.user.id}`, message_id: 'is.null' });
  const response = await fetch(`${current.url}/rest/v1/dm_message_attachments?${params}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(patch),
  });
  if (!response.ok) return null;
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function deletePendingRow(env, session, id) {
  const current = config(env);
  const headers = supabaseHeaders(env, session.auth, { Prefer: 'return=representation' });
  if (!current || !headers) return false;
  const params = new URLSearchParams({ id: `eq.${id}`, owner_id: `eq.${session.user.id}`, message_id: 'is.null' });
  const response = await fetch(`${current.url}/rest/v1/dm_message_attachments?${params}`, {
    method: 'DELETE',
    headers,
  });
  if (!response.ok) return false;
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) && rows.length > 0;
}

async function cleanupExpiredUploads(env, session) {
  const current = config(env);
  const headers = supabaseHeaders(env, session.auth);
  if (!current || !headers || !env.SAUTI_MEDIA) return;
  const params = new URLSearchParams({
    select: 'id,object_key',
    owner_id: `eq.${session.user.id}`,
    message_id: 'is.null',
    expires_at: `lt.${new Date().toISOString()}`,
    limit: '10',
  });
  const response = await fetch(`${current.url}/rest/v1/dm_message_attachments?${params}`, { headers });
  if (!response.ok) return;
  const rows = await response.json().catch(() => []);
  if (!Array.isArray(rows)) return;
  await Promise.all(rows.map(async (row) => {
    if (row?.id) await deletePendingRow(env, session, row.id).catch(() => false);
    if (row?.object_key) await env.SAUTI_MEDIA.delete(row.object_key).catch(() => {});
  }));
}

function resolveUploadType(kind, type, name) {
  if (kind === 'photo') {
    const descriptor = PHOTO_TYPES[type];
    return descriptor ? { ...descriptor, kind } : null;
  }
  if (kind === 'voice') {
    const descriptor = VOICE_TYPES[type];
    return descriptor ? { ...descriptor, kind } : null;
  }
  if (kind === 'file') {
    const descriptor = FILE_TYPES[type];
    if (!descriptor || fileExtension(name) !== descriptor.extension) return null;
    return { ...descriptor, kind };
  }
  return null;
}

async function uploadAttachment(request, env) {
  if (!env.SAUTI_MEDIA) return apiError(503, 'MEDIA_NOT_READY', 'Message media is not enabled yet.');
  if (!config(env)) return apiError(503, 'MEDIA_CONFIG_NOT_READY', 'Message media configuration is unavailable.');
  const session = await authenticate(request, env);
  if (!session) return apiError(401, 'AUTH_REQUIRED', 'Sign in before adding message media.');

  const limited = await consumeLimit(env.DM_MEDIA_UPLOAD_LIMITER, session.user.id);
  if (!limited.ready) return apiError(503, 'RATE_LIMIT_NOT_READY', 'Message uploads are not ready yet.');
  if (!limited.allowed) return apiError(429, 'RATE_LIMITED', 'You are starting message uploads too quickly.');

  await cleanupExpiredUploads(env, session);

  const conversationId = normalizeUuid(request.headers.get('X-Sauti-Conversation-ID'));
  const kind = String(request.headers.get('X-Sauti-Media-Kind') || '').trim().toLowerCase();
  const type = contentType(request);
  const name = decodeFileName(request.headers.get('X-Sauti-File-Name'));
  const expectedSize = Number(request.headers.get('X-Sauti-Size-Bytes') || 0);
  const durationMs = Number(request.headers.get('X-Sauti-Duration-Ms') || 0);

  if (!conversationId) return apiError(400, 'INVALID_CONVERSATION', 'Choose a valid conversation.');
  if (!Number.isSafeInteger(expectedSize) || expectedSize < 1 || expectedSize > MAX_FILE_BYTES) {
    return apiError(413, 'FILE_TOO_LARGE', 'Message files must be 5 MB or smaller.');
  }
  if (kind === 'voice' && (!Number.isSafeInteger(durationMs) || durationMs < 0 || durationMs > MAX_VOICE_DURATION_MS)) {
    return apiError(422, 'VOICE_TOO_LONG', 'Voice notes are limited to 5 minutes.');
  }
  if (kind === 'file' && !name) return apiError(400, 'FILE_NAME_REQUIRED', 'This file needs a valid name.');

  const descriptor = resolveUploadType(kind, type, name);
  if (!descriptor) {
    return apiError(415, 'UNSUPPORTED_MEDIA', 'Use JPEG, PNG or WebP photos; WebM, OGG or M4A voice notes; or PDF, TXT, CSV, RTF, DOC, DOCX, XLS, XLSX, PPT or PPTX files.');
  }

  const conversation = await selectConversation(env, conversationId, session.auth);
  if (!conversation) return apiError(404, 'CONVERSATION_UNAVAILABLE', 'This conversation is unavailable to your account.');

  let bytes;
  try {
    bytes = await readBoundedBody(request, expectedSize);
  } catch (error) {
    const code = String(error?.message || '');
    if (code === 'FILE_TOO_LARGE') return apiError(413, code, 'Message files must be 5 MB or smaller.');
    if (code === 'SIZE_MISMATCH') return apiError(400, code, 'The uploaded file size changed.');
    return apiError(400, 'EMPTY_FILE', 'Choose a file before sending.');
  }

  let width = null;
  let height = null;
  if (kind === 'photo') {
    const inspected = inspectImageBytes(bytes);
    if (!inspected || inspected.contentType !== type || inspected.width > MAX_IMAGE_DIMENSION || inspected.height > MAX_IMAGE_DIMENSION) {
      return apiError(415, 'INVALID_PHOTO', 'The photo contents are invalid or unsupported.');
    }
    width = inspected.width;
    height = inspected.height;
  } else if (kind === 'voice') {
    if (!validVoiceBytes(bytes, type)) return apiError(415, 'INVALID_VOICE_NOTE', 'The recorded voice note format is invalid.');
  } else if (!validDocumentBytes(bytes, descriptor)) {
    return apiError(415, 'INVALID_FILE', 'The file contents do not match the selected file type.');
  }

  const id = crypto.randomUUID();
  const objectKey = `dm/${conversationId}/${session.user.id}/${id}.${descriptor.extension}`;
  const expiresAt = new Date(Date.now() + UPLOAD_TTL_MS).toISOString();
  const row = await insertPendingAttachment(env, session, {
    id,
    conversation_id: conversationId,
    owner_id: session.user.id,
    media_kind: kind,
    object_key: objectKey,
    content_type: type,
    original_name: kind === 'file' ? name : null,
    size_bytes: bytes.byteLength,
    duration_ms: kind === 'voice' ? durationMs : null,
    width,
    height,
    upload_status: 'pending',
    expires_at: expiresAt,
  });
  if (!row) return apiError(409, 'UPLOAD_BEGIN_FAILED', 'The message attachment could not be prepared.');

  try {
    await env.SAUTI_MEDIA.put(objectKey, bytes, {
      httpMetadata: { contentType: type },
      customMetadata: {
        ownerId: session.user.id,
        conversationId,
        mediaId: id,
        mediaKind: kind,
        validated: 'true',
      },
    });
  } catch {
    await deletePendingRow(env, session, id).catch(() => false);
    return apiError(502, 'R2_UPLOAD_FAILED', 'The message attachment could not be stored. Try again.');
  }

  const ready = await patchPendingAttachment(env, session, id, { upload_status: 'ready' });
  if (!ready) {
    await env.SAUTI_MEDIA.delete(objectKey).catch(() => {});
    await deletePendingRow(env, session, id).catch(() => false);
    return apiError(409, 'UPLOAD_METADATA_FAILED', 'The message attachment could not be finalized.');
  }

  return json(201, {
    ok: true,
    data: {
      id,
      conversation_id: conversationId,
      media_kind: kind,
      content_type: type,
      original_name: kind === 'file' ? name : null,
      size_bytes: bytes.byteLength,
      duration_ms: kind === 'voice' ? durationMs : null,
      width,
      height,
      media_url: `/api/dm-media/${id}`,
      expires_at: expiresAt,
    },
  });
}

async function sendAttachment(request, env, id) {
  if (!config(env)) return apiError(503, 'MEDIA_CONFIG_NOT_READY', 'Message media configuration is unavailable.');
  const session = await authenticate(request, env);
  if (!session) return apiError(401, 'AUTH_REQUIRED', 'Sign in before sending message media.');
  const payload = await request.json().catch(() => null);
  const conversationId = normalizeUuid(payload?.conversation_id);
  const body = String(payload?.body || '').trim();
  if (!conversationId) return apiError(400, 'INVALID_CONVERSATION', 'Choose a valid conversation.');
  if (body.length > 4000) return apiError(422, 'MESSAGE_TOO_LONG', 'Keep messages within 4,000 characters.');

  const current = config(env);
  const headers = supabaseHeaders(env, session.auth, { 'Content-Type': 'application/json' });
  const response = await fetch(`${current.url}/rest/v1/rpc/send_dm_media_message_phase35`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      p_conversation_id: conversationId,
      p_attachment_id: id,
      p_body: body,
    }),
  });

  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const provider = String(result?.message || result?.details || '');
    if (provider.includes('DM_RATE_LIMITED')) return apiError(429, 'DM_RATE_LIMITED', 'You are sending messages too quickly. Try again shortly.');
    if (provider.includes('DM_RECIPIENT_RESTRICTED')) return apiError(403, 'DM_RECIPIENT_RESTRICTED', 'This member’s message privacy settings do not currently allow delivery.');
    if (provider.includes('DM_BLOCKED')) return apiError(403, 'DM_BLOCKED', 'Messaging is unavailable between these accounts.');
    if (provider.includes('DM_ATTACHMENT_UNAVAILABLE')) return apiError(404, 'ATTACHMENT_UNAVAILABLE', 'This attachment expired or is no longer available.');
    return apiError(409, 'MESSAGE_SEND_FAILED', 'The attachment could not be sent.');
  }

  const messageId = Number(result);
  return json(200, { ok: true, data: { id, message_id: Number.isSafeInteger(messageId) ? messageId : result } });
}

function publicAttachment(row) {
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    message_id: row.message_id,
    media_kind: row.media_kind,
    content_type: row.content_type,
    original_name: row.original_name,
    size_bytes: Number(row.size_bytes || 0),
    duration_ms: row.duration_ms == null ? null : Number(row.duration_ms),
    width: row.width == null ? null : Number(row.width),
    height: row.height == null ? null : Number(row.height),
    media_url: `/api/dm-media/${row.id}`,
  };
}

async function listMessageAttachments(request, env, url) {
  if (!config(env)) return apiError(503, 'MEDIA_CONFIG_NOT_READY', 'Message media configuration is unavailable.');
  const session = await authenticate(request, env);
  if (!session) return apiError(401, 'AUTH_REQUIRED', 'Sign in before opening message media.');
  const ids = String(url.searchParams.get('ids') || '')
    .split(',')
    .map((value) => value.trim())
    .filter((value, index, array) => MESSAGE_ID_PATTERN.test(value) && array.indexOf(value) === index)
    .slice(0, 200);
  if (!ids.length) return json(200, { ok: true, data: { attachments: [] } });

  const current = config(env);
  const params = new URLSearchParams({
    select: 'id,conversation_id,message_id,media_kind,content_type,original_name,size_bytes,duration_ms,width,height',
    message_id: `in.(${ids.join(',')})`,
    upload_status: 'eq.ready',
  });
  const response = await fetch(`${current.url}/rest/v1/dm_message_attachments?${params}`, {
    headers: supabaseHeaders(env, session.auth),
  });
  if (!response.ok) return apiError(409, 'ATTACHMENTS_UNAVAILABLE', 'Message attachments could not be loaded.');
  const rows = await response.json().catch(() => []);
  return json(200, {
    ok: true,
    data: { attachments: Array.isArray(rows) ? rows.map(publicAttachment) : [] },
  });
}

function contentDisposition(row) {
  if (row.media_kind !== 'file') return 'inline';
  const original = String(row.original_name || 'SautiLink-file').slice(0, 180);
  const fallback = original.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'SautiLink-file';
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(original)}`;
}

async function serveAttachment(request, env, id) {
  if (!env.SAUTI_MEDIA) return apiError(503, 'MEDIA_NOT_READY', 'Message media is not enabled yet.');
  const session = await authenticate(request, env);
  if (!session) return apiError(401, 'AUTH_REQUIRED', 'Sign in before opening message media.');
  const row = await selectAttachment(env, id, session.auth);
  if (!row || row.upload_status !== 'ready') return apiError(404, 'MEDIA_NOT_FOUND', 'This message attachment is unavailable.');

  const object = request.method === 'HEAD'
    ? await env.SAUTI_MEDIA.head(row.object_key)
    : await env.SAUTI_MEDIA.get(row.object_key);
  if (!object) return apiError(404, 'MEDIA_NOT_FOUND', 'This message attachment is unavailable.');

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Content-Type', row.content_type);
  headers.set('Content-Length', String(object.size));
  headers.set('Content-Disposition', contentDisposition(row));
  headers.set('Cache-Control', 'private, no-store, max-age=0');
  headers.set('Content-Security-Policy', "default-src 'none'");
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-SautiLink-DM-Media', row.media_kind);
  return new Response(request.method === 'HEAD' ? null : object.body, { status: 200, headers });
}

async function removePendingAttachment(request, env, id) {
  if (!env.SAUTI_MEDIA) return apiError(503, 'MEDIA_NOT_READY', 'Message media is not enabled yet.');
  const session = await authenticate(request, env);
  if (!session) return apiError(401, 'AUTH_REQUIRED', 'Sign in before removing message media.');
  const row = await selectAttachment(env, id, session.auth);
  if (!row || row.owner_id !== session.user.id || row.message_id || row.finalized_at) {
    return apiError(404, 'MEDIA_NOT_FOUND', 'This pending attachment is unavailable.');
  }
  const deleted = await deletePendingRow(env, session, id);
  if (!deleted) return apiError(409, 'MEDIA_REMOVE_FAILED', 'This pending attachment could not be removed.');
  await env.SAUTI_MEDIA.delete(row.object_key).catch(() => {});
  return json(200, { ok: true, data: { id, removed: true } });
}

export async function handleDmMediaRequest(request, env) {
  const url = new URL(request.url);

  if (url.pathname === '/api/dm-media/status' && request.method === 'GET') {
    return json(200, {
      ok: true,
      data: {
        ready: Boolean(env.SAUTI_MEDIA) && Boolean(env.DM_MEDIA_UPLOAD_LIMITER) && Boolean(config(env)),
        max_file_bytes: MAX_FILE_BYTES,
        max_voice_duration_ms: MAX_VOICE_DURATION_MS,
      },
    });
  }

  if (url.pathname === '/api/dm-media/upload' && request.method === 'POST') return uploadAttachment(request, env);
  if (url.pathname === '/api/dm-media/messages' && request.method === 'GET') return listMessageAttachments(request, env, url);

  let match = url.pathname.match(/^\/api\/dm-media\/send\/([0-9a-f-]{36})$/i);
  if (match && request.method === 'POST') return sendAttachment(request, env, normalizeUuid(match[1]));

  match = url.pathname.match(/^\/api\/dm-media\/([0-9a-f-]{36})$/i);
  if (match && (request.method === 'GET' || request.method === 'HEAD')) return serveAttachment(request, env, normalizeUuid(match[1]));
  if (match && request.method === 'DELETE') return removePendingAttachment(request, env, normalizeUuid(match[1]));

  return null;
}
