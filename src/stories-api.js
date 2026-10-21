import { inspectImageBytes } from './profile-media-api.js';
import { createSautiStoryStreamUpload, readySautiStoryStreamAsset, getSautiStreamJob,
  deleteSautiStreamVideo, prepareSautiStreamVideo, sweepSautiStreamJobs, sautiStoryStreamUploadStatus } from './sauti-stream-lifecycle.js';
import { sautiStreamPlaybackDescriptor, serveSautiStreamHls, serveSautiStreamThumbnail } from './sauti-stream-playback.js';
import { readStreamJson, writeStreamJson, streamEnabled } from './sauti-stream-provider.js';

const DB = 'https://rggpyiterdbbugluejcs.supabase.co';
const KEY = 'sb_publishable_omJ-5Mem-K4vgm6WLXRzJQ_jeGs65ca';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4' };
const IMAGE_LIMIT = 8 * 1024 * 1024;
const VIDEO_LIMIT = 100_000_000;

class StoryError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
function json(status, data) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' } });
}
function fail(status, code, message) { return json(status, { ok: false, error: { code, message } }); }
function auth(request) {
  const value = request.headers.get('Authorization') || '';
  return /^Bearer\s+[^\s]+$/i.test(value) && value.length < 8192 ? value : '';
}
function available(env) { return env.SAUTI_STORIES_ENABLED === 'true' && env.SAUTI_MEDIA && env.SAUTI_STORIES_WORKER_KEY; }
function workerKey(env) { return String(env.SAUTI_STORIES_WORKER_KEY || ''); }
function errorForDatabase(message) {
  const text = String(message || '');
  if (/AUTH_REQUIRED/.test(text)) return new StoryError(401, 'AUTH_REQUIRED', 'Sign in to use Stories.');
  if (/QUOTA/.test(text)) return new StoryError(429, 'STORY_QUOTA_REACHED', 'You can share 4 photos and 2 videos in 24 hours. Try again when a slot is available.');
  if (/UNAVAILABLE|NOT_FOUND|EXPIRED/.test(text)) return new StoryError(404, 'STORY_UNAVAILABLE', 'This story is no longer available.');
  if (/FORBIDDEN|OWNER_REQUIRED|WORKER_REQUIRED/.test(text)) return new StoryError(403, 'STORY_FORBIDDEN', 'This story action is unavailable.');
  if (/INVALID|TOO_LONG|LIMIT|INCOMPLETE/.test(text)) return new StoryError(400, 'STORY_INVALID', 'Check your story and try again.');
  return new StoryError(503, 'STORIES_UNAVAILABLE', 'Stories could not be loaded. Try again shortly.');
}
export async function storiesRpc(name, body, authorization = '', fetcher = fetch) {
  const response = await fetcher(`${DB}/rest/v1/rpc/${name}`, { method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json', Accept: 'application/json', ...(authorization ? { Authorization: authorization } : {}) },
    body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw errorForDatabase(data?.message);
  if (data == null) throw new StoryError(503, 'STORIES_UNAVAILABLE', 'Stories could not be loaded.');
  return data;
}
async function body(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type') || '')) throw new StoryError(415, 'JSON_REQUIRED', 'Send story details as JSON.');
  const bytes = await boundedBytes(request, 8192);
  let value;
  try { value = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new StoryError(400, 'INVALID_JSON', 'Check your story details.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new StoryError(400, 'INVALID_JSON', 'Check your story details.');
  return value;
}
async function boundedBytes(request, limit) {
  const length = Number(request.headers.get('Content-Length') || 0);
  if (length > limit) throw new StoryError(413, 'UPLOAD_TOO_LARGE', 'This file is too large.');
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader(); const parts = []; let size = 0;
  try {
    while (true) {
      const item = await reader.read(); if (item.done) break;
      size += item.value.byteLength;
      if (size > limit) { await reader.cancel(); throw new StoryError(413, 'UPLOAD_TOO_LARGE', 'This file is too large.'); }
      parts.push(item.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return bytes;
}
async function limited(binding, authorization) {
  if (!binding?.limit) throw new StoryError(503, 'STORIES_UNAVAILABLE', 'Stories is temporarily unavailable.');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(authorization));
  const result = await binding.limit({ key: Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('') });
  if (!result?.success) throw new StoryError(429, 'RATE_LIMITED', 'Please wait a moment before trying again.');
}
function caption(value) {
  if (value == null) return '';
  if (typeof value !== 'string' || value.length > 500 || /[\u0000]/.test(value)) throw new StoryError(400, 'CAPTION_INVALID', 'Use a caption of up to 500 characters.');
  return value.trim();
}
function publicStory(row) {
  const base = `/api/stories/${row.id}`;
  const image = row.media_kind === 'image';
  return { id: row.id, owner_id: row.owner_id, media_kind: row.media_kind, caption: row.caption || '',
    width: Number(row.width) || 0, height: Number(row.height) || 0, duration_ms: Number(row.duration_ms) || (image ? 5000 : 0),
    created_at: row.published_at || row.created_at, expires_at: row.expires_at,
    media_path: image ? `${base}/media` : null, thumbnail_path: image ? `${base}/media?w=480` : `${base}/thumbnail`,
    playback_path: image ? null : `${base}/playback`, is_seen: Boolean(row.viewed),
    viewer_count: row.view_count == null ? null : Number(row.view_count), reaction: row.reaction || null };
}
function detail(row) { return { story: publicStory(row), author: row.author }; }
export function groupStories(rows) {
  const groups = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!UUID.test(String(row?.id)) || !UUID.test(String(row.owner_id)) || row.author?.id !== row.owner_id
      || !Number.isFinite(Date.parse(row.expires_at)) || Date.parse(row.expires_at) <= Date.now()) continue;
    const group = groups.get(row.owner_id) || { author: row.author, stories: [], unseen_count: 0 };
    const story = publicStory(row); group.stories.push(story); if (!story.is_seen) group.unseen_count++;
    groups.set(row.owner_id, group);
  }
  return [...groups.values()];
}
async function uploadRow(id, authorization) { return storiesRpc('stories_upload', { p_id: id }, authorization); }
async function validImageObject(env, row) {
  if (!UUID.test(row.id) || !UUID.test(row.owner_id) || !TYPES[row.content_type]
    || row.object_key !== `stories/${row.owner_id}/${row.id}.${TYPES[row.content_type]}`) return null;
  const object = await env.SAUTI_MEDIA.head(row.object_key);
  return object?.customMetadata?.validated === 'true' && object.customMetadata.storyId === row.id
    && object.customMetadata.ownerId === row.owner_id && object.size === Number(row.size_bytes)
    && object.httpMetadata?.contentType === row.content_type ? object : null;
}
async function begin(request, env, authorization) {
  await limited(env.SAUTI_MEDIA_BEGIN_LIMITER, authorization);
  const input = await body(request);
  if (!['image', 'video'].includes(input.media_kind) || !TYPES[input.content_type]
    || input.content_type.startsWith(`${input.media_kind}/`) !== true || !Number.isSafeInteger(input.size_bytes)
    || input.size_bytes < 1 || input.size_bytes > (input.media_kind === 'image' ? IMAGE_LIMIT : VIDEO_LIMIT)
    || !UUID.test(String(input.idempotency_key || ''))) throw new StoryError(400, 'UPLOAD_INVALID', 'Choose a valid photo or MP4 video.');
  if (input.media_kind === 'video' && !streamEnabled(env)) throw new StoryError(503, 'VIDEO_NOT_READY', 'Video Stories is temporarily unavailable.');
  const row = await storiesRpc('stories_reserve', { p_media_kind: input.media_kind, p_content_type: input.content_type,
    p_size_bytes: input.size_bytes, p_client_key: input.idempotency_key }, authorization);
  let uploadUrl = new URL(`/api/stories/uploads/${row.id}`, request.url).href;
  let expiresAt = row.upload_expires_at;
  if (row.media_kind === 'video') {
    const job = await createSautiStoryStreamUpload(env, row);
    if (!job?.upload_url) throw new StoryError(503, 'UPLOAD_PREPARING', 'The video upload is being prepared. Try again with the same story.');
    uploadUrl = job.upload_url; expiresAt = new Date(job.upload_expires_at * 1000).toISOString();
  }
  return json(201, { ok: true, data: { upload_id: row.id, upload_url: uploadUrl,
    upload_method: row.media_kind === 'video' ? 'POST' : 'PUT', expires_at: expiresAt } });
}
async function imageUpload(request, env, id, authorization) {
  const row = await uploadRow(id, authorization);
  if (!UUID.test(String(row.id)) || row.id !== id || !UUID.test(String(row.owner_id)) || row.media_kind !== 'image'
    || !TYPES[row.content_type] || row.object_key !== `stories/${row.owner_id}/${row.id}.${TYPES[row.content_type]}`
    || row.content_type !== (request.headers.get('Content-Type') || '').split(';')[0].toLowerCase()
    || !Number.isSafeInteger(Number(row.size_bytes)) || Number(row.size_bytes) < 1 || Number(row.size_bytes) > IMAGE_LIMIT)
    throw new StoryError(415, 'MEDIA_TYPE_INVALID', 'Choose a supported photo.');
  if (row.status === 'published') return json(200, { ok: true, data: { upload_id: id, uploaded: true } });
  const bytes = await boundedBytes(request, Math.min(IMAGE_LIMIT, Number(row.size_bytes)));
  const inspected = inspectImageBytes(bytes);
  if (bytes.byteLength !== Number(row.size_bytes) || inspected?.contentType !== row.content_type
    || inspected.width * inspected.height > 40_000_000) throw new StoryError(400, 'IMAGE_INVALID', 'This photo could not be read.');
  const saved = await env.SAUTI_MEDIA.put(row.object_key, bytes, { onlyIf: { etagDoesNotMatch: '*' },
    httpMetadata: { contentType: row.content_type }, customMetadata: { validated: 'true', ownerId: row.owner_id,
      storyId: id, width: String(inspected.width), height: String(inspected.height) } });
  // The reserved object is immutable. An uncertain successful PUT can be checked and finalized safely.
  if (!saved && !await validImageObject(env, row)) throw new StoryError(409, 'UPLOAD_CONFLICT', 'Check the upload before retrying.');
  return json(200, { ok: true, data: { upload_id: id, uploaded: true } });
}
async function uploadStatus(env, id, authorization) {
  const row = await uploadRow(id, authorization);
  if (row.media_kind === 'image') {
    const object = await validImageObject(env, row);
    return json(200, { ok: true, data: { upload_id: id, uploaded: Boolean(object), ready: Boolean(object), processing: false, expires_at: row.upload_expires_at } });
  }
  const status = await sautiStoryStreamUploadStatus(env, row);
  return json(200, { ok: true, data: { upload_id: id, ...status, expires_at: row.upload_expires_at } });
}
async function publish(request, env, authorization) {
  const input = await body(request); const id = String(input.upload_id || '');
  if (!UUID.test(id)) throw new StoryError(400, 'UPLOAD_INVALID', 'Choose an uploaded story.');
  const text = caption(input.caption);
  const row = await uploadRow(id, authorization);
  let width; let height; let duration = null; let uid = null;
  if (row.media_kind === 'image') {
    const object = await validImageObject(env, row);
    if (!object) throw new StoryError(409, 'UPLOAD_INCOMPLETE', 'Finish uploading the photo before sharing.');
    width = Number(object.customMetadata.width); height = Number(object.customMetadata.height);
  } else {
    const asset = await readySautiStoryStreamAsset(env, row);
    if (!asset) return json(202, { ok: true, data: { processing: true, retry_after: 3, upload_id: id } });
    width = asset.width; height = asset.height; duration = asset.duration_ms; uid = asset.stream_uid;
    if (!(duration > 0 && duration <= 30000)) throw new StoryError(400, 'VIDEO_DURATION_INVALID', 'Trim your video to 30 seconds or less.');
  }
  const result = await storiesRpc('stories_publish', { p_id: id, p_worker_key: workerKey(env), p_width: width,
    p_height: height, p_duration_ms: duration, p_stream_uid: uid, p_caption: text }, authorization);
  return json(201, { ok: true, data: detail(result) });
}
async function assetRow(env, id, authorization) {
  return storiesRpc('stories_asset', { p_id: id, p_worker_key: workerKey(env) }, authorization);
}
async function serveImage(request, env, row) {
  const object = await validImageObject(env, row);
  if (!object) return fail(404, 'MEDIA_UNAVAILABLE', 'This story is unavailable.');
  const bytes = await env.SAUTI_MEDIA.get(row.object_key);
  if (!bytes) return fail(404, 'MEDIA_UNAVAILABLE', 'This story is unavailable.');
  return new Response(request.method === 'HEAD' ? null : bytes.body, { headers: { 'Content-Type': row.content_type,
    'Content-Length': String(object.size), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'", 'Referrer-Policy': 'no-referrer' } });
}
async function serveVideo(request, env, row, mode, authorization) {
  const record = await getSautiStreamJob(env, 'story', row.id);
  const job = record?.data;
  if (!job || job.state !== 'ready' || job.owner_id !== row.owner_id || job.stream_uid !== row.stream_uid) return fail(404, 'MEDIA_UNAVAILABLE', 'This story is unavailable.');
  const asset = { kind: 'story', id: row.id, stream_uid: job.stream_uid, generation: job.generation };
  const options = { basePath: `/api/stories/${row.id}/hls/`, accessScope: authorization, expiresAt: row.expires_at };
  if (mode === 'hls') return serveSautiStreamHls(request, env, asset, options);
  if (mode === 'thumbnail') return serveSautiStreamThumbnail(request, env, asset, options);
  const descriptor = await sautiStreamPlaybackDescriptor(request, env, asset, options);
  return descriptor ? json(200, { ok: true, data: descriptor }) : fail(503, 'PLAYBACK_UNAVAILABLE', 'Try this video again shortly.');
}

/** Stories are exposed to the native client; media authorization is checked before every request. */
export async function handleStoriesRequest(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/stories')) return null;
  if (!available(env)) return fail(503, 'STORIES_UNAVAILABLE', 'Stories is temporarily unavailable.');
  const authorization = auth(request);
  if (!authorization) return fail(401, 'AUTH_REQUIRED', 'Sign in to use Stories.');
  try {
    if (url.pathname === '/api/stories/uploads' && request.method === 'POST') return await begin(request, env, authorization);
    let match = /^\/api\/stories\/uploads\/([0-9a-f-]{36})$/.exec(url.pathname);
    if (match && UUID.test(match[1])) {
      if (request.method === 'PUT') return await imageUpload(request, env, match[1], authorization);
      if (request.method === 'GET') return await uploadStatus(env, match[1], authorization);
    }
    if (url.pathname === '/api/stories' && request.method === 'POST') return await publish(request, env, authorization);
    const profile = /^\/api\/stories\/profile\/([a-z0-9][a-z0-9._]{2,29})$/.exec(url.pathname);
    if ((url.pathname === '/api/stories' || profile) && request.method === 'GET') {
      const [rows, quota] = await Promise.all([storiesRpc('stories_feed', { p_username: profile?.[1] || null }, authorization), storiesRpc('stories_quota', {}, authorization)]);
      return json(200, { ok: true, data: { server_now: new Date().toISOString(), groups: groupStories(rows), quota } });
    }
    match = /^\/api\/stories\/([0-9a-f-]{36})(?:\/(media|thumbnail|playback|hls(?:\/.*)?|view|viewers|reaction))?$/.exec(url.pathname);
    if (!match || !UUID.test(match[1])) return fail(404, 'NOT_FOUND', 'This Stories route is unavailable.');
    const id = match[1]; const action = match[2] || '';
    if (['GET', 'HEAD'].includes(request.method) && ['media', 'thumbnail', 'playback'].includes(action) || action.startsWith('hls/') && ['GET', 'HEAD'].includes(request.method)) {
      const row = await assetRow(env, id, authorization);
      if (!Number.isFinite(Date.parse(row.expires_at)) || Date.parse(row.expires_at) <= Date.now()) return fail(404, 'STORY_UNAVAILABLE', 'This story has expired.');
      if (action === 'media') return row.media_kind === 'image' ? await serveImage(request, env, row) : fail(404, 'NOT_FOUND', 'This photo is unavailable.');
      return row.media_kind === 'video' ? await serveVideo(request, env, row, action.startsWith('hls/') ? 'hls' : action, authorization) : fail(404, 'NOT_FOUND', 'This video is unavailable.');
    }
    if (!action && request.method === 'GET') return json(200, { ok: true, data: detail(await storiesRpc('stories_get', { p_id: id }, authorization)) });
    if (!action && request.method === 'PATCH') return json(200, { ok: true, data: detail(await storiesRpc('stories_edit', { p_id: id, p_caption: caption((await body(request)).caption) }, authorization)) });
    if (!action && request.method === 'DELETE') {
      const row = await assetRow(env, id, authorization);
      const result = await storiesRpc('stories_delete', { p_id: id }, authorization);
      if (row.media_kind === 'video') await deleteSautiStreamVideo(env, row, 'story');
      else await env.SAUTI_MEDIA.delete(row.object_key).catch(() => {});
      return json(200, { ok: true, data: result });
    }
    if (action === 'view' && request.method === 'POST') return json(200, { ok: true, data: await storiesRpc('stories_view', { p_id: id }, authorization) });
    if (action === 'viewers' && request.method === 'GET') {
      const offset = Number(url.searchParams.get('cursor') || '0');
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) throw new StoryError(400, 'CURSOR_INVALID', 'Refresh this list.');
      const result = await storiesRpc('stories_viewers', { p_id: id, p_offset: offset }, authorization);
      return json(200, { ok: true, data: { ...result, total: result.total ?? result.viewers?.length ?? 0, next_cursor: result.has_more ? String(offset + (result.viewers?.length || 0)) : null } });
    }
    if (action === 'reaction' && request.method === 'PUT') {
      await limited(env.SOCIAL_LIKE_LIMITER, authorization);
      const reaction = (await body(request)).reaction ?? null;
      if (reaction !== null && !['love', 'dislike'].includes(reaction)) throw new StoryError(400, 'REACTION_INVALID', 'Choose Love or Dislike.');
      return json(200, { ok: true, data: await storiesRpc('stories_react', { p_id: id, p_reaction: reaction }, authorization) });
    }
    return fail(405, 'METHOD_NOT_ALLOWED', 'This Stories action is unavailable.');
  } catch (error) {
    return error instanceof StoryError ? fail(error.status, error.code, error.message) : fail(503, 'STORIES_UNAVAILABLE', 'Stories could not be loaded. Try again shortly.');
  }
}

/** Durable retries keep failed provider deletions queued; quotas are never refunded by cleanup. */
export async function runStoriesAndStreamMaintenance(env) {
  if (!available(env)) return { enabled: false };
  const p_worker_key = workerKey(env);
  const rows = await storiesRpc('stories_cleanup', { p_worker_key, p_limit: 25 });
  let cleaned = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    let done = false;
    if (row.media_kind === 'video') done = await deleteSautiStreamVideo(env, row, 'story');
    else if (row.object_key === `stories/${row.owner_id}/${row.id}.${TYPES[row.content_type]}`) {
      try { await env.SAUTI_MEDIA.delete(row.object_key); done = true; } catch { /* retry next scheduled run */ }
    }
    if (done) { await storiesRpc('stories_cleanup_ack', { p_worker_key, p_id: row.id }); cleaned++; }
  }
  if (!streamEnabled(env)) return { cleaned };
  await sweepSautiStreamJobs(env, { limit: 25, validate: async job => {
    try { return await storiesRpc('stories_asset_state', { p_worker_key, p_kind: job.kind, p_id: job.id }); }
    catch { return null; }
  } });
  const cursorKey = 'stream-control/v2/backfill-cursor.json';
  const prior = await readStreamJson(env, cursorKey);
  const batch = await storiesRpc('stories_video_backfill', { p_worker_key, p_after: prior?.data?.after || null, p_limit: 4 });
  for (const row of Array.isArray(batch) ? batch : []) await prepareSautiStreamVideo(env, row);
  // Cycle inventory continuously, so future finalized videos recover if a request task was interrupted.
  await writeStreamJson(env, cursorKey, { after: batch.length === 4 ? batch[batch.length - 1].id : null, updated_at: new Date().toISOString() }, prior?.etag);
  return { enabled: true, cleaned, backfill_checked: batch.length };
}
