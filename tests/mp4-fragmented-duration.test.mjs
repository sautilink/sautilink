import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectMp4Bytes } from '../src/sauti-media-api.js';

// Metadata-only synthetic ISO BMFF fixtures. No uploaded media or user data.
const ascii = (text) => Uint8Array.from(text, (char) => char.charCodeAt(0));
const u32 = (value) => {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
};
const u64 = (value) => {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value), false);
  return bytes;
};
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
};
const box = (type, ...parts) => {
  const payload = concat(...parts);
  return concat(u32(payload.length + 8), ascii(type), payload);
};
const full = (version = 0, flags = 0) => u32(version * 2 ** 24 + flags);
const timing = (scale, duration, version = 1) => concat(full(version),
  new Uint8Array(version === 1 ? 16 : 8), u32(scale),
  version === 1 ? u64(duration) : u32(duration), new Uint8Array(4));
const ftyp = box('ftyp', ascii('isom'), new Uint8Array(8));

function track({ id = 1, scale = 30000, initial = 3439, width = 576, height = 1024, handler = 'vide', version = 1 } = {}) {
  const data = new Uint8Array(version === 1 ? 96 : 84);
  const view = new DataView(data.buffer);
  data.set(full(version));
  view.setUint32(version === 1 ? 20 : 12, id, false);
  view.setUint32(version === 1 ? 88 : 76, width * 65536, false);
  view.setUint32(version === 1 ? 92 : 80, height * 65536, false);
  return box('trak', box('tkhd', data), box('mdia',
    box('mdhd', timing(scale, initial, version)),
    box('hdlr', full(), u32(0), ascii(handler), new Uint8Array(12))));
}

function movie(tracks = [track()], defaults = [{ id: 1, duration: 0 }], { extendsBox = true, duration = 0, version = 1 } = {}) {
  return box('moov', box('mvhd', timing(1000, duration, version)), ...tracks,
    ...(extendsBox ? [box('mvex', ...defaults.map(({ id, duration: value }) =>
      box('trex', full(), u32(id), u32(1), u32(value), u32(0), u32(0))))] : []));
}

function run(durations, { flags = 0x305, version = 1, count = durations.length, offsets = [] } = {}) {
  return box('trun', full(version, flags), u32(count),
    ...((flags & 1) ? [u32(0)] : []), ...((flags & 4) ? [u32(0x02000000)] : []),
    ...durations.flatMap((duration, index) => [
      ...((flags & 0x100) ? [u32(duration)] : []),
      ...((flags & 0x200) ? [u32(12)] : []),
      ...((flags & 0x400) ? [u32(0)] : []),
      ...((flags & 0x800) ? [u32(offsets[index] || 0)] : []),
    ]));
}

function fragment({ id = 1, time = 0, timeVersion = 1, durations = [30000], runs = null,
  defaultDuration = null, omitTime = false, extraHeader = new Uint8Array() } = {}) {
  const flags = 0x020020 | (defaultDuration === null ? 0 : 8);
  return box('traf', box('tfhd', full(0, flags), u32(id),
    ...(defaultDuration === null ? [] : [u32(defaultDuration)]), u32(0x01010000), extraHeader),
  ...(omitTime ? [] : [box('tfdt', full(timeVersion), timeVersion === 1 ? u64(time) : u32(time))]),
  ...(runs || [run(durations)]));
}

const moof = (...tracks) => box('moof', box('mfhd', full(), u32(1)), ...tracks);
const mp4 = (moov, ...fragments) => concat(ftyp, moov, ...fragments.flatMap((part) => [part, box('mdat')]));

test('fragmented mobile MP4 counts the complete timeline instead of tiny version-1 mdhd initialization values', () => {
  const bytes = mp4(movie([
    track({ id: 1, scale: 30000, initial: 7224, width: 720, height: 1280 }),
    track({ id: 2, scale: 44100, initial: 7244, width: 0, height: 0, handler: 'soun' }),
  ], [{ id: 1, duration: 0 }, { id: 2, duration: 0 }]),
  moof(fragment({ id: 1, durations: [300000, 300000] }), fragment({ id: 2, durations: [441000, 441000] })),
  moof(fragment({ id: 1, time: 600000, durations: [257979] }), fragment({ id: 2, time: 882000, durations: [444059] })));
  assert.deepEqual(inspectMp4Bytes(bytes), { contentType: 'video/mp4', width: 720, height: 1280, durationMs: 30070 });
});

test('fragmented tracks use their own timescales, regardless of audio/video order', () => {
  const bytes = mp4(movie([
    track({ id: 7, scale: 44100, initial: 3668, width: 0, height: 0, handler: 'soun' }),
    track({ id: 8, scale: 30000, initial: 3338 }),
  ], [{ id: 7, duration: 0 }, { id: 8, duration: 0 }]),
  moof(fragment({ id: 7, durations: [1338338] }), fragment({ id: 8, durations: [864466] })));
  assert.equal(inspectMp4Bytes(bytes)?.durationMs, 30348);
});

test('trex and tfhd default durations and consecutive runs are honored with version-0 and implicit decode times', () => {
  const bytes = mp4(movie([track({ initial: 0 })], [{ id: 1, duration: 30000 }]),
    moof(fragment({ timeVersion: 0, runs: [run([0, 0], { flags: 0 }), run([0], { flags: 0 })] })),
    moof(fragment({ defaultDuration: 15000, omitTime: true, runs: [run([0, 0], { flags: 0 })] })));
  assert.equal(inspectMp4Bytes(bytes)?.durationMs, 4000);
});

test('duration includes composition offsets and rejects presentation or decode timelines over the 180-second container limit', () => {
  const make = (durations, flags, offsets, version = 1) => mp4(movie([track({ initial: 0 })]),
    moof(fragment({ runs: [run(durations, { flags, offsets, version })] })));
  assert.equal(inspectMp4Bytes(make([30000], 0x900, [30000]))?.durationMs, 2000);
  assert.equal(inspectMp4Bytes(make([30000], 0x900, [-15000]))?.durationMs, 1000);
  assert.equal(inspectMp4Bytes(make([5400000], 0x100, []))?.durationMs, 180000);
  assert.equal(inspectMp4Bytes(make([5400001], 0x100, [])), null);
  assert.equal(inspectMp4Bytes(make([5400000], 0x900, [1], 0)), null);
});

test('normal MP4 duration includes movie and audio durations rather than only the largest video track', () => {
  const make = (audio, movieDuration = 0) => mp4(movie([
    track({ id: 1, scale: 1000, initial: 20000, version: 0 }),
    track({ id: 2, scale: 1000, initial: audio, width: 0, height: 0, handler: 'soun', version: 0 }),
  ], [], { extendsBox: false, duration: movieDuration, version: 0 }));
  assert.equal(inspectMp4Bytes(make(30001))?.durationMs, 30001);
  assert.equal(inspectMp4Bytes(make(20000, 45000))?.durationMs, 45000);
  assert.equal(inspectMp4Bytes(make(180001)), null);
});

test('malformed or incomplete fragments fail closed instead of falling back to misleading initialization durations', () => {
  const initialization = movie();
  const valid = moof(fragment());
  for (const bytes of [
    mp4(initialization),
    mp4(movie([track()], [], { extendsBox: false }), valid),
    mp4(initialization, moof(fragment({ id: 999 }))),
    mp4(initialization, moof(fragment({ runs: [run([0], { flags: 0 })] }))),
    mp4(initialization, moof(fragment({ runs: [run([30000], { count: 250001 })] }))),
    mp4(initialization, moof(fragment({ runs: [run([30000], { flags: 0x100000 })] }))),
    mp4(initialization, moof(fragment({ time: BigInt(Number.MAX_SAFE_INTEGER) + 1n }))),
    mp4(initialization, moof(fragment({ extraHeader: u32(1) }))),
    mp4(initialization, valid.subarray(0, valid.length - 1)),
    concat(mp4(initialization, valid), new Uint8Array([0])),
    concat(ftyp, initialization, box('moof', new Uint8Array([0]))),
  ]) assert.equal(inspectMp4Bytes(bytes), null);
});

test('untrusted sample counts cannot force unbounded per-sample loops when trun relies on defaults', () => {
  const bytes = mp4(movie([track({ initial: 0 })], [{ id: 1, duration: 1 }]),
    moof(fragment({ runs: [run([], { flags: 0, count: 0xffffffff })] })));
  assert.equal(inspectMp4Bytes(bytes), null);
});
