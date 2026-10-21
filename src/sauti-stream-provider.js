// Stream's Workers binding keeps provider credentials out of both clients.
export const STREAM_UID = /^[0-9a-f]{32}$/;
export const STREAM_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function streamEnabled(env) {
  return env?.SAUTI_STREAM_ENABLED === 'true' && Boolean(env.STREAM?.video && env.STREAM?.upload && env.SAUTI_MEDIA);
}

export function streamOrigin(env) {
  const origin = String(env?.SAUTI_STREAM_ORIGIN || '');
  return /^https:\/\/customer-[a-z0-9]{1,64}\.cloudflarestream\.com$/.test(origin) ? origin : null;
}

export function streamVideoId(video) {
  const id = String(video?.id || video?.uid || '');
  return STREAM_UID.test(id) ? id : null;
}

export async function streamOperation(operation, timeoutMs = 12000) {
  let timer;
  try {
    return await Promise.race([operation(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('STREAM_OPERATION_TIMEOUT')), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

export async function deleteStreamAsset(env, id) {
  if (!STREAM_UID.test(String(id || '')) || !env?.STREAM?.video) return false;
  try { await streamOperation(() => env.STREAM.video(id).delete()); return true; }
  catch (error) {
    // The real binding can serialize NotFoundError as this exact generic
    // message. Other errors, including denied/uncertain deletes, retain retries.
    return error?.name === 'NotFoundError' || error?.status === 404 || error?.statusCode === 404
      || (error?.name === 'Error' && error?.message === 'Not Found: The requested resource or operation was not found.');
  }
}

export async function streamAssetDetails(env, id) {
  if (!STREAM_UID.test(String(id || '')) || !env?.STREAM?.video) return null;
  try { return await streamOperation(() => env.STREAM.video(id).details()); }
  catch { return null; }
}

export function streamAssetMatches(video, { kind, id, ownerId, generation, sourceEtag } = {}) {
  return Boolean(streamVideoId(video) && video.requireSignedURLs === true && video.creator === ownerId
    && video.meta?.sauti_kind === kind && video.meta?.sauti_id === id
    && video.meta?.sauti_generation === generation
    && (!sourceEtag || video.meta?.sauti_source_etag === sourceEtag));
}

export function streamAssetReady(video, options = {}) {
  const duration = Number(video?.duration);
  return streamAssetMatches(video, options) && video.readyToStream === true && video.status?.state === 'ready'
    && duration > 0 && Number.isFinite(duration) && duration <= options.maxDurationSeconds;
}

export function streamSourceKey(env) {
  const value = String(env?.SAUTI_STREAM_SOURCE_KEY || '');
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
  try { return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/') + '='), (char) => char.charCodeAt(0)); }
  catch { return null; }
}

export function streamBase64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export async function streamHmac(env, value) {
  const bytes = streamSourceKey(env);
  if (!bytes) throw new Error('STREAM_SIGNING_NOT_CONFIGURED');
  const key = await crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return streamBase64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
}

export async function verifyStreamHmac(env, value, signature) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(String(signature || ''))) return false;
  const bytes = streamSourceKey(env);
  if (!bytes) return false;
  const key = await crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const raw = Uint8Array.from(atob(signature.replaceAll('-', '+').replaceAll('_', '/') + '='), (char) => char.charCodeAt(0));
  return crypto.subtle.verify('HMAC', key, raw, new TextEncoder().encode(value));
}

export async function readStreamJson(env, key, maxBytes = 16384) {
  const object = await env.SAUTI_MEDIA?.get(key).catch(() => null);
  if (!object || !object.etag || object.size <= 0 || object.size > maxBytes) return null;
  try {
    const text = await object.text();
    return new TextEncoder().encode(text).length <= maxBytes ? { data: JSON.parse(text), etag: object.etag } : null;
  } catch { return null; }
}

export function writeStreamJson(env, key, data, etag = null) {
  return env.SAUTI_MEDIA.put(key, JSON.stringify(data), {
    httpMetadata: { contentType: 'application/json' },
    onlyIf: etag ? { etagMatches: etag } : { etagDoesNotMatch: '*' },
  });
}

const CAPACITY_KEY = 'stream-control/v2/storage-capacity.json';
const MAX_RESERVATIONS = 20000;

// Reservations include pending/uncertain operations, not just ready videos.
// There is deliberately no API that purchases additional storage.
export async function reserveStreamSeconds(env, reservation, seconds) {
  const capacity = Number(env.SAUTI_STREAM_STORAGE_SECONDS);
  const baseline = Number(env.SAUTI_STREAM_INITIAL_SECONDS);
  if (!/^[a-z0-9/-]{1,160}$/.test(reservation) || !Number.isSafeInteger(seconds) || seconds < 1
    || !Number.isSafeInteger(capacity) || capacity < 1 || capacity > 60000
    || !Number.isSafeInteger(baseline) || baseline < 0 || baseline > capacity) return false;
  for (let attempt = 0; attempt < 5; attempt++) {
    const prior = await readStreamJson(env, CAPACITY_KEY, 2 * 1024 * 1024);
    const ledger = prior?.data || { version: 2, baseline_seconds: baseline, reservations: {} };
    if (ledger.version !== 2 || !ledger.reservations || typeof ledger.reservations !== 'object'
      || Array.isArray(ledger.reservations) || !Number.isSafeInteger(ledger.baseline_seconds)
      || ledger.baseline_seconds < 0) return false;
    const entries = Object.entries(ledger.reservations);
    if (entries.some(([, value]) => !Number.isSafeInteger(value) || value < 1)) return false;
    if (Object.hasOwn(ledger.reservations, reservation)) return ledger.reservations[reservation] === seconds;
    const used = entries.reduce((sum, [, value]) => sum + value, ledger.baseline_seconds);
    if (entries.length >= MAX_RESERVATIONS || used + seconds > capacity) return false;
    if (await writeStreamJson(env, CAPACITY_KEY, { ...ledger,
      reservations: { ...ledger.reservations, [reservation]: seconds } }, prior?.etag)) return true;
  }
  return false;
}

export async function releaseStreamSeconds(env, reservation) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const prior = await readStreamJson(env, CAPACITY_KEY, 2 * 1024 * 1024);
    if (!prior || !Object.hasOwn(prior.data.reservations || {}, reservation)) return true;
    const reservations = { ...prior.data.reservations };
    delete reservations[reservation];
    if (await writeStreamJson(env, CAPACITY_KEY, { ...prior.data, reservations }, prior.etag)) return true;
  }
  return false;
}

export async function streamCapacityStatus(env) {
  const prior = await readStreamJson(env, CAPACITY_KEY, 2 * 1024 * 1024);
  const ledger = prior?.data;
  return { capacity_seconds: Number(env.SAUTI_STREAM_STORAGE_SECONDS) || 0,
    reserved_seconds: ledger ? Object.values(ledger.reservations || {}).reduce((sum, value) => sum + Number(value), Number(ledger.baseline_seconds)) : Number(env.SAUTI_STREAM_INITIAL_SECONDS) || 0,
    reservations: Object.keys(ledger?.reservations || {}).length };
}
