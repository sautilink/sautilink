import { POST_UPLOAD_PART_BYTES, POST_VIDEO_LIMIT } from './post-media-policy.js';

const MAX_METADATA_BYTES = 8 * 1024 * 1024;
const MAX_TOP_LEVEL_BOXES = 512;
const MAX_PARTS = Math.ceil(POST_VIDEO_LIMIT / POST_UPLOAD_PART_BYTES);

export class MediaChunkError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new MediaChunkError(status, code, message); };
const prefix = (row) => `post-upload-parts/v1/${row.owner_id}/${row.id}/`;
const partKey = (row, part) => `${prefix(row)}${part}`;
const lockKey = (row) => `${prefix(row)}assembly`;
const assembledKey = (row) => `${prefix(row)}assembled.mp4`;
const count = (row) => Math.ceil(Number(row.size_bytes) / POST_UPLOAD_PART_BYTES);
const partSize = (row, part) => Math.min(POST_UPLOAD_PART_BYTES, Number(row.size_bytes) - (part - 1) * POST_UPLOAD_PART_BYTES);
const scoped = (row) => row.media_kind === 'video' && row.content_type === 'video/mp4'
  && /^[0-9a-f-]{36}$/i.test(row.owner_id) && /^[0-9a-f-]{36}$/i.test(row.id)
  && row.object_key === `sauti/${row.owner_id}/${row.id}.mp4`
  && Number.isSafeInteger(Number(row.size_bytes)) && Number(row.size_bytes) > POST_UPLOAD_PART_BYTES
  && Number(row.size_bytes) <= POST_VIDEO_LIMIT;

export function mediaChunkContract(row) {
  if (!scoped(row)) return null;
  return { part_size_bytes: POST_UPLOAD_PART_BYTES, part_count: count(row),
    part_url: `/api/sauti-media/upload/${row.id}?part={part}`,
    complete_url: `/api/sauti-media/upload/${row.id}?complete=1` };
}

export async function cleanupMediaChunks(bucket, row, keepAssembly = false) {
  if (!row?.owner_id || !row?.id) return;
  // A fixed namespace and bound also clean incomplete rows whose size is absent.
  const keys = Array.from({ length: MAX_PARTS }, (_, i) => partKey(row, i + 1));
  keys.push(assembledKey(row));
  if (!keepAssembly) keys.push(lockKey(row));
  await bucket.delete(keys);
}

export async function boundedMediaUploadBody(request, expected) {
  const length = request.headers.get('Content-Length');
  if (length != null && Number(length) !== expected) fail(400, 'SIZE_MISMATCH', 'The uploaded part size changed.');
  if (!request.body) fail(400, 'SIZE_MISMATCH', 'The uploaded part is empty.');
  const reader = request.body.getReader();
  const result = new Uint8Array(expected);
  let offset = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.byteLength > expected) {
        await reader.cancel();
        fail(413, 'PART_TOO_LARGE', 'This upload part is too large.');
      }
      result.set(value, offset); offset += value.byteLength;
    }
  } finally { reader.releaseLock(); }
  if (offset !== expected) fail(400, 'SIZE_MISMATCH', 'The uploaded part size changed.');
  return result;
}

function validPart(object, row, part) {
  return object?.etag && object.size === partSize(row, part)
    && object.customMetadata?.ownerId === row.owner_id && object.customMetadata?.mediaId === row.id
    && object.customMetadata?.part === String(part) && object.customMetadata?.partCount === String(count(row));
}

export async function putMediaChunk(request, bucket, row, part) {
  if (!scoped(row) || !Number.isSafeInteger(part) || part < 1 || part > count(row)) {
    fail(400, 'INVALID_UPLOAD_PART', 'Choose a valid upload part.');
  }
  if (await bucket.head(lockKey(row))) fail(409, 'UPLOAD_ASSEMBLING', 'This video is already being completed.');
  const bytes = await boundedMediaUploadBody(request, partSize(row, part));
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((value) => value.toString(16).padStart(2, '0')).join('');
  if (await bucket.head(lockKey(row))) fail(409, 'UPLOAD_ASSEMBLING', 'This video is already being completed.');
  const stored = await bucket.put(partKey(row, part), bytes, {
    onlyIf: { etagDoesNotMatch: '*' },
    customMetadata: { ownerId: row.owner_id, mediaId: row.id, part: String(part), partCount: String(count(row)), sha256: hash },
    httpMetadata: { contentType: 'application/octet-stream' },
  });
  if (!stored) {
    const prior = await bucket.head(partKey(row, part));
    if (!validPart(prior, row, part) || prior.customMetadata.sha256 !== hash) {
      fail(409, 'UPLOAD_PART_CHANGED', 'This upload part has already been stored with different contents.');
    }
  }
  return { id: row.id, part, part_count: count(row), received_bytes: bytes.byteLength };
}

// Older installed clients send one PUT and ignore begin.chunk_upload. Preserve
// their former 100MB contract without restoring the whole-video heap buffer.
export async function stageLegacyMediaBody(request, bucket, row) {
  if (!scoped(row) || Number(row.size_bytes) > 100_000_000 || !request.body) {
    fail(413, 'CHUNK_UPLOAD_REQUIRED', 'Upload this video in the parts provided when the upload began.');
  }
  const expected = Number(row.size_bytes);
  const reader = request.body.getReader();
  let buffer = new Uint8Array(Math.min(POST_UPLOAD_PART_BYTES, expected));
  let buffered = 0; let received = 0; let part = 1;
  async function flush() {
    await putMediaChunk(new Request('https://sautilink.com/internal/upload-part', { method: 'PUT', body: buffer }), bucket, row, part++);
    buffered = 0;
    buffer = new Uint8Array(Math.min(POST_UPLOAD_PART_BYTES, Math.max(0, expected - received)));
  }
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (received + value.byteLength > expected) {
        await reader.cancel(); fail(400, 'SIZE_MISMATCH', 'The uploaded file size changed.');
      }
      let offset = 0;
      while (offset < value.byteLength) {
        const take = Math.min(buffer.length - buffered, value.byteLength - offset);
        buffer.set(value.subarray(offset, offset + take), buffered);
        buffered += take; received += take; offset += take;
        if (buffered === buffer.length) await flush();
      }
    }
  } finally { reader.releaseLock(); }
  if (received !== expected || buffered) fail(400, 'SIZE_MISMATCH', 'The uploaded file size changed.');
}

// Read only MP4 container metadata, never the mdat video payload. Atom and byte
// budgets reject pathological containers rather than allocating a full video.
export async function inspectChunkedMp4(bucket, row, parts, inspectMp4) {
  const size = Number(row.size_bytes);
  async function read(offset, length) {
    if (!Number.isSafeInteger(length) || length < 1 || length > MAX_METADATA_BYTES || offset + length > size) return null;
    const result = new Uint8Array(length);
    let written = 0;
    while (written < length) {
      const position = offset + written;
      const index = Math.floor(position / POST_UPLOAD_PART_BYTES);
      const local = position % POST_UPLOAD_PART_BYTES;
      const take = Math.min(length - written, parts[index].size - local);
      const object = await bucket.get(partKey(row, index + 1), {
        onlyIf: { etagMatches: parts[index].etag }, range: { offset: local, length: take },
      });
      if (!object?.body) return null;
      const bytes = new Uint8Array(await object.arrayBuffer());
      if (bytes.byteLength !== take) return null;
      result.set(bytes, written); written += take;
    }
    return result;
  }
  let offset = 0; let metadataSize = 0; let atoms = 0;
  const metadata = [];
  while (offset < size && atoms++ < MAX_TOP_LEVEL_BOXES) {
    if (size - offset < 8) return null;
    const header = await read(offset, Math.min(16, size - offset));
    if (!header) return null;
    const view = new DataView(header.buffer);
    let atomSize = view.getUint32(0); let headerSize = 8;
    if (atomSize === 1) {
      if (header.length < 16) return null;
      atomSize = view.getUint32(8) * 4294967296 + view.getUint32(12); headerSize = 16;
    } else if (atomSize === 0) atomSize = size - offset;
    if (!Number.isSafeInteger(atomSize) || atomSize < headerSize || offset + atomSize > size) return null;
    const type = String.fromCharCode(...header.subarray(4, 8));
    if (['ftyp', 'moov', 'moof'].includes(type)) {
      if ((metadataSize += atomSize) > MAX_METADATA_BYTES) return null;
      const bytes = await read(offset, atomSize);
      if (!bytes) return null;
      // A zero-sized selected atom originally ran to EOF; normalize its size
      // because unrelated mdat/free boxes are deliberately excluded below.
      if (view.getUint32(0) === 0) new DataView(bytes.buffer).setUint32(0, atomSize);
      metadata.push(bytes);
    }
    offset += atomSize;
  }
  if (offset !== size) return null;
  const bytes = new Uint8Array(metadataSize);
  let target = 0;
  for (const atom of metadata) { bytes.set(atom, target); target += atom.byteLength; }
  return inspectMp4(bytes);
}

export async function assembleMediaChunks(bucket, row, inspectMp4, commit) {
  if (!scoped(row)) fail(400, 'INVALID_CHUNK_UPLOAD', 'This upload does not support parts.');
  // The lock is never stolen on a timer. A crashed completion requires a new
  // upload, preventing an older Worker from overwriting a later publication.
  const lock = await bucket.put(lockKey(row), '', { onlyIf: { etagDoesNotMatch: '*' } });
  if (!lock) fail(409, 'UPLOAD_ASSEMBLING', 'This video is already being completed.');
  let multipart; let completed = false;
  try {
    const parts = [];
    for (let part = 1; part <= count(row); part++) {
      const object = await bucket.head(partKey(row, part));
      if (!validPart(object, row, part)) fail(409, 'UPLOAD_INCOMPLETE', 'Upload every video part before completing.');
      parts.push(object);
    }
    const inspected = await inspectChunkedMp4(bucket, row, parts, inspectMp4);
    if (!inspected) fail(415, 'INVALID_VIDEO', 'Use a valid MP4 video no longer than 3 minutes.');
    const metadata = {
      httpMetadata: { contentType: row.content_type },
      customMetadata: { ownerId: row.owner_id, mediaId: row.id, validated: 'true', mediaKind: 'video',
        width: String(inspected.width), height: String(inspected.height), durationMs: String(inspected.durationMs) },
    };
    // Multipart completion has no create-only precondition. Assemble privately,
    // then publish through an atomic create-only write so an older whole-PUT
    // request that already won this media ID is never overwritten.
    multipart = await bucket.createMultipartUpload(assembledKey(row), metadata);
    const uploaded = [];
    for (let index = 0; index < parts.length; index++) {
      const object = await bucket.get(partKey(row, index + 1), { onlyIf: { etagMatches: parts[index].etag } });
      if (!object?.body) fail(409, 'UPLOAD_PART_CHANGED', 'A video upload part is unavailable.');
      uploaded.push(await multipart.uploadPart(index + 1, object.body));
    }
    const assembled = await multipart.complete(uploaded); completed = true;
    if (!assembled?.etag || assembled.size !== Number(row.size_bytes)) {
      fail(502, 'UPLOAD_ASSEMBLY_FAILED', 'The video upload could not be completed.');
    }
    const source = await bucket.get(assembledKey(row), { onlyIf: { etagMatches: assembled.etag } });
    if (!source?.body || source.size !== Number(row.size_bytes)) {
      fail(502, 'UPLOAD_ASSEMBLY_FAILED', 'The video upload could not be completed.');
    }
    let stored;
    try {
      // R2 object bodies retain their known length; forward the stream directly
      // instead of allocating another whole-video ArrayBuffer in this Worker.
      stored = await bucket.put(row.object_key, source.body, { ...metadata, onlyIf: { etagDoesNotMatch: '*' } });
    } finally { await source.body.cancel().catch(() => {}); }
    if (!stored) fail(409, 'UPLOAD_ALREADY_STORED', 'This media was already stored. Refresh its status or add the file again.');
    if (!await commit(inspected)) {
      // A failed metadata ACK/CAS is not ownership of a database deletion.
      // Keep this private pending object's bytes for the existing authorized
      // cancel/expiry cleanup rather than deleting a concurrent publication.
      fail(409, 'UPLOAD_METADATA_FAILED', 'The upload could not be recorded.');
    }
    // Retain a tiny permanent completion marker. A second request may have read
    // the pending DB row before this request committed, so deleting the marker
    // would let it overwrite a now-published canonical object.
    await cleanupMediaChunks(bucket, row, true).catch(() => {});
    return { id: row.id, width: inspected.width, height: inspected.height, duration_ms: inspected.durationMs };
  } catch (error) {
    if (multipart && !completed) await multipart.abort().catch(() => {});
    await bucket.delete(assembledKey(row)).catch(() => {});
    // No other completion can own this lock while it exists.
    if (!completed) await bucket.delete(lockKey(row)).catch(() => {});
    throw error;
  }
}
