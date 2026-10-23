import assert from 'node:assert/strict';
import test from 'node:test';
import { readPostVideoContainerDuration } from '../src/post-video-metadata.js';
import { POST_VIDEO_LIMIT } from '../src/post-media-policy.js';

// Complete ISO BMFF metadata headers; media payloads contain no user data.
const ascii = (text) => Uint8Array.from(text, (char) => char.charCodeAt(0));
const concat = (...parts) => {
  const bytes = new Uint8Array(parts.reduce((sum, item) => sum + item.length, 0));
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return bytes;
};
const integer = (value, length = 4) => {
  const bytes = new Uint8Array(length);
  const view = new DataView(bytes.buffer);
  if (length === 8) view.setBigUint64(0, BigInt(value), false);
  else view.setUint32(0, value, false);
  return bytes;
};
const box = (type, payload = new Uint8Array(), { extended = false, zero = false } = {}) => concat(
  integer(zero ? 0 : extended ? 1 : payload.length + 8), ascii(type),
  ...(extended ? [integer(payload.length + 16, 8)] : []), payload,
);
const timing = (type, { version = 0, scale = 1000, ticks = 30_000, unknown = false } = {}) => {
  const bytes = new Uint8Array(type === 'mvhd' ? (version === 1 ? 112 : 100) : (version === 1 ? 36 : 24));
  const view = new DataView(bytes.buffer);
  bytes[0] = version;
  view.setUint32(version === 1 ? 20 : 12, scale, false);
  if (version === 1) view.setBigUint64(24, unknown ? 0xffffffffffffffffn : BigInt(ticks), false);
  else view.setUint32(16, unknown ? 0xffffffff : ticks, false);
  return box(type, bytes);
};
const trackHeader = ({ id = 1, version = 0, width = 720, height = 1280 } = {}) => {
  const bytes = new Uint8Array(version === 1 ? 96 : 84);
  const view = new DataView(bytes.buffer);
  bytes[0] = version;
  view.setUint32(version === 1 ? 20 : 12, id, false);
  view.setUint32(version === 1 ? 88 : 76, width * 65536, false);
  view.setUint32(version === 1 ? 92 : 80, height * 65536, false);
  return box('tkhd', bytes);
};
const handler = (kind = 'vide') => {
  const bytes = new Uint8Array(24);
  bytes.set(ascii(kind), 8);
  return box('hdlr', bytes);
};
const track = (options = {}) => box('trak', concat(
  trackHeader(options),
  box('mdia', concat(timing('mdhd', options), handler(options.kind), ...(options.mediaExtras || []))),
  ...(options.extras || []),
));
const ftyp = box('ftyp', concat(ascii('isom'), integer(0), ascii('isom')));
const movie = ({ movieTiming = {}, tracks = [track()], extras = [], extended = false } = {}) => box('moov', concat(
  ...(movieTiming === null ? [] : [timing('mvhd', movieTiming)]), ...tracks, ...extras,
), { extended });
const mp4 = (options = {}) => concat(ftyp, movie(options), box('mdat', new Uint8Array(16)));
const file = (bytes) => {
  const blob = new Blob([bytes], { type: 'video/mp4' });
  const reads = [];
  return {
    size: blob.size, type: blob.type, reads,
    slice(start, end) { reads.push([start, end]); return blob.slice(start, end); },
  };
};

test('reads complete version-0 and version-1 mobile MP4 headers without a media decoder', async () => {
  assert.equal(await readPostVideoContainerDuration(file(mp4())), 30);
  const options = { version: 1, scale: 30_000, ticks: 901_440 };
  assert.equal(await readPostVideoContainerDuration(file(mp4({
    movieTiming: { version: 1, ticks: 0 }, tracks: [track(options)], extended: true,
  }))), 30.048);
});

test('takes the conservative maximum of movie, video and audio timings independent of track order', async () => {
  const video = track({ scale: 30_000, ticks: 600_000 });
  const audio = track({ id: 2, kind: 'soun', width: 0, height: 0, scale: 44_100, ticks: 1_323_045 });
  for (const tracks of [[video, audio], [audio, video]]) {
    assert.equal(await readPostVideoContainerDuration(file(mp4({ movieTiming: { ticks: 0 }, tracks }))), 30.002);
    assert.equal(await readPostVideoContainerDuration(file(mp4({ movieTiming: { ticks: 45_000 }, tracks }))), 45);
  }
});

test('unknown movie timing falls back to complete track timing and never guesses an unknown track end', async () => {
  for (const version of [0, 1]) {
    assert.equal(await readPostVideoContainerDuration(file(mp4({ movieTiming: { version, unknown: true } }))), 30);
    assert.equal(await readPostVideoContainerDuration(file(mp4({
      movieTiming: { version, unknown: true }, tracks: [track({ version, unknown: true })],
    }))), null);
  }
  assert.equal(await readPostVideoContainerDuration(file(mp4({ movieTiming: null }))), 30);
  assert.equal(await readPostVideoContainerDuration(file(mp4({ tracks: [track({ unknown: true })] }))), 30);
});

test('preserves the 180-second boundary and reports longer durations for the caller to trim', async () => {
  for (const ticks of [180_000, 180_001, 240_000]) {
    assert.equal(await readPostVideoContainerDuration(file(mp4({ movieTiming: { ticks }, tracks: [track({ ticks })] }))), ticks / 1000);
  }
  assert.equal(await readPostVideoContainerDuration(file(mp4({
    movieTiming: { ticks: 0 }, tracks: [track({ scale: 30_000, ticks: 5_400_001 })],
  }))), 180.001, 'ceil to the same milliseconds used by server inspection');
});

test('locates moov after a 250 MiB mdat by reading headers only, including extended atom sizes', async () => {
  const tail = movie();
  const tailOffset = POST_VIDEO_LIMIT - tail.length;
  const mdatSize = tailOffset - ftyp.length;
  const mdatHeader = concat(integer(1), ascii('mdat'), integer(mdatSize, 8));
  const segments = [[0, ftyp], [ftyp.length, mdatHeader], [tailOffset, tail]];
  const reads = [];
  const sparse = {
    size: POST_VIDEO_LIMIT,
    slice(start, end) {
      reads.push([start, end]);
      return { async arrayBuffer() {
        const bytes = new Uint8Array(end - start);
        for (const [offset, data] of segments) {
          const from = Math.max(start, offset), to = Math.min(end, offset + data.length);
          if (from < to) bytes.set(data.subarray(from - offset, to - offset), from - start);
        }
        return bytes.buffer;
      } };
    },
  };
  assert.equal(await readPostVideoContainerDuration(sparse), 30);
  assert.ok(reads.every(([from, to]) => to - from <= 112));
  assert.ok(reads.reduce((sum, [from, to]) => sum + to - from, 0) < 1024);
  assert.ok(reads.every(([from, to]) => to <= ftyp.length + 16 || from >= tailOffset), 'mdat bytes never enter the JS heap');
});

test('allows a final zero-size container but does not search arbitrary payload bytes for fake metadata', async () => {
  const moov = movie();
  const final = concat(integer(0), moov.subarray(4));
  assert.equal(await readPostVideoContainerDuration(file(concat(ftyp, final))), 30);
  assert.equal(await readPostVideoContainerDuration(file(concat(ftyp, box('mdat', moov)))), null);
});

test('refuses fragmented initialization timing instead of undercounting the full sample timeline', async () => {
  const shortTiming = { movieTiming: { ticks: 100 }, tracks: [track({ ticks: 100 })] };
  for (const bytes of [
    mp4({ ...shortTiming, extras: [box('mvex', box('trex', new Uint8Array(24)))] }),
    concat(ftyp, movie(shortTiming), box('moof', new Uint8Array(32)), box('mdat', new Uint8Array(32))),
  ]) assert.equal(await readPostVideoContainerDuration(file(bytes)), null);
});

test('rejects missing or duplicate structural metadata and files without a video track', async () => {
  const audio = track({ kind: 'soun', width: 0, height: 0 });
  for (const bytes of [
    movie(), concat(ftyp, ftyp, movie()), concat(ftyp, movie(), movie()),
    mp4({ extras: [timing('mvhd')] }), mp4({ tracks: [] }), mp4({ tracks: [audio] }),
    mp4({ tracks: [track(), track()] }),
    mp4({ tracks: [track({ extras: [trackHeader()] })] }),
    mp4({ tracks: [track({ mediaExtras: [timing('mdhd')] })] }),
    mp4({ tracks: [track({ mediaExtras: [handler()] })] }),
    mp4({ tracks: Array.from({ length: 33 }, (_, i) => track({ id: i + 1 })) }),
  ]) assert.equal(await readPostVideoContainerDuration(file(bytes)), null);
});

test('rejects invalid timescales, versions, unsafe integers, dimensions and truncated full headers', async () => {
  const unsafe = timing('mvhd', { version: 1, ticks: 1n << 54n });
  for (const bytes of [
    mp4({ movieTiming: { scale: 0 } }), mp4({ tracks: [track({ scale: 0 })] }),
    mp4({ movieTiming: { version: 2 } }), mp4({ tracks: [track({ version: 2 })] }),
    concat(ftyp, movie({ movieTiming: null, extras: [unsafe] })),
    mp4({ tracks: [track({ width: 0 })] }), mp4({ tracks: [track({ height: 8193 })] }),
    concat(ftyp, movie({ movieTiming: null, extras: [box('mvhd', new Uint8Array(20))] })),
    concat(ftyp, box('moov', concat(timing('mvhd'), box('trak', concat(
      box('tkhd', new Uint8Array(80)), box('mdia', concat(timing('mdhd'), handler())),
    ))))),
  ]) assert.equal(await readPostVideoContainerDuration(file(bytes)), null);
});

test('rejects malformed, truncated, overflowing and unsafe atom extents', async () => {
  for (const tail of [
    new Uint8Array([1]),
    concat(integer(7), ascii('free')),
    concat(integer(1024), ascii('free')),
    concat(integer(1), ascii('free'), integer(15, 8)),
    concat(integer(1), ascii('free'), integer(1n << 54n, 8)),
    concat(integer(1), ascii('free'), integer(8)),
  ]) assert.equal(await readPostVideoContainerDuration(file(concat(mp4(), tail))), null);
  assert.equal(await readPostVideoContainerDuration(file(concat(box('ftyp', new Uint8Array(9)), movie()))), null);
});

test('hard atom and aggregate-read budgets bound adversarial metadata', async () => {
  const value = file(concat(ftyp, ...Array.from({ length: 5000 }, () => box('free')), movie()));
  assert.equal(await readPostVideoContainerDuration(value), null);
  assert.ok(value.reads.length <= 4096);
  assert.ok(value.reads.reduce((sum, [from, to]) => sum + to - from, 0) <= 512 * 1024);
});

test('oversized, empty or invalid files fail before any local read', async () => {
  for (const size of [0, 31, POST_VIDEO_LIMIT + 1, Infinity, -1, 1.5]) {
    assert.equal(await readPostVideoContainerDuration({ size, slice() { assert.fail('file must not be read'); } }), null);
  }
  assert.equal(await readPostVideoContainerDuration(null), null);
  assert.equal(await readPostVideoContainerDuration({ size: 100 }), null);
});

test('unreadable or short reads safely return null rather than rejecting or reporting guessed timing', async () => {
  for (const arrayBuffer of [async () => { throw new Error('file no longer available'); }, async () => new ArrayBuffer(1), async () => null]) {
    assert.equal(await readPostVideoContainerDuration({ size: 100, slice: () => ({ arrayBuffer }) }), null);
  }
});

test('cancellation prevents new reads and settles a pending file read without leaking abort listeners', async () => {
  const controller = new AbortController();
  controller.abort();
  assert.equal(await readPostVideoContainerDuration({ size: 100, slice() { assert.fail('already aborted'); } }, { signal: controller.signal }), null);
  const active = new AbortController();
  let reads = 0, added = 0, removed = 0, finishRead;
  const originalAdd = active.signal.addEventListener.bind(active.signal);
  const originalRemove = active.signal.removeEventListener.bind(active.signal);
  active.signal.addEventListener = (...args) => { added++; originalAdd(...args); };
  active.signal.removeEventListener = (...args) => { removed++; originalRemove(...args); };
  const pending = readPostVideoContainerDuration({ size: 100, slice() {
    reads++;
    return { arrayBuffer: () => new Promise((resolve) => { finishRead = resolve; }) };
  } }, { signal: active.signal });
  await Promise.resolve();
  active.abort();
  assert.equal(await pending, null);
  assert.equal(reads, 1); assert.equal(added, removed);
  finishRead(new ArrayBuffer(8));
  await Promise.resolve();
  assert.equal(reads, 1, 'a late I/O completion cannot resume metadata parsing');
});

test('reads do not mutate the selected file, infer a MIME type or relabel unsupported formats', async () => {
  const value = file(mp4());
  value.type = 'video/quicktime'; value.name = 'original.mov';
  assert.equal(await readPostVideoContainerDuration(value), 30);
  assert.equal(value.type, 'video/quicktime'); assert.equal(value.name, 'original.mov');
});
