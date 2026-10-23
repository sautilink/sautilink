import { POST_VIDEO_LIMIT } from './post-media-policy.js';

const MAX_METADATA_READ_BYTES = 512 * 1024;
const MAX_BOXES = 4096;
const MAX_TRACKS = 32;
const MAX_DIMENSION = 8192;

function ascii(bytes, offset, length = 4) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function uint64(view, offset) {
  const high = view.getUint32(offset, false);
  const low = view.getUint32(offset + 4, false);
  const value = high * 2 ** 32 + low;
  return Number.isSafeInteger(value) ? value : null;
}

// Read container timing without asking the browser to decode its video codec.
// MIME acceptance and the upload policy remain the caller's responsibility.
// Fragmented files need their sample timeline, so this header-only fallback
// deliberately leaves them to the normal media reader and server inspection.
export async function readPostVideoContainerDuration(file, { signal } = {}) {
  if (signal?.aborted || !file || typeof file.slice !== 'function'
    || !Number.isSafeInteger(file.size) || file.size < 32 || file.size > POST_VIDEO_LIMIT) return null;

  let bytesRead = 0;
  let boxCount = 0;
  const read = async (offset, length) => {
    if (signal?.aborted || !Number.isSafeInteger(offset) || !Number.isSafeInteger(length)
      || offset < 0 || length < 1 || offset + length > file.size
      || bytesRead + length > MAX_METADATA_READ_BYTES) throw new Error('INVALID_METADATA_READ');
    bytesRead += length;
    const pending = Promise.resolve().then(() => {
      if (signal?.aborted) throw new Error('METADATA_ABORTED');
      return file.slice(offset, offset + length).arrayBuffer();
    });
    let abort;
    const buffer = signal ? await Promise.race([
      pending,
      new Promise((_, reject) => {
        abort = () => reject(new Error('METADATA_ABORTED'));
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      }),
    ]).finally(() => signal.removeEventListener('abort', abort)) : await pending;
    if (signal?.aborted || !(buffer instanceof ArrayBuffer) || buffer.byteLength !== length) throw new Error('INVALID_METADATA_BYTES');
    return new Uint8Array(buffer);
  };

  const boxes = async (start, end) => {
    const result = [];
    let offset = start;
    while (offset < end) {
      if (end - offset < 8 || ++boxCount > MAX_BOXES) throw new Error('INVALID_METADATA_BOX');
      const bytes = await read(offset, 8);
      const view = new DataView(bytes.buffer);
      let size = view.getUint32(0, false);
      let header = 8;
      if (size === 1) {
        if (end - offset < 16) throw new Error('INVALID_METADATA_BOX');
        const extended = await read(offset + 8, 8);
        size = uint64(new DataView(extended.buffer), 0);
        header = 16;
      } else if (size === 0) {
        size = end - offset;
      }
      if (!Number.isSafeInteger(size) || size < header || size > end - offset) throw new Error('INVALID_METADATA_BOX');
      result.push({ type: ascii(bytes, 4), offset, size, header, start: offset + header, end: offset + size });
      offset += size;
    }
    return result;
  };

  const single = (items, type, required = false) => {
    const matches = items.filter((item) => item.type === type);
    if (matches.length > 1 || (required && matches.length !== 1)) throw new Error('AMBIGUOUS_METADATA_BOX');
    return matches[0];
  };

  const timing = async (box) => {
    if (!box) return null;
    if (box.end - box.start < 4) throw new Error('INVALID_METADATA_TIMING');
    const prefix = await read(box.start, Math.min(32, box.end - box.start));
    const version = prefix[0];
    const minimum = box.type === 'mvhd' ? (version === 1 ? 112 : 100) : (version === 1 ? 36 : 24);
    if ((version !== 0 && version !== 1) || box.end - box.start < minimum) throw new Error('INVALID_METADATA_TIMING');
    const view = new DataView(prefix.buffer);
    const scale = view.getUint32(version === 1 ? 20 : 12, false);
    if (!scale) throw new Error('INVALID_METADATA_TIMESCALE');
    const high = version === 1 ? view.getUint32(24, false) : 0;
    const low = view.getUint32(version === 1 ? 28 : 16, false);
    if ((version === 0 && low === 0xffffffff) || (version === 1 && high === 0xffffffff && low === 0xffffffff)) return null;
    const ticks = version === 1 ? uint64(view, 24) : low;
    if (ticks === null) throw new Error('INVALID_METADATA_DURATION');
    if (!ticks) return null;
    const milliseconds = Math.ceil(ticks / scale * 1000);
    if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0) throw new Error('INVALID_METADATA_DURATION');
    return milliseconds;
  };

  try {
    const top = await boxes(0, file.size);
    const format = single(top, 'ftyp', true);
    const movie = single(top, 'moov', true);
    if (format.end - format.start < 8 || (format.end - format.start) % 4
      || top.some((box) => box.type === 'moof')) return null;
    // Verify that even a skipped format payload can actually be read.
    await read(format.start, 8);
    const children = await boxes(movie.start, movie.end);
    if (children.some((box) => box.type === 'mvex')) return null;
    const movieDuration = await timing(single(children, 'mvhd'));
    const tracks = children.filter((box) => box.type === 'trak');
    if (!tracks.length || tracks.length > MAX_TRACKS) return null;
    const ids = new Set();
    let hasVideo = false;
    let duration = movieDuration || 0;
    for (const track of tracks) {
      const trackBoxes = await boxes(track.start, track.end);
      const header = single(trackBoxes, 'tkhd', true);
      const media = single(trackBoxes, 'mdia', true);
      if (header.end - header.start < 4) return null;
      const version = (await read(header.start, 4))[0];
      const length = version === 1 ? 96 : 84;
      if ((version !== 0 && version !== 1) || header.end - header.start < length) return null;
      const trackHeader = await read(header.start, length);
      const view = new DataView(trackHeader.buffer);
      const id = view.getUint32(version === 1 ? 20 : 12, false);
      if (!id || ids.has(id)) return null;
      ids.add(id);
      const width = view.getUint32(version === 1 ? 88 : 76, false) / 65536;
      const height = view.getUint32(version === 1 ? 92 : 80, false) / 65536;
      const mediaBoxes = await boxes(media.start, media.end);
      const handler = single(mediaBoxes, 'hdlr', true);
      if (handler.end - handler.start < 24) return null;
      const handlerBytes = await read(handler.start, 12);
      if (handlerBytes[0] !== 0) return null;
      const isVideo = ascii(handlerBytes, 8) === 'vide';
      if (isVideo) {
        if (width <= 0 || height <= 0 || width > MAX_DIMENSION || height > MAX_DIMENSION) return null;
        hasVideo = true;
      }
      const trackDuration = await timing(single(mediaBoxes, 'mdhd', true));
      // With no movie duration an unknown track may extend beyond every
      // known track. Never present a shorter duration as authoritative.
      if (!trackDuration && !movieDuration) return null;
      duration = Math.max(duration, trackDuration || 0);
    }
    return !signal?.aborted && hasVideo && duration > 0 ? duration / 1000 : null;
  } catch {
    return null;
  }
}
