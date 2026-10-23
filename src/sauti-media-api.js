import { originalVideoIndexObjectKey, originalVideoIndexReceiptObjectKey, servePrecomputedOriginalIndex } from './original-video-index-delivery.js';
import { inspectImageBytes } from './profile-media-api.js';
import { VIDEO_VARIANT_QUALITIES, videoVariantDimensions, availableVideoQualities } from './video-quality-levels.js';
import { prepareSautiStreamVideo, readySautiPostStreamAsset, serveSautiStreamSource, deleteSautiStreamVideo } from './sauti-stream-lifecycle.js';
import { sautiStreamPlaybackDescriptor, serveSautiStreamHls, serveSautiStreamThumbnail } from './sauti-stream-playback.js';
import { streamEnabled } from './sauti-stream-provider.js';
import { createMediaServerTiming } from './media-server-timing.js';
import { sautiStreamBootstrap } from './sauti-stream-bootstrap.js';
import { POST_IMAGE_LIMIT, POST_VIDEO_LIMIT, POST_VIDEO_DURATION_MS, POST_UPLOAD_PART_BYTES } from './post-media-policy.js';
import { MediaChunkError, mediaChunkContract, putMediaChunk, assembleMediaChunks, cleanupMediaChunks, boundedMediaUploadBody, stageLegacyMediaBody } from './sauti-media-chunks.js';

const SUPABASE_URL = 'https://rggpyiterdbbugluejcs.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_omJ-5Mem-K4vgm6WLXRzJQ_jeGs65ca';
const IMAGE_LIMIT = POST_IMAGE_LIMIT;
const VIDEO_LIMIT = POST_VIDEO_LIMIT;
const MAX_VIDEO_DURATION_MS = POST_VIDEO_DURATION_MS;
const MAX_DIMENSION = 8192;
const UPLOAD_TTL_MS = 60 * 60 * 1000;
const IMAGE_VARIANT_VERSION = 'v1';
const IMAGE_VARIANT_WIDTHS = Object.freeze([480, 960, 1440]);
const IMAGE_VARIANT_EDGE_TTL_SECONDS = 30 * 24 * 60 * 60;
const VIDEO_VARIANT_VERSION = 'v2';
const VIDEO_POSTER_VERSION = 'v1';
const VIDEO_RANGE_CHUNK_BYTES = 1024 * 1024;
const VIDEO_MEDIA_SESSION_COOKIE = '__Secure-sautilink-media-session';
const VIDEO_MEDIA_SESSION_TTL_SECONDS = 5 * 60;
const videoVariantJobs = new Map();
const videoPosterJobs = new Map();

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

// Preserve the original thrown object; retain only its fatal delivery phase weakly.
const mediaDeliveryFailures = new WeakMap();
const mediaDeliveryPhases = new Set(['METADATA_LOOKUP', 'ORIGINAL_R2_HEAD', 'ORIGINAL_R2_GET', 'VARIANT_R2_GET', 'ORIGINAL_INDEX_R2_HEAD', 'ORIGINAL_INDEX_RECEIPT_R2_GET', 'ORIGINAL_INDEX_R2_GET']);
const mediaDeliveryErrorNames = new Set(['Error', 'TypeError', 'RangeError', 'SyntaxError',
  'DOMException', 'AbortError', 'TimeoutError', 'NetworkError']);
async function mediaDeliveryPhase(phase, operation) {
  try { return await operation(); } catch (error) {
    if (error !== null && (typeof error === 'object' || typeof error === 'function')) {
      mediaDeliveryFailures.set(error, phase);
    }
    throw error;
  }
}

export function mediaDeliveryFailureDiagnostic(error) {
  const object = error !== null && (typeof error === 'object' || typeof error === 'function');
  const taggedPhase = object ? mediaDeliveryFailures.get(error) : null;
  const phase = mediaDeliveryPhases.has(taggedPhase) ? taggedPhase : 'UNCLASSIFIED_MEDIA';
  let name = object ? 'UNKNOWN' : 'NON_OBJECT', code = null;
  try {
    const candidateName = object ? error.name : null;
    if (mediaDeliveryErrorNames.has(candidateName)) name = candidateName;
    const value = object ? error.code : null;
    if (Number.isSafeInteger(value) && value >= 0 && value <= 999999) code = value;
    // R2 can put its numeric code in this fixed prefix, rather than a code property.
    const message = object && code === null ? error.message : null;
    if (typeof message === 'string') {
      const match = /^R2 (?:GET|HEAD) failed:?\s*\((\d{3,6})\)/.exec(message.slice(0, 160));
      if (match) code = Number(match[1]);
    }
  } catch { /* A diagnostic must not replace the existing failure response. */ }
  return { delivery_phase: phase, exception_class: name, exception_code: code ?? 'NONE',
    delivery_reason: phase === 'METADATA_LOOKUP' ? 'METADATA_THROW'
      : phase === 'UNCLASSIFIED_MEDIA' ? 'UNCLASSIFIED_THROW' : 'R2_THROW' };
}

function authorization(request) {
  const value = request.headers.get('Authorization') || '';
  return /^Bearer\s+[^\s]+$/i.test(value) ? value : '';
}

function mediaSessionToken(request) {
  const cookies = String(request.headers.get('Cookie') || '').split(';');
  const prefix = `${VIDEO_MEDIA_SESSION_COOKIE}=`;
  const encoded = cookies.map((value) => value.trim()).find((value) => value.startsWith(prefix))?.slice(prefix.length) || '';
  if (!encoded || encoded.length > 4096) return '';
  try {
    const token = decodeURIComponent(encoded);
    return /^[^\s]+\.[^\s]+\.[^\s]+$/.test(token) ? token : '';
  } catch {
    return '';
  }
}

function mediaDeliveryAuthorization(request) {
  const header = authorization(request);
  if (header) return header;
  const token = mediaSessionToken(request);
  return token ? `Bearer ${token}` : '';
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

async function createVideoMediaSession(request) {
  const session = await authenticate(request);
  if (!session) return apiError(401, 'AUTH_REQUIRED', 'Sign in before streaming video.');
  const token = session.auth.replace(/^Bearer\s+/i, '');
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  headers.append(
    'Set-Cookie',
    `${VIDEO_MEDIA_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/api/sauti-media; Max-Age=${VIDEO_MEDIA_SESSION_TTL_SECONDS}; Secure; HttpOnly; SameSite=Strict`,
  );
  return new Response(null, { status: 204, headers });
}

function clearVideoMediaSession() {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  headers.append(
    'Set-Cookie',
    `${VIDEO_MEDIA_SESSION_COOKIE}=; Path=/api/sauti-media; Max-Age=0; Secure; HttpOnly; SameSite=Strict`,
  );
  return new Response(null, { status: 204, headers });
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

export function normalizeSautiMediaVariantWidth(value) {
  const width = Number(value || 0);
  return IMAGE_VARIANT_WIDTHS.includes(width) ? width : 0;
}

export function normalizeSautiVideoQuality(value) {
  const quality = Number(value || 0);
  return VIDEO_VARIANT_QUALITIES.includes(quality) ? quality : 0;
}

export function sautiVideoVariantObjectKey(objectKey, quality) {
  const normalized = normalizeSautiVideoQuality(quality);
  return normalized ? `${String(objectKey || '')}.video-${VIDEO_VARIANT_VERSION}-q${normalized}.mp4` : '';
}

export function sautiVideoPosterObjectKey(objectKey) {
  return `${String(objectKey || '')}.poster-${VIDEO_POSTER_VERSION}.jpg`;
}

export function sautiMediaObjectKeys(row) {
  const original = String(row?.object_key || '');
  if (!original) return [];
  if (row?.media_kind !== 'video') return [original];
  return [original, originalVideoIndexReceiptObjectKey(original), originalVideoIndexObjectKey(original), sautiVideoPosterObjectKey(original),
    ...VIDEO_VARIANT_QUALITIES.map((quality) => sautiVideoVariantObjectKey(original, quality)),
    ...[360, 720].map((quality) => `${original}.video-v1-q${quality}.mp4`)];
}

function responsiveImagesEnabled(env) {
  return String(env?.SAUTI_MEDIA_VARIANTS_ENABLED || '').toLowerCase() === 'true' && Boolean(env?.IMAGES);
}

function mediaVariantEtag(id, width = 0) {
  const suffix = width ? `${IMAGE_VARIANT_VERSION}-w${width}` : 'original';
  return `W/"sauti-${id}-${suffix}"`;
}

function videoVariantEtag(id, quality) {
  return `W/"sauti-${id}-video-${VIDEO_VARIANT_VERSION}-q${quality}"`;
}

export function boundedSautiVideoRange(value, size) {
  const total = Number(size);
  const match = /^bytes=(\d*)-(\d*)$/i.exec(String(value || '').trim());
  if (!match || !Number.isSafeInteger(total) || total <= 0 || (!match[1] && !match[2])) return null;
  if (!match[1]) {
    const suffix = Number(match[2]);
    return Number.isSafeInteger(suffix) && suffix > 0
      ? { suffix: Math.min(suffix, VIDEO_RANGE_CHUNK_BYTES) } : null;
  }
  const offset = Number(match[1]);
  const end = match[2] ? Number(match[2]) : total - 1;
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end)
    || offset < 0 || offset >= total || end < offset) return null;
  return { offset, length: Math.min(end - offset + 1, total - offset, VIDEO_RANGE_CHUNK_BYTES) };
}

function mediaResponseHeaders(contentType, etag, variantWidth = 0) {
  const headers = new Headers();
  if (contentType) headers.set('Content-Type', contentType);
  headers.set('Cache-Control', 'private, no-store, max-age=0');
  headers.set('Content-Security-Policy', "default-src 'none'");
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Content-Disposition', 'inline');
  headers.set('ETag', etag);
  if (variantWidth) headers.set('X-Sauti-Media-Variant', `${IMAGE_VARIANT_VERSION};w=${variantWidth}`);
  else headers.set('X-Sauti-Media-Variant', 'original');
  return headers;
}

function requestHasEtag(request, etag) {
  return String(request.headers.get('If-None-Match') || '')
    .split(',')
    .map((value) => value.trim())
    .includes(etag);
}

function mediaVariantCacheKey(request, id, width) {
  const url = new URL(request.url);
  url.search = '';
  url.searchParams.set('w', String(width));
  url.searchParams.set('variant', IMAGE_VARIANT_VERSION);
  return new Request(url.toString(), { method: 'GET' });
}

function fixed16(value) {
  return Math.max(0, Math.round(value / 65536));
}

function boxType(bytes, offset) {
  if (offset + 8 > bytes.length) return '';
  return String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
}

function boxSize(view, bytes, offset, end) {
  if (offset + 8 > bytes.length) return 0;
  const size32 = view.getUint32(offset, false);
  if (size32 === 0) return end - offset;
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
  let count = 0;
  while (offset < end) {
    if (offset + 8 > end || ++count > 4096) return null;
    const size = boxSize(view, bytes, offset, end);
    const header = view.getUint32(offset, false) === 1 ? 16 : 8;
    if (size < header || offset + size > end) return null;
    const type = boxType(bytes, offset);
    if (wanted.has(type)) found.push({ type, offset, size, header });
    offset += size;
  }
  return found;
}

function fullBoxTiming(bytes, view, box) {
  if (!box) return null;
  const base = box.offset + box.header;
  const end = box.offset + box.size;
  const version = bytes[base];
  const timing = base + 4;
  let timescale = 0;
  let duration = 0;

  if (version === 0 && timing + 16 <= end) {
    timescale = view.getUint32(timing + 8, false);
    duration = view.getUint32(timing + 12, false);
    if (duration === 0xffffffff) duration = 0;
  } else if (version === 1 && timing + 28 <= end) {
    timescale = view.getUint32(timing + 16, false);
    const high = view.getUint32(timing + 20, false);
    const low = view.getUint32(timing + 24, false);
    duration = high === 0xffffffff && low === 0xffffffff ? 0 : high * 2 ** 32 + low;
  } else {
    return null;
  }

  if (!timescale || !Number.isSafeInteger(duration)) return null;
  return { timescale, duration };
}

function timingDurationMs(timing) {
  if (!timing) return 0;
  const durationMs = Math.ceil((timing.duration / timing.timescale) * 1000);
  return Number.isSafeInteger(durationMs) && durationMs > 0 ? durationMs : 0;
}

function handlerType(bytes, box) {
  if (!box) return '';
  const offset = box.offset + box.header + 8;
  if (offset + 4 > box.offset + box.size) return '';
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

// Fragmented MP4 initialization headers can describe only the first few samples
// (or zero samples). The complete duration comes from each track's tfdt/trun
// timeline, including audio that continues after the final video frame.
function fragmentedDurationMs(bytes, view, moofs, mvex, tracks) {
  const defaults = new Map();
  const extendsBoxes = mvex && findBoxes(bytes, mvex.offset + mvex.header, mvex.offset + mvex.size, new Set(['trex']));
  if (!extendsBoxes) return null;
  for (const box of extendsBoxes) {
    const base = box.offset + box.header;
    if (box.size - box.header !== 24 || bytes[base] !== 0) return null;
    const id = view.getUint32(base + 4, false);
    if (!tracks.has(id) || defaults.has(id)) return null;
    defaults.set(id, view.getUint32(base + 12, false));
  }

  let sampleBudget = 250000;
  let durationMs = 0;
  let hasSamples = false;
  for (const moof of moofs) {
    const fragments = findBoxes(bytes, moof.offset + moof.header, moof.offset + moof.size, new Set(['traf']));
    if (!fragments?.length) return null;
    for (const fragment of fragments) {
      const boxes = findBoxes(bytes, fragment.offset + fragment.header, fragment.offset + fragment.size, new Set(['tfhd', 'tfdt', 'trun']));
      if (!boxes) return null;
      const headers = boxes.filter((box) => box.type === 'tfhd');
      const times = boxes.filter((box) => box.type === 'tfdt');
      if (headers.length !== 1 || times.length > 1) return null;
      const header = headers[0];
      const base = header.offset + header.header;
      const end = header.offset + header.size;
      if (base + 8 > end || bytes[base] !== 0) return null;
      const flags = view.getUint32(base, false) & 0xffffff;
      if (flags & ~0x03003b) return null;
      const id = view.getUint32(base + 4, false);
      const track = tracks.get(id);
      if (!track?.timing || !defaults.has(id)) return null;
      let offset = base + 8 + ((flags & 1) ? 8 : 0) + ((flags & 2) ? 4 : 0);
      let defaultDuration = defaults.get(id);
      if (flags & 8) {
        if (offset + 4 > end) return null;
        defaultDuration = view.getUint32(offset, false);
        offset += 4;
      }
      offset += ((flags & 0x10) ? 4 : 0) + ((flags & 0x20) ? 4 : 0);
      if (offset !== end) return null;
      let decodeTime = track.decodeEnd || 0;
      if (times.length) {
        const time = times[0];
        const p = time.offset + time.header;
        const version = bytes[p];
        if ((version !== 0 && version !== 1) || time.size - time.header !== (version === 1 ? 12 : 8)) return null;
        decodeTime = version === 1 ? view.getUint32(p + 4, false) * 2 ** 32 + view.getUint32(p + 8, false) : view.getUint32(p + 4, false);
        if (!Number.isSafeInteger(decodeTime)) return null;
      }
      const runs = boxes.filter((box) => box.type === 'trun');
      if ((flags & 0x010000) && runs.length) return null;
      for (const run of runs) {
        const p = run.offset + run.header;
        const runEnd = run.offset + run.size;
        if (p + 8 > runEnd || bytes[p] > 1) return null;
        const runFlags = view.getUint32(p, false) & 0xffffff;
        if ((runFlags & ~0x000f05) || ((runFlags & 4) && (runFlags & 0x400))) return null;
        const count = view.getUint32(p + 4, false);
        if (!count || count > sampleBudget) return null;
        sampleBudget -= count;
        let sample = p + 8 + ((runFlags & 1) ? 4 : 0) + ((runFlags & 4) ? 4 : 0);
        const stride = ((runFlags & 0x100) ? 4 : 0) + ((runFlags & 0x200) ? 4 : 0)
          + ((runFlags & 0x400) ? 4 : 0) + ((runFlags & 0x800) ? 4 : 0);
        if (sample + count * stride !== runEnd) return null;
        for (let index = 0; index < count; index += 1) {
          const duration = (runFlags & 0x100) ? view.getUint32(sample, false) : defaultDuration;
          sample += ((runFlags & 0x100) ? 4 : 0) + ((runFlags & 0x200) ? 4 : 0) + ((runFlags & 0x400) ? 4 : 0);
          const compositionOffset = (runFlags & 0x800)
            ? (bytes[p] === 1 ? view.getInt32(sample, false) : view.getUint32(sample, false)) : 0;
          sample += (runFlags & 0x800) ? 4 : 0;
          const decodeEnd = decodeTime + duration;
          const presentationEnd = decodeEnd + compositionOffset;
          if (!duration || !Number.isSafeInteger(decodeEnd) || !Number.isSafeInteger(presentationEnd)) return null;
          const sampleEndMs = Math.ceil((Math.max(decodeEnd, presentationEnd) / track.timing.timescale) * 1000);
          if (!Number.isSafeInteger(sampleEndMs) || sampleEndMs > MAX_VIDEO_DURATION_MS) return null;
          durationMs = Math.max(durationMs, sampleEndMs);
          decodeTime = decodeEnd;
          hasSamples = true;
        }
      }
      track.decodeEnd = decodeTime;
    }
  }
  return hasSamples && durationMs > 0 ? durationMs : null;
}

export function inspectMp4Bytes(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 32 || bytes.length > VIDEO_LIMIT) return null;
  const top = findBoxes(bytes, 0, bytes.length, new Set(['ftyp', 'moov', 'moof']));
  if (!top || top.filter((box) => box.type === 'ftyp').length !== 1) return null;
  const movies = top.filter((box) => box.type === 'moov');
  if (movies.length !== 1) return null;
  const moov = movies[0];

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const children = findBoxes(bytes, moov.offset + moov.header, moov.offset + moov.size, new Set(['mvhd', 'trak', 'mvex']));
  if (!children || children.filter((box) => box.type === 'mvhd').length > 1 || children.filter((box) => box.type === 'mvex').length > 1) return null;
  const mvhd = children.find((box) => box.type === 'mvhd');
  let durationMs = timingDurationMs(fullBoxTiming(bytes, view, mvhd));
  const tracks = new Map();
  const trackBoxesList = children.filter((box) => box.type === 'trak');
  if (trackBoxesList.length > 32) return null;

  let width = 0;
  let height = 0;
  for (const trak of trackBoxesList) {
    const trackBoxes = findBoxes(bytes, trak.offset + trak.header, trak.offset + trak.size, new Set(['tkhd', 'mdia']));
    if (!trackBoxes || trackBoxes.filter((box) => box.type === 'tkhd').length !== 1 || trackBoxes.filter((box) => box.type === 'mdia').length > 1) return null;
    const tkhd = trackBoxes.find((box) => box.type === 'tkhd');
    if (!tkhd) continue;
    const base = tkhd.offset + tkhd.header;
    const tkVersion = bytes[base];
    if (tkVersion !== 0 && tkVersion !== 1) return null;
    const data = base + 4;
    const dimensionOffset = tkVersion === 1 ? data + 84 : data + 72;
    if (dimensionOffset + 8 > tkhd.offset + tkhd.size) return null;
    const w = fixed16(view.getUint32(dimensionOffset, false));
    const h = fixed16(view.getUint32(dimensionOffset + 4, false));
    const mdia = trackBoxes.find((box) => box.type === 'mdia');
    const mediaBoxes = mdia
      ? findBoxes(bytes, mdia.offset + mdia.header, mdia.offset + mdia.size, new Set(['mdhd', 'hdlr']))
      : [];
    if (!mediaBoxes || mediaBoxes.filter((box) => box.type === 'mdhd').length > 1 || mediaBoxes.filter((box) => box.type === 'hdlr').length > 1) return null;
    const timing = fullBoxTiming(bytes, view, mediaBoxes.find((box) => box.type === 'mdhd'));
    const id = view.getUint32(base + (tkVersion === 1 ? 20 : 12), false);
    if (tracks.has(id)) return null;
    tracks.set(id, { timing, decodeEnd: 0 });
    durationMs = Math.max(durationMs, timingDurationMs(timing));
    const mediaHandler = handlerType(bytes, mediaBoxes.find((box) => box.type === 'hdlr'));
    const isVideoTrack = mediaHandler === 'vide' || (w > 0 && h > 0);

    if (isVideoTrack && w * h > width * height) {
      width = w;
      height = h;
    }
  }
  const moofs = top.filter((box) => box.type === 'moof');
  const mvex = children.find((box) => box.type === 'mvex');
  if (moofs.length || mvex) {
    if (!moofs.length || !mvex) return null;
    const fragmentedMs = fragmentedDurationMs(bytes, view, moofs, mvex, tracks);
    if (fragmentedMs === null) return null;
    durationMs = Math.max(durationMs, fragmentedMs);
  }
  if (!width || !height) return null;
  if (!durationMs) return null;
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

async function selectVideoMediaForDelivery(request, id, auth) {
  const cache = globalThis.caches?.default;
  if (!cache || !auth) return selectMedia(id, auth);

  // Cache only a successful, token-scoped RLS result for the burst of range
  // requests a browser makes when it starts a video. Never cache denials.
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(auth));
  const tokenHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const url = new URL(request.url);
  url.pathname = `/__sauti_media_access/${id}`;
  url.search = `?token=${tokenHash}`;
  const key = new Request(url.toString());
  const cached = await cache.match(key).catch(() => null);
  if (cached) return cached.json();

  const row = await selectMedia(id, auth);
  if (row?.upload_status === 'attached' && row.media_kind === 'video') {
    await cache.put(key, new Response(JSON.stringify(row), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3' },
    })).catch(() => {});
  }
  return row;
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
  const params = new URLSearchParams({ id: `eq.${id}`, owner_id: `eq.${session.user.id}`, post_id: 'is.null',
    upload_status: patch.upload_status === 'uploaded' ? 'eq.pending' : 'eq.uploaded', select: 'id,upload_status,finalized_at' });
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

async function deleteMediaRow(session, id, expectedStatus = '') {
  const params = new URLSearchParams({ id: `eq.${id}`, owner_id: `eq.${session.user.id}`, post_id: 'is.null', select: 'id' });
  if (expectedStatus) params.set('upload_status', `eq.${expectedStatus}`);
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
    select: 'id,owner_id,object_key,media_kind',
    limit: '12',
  });
  const response = await fetch(`${SUPABASE_URL}/rest/v1/social_post_media?${params}`, {
    headers: supabaseHeaders(session.auth),
  });
  if (!response.ok) return;

  const rows = await response.json().catch(() => []);
  if (!Array.isArray(rows) || !rows.length) return;

  await Promise.all(rows.map(async (row) => {
    if (!row?.id) return;
    const deleteParams = new URLSearchParams({
      id: `eq.${row.id}`,
      owner_id: `eq.${session.user.id}`,
      post_id: 'is.null',
      select: 'id',
    });
    const removal = await fetch(`${SUPABASE_URL}/rest/v1/social_post_media?${deleteParams}`, {
      method: 'DELETE',
      headers: { ...supabaseHeaders(session.auth), Prefer: 'return=representation' },
    }).catch(() => null);
    const deleted = removal?.ok ? await removal.json().catch(() => []) : [];
    // Pending Room holds reject DB deletion. Never delete bytes first: another
    // transaction can claim an upload after the expired-upload SELECT.
    if (Array.isArray(deleted) && deleted.some((item) => item.id === row.id)) {
      await cleanupMediaChunks(env.SAUTI_MEDIA, row).catch(() => {});
      await Promise.all(sautiMediaObjectKeys(row).map((key) => env.SAUTI_MEDIA.delete(key).catch(() => {})));
    }
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
    return apiError(413, 'FILE_TOO_LARGE', type.kind === 'video' ? 'Videos must be 250 MiB or smaller.' : 'Images must be 5 MiB or smaller.');
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
      ...(type.kind === 'video' && sizeBytes > POST_UPLOAD_PART_BYTES
        ? { chunk_upload: mediaChunkContract({ id, owner_id: session.user.id, object_key: objectKey, media_kind: type.kind, content_type: contentType, size_bytes: sizeBytes }) } : {}),
    },
  });
}

async function completePostMediaChunks(env, row, session) {
  return assembleMediaChunks(env.SAUTI_MEDIA, row, inspectMp4Bytes, async (inspected) => {
    const patched = await patchMedia(session, row.id, { width: inspected.width, height: inspected.height,
      duration_ms: inspected.durationMs, upload_status: 'uploaded' }).catch(() => null);
    if (patched) return true;
    // A response can disappear after ACK. Confirm the committed state before
    // considering removal of the just-assembled canonical file.
    const current = await selectMedia(row.id, session.auth);
    return current?.owner_id === session.user.id && ['uploaded','ready','attached'].includes(current.upload_status)
      && current.object_key === row.object_key && Number(current.size_bytes) === Number(row.size_bytes)
      && Number(current.duration_ms) === inspected.durationMs && Number(current.width) === inspected.width
      && Number(current.height) === inspected.height;
  });
}

async function uploadMedia(request, env, id) {
  if (!env.SAUTI_MEDIA) return apiError(503, 'MEDIA_NOT_READY', 'Post media is not enabled yet.');
  const session = await authenticate(request);
  if (!session) return apiError(401, 'AUTH_REQUIRED', 'Sign in before uploading media.');

  const row = await selectMedia(id, session.auth);
  const url = new URL(request.url);
  const isCompletion = url.searchParams.get('complete') === '1';
  if ([...url.searchParams.keys()].some((key) => !['part','complete'].includes(key))
    || url.searchParams.getAll('part').length > 1 || url.searchParams.getAll('complete').length > 1
    || (url.searchParams.has('complete') && (!isCompletion || url.searchParams.has('part')))) {
    return apiError(400, 'INVALID_UPLOAD_REQUEST', 'Choose one upload part or completion.');
  }
  // A completion response may have been lost after the database acknowledged it.
  if (isCompletion && row?.owner_id === session.user.id && !row.post_id
    && ['uploaded', 'ready'].includes(row.upload_status) && mediaChunkContract(row)) {
    const object = await env.SAUTI_MEDIA.head(row.object_key);
    if (object?.size === Number(row.size_bytes) && object.customMetadata?.validated === 'true'
      && object.customMetadata?.ownerId === session.user.id && object.customMetadata?.mediaId === id) {
      return json(200, { ok: true, data: { id, width: row.width, height: row.height, duration_ms: row.duration_ms } });
    }
  }
  if (!row || row.owner_id !== session.user.id || row.post_id || row.upload_status !== 'pending') {
    return apiError(404, 'UPLOAD_NOT_FOUND', 'This upload is unavailable.');
  }
  if (!Number.isFinite(Date.parse(row.expires_at)) || Date.parse(row.expires_at) <= Date.now()) return apiError(410, 'UPLOAD_EXPIRED', 'This upload expired. Add the file again.');

  const declared = TYPES[row.content_type];
  if (isCompletion || url.searchParams.has('part')) {
    try {
      if (!declared || !mediaChunkContract(row) || (isCompletion && url.searchParams.has('part'))) {
        return apiError(400, 'INVALID_CHUNK_UPLOAD', 'This upload does not support parts.');
      }
      if (isCompletion) {
        if (Number(request.headers.get('Content-Length') || 0) > 0) return apiError(400, 'INVALID_COMPLETION', 'Completion must have an empty body.');
        if (request.body) await boundedMediaUploadBody(request, 0);
        return json(200, { ok: true, data: await completePostMediaChunks(env, row, session) });
      }
      if (String(request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase() !== row.content_type) {
        return apiError(415, 'CONTENT_TYPE_MISMATCH', 'The uploaded file type changed.');
      }
      const part = Number(url.searchParams.get('part'));
      return json(200, { ok: true, data: await putMediaChunk(request, env.SAUTI_MEDIA, row, part) });
    } catch (error) {
      return error instanceof MediaChunkError ? apiError(error.status, error.code, error.message)
        : apiError(502, 'R2_UPLOAD_FAILED', 'The video upload could not be completed. Try again.');
    }
  }
  const contentType = String(request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (!declared || contentType !== row.content_type) return apiError(415, 'CONTENT_TYPE_MISMATCH', 'The uploaded file type changed.');

  const contentLength = Number(request.headers.get('Content-Length') || 0);
  if (contentLength && contentLength !== Number(row.size_bytes)) return apiError(400, 'SIZE_MISMATCH', 'The uploaded file size changed.');
  if (Number(row.size_bytes) > POST_UPLOAD_PART_BYTES) {
    try {
      await stageLegacyMediaBody(request, env.SAUTI_MEDIA, row);
      return json(200, { ok: true, data: await completePostMediaChunks(env, row, session) });
    } catch (error) {
      return error instanceof MediaChunkError ? apiError(error.status, error.code, error.message)
        : apiError(502, 'R2_UPLOAD_FAILED', 'The video upload could not be completed. Try again.');
    }
  }

  let bytes;
  try { bytes = await boundedMediaUploadBody(request, Number(row.size_bytes)); }
  catch (error) {
    return error instanceof MediaChunkError ? apiError(error.status, error.code, error.message)
      : apiError(400, 'UPLOAD_INTERRUPTED', 'The media upload was interrupted. Try again.');
  }
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
    if (!inspected) {
      await deleteMediaRow(session, id, 'pending').catch(() => false);
      return apiError(415, 'INVALID_VIDEO', 'Use a valid MP4 video no longer than 3 minutes.');
    }
  }

  try {
    const stored = await env.SAUTI_MEDIA.put(row.object_key, bytes, {
      onlyIf: { etagDoesNotMatch: '*' },
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
    if (!stored) return apiError(409, 'UPLOAD_ALREADY_STORED', 'This media was already stored. Refresh its status or add the file again.');
  } catch {
    return apiError(502, 'R2_UPLOAD_FAILED', 'The media could not be stored. Try again.');
  }

  const patched = await patchMedia(session, id, {
    width: inspected.width,
    height: inspected.height,
    duration_ms: inspected.durationMs,
    upload_status: 'uploaded',
  }).catch(() => null);
  if (!patched) {
    const removed = await deleteMediaRow(session, id, 'pending').catch(() => false);
    if (removed) {
      if (row.media_kind === 'video') await cleanupMediaChunks(env.SAUTI_MEDIA, row).catch(() => {});
      await Promise.all(sautiMediaObjectKeys(row).map((key) => env.SAUTI_MEDIA.delete(key).catch(() => {})));
    }
    return apiError(409, 'UPLOAD_METADATA_FAILED', 'The upload could not be recorded.');
  }

  return json(200, { ok: true, data: { id, width: inspected.width, height: inspected.height, duration_ms: inspected.durationMs } });
}

async function createSautiVideoVariant(env, row, id, quality) {
  // This binding buffers its output. Large uploads use Stream adaptive playback
  // or streamed original bytes rather than creating an unbounded Worker buffer.
  if (Number(row?.size_bytes) > 32 * 1024 * 1024) return '';
  const dimensions = videoVariantDimensions(row, quality);
  const objectKey = sautiVideoVariantObjectKey(row?.object_key, quality);
  if (!dimensions || !objectKey || !env?.MEDIA || !env?.SAUTI_MEDIA) {
    return '';
  }

  const existing = await env.SAUTI_MEDIA.head(objectKey).catch(() => null);
  if (existing) return objectKey;

  const jobKey = `${id}:${quality}`;
  if (videoVariantJobs.has(jobKey)) return videoVariantJobs.get(jobKey);

  const job = (async () => {
    const original = await env.SAUTI_MEDIA.get(row.object_key);
    if (!original?.body) return '';

    const result = env.MEDIA
      .input(original.body)
      .transform({ ...dimensions, fit: 'scale-down' })
      .output({ mode: 'video', audio: true });
    // R2 requires a known length for Worker-created streams. Media
    // Transformations currently returns an unbounded ReadableStream.
    const body = await new Response(await result.media()).arrayBuffer();
    await env.SAUTI_MEDIA.put(objectKey, body, {
      httpMetadata: { contentType: 'video/mp4' },
      customMetadata: {
        ownerId: String(row.owner_id || ''),
        mediaId: id,
        mediaKind: 'video',
        quality: String(quality),
        variantVersion: VIDEO_VARIANT_VERSION,
        sourceEtag: String(original.etag || ''),
      },
    });
    return objectKey;
  })().catch((error) => {
    console.warn('Sauti video rendition failed', {
      quality,
      code: String(error?.code || ''),
      message: String(error?.message || 'Unknown media transform error').slice(0, 160),
    });
    return '';
  }).finally(() => videoVariantJobs.delete(jobKey));

  videoVariantJobs.set(jobKey, job);
  return job;
}

async function createSautiVideoPoster(env, row, id) {
  if (row?.media_kind !== 'video' || !env?.MEDIA || !env?.SAUTI_MEDIA) return '';
  const objectKey = sautiVideoPosterObjectKey(row.object_key);
  if (await env.SAUTI_MEDIA.head(objectKey).catch(() => null)) return objectKey;
  if (videoPosterJobs.has(id)) return videoPosterJobs.get(id);

  const job = (async () => {
    const original = await env.SAUTI_MEDIA.get(row.object_key);
    if (!original?.body) return '';
    const time = Number(row.duration_ms) >= 1500 ? '1s' : '0s';
    const result = env.MEDIA.input(original.body)
      .transform({ width: 640, fit: 'scale-down' })
      .output({ mode: 'frame', time, format: 'jpg' });
    const body = await new Response(await result.media()).arrayBuffer();
    if (!body.byteLength) return '';
    await env.SAUTI_MEDIA.put(objectKey, body, {
      httpMetadata: { contentType: 'image/jpeg' },
      customMetadata: {
        ownerId: String(row.owner_id || ''),
        mediaId: id,
        mediaKind: 'video-poster',
        variantVersion: VIDEO_POSTER_VERSION,
        sourceEtag: String(original.etag || ''),
      },
    });
    return objectKey;
  })().catch((error) => {
    console.warn('Sauti video poster failed', {
      code: String(error?.code || ''),
      message: String(error?.message || 'Unknown media transform error').slice(0, 160),
    });
    return '';
  }).finally(() => videoPosterJobs.delete(id));
  videoPosterJobs.set(id, job);
  return job;
}

function prewarmSautiVideoVariants(env, row, id, ctx) {
  if (row?.media_kind !== 'video' || !ctx?.waitUntil || !env?.MEDIA) return;
  ctx.waitUntil(Promise.allSettled(
    [createSautiVideoPoster(env, row, id),
      ...availableVideoQualities(row).map((quality) => createSautiVideoVariant(env, row, id, quality))],
  ));
}

async function finalizeUpload(request, env, id, ctx = null) {
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

  prewarmSautiVideoVariants(env, row, id, ctx);

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
  await deleteSautiStreamVideo(env, row);
  await cleanupMediaChunks(env.SAUTI_MEDIA, row).catch(() => {});
  await Promise.all(sautiMediaObjectKeys(row).map((key) => env.SAUTI_MEDIA.delete(key).catch(() => {})));
  return json(200, { ok: true, data: { id, removed: true } });
}

async function serveOriginalMedia(request, env, row, id) {
  const etag = mediaVariantEtag(id);
  const headers = mediaResponseHeaders(row.content_type, etag);
  const video = row.media_kind === 'video';
  const rangeHeader = video ? String(request.headers.get('Range') || '') : '';
  if (video) headers.set('Accept-Ranges', 'bytes');
  if (!rangeHeader && requestHasEtag(request, etag)) return new Response(null, { status: 304, headers });

  if (request.method === 'HEAD') {
    const object = await mediaDeliveryPhase('ORIGINAL_R2_HEAD', () => env.SAUTI_MEDIA.head(row.object_key));
    if (!object) return apiError(404, 'MEDIA_NOT_FOUND', 'This media is unavailable.');
    object.writeHttpMetadata(headers);
    headers.set('Cache-Control', video ? 'private, max-age=300, must-revalidate' : 'private, no-store, max-age=0');
    headers.set('Content-Length', String(object.size));
    if (video) headers.set('Accept-Ranges', 'bytes');
    headers.set('ETag', etag);
    return new Response(null, { status: 200, headers });
  }

  const object = await mediaDeliveryPhase('ORIGINAL_R2_GET', () => env.SAUTI_MEDIA.get(
    row.object_key,
    rangeHeader ? { range: boundedSautiVideoRange(rangeHeader, row.size_bytes) || request.headers } : undefined,
  ));
  if (!object) return apiError(404, 'MEDIA_NOT_FOUND', 'This media is unavailable.');
  object.writeHttpMetadata(headers);
  headers.set('Cache-Control', video ? 'private, max-age=300, must-revalidate' : 'private, no-store, max-age=0');
  headers.set('Content-Security-Policy', "default-src 'none'");
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Content-Disposition', 'inline');
  headers.set('ETag', etag);
  headers.set('X-Sauti-Media-Variant', 'original');
  if (video) headers.set('Accept-Ranges', 'bytes');

  if (video && object.range) {
    const length = Number(object.range.length || object.range.suffix || 0);
    const offset = Number.isFinite(object.range.offset)
      ? Number(object.range.offset)
      : Math.max(0, Number(object.size || 0) - length);
    if (length > 0) {
      headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${object.size}`);
      headers.set('Content-Length', String(length));
      return new Response(object.body, { status: 206, headers });
    }
  }

  headers.set('Content-Length', String(object.size));
  return new Response(object.body, { status: 200, headers });
}

async function serveVideoVariant(request, env, row, id, quality, ctx = null) {
  const objectKey = sautiVideoVariantObjectKey(row.object_key, quality);
  if (!objectKey || row.media_kind !== 'video') return serveOriginalMedia(request, env, row, id);
  // Media Transformations currently caps output at one minute. A longer
  // variant would silently end before the source video does.
  if (!videoVariantDimensions(row, quality)) {
    return serveOriginalMedia(request, env, row, id);
  }

  let available = await env.SAUTI_MEDIA.head(objectKey).catch(() => null);
  if (!available && request.method !== 'HEAD') {
    const generation = createSautiVideoVariant(env, row, id, quality);
    if (ctx?.waitUntil) {
      // Keep playback responsive while the first request warms this rendition.
      ctx.waitUntil(generation);
    } else {
      const generatedKey = await generation;
      if (generatedKey) available = await env.SAUTI_MEDIA.head(generatedKey).catch(() => null);
    }
  }
  if (!available) return serveOriginalMedia(request, env, row, id);

  const etag = videoVariantEtag(id, quality);
  const headers = mediaResponseHeaders('video/mp4', etag);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', 'private, max-age=300, must-revalidate');
  headers.set('X-Sauti-Media-Variant', `video-${VIDEO_VARIANT_VERSION};q=${quality}`);
  headers.set('X-Sauti-Video-Quality', `${quality}p`);
  const rangeHeader = String(request.headers.get('Range') || '');
  if (!rangeHeader && requestHasEtag(request, etag)) return new Response(null, { status: 304, headers });

  if (request.method === 'HEAD') {
    available.writeHttpMetadata(headers);
    headers.set('Content-Length', String(available.size));
    return new Response(null, { status: 200, headers });
  }

  const object = await mediaDeliveryPhase('VARIANT_R2_GET', () => env.SAUTI_MEDIA.get(
    objectKey,
    rangeHeader ? { range: boundedSautiVideoRange(rangeHeader, available.size) || request.headers } : undefined,
  ));
  if (!object) return serveOriginalMedia(request, env, row, id);
  object.writeHttpMetadata(headers);
  headers.set('Content-Security-Policy', "default-src 'none'");
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Content-Disposition', 'inline');

  if (object.range) {
    const length = Number(object.range.length || object.range.suffix || 0);
    const offset = Number.isFinite(object.range.offset)
      ? Number(object.range.offset)
      : Math.max(0, Number(object.size || 0) - length);
    if (length > 0) {
      headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${object.size}`);
      headers.set('Content-Length', String(length));
      return new Response(object.body, { status: 206, headers });
    }
  }

  headers.set('Content-Length', String(object.size));
  return new Response(object.body, { status: 200, headers });
}

async function serveVideoPoster(request, env, row, id) {
  if (row.media_kind !== 'video') return apiError(404, 'MEDIA_NOT_FOUND', 'This media is unavailable.');
  const unavailable = () => apiError(404, 'POSTER_UNAVAILABLE', 'This video has no preview image yet.');
  if (request.signal.aborted) return unavailable();
  const objectKey = sautiVideoPosterObjectKey(row.object_key);
  let available = await env.SAUTI_MEDIA.head(objectKey).catch(() => null);
  if (request.signal.aborted) return unavailable();
  if (!available) {
    // The caller has already read this row through the normal media ACL. A
    // ready private Stream asset can supply its encoded JPEG without reading
    // and transforming the original MP4 again. Strict mapping/source identity
    // checks also keep synthetic public-index rows on their existing path.
    const asset = await readySautiPostStreamAsset(env, row).catch(() => null);
    if (request.signal.aborted) return unavailable();
    if (asset) {
      const thumbnail = await serveSautiStreamThumbnail(request, env, asset);
      if (request.signal.aborted) { await thumbnail.body?.cancel().catch(() => {}); return unavailable(); }
      if (thumbnail.ok) {
        const headers = new Headers(thumbnail.headers);
        headers.set('Cache-Control', 'private, no-store, max-age=0');
        headers.set('Content-Security-Policy', "default-src 'none'");
        headers.set('Content-Disposition', 'inline');
        headers.set('X-Sauti-Media-Variant', 'poster-stream');
        return new Response(thumbnail.body, { status: thumbnail.status, headers });
      }
      await thumbnail.body?.cancel().catch(() => {});
    }
  }
  // A disconnected thumbnail must not become a full-source legacy transform.
  if (request.signal.aborted) return unavailable();
  if (!available && request.method === 'GET') {
    const generated = await createSautiVideoPoster(env, row, id);
    if (generated) available = await env.SAUTI_MEDIA.head(generated).catch(() => null);
  }
  if (!available) return apiError(404, 'POSTER_UNAVAILABLE', 'This video has no preview image yet.');

  const etag = `W/"sauti-${id}-poster-${VIDEO_POSTER_VERSION}"`;
  const headers = mediaResponseHeaders('image/jpeg', etag);
  headers.set('Cache-Control', 'private, max-age=300, must-revalidate');
  headers.set('X-Sauti-Media-Variant', `poster-${VIDEO_POSTER_VERSION}`);
  if (requestHasEtag(request, etag)) return new Response(null, { status: 304, headers });
  if (request.method === 'HEAD') {
    headers.set('Content-Length', String(available.size));
    return new Response(null, { status: 200, headers });
  }
  const object = await env.SAUTI_MEDIA.get(objectKey);
  if (!object) return apiError(404, 'POSTER_UNAVAILABLE', 'This video has no preview image yet.');
  headers.set('Content-Length', String(object.size));
  return new Response(object.body, { status: 200, headers });
}

async function serveImageVariant(request, env, row, id, width) {
  if (!responsiveImagesEnabled(env) || row.media_kind !== 'image') {
    return serveOriginalMedia(request, env, row, id);
  }

  const etag = mediaVariantEtag(id, width);
  const clientHeaders = mediaResponseHeaders('image/webp', etag, width);
  if (requestHasEtag(request, etag)) return new Response(null, { status: 304, headers: clientHeaders });
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers: clientHeaders });

  const cache = globalThis.caches?.default;
  const cacheKey = mediaVariantCacheKey(request, id, width);
  if (cache) {
    const cached = await cache.match(cacheKey).catch(() => null);
    if (cached) {
      const headers = mediaResponseHeaders(cached.headers.get('Content-Type') || 'image/webp', etag, width);
      headers.set('X-Sauti-Media-Cache', 'HIT');
      return new Response(cached.body, { status: 200, headers });
    }
  }

  const original = await env.SAUTI_MEDIA.get(row.object_key);
  if (!original) return apiError(404, 'MEDIA_NOT_FOUND', 'This media is unavailable.');

  const sourceWidth = Math.max(1, Number(row.width || width));
  const targetWidth = Math.max(1, Math.min(width, sourceWidth));

  try {
    const output = await env.IMAGES
      .input(original.body)
      .transform({ width: targetWidth, fit: 'scale-down' })
      .output({ format: 'image/webp', quality: 85, anim: true });
    const transformed = output.response();
    if (!transformed.ok) return serveOriginalMedia(request, env, row, id);

    const edgeHeaders = new Headers();
    edgeHeaders.set('Content-Type', transformed.headers.get('Content-Type') || 'image/webp');
    edgeHeaders.set('Cache-Control', `public, max-age=${IMAGE_VARIANT_EDGE_TTL_SECONDS}, immutable`);
    edgeHeaders.set('ETag', etag);
    edgeHeaders.set('X-Sauti-Media-Variant', `${IMAGE_VARIANT_VERSION};w=${width}`);
    const edgeResponse = new Response(transformed.body, { status: 200, headers: edgeHeaders });

    if (cache) await cache.put(cacheKey, edgeResponse.clone()).catch(() => {});

    const headers = mediaResponseHeaders(edgeHeaders.get('Content-Type'), etag, width);
    headers.set('X-Sauti-Media-Cache', 'MISS');
    return new Response(edgeResponse.body, { status: 200, headers });
  } catch {
    return serveOriginalMedia(request, env, row, id);
  }
}

export async function servePublicSautiMediaPreview(request, env, media) {
  if (!env.SAUTI_MEDIA) return apiError(503, 'MEDIA_NOT_READY', 'Post media is not enabled yet.');

  const id = uuid(media?.id);
  const ownerId = uuid(media?.owner_id);
  const contentType = String(media?.content_type || '').toLowerCase();
  const declared = TYPES[contentType];
  const kind = media?.media_kind === 'video' ? 'video' : media?.media_kind === 'image' ? 'image' : '';
  if (!id || !ownerId || !declared || declared.kind !== kind) {
    return apiError(404, 'MEDIA_NOT_FOUND', 'This media is unavailable.');
  }

  const row = {
    id,
    owner_id: ownerId,
    object_key: `sauti/${ownerId}/${id}.${declared.extension}`,
    media_kind: kind,
    content_type: contentType,
    width: Math.max(0, Number(media?.width || 0)) || null,
    height: Math.max(0, Number(media?.height || 0)) || null,
    duration_ms: Math.max(0, Number(media?.duration_ms || 0)) || null,
    upload_status: 'attached',
  };

  const url = new URL(request.url);
  if (kind === 'video') {
    if (url.searchParams.get('poster') !== '1') {
      return apiError(401, 'AUTH_REQUIRED', 'Join or sign in to watch this video.');
    }
    return serveVideoPoster(request, env, row, id);
  }

  const width = normalizeSautiMediaVariantWidth(url.searchParams.get('w'));
  if (width) return serveImageVariant(request, env, row, id, width);
  return serveOriginalMedia(request, env, row, id);
}

async function serveMedia(request, env, id, ctx = null) {
  if (!env.SAUTI_MEDIA) return apiError(503, 'MEDIA_NOT_READY', 'Post media is not enabled yet.');
  const deliveryAuth = mediaDeliveryAuthorization(request);
  const row = await mediaDeliveryPhase('METADATA_LOOKUP', () => selectVideoMediaForDelivery(request, id, deliveryAuth));
  if (!row || !['ready', 'attached'].includes(row.upload_status)) return apiError(404, 'MEDIA_NOT_FOUND', 'This media is unavailable.');

  const url = new URL(request.url);
  const posterOnly = url.searchParams.get('poster') === '1';
  if (row.media_kind === 'video' && !deliveryAuth && !posterOnly) {
    return apiError(401, 'AUTH_REQUIRED', 'Join or sign in to watch this video.');
  }

  const width = normalizeSautiMediaVariantWidth(url.searchParams.get('w'));
  const quality = normalizeSautiVideoQuality(url.searchParams.get('quality'));
  const indexed = !posterOnly && row.media_kind === 'video'
    ? await servePrecomputedOriginalIndex(request, env, row, mediaDeliveryPhase) : null;
  if (indexed) return indexed;
  if (posterOnly) return serveVideoPoster(request, env, row, id);
  if (width && row.media_kind === 'image') return serveImageVariant(request, env, row, id, width);
  if (quality && row.media_kind === 'video') return serveVideoVariant(request, env, row, id, quality, ctx);
  return serveOriginalMedia(request, env, row, id);
}

async function servePlaybackDescriptor(request, env, id, ctx) {
  const timing = createMediaServerTiming();
  if (!env.SAUTI_MEDIA) return apiError(503, 'MEDIA_NOT_READY', 'Post media is unavailable.');
  const auth = mediaDeliveryAuthorization(request);
  if (!auth) return apiError(401, 'AUTH_REQUIRED', 'Sign in to watch this video.');
  const row = await timing.rls(() => selectMedia(id, auth));
  if (!row || row.media_kind !== 'video' || !['ready', 'attached'].includes(row.upload_status)) return apiError(404, 'MEDIA_NOT_FOUND', 'This media is unavailable.');
  const asset = await timing.ready(() => readySautiPostStreamAsset(env, row));
  const options = {
    basePath: `/api/sauti-media/${id}/hls/`, accessScope: auth,
  };
  const playback = asset && await timing.hls(() => sautiStreamPlaybackDescriptor(request, env, asset, options));
  if (playback) {
    const bootstrap = await timing.hls(() => sautiStreamBootstrap(request, env, asset, playback, options));
    return timing.response(json(200, { ok: true, data: { ...playback, ...(bootstrap ? { bootstrap } : {}) } }));
  }
  if (streamEnabled(env) && row.upload_status === 'attached') {
    const preparation = prepareSautiStreamVideo(env, row).catch(() => {});
    if (ctx?.waitUntil) ctx.waitUntil(preparation);
    else await preparation;
  }
  return timing.response(json(200, { ok: true, data: { type: 'mp4', url: new URL(`/api/sauti-media/${id}`, request.url).href,
    qualities: availableVideoQualities(row), expires_in: 300, expires_at: new Date(Date.now() + 300000).toISOString() } }));
}

async function serveStreamHls(request, env, id) {
  const timing = createMediaServerTiming();
  const auth = mediaDeliveryAuthorization(request);
  if (!auth) return apiError(401, 'AUTH_REQUIRED', 'Sign in to watch this video.');
  const row = await timing.rls(() => selectMedia(id, auth));
  const asset = row && await timing.ready(() => readySautiPostStreamAsset(env, row));
  if (!asset) return apiError(404, 'MEDIA_NOT_FOUND', 'This media is unavailable.');
  return timing.response(await timing.hls(() => serveSautiStreamHls(request, env, asset, { basePath: `/api/sauti-media/${id}/hls/`, accessScope: auth })));
}

async function downloadShortVideo(request, env, id) {
  if (!env.SAUTI_MEDIA) return apiError(503, 'MEDIA_NOT_READY', 'Video downloads are unavailable.');
  const session = await authenticate(request);
  if (!session) return apiError(401, 'AUTH_REQUIRED', 'Sign in to download a video.');
  // These reads intentionally bypass the burst playback cache. Public visibility
  // does not bypass RLS for blocked, removed or otherwise unavailable posts.
  const row = await selectMedia(id, session.auth);
  if (!row || row.upload_status !== 'attached' || row.media_kind !== 'video' || row.content_type !== 'video/mp4'
    || !row.post_id || row.object_key !== `sauti/${row.owner_id}/${id}.mp4`) {
    return apiError(404, 'VIDEO_UNAVAILABLE', 'This video is unavailable for download.');
  }
  const params = new URLSearchParams({ id: `eq.${row.post_id}`, circle_id: 'is.null', parent_post_id: 'is.null',
    visibility: 'eq.public', post_status: 'eq.published', deleted_at: 'is.null', moderation_state: 'eq.visible',
    select: 'id,author_id', limit: '1' });
  const response = await fetch(`${SUPABASE_URL}/rest/v1/social_posts?${params}`, { headers: supabaseHeaders(session.auth) });
  const posts = response.ok ? await response.json().catch(() => []) : [];
  if (!Array.isArray(posts) || posts[0]?.id !== row.post_id || posts[0]?.author_id !== row.owner_id) {
    return apiError(404, 'VIDEO_UNAVAILABLE', 'This video is unavailable for download.');
  }
  const source = await env.SAUTI_MEDIA.head(row.object_key);
  if (!source?.etag || source.size !== Number(row.size_bytes) || source.size < 1 || source.size > POST_VIDEO_LIMIT
    || source.customMetadata?.ownerId !== row.owner_id || source.customMetadata?.mediaId !== id
    || source.customMetadata?.validated !== 'true') return apiError(404, 'VIDEO_UNAVAILABLE', 'This video is unavailable for download.');
  const etag = source.httpEtag || `"${source.etag}"`;
  let range;
  const requestedRange = request.headers.get('Range');
  if (requestedRange && (!request.headers.has('If-Range') || request.headers.get('If-Range') === etag)) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(requestedRange);
    const offset = Number(match?.[1]);
    const end = match?.[2] ? Number(match[2]) : source.size - 1;
    if (!match || !Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || end < offset || end >= source.size) {
      return new Response(null, { status: 416, headers: { 'Cache-Control': 'no-store', 'Content-Range': `bytes */${source.size}` } });
    }
    range = { offset, length: end - offset + 1 };
  }
  const headers = new Headers({ 'Content-Type': 'video/mp4', 'Content-Disposition': `attachment; filename="SautiLink-${id}.mp4"`,
    'Content-Length': String(range?.length || source.size), 'Cache-Control': 'private, no-store', 'ETag': etag,
    'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'" });
  if (range) headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${source.size}`);
  if (request.method === 'HEAD') return new Response(null, { status: range ? 206 : 200, headers });
  // R2's existing canonical MP4 is streamed, never buffered, transcoded again or
  // exposed as a public/provider URL. The ETag binds the HEAD to the body read.
  const object = await env.SAUTI_MEDIA.get(row.object_key, { onlyIf: { etagMatches: source.etag }, ...(range ? { range } : {}) });
  if (!object?.body || object.etag !== source.etag) return apiError(404, 'VIDEO_UNAVAILABLE', 'This video is unavailable for download.');
  return new Response(object.body, { status: range ? 206 : 200, headers });
}

export async function handleSautiMediaRequest(request, env, ctx = null) {
  const url = new URL(request.url);

  const downloadMatch = url.pathname.match(/^\/api\/sauti-media\/([0-9a-f-]{36})\/download$/i);
  if (downloadMatch && ['GET', 'HEAD'].includes(request.method)) return downloadShortVideo(request, env, uuid(downloadMatch[1]));

  let streamMatch = url.pathname.match(/^\/api\/sauti-media\/([0-9a-f-]{36})\/stream-source$/i);
  if (streamMatch && ['GET', 'HEAD'].includes(request.method)) return serveSautiStreamSource(request, env, uuid(streamMatch[1]));
  streamMatch = url.pathname.match(/^\/api\/sauti-media\/([0-9a-f-]{36})\/playback$/i);
  if (streamMatch && request.method === 'GET') return servePlaybackDescriptor(request, env, uuid(streamMatch[1]), ctx);
  streamMatch = url.pathname.match(/^\/api\/sauti-media\/([0-9a-f-]{36})\/hls\/[A-Za-z0-9_-]+$/i);
  if (streamMatch && ['GET', 'HEAD'].includes(request.method)) return serveStreamHls(request, env, uuid(streamMatch[1]));

  if (url.pathname === '/api/sauti-media/status' && request.method === 'GET') {
    return json(200, {
      ok: true,
      data: {
        ready: Boolean(env.SAUTI_MEDIA),
        responsive_images: responsiveImagesEnabled(env),
        image_variant_widths: IMAGE_VARIANT_WIDTHS,
        adaptive_video: Boolean(env.SAUTI_MEDIA && env.MEDIA),
        adaptive_stream: streamEnabled(env),
        video_variant_qualities: VIDEO_VARIANT_QUALITIES,
      },
    });
  }
  if (url.pathname === '/api/sauti-media/session' && request.method === 'POST') {
    return createVideoMediaSession(request);
  }
  if (url.pathname === '/api/sauti-media/session' && request.method === 'DELETE') {
    return clearVideoMediaSession();
  }
  if (url.pathname === '/api/sauti-media/begin' && request.method === 'POST') return beginUpload(request, env);

  let match = url.pathname.match(/^\/api\/sauti-media\/upload\/([0-9a-f-]{36})$/i);
  if (match && request.method === 'PUT') return uploadMedia(request, env, uuid(match[1]));

  match = url.pathname.match(/^\/api\/sauti-media\/finalize\/([0-9a-f-]{36})$/i);
  if (match && request.method === 'POST') return finalizeUpload(request, env, uuid(match[1]), ctx);

  match = url.pathname.match(/^\/api\/sauti-media\/([0-9a-f-]{36})$/i);
  if (match && (request.method === 'GET' || request.method === 'HEAD')) return serveMedia(request, env, uuid(match[1]), ctx);
  if (match && request.method === 'DELETE') return removeUpload(request, env, uuid(match[1]));

  return null;
}
