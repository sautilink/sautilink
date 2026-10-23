// Read an operator-verified derivative only. Never modify an original or generate
// an index during playback. Call only AFTER the normal caller/RLS authorization.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_SOURCE_BYTES = 100_000_000;
const MAX_APPEND_BYTES = 4 * 1024 * 1024;
const RANGE_BYTES = 1024 * 1024;

export function originalVideoIndexObjectKey(key) {
  return key ? `${key}.original-index-v1.mp4` : '';
}

export function originalVideoIndexReceiptObjectKey(key) {
  return key ? `${originalVideoIndexObjectKey(key)}.receipt.json` : '';
}

function decimal(value, maximum) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,11}$/.test(value)) return 0;
  const number = Number(value);
  return Number.isSafeInteger(number) && number <= maximum ? number : 0;
}

export function originalIndexReceipt(meta, object, row) {
  if (!meta || meta.originalIndexVersion !== '1' || meta.timelineComplete !== 'true'
    || meta.mdatPreserved !== 'true' || meta.durationHeadersRepaired !== 'true'
    || meta.ownerId !== row.owner_id || meta.mediaId !== row.id
    || !SHA256.test(meta.sourceSha256 || '') || !SHA256.test(meta.derivedSha256 || '')
    || typeof meta.sourceEtag !== 'string' || !/^[\x21-\x7e]{1,128}$/.test(meta.sourceEtag)
    || !/^[\x21-\x7e]{1,128}$/.test(object.etag || '')
    || meta.derivedEtag !== object.etag
    || object.httpMetadata?.contentType !== 'video/mp4') return null;
  const sourceSize = decimal(meta.sourceSize, MAX_SOURCE_BYTES);
  const derivedSize = decimal(meta.derivedSize, MAX_SOURCE_BYTES + MAX_APPEND_BYTES);
  const completeDurationMs = decimal(meta.completeDurationMs, 120_000);
  if (!sourceSize || !derivedSize || !completeDurationMs || derivedSize <= sourceSize
    || derivedSize - sourceSize > MAX_APPEND_BYTES || object.size !== derivedSize) return null;
  return { sourceEtag: meta.sourceEtag, sourceSize, derivedSize, completeDurationMs,
    derivedSha256: meta.derivedSha256 };
}

async function boundedReceipt(object) {
  const contentType = object?.httpMetadata?.contentType?.split(';')[0].trim();
  if (!object?.body || !Number.isSafeInteger(object.size) || object.size <= 0
    || object.size > 4096 || object.range || contentType !== 'application/json') {
    try { await object?.body?.cancel?.(); } catch { /* Optional cache only. */ }
    return null;
  }
  const reader = new Response(object.body).body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096 || size > object.size) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    if (size !== object.size) return null;
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    try { await reader.cancel(); } catch { /* Optional cache only. */ }
    return null;
  } finally { reader.releaseLock(); }
}

// A bounded SINGLE range. Invalid/unsatisfiable input is a 416, never an R2 call.
export function indexedVideoRange(value, total) {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(String(value).trim());
  if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(total) || total <= 0) return null;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    const length = Math.min(suffix, total, RANGE_BYTES);
    return { offset: total - length, length };
  }
  const offset = Number(match[1]);
  const end = match[2] ? Number(match[2]) : total - 1;
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end)
    || offset < 0 || offset >= total || end < offset) return null;
  return { offset, length: Math.min(end - offset + 1, total - offset, RANGE_BYTES) };
}

function matchesIfNoneMatch(value, etag) {
  return String(value || '').split(',').some((part) => {
    const candidate = part.trim();
    return candidate === '*' || candidate.replace(/^W\//, '') === etag;
  });
}

function unavailable() {
  return new Response(JSON.stringify({ ok: false, error: {
    code: 'MEDIA_REPRESENTATION_CHANGED', message: 'This video changed. Retry playback.',
  } }), { status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

export async function servePrecomputedOriginalIndex(request, env, row, phase) {
  if (!['GET', 'HEAD'].includes(request.method) || row?.media_kind !== 'video'
    || row.upload_status !== 'attached' || !UUID.test(row.id || '') || !UUID.test(row.post_id || '')
    || !UUID.test(row.owner_id || '') || !row.object_key || typeof env?.SAUTI_MEDIA?.head !== 'function') return null;
  const url = new URL(request.url);
  if (url.pathname.toLowerCase() !== `/api/sauti-media/${row.id}`.toLowerCase()
    || url.searchParams.get('poster') === '1') return null;
  const bucket = env.SAUTI_MEDIA;
  const key = originalVideoIndexObjectKey(row.object_key);
  // This cache is optional. Its probe failure must not prevent an unchanged
  // original from playing. Source HEAD and selected-body failures still surface.
  const candidate = await phase('ORIGINAL_INDEX_R2_HEAD', () => bucket.head(key)).catch(() => null);
  if (!candidate || !Number.isSafeInteger(candidate.size) || candidate.size <= 0
    || candidate.size > MAX_SOURCE_BYTES + MAX_APPEND_BYTES) return null;
  // Ordinary pinned CLI uploads cannot set arbitrary R2 customMetadata. A small
  // separately uploaded receipt is the activation record; upload it LAST.
  const receiptObject = await phase('ORIGINAL_INDEX_RECEIPT_R2_GET',
    () => bucket.get(originalVideoIndexReceiptObjectKey(row.object_key))).catch(() => null);
  const receipt = originalIndexReceipt(await boundedReceipt(receiptObject), candidate, row);
  if (!receipt) return null;
  // Never trust DB duration, a guessed MD5/ETag, or an older source's derivative.
  const source = await phase('ORIGINAL_R2_HEAD', () => bucket.head(row.object_key));
  if (!source || source.etag !== receipt.sourceEtag || source.size !== receipt.sourceSize) return null;

  const etag = `"sauti-original-index-v1-${receipt.derivedSha256}"`;
  const headers = new Headers({ 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=300, must-revalidate',
    'Content-Security-Policy': "default-src 'none'", 'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': 'inline', ETag: etag, 'X-Sauti-Media-Variant': 'original-index-v1',
    'X-Sauti-Video-Quality': 'original', 'X-Sauti-Video-Duration-Ms': String(receipt.completeDurationMs) });
  if (matchesIfNoneMatch(request.headers.get('If-None-Match'), etag)) {
    return new Response(null, { status: 304, headers });
  }
  if (request.method === 'HEAD') {
    headers.set('Content-Length', String(receipt.derivedSize));
    return new Response(null, { status: 200, headers });
  }
  const rangeValue = request.headers.get('Range');
  // A weak/date/mismatched validator cannot combine bytes from representations.
  const ifRange = request.headers.get('If-Range');
  const useRange = rangeValue !== null && (ifRange === null || ifRange === etag);
  const range = useRange ? indexedVideoRange(rangeValue, receipt.derivedSize) : null;
  if (useRange && !range) {
    headers.set('Content-Range', `bytes */${receipt.derivedSize}`);
    headers.set('Content-Length', '0');
    return new Response(null, { status: 416, headers });
  }
  const object = await phase('ORIGINAL_INDEX_R2_GET', () => bucket.get(key, {
    onlyIf: { etagMatches: candidate.etag }, ...(range ? { range } : {}),
  }));
  // R2 returns metadata without a body on a failed precondition. Do not fall back
  // after selecting a representation; doing so could splice different byte sets.
  if (!object?.body || object.etag !== candidate.etag || object.size !== receipt.derivedSize
    || (range && (object.range?.offset !== range.offset || object.range?.length !== range.length))
    || (!range && object.range)) {
    try { await object?.body?.cancel?.(); } catch { /* Release only; keep the fixed response. */ }
    return unavailable();
  }
  if (range) {
    headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${receipt.derivedSize}`);
    headers.set('Content-Length', String(range.length));
  } else headers.set('Content-Length', String(receipt.derivedSize));
  return new Response(object.body, { status: range ? 206 : 200, headers });
}
