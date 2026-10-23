import { STREAM_UUID, STREAM_UID, streamEnabled, streamOrigin, streamSourceKey, streamHmac, verifyStreamHmac,
  readStreamJson, writeStreamJson, streamVideoId, streamOperation, streamAssetDetails, streamAssetMatches, streamAssetReady,
  deleteStreamAsset, reserveStreamSeconds, releaseStreamSeconds } from './sauti-stream-provider.js';
import { POST_VIDEO_LIMIT, POST_VIDEO_DURATION_MS } from './post-media-policy.js';

const SOURCE_TTL = 15 * 60;
const SOURCE_MAX_BYTES = POST_VIDEO_LIMIT;
const JOB_PREFIX = 'stream-jobs/v2/';
const POLL_INTERVAL = 15;
const STORY_POLL_INTERVAL = 2;
const CANCELLED = new Set(['delete_pending', 'deleted']);
export const sautiStreamJobKey = (kind, id) => `${JOB_PREFIX}${kind}/${id}.json`;
const reservationKey = (job) => `${job.kind}/${job.id}/${job.generation}`;

function canonicalPost(row) {
  return STREAM_UUID.test(String(row?.id || '')) && STREAM_UUID.test(String(row?.owner_id || ''))
    && STREAM_UUID.test(String(row?.post_id || '')) && row.upload_status === 'attached' && row.media_kind === 'video'
    && row.object_key === `sauti/${row.owner_id}/${row.id}.mp4`
    && Number(row.duration_ms) > 0 && Number(row.duration_ms) <= POST_VIDEO_DURATION_MS;
}
async function sourceHead(env, row, etag) {
  const source = await env.SAUTI_MEDIA.head(row.object_key).catch(() => null);
  return source?.etag && (!etag || source.etag === etag) && source.size > 0 && source.size <= SOURCE_MAX_BYTES
    && source.customMetadata?.ownerId === row.owner_id && source.customMetadata?.mediaId === row.id
    && source.customMetadata?.validated === 'true' ? source : null;
}
function configured(env) { return streamEnabled(env) && Boolean(streamOrigin(env) && streamSourceKey(env)); }
export async function inspectSautiStreamImportCandidate(env, row) {
  if (!canonicalPost(row)) return { eligible: false, reason: 'not_attached_canonical_video' };
  const source = await sourceHead(env, row);
  if (!source) return { eligible: false, reason: 'source_unavailable_or_unvalidated' };
  if (Number(row.size_bytes) !== source.size) return { eligible: false, reason: 'source_size_mismatch' };
  return { eligible: true, source_etag: source.etag, source_bytes: source.size,
    reserved_seconds: Math.min(180, Math.ceil(Number(row.duration_ms) / 1000) + 1) };
}
function matches(job, kind, id, owner) {
  return job?.version === 2 && job.kind === kind && job.id === id && job.owner_id === owner
    && STREAM_UUID.test(String(job.generation || ''));
}
export async function getSautiStreamJob(env, kind, id) {
  if (!['post', 'story'].includes(kind) || !STREAM_UUID.test(String(id || ''))) return null;
  return readStreamJson(env, sautiStreamJobKey(kind, id));
}

async function updateJob(env, record, patch) {
  const data = { ...record.data, ...patch };
  const saved = await writeStreamJson(env, sautiStreamJobKey(data.kind, data.id), data, record.etag);
  return saved ? { data, etag: saved.etag } : null;
}
async function removeJobAsset(env, record) {
  if (record.data.state !== 'delete_pending') return false;
  if (!STREAM_UID.test(String(record.data.stream_uid || ''))) return false;
  if (!await deleteStreamAsset(env, record.data.stream_uid)) return false;
  const saved = await updateJob(env, record, { state: 'deleted', provider_deleted: true, upload_url: null });
  if (saved) await releaseStreamSeconds(env, reservationKey(saved.data));
  return Boolean(saved);
}

export async function deleteSautiStreamVideo(env, rowOrJob, kind = 'post') {
  const id = String(rowOrJob?.id || '');
  const record = await getSautiStreamJob(env, kind, id);
  if (!record) return true;
  if (record.data.owner_id !== rowOrJob.owner_id) return false;
  if (record.data.state === 'deleted') return releaseStreamSeconds(env, reservationKey(record.data));
  const pending = record.data.state === 'delete_pending' ? record : await updateJob(env, record, { state: 'delete_pending', upload_url: null });
  if (!pending) return false;
  if (pending.data.stream_uid) return removeJobAsset(env, pending);
  // If no provider operation was started, no billable object can exist.
  if (!pending.data.operation_started) {
    const deleted = await updateJob(env, pending, { state: 'deleted', provider_deleted: true });
    if (deleted) await releaseStreamSeconds(env, reservationKey(deleted.data));
    return Boolean(deleted);
  }
  // An uncertain upload stays reserved and is reconciled rather than repeated.
  return false;
}

async function findUncertainAsset(env, record, now) {
  if (now - Number(record.data.updated_at || 0) < POLL_INTERVAL) return record;
  const claimed = await updateJob(env, record, { updated_at: now });
  if (!claimed) return null;
  let videos;
  try { videos = await streamOperation(() => env.STREAM.videos.list({ limit: 1000 })); }
  catch { return claimed; }
  if (!Array.isArray(videos)) return claimed;
  const matches = videos.filter((video) => streamVideoId(video) && video.meta?.sauti_generation === claimed.data.generation
    && video.meta?.sauti_id === claimed.data.id && video.meta?.sauti_kind === claimed.data.kind && video.creator === claimed.data.owner_id);
  if (matches.length !== 1) return claimed;
  const current = await getSautiStreamJob(env, claimed.data.kind, claimed.data.id);
  if (!current || current.data.generation !== claimed.data.generation) return null;
  const found = await updateJob(env, current, { stream_uid: streamVideoId(matches[0]),
    state: CANCELLED.has(current.data.state) ? 'delete_pending' : 'processing' });
  if (found?.data.state === 'delete_pending') await removeJobAsset(env, found);
  return found;
}

export async function reconcileSautiStreamJob(env, record, now = Math.floor(Date.now() / 1000)) {
  if (!configured(env) || !record?.data) return record;
  if (record.data.state === 'deleted') { await releaseStreamSeconds(env, reservationKey(record.data)); return record; }
  let job = record.data;
  if (!job.stream_uid) {
    if (job.operation_started) return findUncertainAsset(env, record, now);
    return record;
  }
  if (job.state === 'delete_pending') { await removeJobAsset(env, record); return record; }
  // Active Story uploads have a known provider ID and can become playable
  // quickly. Uncertain operations above retain the slower discovery interval.
  const interval = job.kind === 'story' ? STORY_POLL_INTERVAL : POLL_INTERVAL;
  if (job.state === 'ready' || now - Number(job.updated_at || 0) < interval) return record;
  const claimed = await updateJob(env, record, { updated_at: now });
  if (!claimed) return null;
  job = claimed.data;
  const video = await streamAssetDetails(env, job.stream_uid);
  if (!video) return claimed;
  const expected = { kind: job.kind, id: job.id, ownerId: job.owner_id,
    generation: job.generation, sourceEtag: job.source_etag, maxDurationSeconds: job.max_duration_seconds };
  const duration = Number(video.duration);
  if (streamVideoId(video) !== job.stream_uid || !streamAssetMatches(video, expected) || video.status?.state === 'error'
    || (job.kind === 'story' && Boolean(video.status?.errorReasonCode || video.status?.errReasonCode))
    || (duration > 0 && duration > job.max_duration_seconds)
    || (video.readyToStream && !(duration > 0 && Number.isFinite(duration)))) {
    await deleteSautiStreamVideo(env, job, job.kind);
    return null;
  }
  const observation = { provider_upload_state: String(video.status?.state || '').slice(0, 40), provider_checked_at: now };
  // Cloudflare documents readyToStream as at least one encoded quality. Stories
  // can use it while remaining qualities encode; posts keep their existing gate.
  const storyPlayable = job.kind === 'story' && video.readyToStream === true
    && ['ready', 'inprogress'].includes(video.status?.state)
    && duration > 0 && Number.isFinite(duration) && duration <= job.max_duration_seconds;
  if (!streamAssetReady(video, expected) && !storyPlayable) return updateJob(env, claimed, observation);
  return updateJob(env, claimed, { ...observation, state: 'ready', duration_ms: Math.round(duration * 1000),
    width: Number(video.input?.width) || null, height: Number(video.input?.height) || null, upload_url: null });
}

/** Only call with a current attached row read through its existing post ACL. */
export async function prepareSautiStreamVideo(env, row, now = Math.floor(Date.now() / 1000)) {
  if (!configured(env) || !canonicalPost(row)) return null;
  const source = await sourceHead(env, row);
  if (!source || Number(row.size_bytes) !== source.size) return null;
  let record = await getSautiStreamJob(env, 'post', row.id);
  if (record) {
    if (!matches(record.data, 'post', row.id, row.owner_id)) return null;
    if (record.data.source_etag !== source.etag || record.data.object_key !== row.object_key) {
      await deleteSautiStreamVideo(env, row); return null;
    }
    if (!['reserved', 'capacity_wait'].includes(record.data.state)) return reconcileSautiStreamJob(env, record, now);
  } else {
    const data = { version: 2, kind: 'post', id: row.id, owner_id: row.owner_id, generation: crypto.randomUUID(),
      object_key: row.object_key, source_etag: source.etag, source_expires_at: now + SOURCE_TTL,
      created_at: now, updated_at: now, state: 'reserved', duration_ms: Number(row.duration_ms),
      max_duration_seconds: Math.min(180, Math.ceil(Number(row.duration_ms) / 1000) + 1), operation_started: false };
    const claimed = await writeStreamJson(env, sautiStreamJobKey('post', row.id), data);
    if (!claimed) return null;
    record = { data, etag: claimed.etag };
  }
  if (!await reserveStreamSeconds(env, reservationKey(record.data), record.data.max_duration_seconds)) {
    await updateJob(env, record, { state: 'capacity_wait' }); return null;
  }
  const claimed = await updateJob(env, record, { state: 'importing', operation_started: true,
    source_expires_at: now + SOURCE_TTL, updated_at: now });
  if (!claimed) return null;
  const job = claimed.data;
  const signature = await streamHmac(env, `${job.id}\n${job.generation}\n${job.source_expires_at}\n${job.source_etag}`);
  const url = `https://sautilink.com/api/sauti-media/${job.id}/stream-source?g=${job.generation}&e=${job.source_expires_at}&s=${signature}`;
  let video = null;
  try {
    video = await streamOperation(() => env.STREAM.upload(url, { requireSignedURLs: true, creator: job.owner_id,
      meta: { name: `sauti-${job.generation}`, sauti_kind: 'post', sauti_id: job.id,
        sauti_generation: job.generation, sauti_source_etag: job.source_etag } }));
  } catch { /* An uncertain provider POST is never automatically replayed. */ }
  const uid = streamVideoId(video);
  const current = await getSautiStreamJob(env, 'post', job.id);
  if (!current || current.data.generation !== job.generation) { if (uid) await deleteStreamAsset(env, uid); return null; }
  const saved = await updateJob(env, current, { ...(uid ? { stream_uid: uid } : {}),
    state: CANCELLED.has(current.data.state) ? 'delete_pending' : uid && video.requireSignedURLs === true ? 'processing' : 'unknown' });
  if (uid && (saved?.data.state === 'delete_pending' || video.requireSignedURLs !== true)) {
    await deleteSautiStreamVideo(env, job); return null;
  }
  return saved;
}

export async function readySautiPostStreamAsset(env, row) {
  if (!configured(env) || !canonicalPost(row)) return null;
  // Both reads remain fresh for every authorized resource request. Their keys
  // come from the canonical row, so neither read depends on the other's result.
  const [record, source] = await Promise.all([
    getSautiStreamJob(env, 'post', row.id),
    sourceHead(env, row),
  ]);
  const job = record?.data;
  if (!matches(job, 'post', row.id, row.owner_id) || job.state !== 'ready' || !STREAM_UID.test(String(job.stream_uid || ''))
    || job.object_key !== row.object_key || !source || (job.source_etag && source.etag !== job.source_etag)) return null;
  return { kind: 'post', id: row.id, stream_uid: job.stream_uid, generation: job.generation };
}

/** Opaque short-lived capability for Stream's origin download, never a user JWT. */
export async function serveSautiStreamSource(request, env, id, now = Math.floor(Date.now() / 1000)) {
  const unavailable = () => new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
  if (!configured(env) || !STREAM_UUID.test(String(id || '')) || !['GET', 'HEAD'].includes(request.method)) return unavailable();
  const url = new URL(request.url);
  if ([...url.searchParams.keys()].some((key) => !['g', 'e', 's'].includes(key)) || ['g', 'e', 's'].some((key) => url.searchParams.getAll(key).length !== 1)) return unavailable();
  const record = await getSautiStreamJob(env, 'post', id);
  const job = record?.data;
  const expires = Number(url.searchParams.get('e'));
  if (!job || job.id !== id || job.generation !== url.searchParams.get('g') || CANCELLED.has(job.state)
    || !job.operation_started || !Number.isSafeInteger(expires) || expires !== job.source_expires_at || expires <= now || expires > now + SOURCE_TTL
    || !await verifyStreamHmac(env, `${id}\n${job.generation}\n${expires}\n${job.source_etag}`, url.searchParams.get('s'))) return unavailable();
  const row = { id, owner_id: job.owner_id, object_key: job.object_key };
  const source = await sourceHead(env, row, job.source_etag);
  if (!source) return unavailable();
  let range;
  const rangeHeader = request.headers.get('Range');
  if (rangeHeader) {
    const parsed = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader);
    const offset = Number(parsed?.[1]);
    const end = parsed?.[2] ? Number(parsed[2]) : source.size - 1;
    if (!parsed || !Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || end < offset || end >= source.size) {
      return new Response(null, { status: 416, headers: { 'Cache-Control': 'no-store', 'Content-Range': `bytes */${source.size}` } });
    }
    range = { offset, length: end - offset + 1 };
  }
  const headers = new Headers({ 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff', 'Accept-Ranges': 'bytes', 'Content-Length': String(range?.length || source.size), ETag: source.httpEtag || `"${source.etag}"` });
  if (range) headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${source.size}`);
  if (request.method === 'HEAD') return new Response(null, { status: range ? 206 : 200, headers });
  const object = await env.SAUTI_MEDIA.get(row.object_key, { onlyIf: { etagMatches: job.source_etag }, ...(range ? { range } : {}) });
  if (!object?.body || object.etag !== job.source_etag) return unavailable();
  return new Response(object.body, { status: range ? 206 : 200, headers });
}

/** Root Story API must authenticate ownership/quota before calling this helper. */
export async function createSautiStoryStreamUpload(env, { id, owner_id: ownerId }, now = Math.floor(Date.now() / 1000)) {
  if (!configured(env) || !STREAM_UUID.test(String(id || '')) || !STREAM_UUID.test(String(ownerId || ''))) return null;
  let record = await getSautiStreamJob(env, 'story', id);
  if (record) {
    if (!matches(record.data, 'story', id, ownerId)) return null;
    if (record.data.upload_url && record.data.upload_expires_at > now && record.data.state === 'processing') return record.data;
    return null;
  }
  const job = { version: 2, kind: 'story', id, owner_id: ownerId, generation: crypto.randomUUID(), state: 'reserved',
    max_duration_seconds: 30, created_at: now, updated_at: now, operation_started: false, upload_expires_at: now + 600 };
  const claim = await writeStreamJson(env, sautiStreamJobKey('story', id), job);
  if (!claim) return null;
  record = { data: job, etag: claim.etag };
  if (!await reserveStreamSeconds(env, reservationKey(job), 30)) { await updateJob(env, record, { state: 'capacity_wait' }); return null; }
  const started = await updateJob(env, record, { operation_started: true, state: 'importing' });
  if (!started) return null;
  let upload;
  try {
    upload = await streamOperation(() => env.STREAM.createDirectUpload({ maxDurationSeconds: 30,
      expiry: new Date(job.upload_expires_at * 1000).toISOString(), requireSignedURLs: true, creator: ownerId,
      meta: { name: `sauti-${job.generation}`, sauti_kind: 'story', sauti_id: id, sauti_generation: job.generation } }));
  } catch { await updateJob(env, started, { state: 'unknown' }); return null; }
  const uid = streamVideoId(upload);
  let url;
  try { url = new URL(upload?.uploadURL); } catch { /* Mark known provider objects for durable deletion below. */ }
  const current = await getSautiStreamJob(env, 'story', id);
  if (!current || current.data.generation !== job.generation) { await deleteStreamAsset(env, uid); return null; }
  if (!uid || !url || !['https://upload.videodelivery.net', 'https://upload.cloudflarestream.com'].includes(url.origin)
    || url.username || url.password || url.hash || url.search || !/^\/[A-Za-z0-9_-]{32}$/.test(url.pathname)
    || !/^https:\/\/(?:upload\.videodelivery\.net|upload\.cloudflarestream\.com)\/[A-Za-z0-9_-]{32}$/.test(String(upload.uploadURL))) {
    const invalid = await updateJob(env, current, { state: uid ? 'delete_pending' : 'unknown', ...(uid ? { stream_uid: uid } : {}) });
    if (invalid?.data.stream_uid) await removeJobAsset(env, invalid);
    return null;
  }
  const saved = await updateJob(env, current, { state: CANCELLED.has(current.data.state) ? 'delete_pending' : 'processing',
    stream_uid: uid, upload_url: url.href });
  if (saved?.data.state === 'delete_pending') { await removeJobAsset(env, saved); return null; }
  return saved?.data || null;
}

export async function readySautiStoryStreamAsset(env, { id, owner_id }, now = Math.floor(Date.now() / 1000)) {
  const prior = await getSautiStreamJob(env, 'story', id);
  if (!prior || !matches(prior.data, 'story', id, owner_id) || CANCELLED.has(prior.data.state)) return null;
  const record = await reconcileSautiStreamJob(env, prior, now);
  return record?.data.state === 'ready' ? record.data : null;
}

/** A provisioned one-time URL is not evidence that any upload was received. */
export async function sautiStoryStreamUploadStatus(env, { id, owner_id }, now = Math.floor(Date.now() / 1000)) {
  const prior = await getSautiStreamJob(env, 'story', id);
  if (!prior || !matches(prior.data, 'story', id, owner_id)) {
    return { uploaded: false, ready: false, processing: false, awaiting_upload: false, retry_upload: false, failed: false };
  }
  await reconcileSautiStreamJob(env, prior, now);
  const current = await getSautiStreamJob(env, 'story', id);
  const job = current?.data;
  if (!job || !matches(job, 'story', id, owner_id)) {
    return { uploaded: false, ready: false, processing: false, awaiting_upload: false, retry_upload: false, failed: false };
  }
  const ready = job.state === 'ready';
  const awaiting = job.provider_upload_state === 'pendingupload';
  const accepted = ready || ['queued', 'inprogress', 'ready'].includes(job.provider_upload_state);
  const failed = CANCELLED.has(job.state) || (awaiting && job.upload_expires_at <= now);
  return { uploaded: accepted && !failed, ready: ready && !failed, processing: accepted && !ready && !failed,
    awaiting_upload: awaiting && !failed,
    // A stale pendingupload observation must never replay an uncertain POST.
    retry_upload: awaiting && !failed && Boolean(job.upload_url) && job.upload_expires_at > now
      && Number(job.provider_checked_at) >= now - 5,
    failed };
}

/** Bounded durable queue polling. Caller rechecks row existence/expiry via validate. */
export async function sweepSautiStreamJobs(env, { validate, now = Math.floor(Date.now() / 1000), limit = 25 } = {}) {
  if (!configured(env) || typeof validate !== 'function') return { processed: 0 };
  const cursorKey = 'stream-control/v2/sweep-cursor.json';
  const prior = await readStreamJson(env, cursorKey);
  const page = await env.SAUTI_MEDIA.list({ prefix: JOB_PREFIX, limit: Math.min(50, Math.max(1, limit)), ...(prior?.data.cursor ? { cursor: prior.data.cursor } : {}) });
  let processed = 0;
  for (const entry of page.objects || []) {
    const record = await readStreamJson(env, entry.key);
    if (!record) continue;
    const valid = await validate(record.data);
    if (valid === false) await deleteSautiStreamVideo(env, record.data, record.data.kind);
    else if (valid === true) await reconcileSautiStreamJob(env, record, now);
    processed++;
  }
  await writeStreamJson(env, cursorKey, { cursor: page.truncated ? page.cursor : null }, prior?.etag);
  return { processed, truncated: Boolean(page.truncated) };
}
