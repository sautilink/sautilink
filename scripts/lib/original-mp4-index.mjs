// LOCAL REVIEW PROPOSAL. No I/O, encoding, trimming, or original-object mutation.
const MAX_BYTES = 100_000_000;
const MAX_SAMPLES = 1_000_000;
const MAX_INDEX_ENTRIES = 4096;
const LONG_MAX = (1n << 63n) - 1n;
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'mvex', 'moof', 'traf']);
const forbidden = new Set(['sidx', 'mfra', 'senc', 'saiz', 'saio', 'sinf', 'schm', 'schi', 'tenc', 'encv', 'enca', 'uuid', 'sgpd', 'sbgp', 'edts']);
function requireValue(value) { if (!value) throw new Error('UNSUPPORTED_OR_INVALID_MP4'); }
function view(bytes) { return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
function read32(bytes, offset, end = bytes.length) { requireValue(offset >= 0 && offset + 4 <= end); return view(bytes).getUint32(offset); }
function read64(bytes, offset, end = bytes.length) { requireValue(offset >= 0 && offset + 8 <= end); return view(bytes).getBigUint64(offset); }
function typeAt(bytes, offset) { return String.fromCharCode(...bytes.subarray(offset, offset + 4)); }
function boxes(bytes, start = 0, end = bytes.length) {
  const result = []; let offset = start;
  while (offset < end) {
    requireValue(result.length < 10000 && end - offset >= 8);
    let size = read32(bytes, offset, end), header = 8;
    // A size-zero atom would absorb a subsequently appended index.
    requireValue(size !== 0);
    if (size === 1) { const wide = read64(bytes, offset + 8, end); requireValue(wide <= BigInt(end - offset)); size = Number(wide); header = 16; }
    requireValue(size >= header && size <= end - offset);
    result.push({ type: typeAt(bytes, offset + 4), offset, size, payload: offset + header, end: offset + size });
    offset += size;
  }
  requireValue(offset === end); return result;
}
function children(bytes, box) { return boxes(bytes, box.payload, box.end); }
function only(list, type, required = true) {
  const found = list.filter(box => box.type === type); requireValue(found.length <= 1 && (!required || found.length === 1)); return found[0];
}
function scanForbidden(bytes, list) {
  for (const box of list) { requireValue(!forbidden.has(box.type)); if (CONTAINERS.has(box.type)) scanForbidden(bytes, children(bytes, box)); }
}
function cursor(bytes, box) {
  let pos = box.payload;
  return {
    get pos() { return pos; }, get left() { return box.end - pos; },
    u32() { const value = read32(bytes, pos, box.end); pos += 4; return value; },
    i32() { const value = this.u32(); return value > 0x7fffffff ? value - 0x100000000 : value; },
    u64() { const value = read64(bytes, pos, box.end); pos += 8; requireValue(value <= LONG_MAX); return value; },
    skip(length) { requireValue(length >= 0 && pos + length <= box.end); pos += length; },
    full(versions = [0]) { const n = this.u32(), version = n >>> 24; requireValue(versions.includes(version)); return { version, flags: n & 0xffffff }; }
  };
}
function timedHeader(bytes, box) {
  const c = cursor(bytes, box), { version } = c.full([0, 1]); c.skip(version === 1 ? 16 : 8);
  const timescale = c.u32(), durationOffset = c.pos, ticks = version === 1 ? c.u64() : BigInt(c.u32());
  requireValue(timescale > 0); return { type: box.type, timescale, durationOffset, width: version === 1 ? 8 : 4, ticks };
}
function trackHeader(bytes, box) {
  const c = cursor(bytes, box), { version } = c.full([0, 1]); c.skip(version === 1 ? 16 : 8);
  const id = c.u32(); c.skip(4); const durationOffset = c.pos, ticks = version === 1 ? c.u64() : BigInt(c.u32());
  requireValue(id > 0); return { type: 'tkhd', id, durationOffset, width: version === 1 ? 8 : 4, ticks };
}
function descriptor(bytes, pos, end) {
  requireValue(pos < end); const tag = bytes[pos++]; let length = 0, done = false;
  for (let i = 0; i < 4; i++) { requireValue(pos < end); const n = bytes[pos++]; length = length * 128 + (n & 127); if (!(n & 128)) { done = true; break; } }
  requireValue(done && length <= end - pos); return { tag, payload: pos, end: pos + length };
}
function requireAac(bytes, extras) {
  const esds = only(extras, 'esds'), c = cursor(bytes, esds); requireValue(c.full().flags === 0);
  const es = descriptor(bytes, c.pos, esds.end); requireValue(es.tag === 3 && es.end - es.payload >= 3);
  let pos = es.payload + 2; const flags = bytes[pos++];
  if (flags & 128) pos += 2;
  if (flags & 64) { requireValue(pos < es.end); pos += 1 + bytes[pos]; }
  if (flags & 32) pos += 2;
  const config = descriptor(bytes, pos, es.end); requireValue(config.tag === 4 && config.end - config.payload >= 13);
  requireValue(bytes[config.payload] === 0x40 && (bytes[config.payload + 1] >>> 2) === 5);
  const specific = descriptor(bytes, config.payload + 13, config.end); requireValue(specific.tag === 5 && specific.end - specific.payload >= 2);
  requireValue([2, 5, 29].includes(bytes[specific.payload] >>> 3));
}
function sampleDescription(bytes, stbl, handler) {
  const stsd = only(stbl, 'stsd'), c = cursor(bytes, stsd); requireValue(c.full().flags === 0 && c.u32() === 1);
  const entries = boxes(bytes, c.pos, stsd.end); requireValue(entries.length === 1);
  const entry = entries[0]; requireValue(handler === 'vide' ? entry.type === 'avc1' : entry.type === 'mp4a');
  const fixed = handler === 'vide' ? 78 : 28; requireValue(entry.payload + fixed <= entry.end);
  const extras = boxes(bytes, entry.payload + fixed, entry.end); scanForbidden(bytes, extras);
  if (handler !== 'vide') { requireAac(bytes, extras); return null; }
  const avc = only(extras, 'avcC'); requireValue(avc.end - avc.payload >= 7 && bytes[avc.payload] === 1);
  const nalLength = (bytes[avc.payload + 4] & 3) + 1; requireValue([1, 2, 4].includes(nalLength));
  let pos = avc.payload + 6; const spsCount = bytes[avc.payload + 5] & 31; requireValue(spsCount > 0);
  function parameterSet(type) {
    requireValue(pos + 2 <= avc.end); const length = (bytes[pos] << 8) | bytes[pos + 1]; pos += 2;
    requireValue(length > 0 && pos + length <= avc.end && (bytes[pos] & 31) === type); pos += length;
  }
  for (let i = 0; i < spsCount; i++) parameterSet(7);
  requireValue(pos < avc.end); const ppsCount = bytes[pos++]; requireValue(ppsCount > 0);
  for (let i = 0; i < ppsCount; i++) parameterSet(8);
  return nalLength;
}
function parseMovie(bytes, moov) {
  const list = children(bytes, moov), movie = timedHeader(bytes, only(list, 'mvhd'));
  const mvex = children(bytes, only(list, 'mvex')), defaults = new Map();
  for (const box of mvex.filter(box => box.type === 'trex')) {
    const c = cursor(bytes, box); requireValue(c.full().flags === 0); const id = c.u32(), description = c.u32();
    requireValue(!defaults.has(id) && description === 1);
    defaults.set(id, { duration: c.u32(), size: c.u32(), flags: c.u32() }); requireValue(c.left === 0);
  }
  const tracks = new Map();
  for (const trak of list.filter(box => box.type === 'trak')) {
    const trackChildren = children(bytes, trak), tkhd = trackHeader(bytes, only(trackChildren, 'tkhd'));
    requireValue(!tracks.has(tkhd.id) && defaults.has(tkhd.id));
    const mdia = children(bytes, only(trackChildren, 'mdia')), mdhd = timedHeader(bytes, only(mdia, 'mdhd'));
    const hdlr = only(mdia, 'hdlr'); requireValue(hdlr.end - hdlr.payload >= 12);
    const handler = typeAt(bytes, hdlr.payload + 8); requireValue(['vide', 'soun'].includes(handler));
    const stbl = children(bytes, only(children(bytes, only(mdia, 'minf')), 'stbl'));
    const stsz = cursor(bytes, only(stbl, 'stsz')); stsz.full(); stsz.u32(); requireValue(stsz.u32() === 0);
    for (const b of stbl.filter(b => b.type === 'stco' || b.type === 'co64')) { const c = cursor(bytes, b); c.full(); requireValue(c.u32() === 0); }
    tracks.set(tkhd.id, { id: tkhd.id, handler, tkhd, mdhd, defaults: defaults.get(tkhd.id),
      nalLength: sampleDescription(bytes, stbl, handler), end: 0n, decodeEnd: 0n, samples: 0, lastDecodeEnd: null,
      maxSampleDuration: 0n, decodeOverlapCount: 0 });
  }
  requireValue(tracks.size >= 1 && tracks.size <= 8 && [...tracks.values()].filter(t => t.handler === 'vide').length === 1);
  const mehdBox = only(mvex, 'mehd', false); let mehd = null;
  if (mehdBox) { const c = cursor(bytes, mehdBox), { version } = c.full([0, 1]); mehd = { type: 'mehd', durationOffset: c.pos, width: version === 1 ? 8 : 4, ticks: version === 1 ? c.u64() : BigInt(c.u32()) }; requireValue(c.left === 0); }
  return { movie, tracks, mehd };
}
function containsSample(mdats, offset, length) { return mdats.some(box => offset >= box.payload && offset + length <= box.end); }
function isIdr(bytes, offset, size, lengthSize) {
  let pos = offset, idr = false, otherVcl = false, count = 0;
  while (pos < offset + size) {
    requireValue(++count <= 1024 && pos + lengthSize <= offset + size);
    let length = 0; for (let i = 0; i < lengthSize; i++) length = length * 256 + bytes[pos++];
    requireValue(length > 0 && pos + length <= offset + size);
    const header = bytes[pos], type = header & 31; requireValue((header & 128) === 0 && type > 0 && type < 24);
    if (type === 5) { requireValue(((header >>> 5) & 3) !== 0); idr = true; }
    else if (type >= 1 && type <= 4) otherVcl = true;
    requireValue(!(idr && otherVcl)); pos += length;
  }
  return idr;
}
function parseFragments(bytes, top, movie) {
  const mdats = top.filter(box => box.type === 'mdat'), entries = [], intervals = []; let samples = 0, fragments = 0;
  for (const moof of top.filter(box => box.type === 'moof')) {
    requireValue(++fragments <= 10000); const trafs = children(bytes, moof).filter(box => box.type === 'traf'); requireValue(trafs.length > 0);
    for (let trafIndex = 0; trafIndex < trafs.length; trafIndex++) {
      const atoms = children(bytes, trafs[trafIndex]), tfhd = cursor(bytes, only(atoms, 'tfhd'));
      const full = tfhd.full(); requireValue((full.flags & ~0x02003b) === 0);
      const track = movie.tracks.get(tfhd.u32()); requireValue(track);
      requireValue((full.flags & 1) !== 0 || (full.flags & 0x020000) !== 0);
      let base = (full.flags & 1) ? tfhd.u64() : BigInt(moof.offset); requireValue(base <= BigInt(bytes.length));
      if (full.flags & 2) requireValue(tfhd.u32() === 1);
      const duration = (full.flags & 8) ? tfhd.u32() : track.defaults.duration;
      const size = (full.flags & 16) ? tfhd.u32() : track.defaults.size;
      const flags = (full.flags & 32) ? tfhd.u32() : track.defaults.flags; requireValue(tfhd.left === 0);
      const tfdt = cursor(bytes, only(atoms, 'tfdt')), tfdtFull = tfdt.full([0, 1]); requireValue(tfdtFull.flags === 0);
      let tick = tfdtFull.version === 1 ? tfdt.u64() : BigInt(tfdt.u32()); requireValue(tfdt.left === 0);
      const truns = atoms.filter(box => box.type === 'trun'); requireValue(truns.length > 0); let nextData = null;
      const trafSamples = truns.reduce((sum, box) => sum + read32(bytes, box.payload + 4, box.end), 0);
      // Preserve the existing one-frame timestamp overlap seen in the originals. Never reorder it.
      // Larger discontinuities and nonmonotonic random-access timestamps remain unsupported.
      if (trafSamples > 0 && track.lastDecodeEnd !== null && tick < track.lastDecodeEnd) {
        requireValue(track.lastDecodeEnd - tick <= track.maxSampleDuration); track.decodeOverlapCount++;
      }
      for (let trunIndex = 0; trunIndex < truns.length; trunIndex++) {
        const trun = cursor(bytes, truns[trunIndex]), f = trun.full([0, 1]); requireValue((f.flags & ~0xf05) === 0);
        const count = trun.u32(); requireValue(count <= MAX_SAMPLES && (samples += count) <= MAX_SAMPLES);
        let data = (f.flags & 1) ? Number(base) + trun.i32() : nextData;
        if (count === 0 && data === null) data = Number(base);
        requireValue(data !== null && Number.isSafeInteger(data) && data >= 0);
        const firstFlags = (f.flags & 4) ? trun.u32() : flags; requireValue(!(f.flags & 4) || !(f.flags & 0x400));
        const runStart = data;
        for (let sampleIndex = 0; sampleIndex < count; sampleIndex++) {
          const sampleDuration = (f.flags & 0x100) ? trun.u32() : duration;
          const sampleSize = (f.flags & 0x200) ? trun.u32() : size;
          const sampleFlags = (f.flags & 0x400) ? trun.u32() : sampleIndex === 0 ? firstFlags : flags;
          const cto = (f.flags & 0x800) ? trun.i32() : 0;
          requireValue(sampleDuration > 0 && sampleDuration <= 0x7fffffff && sampleSize > 0 && containsSample(mdats, data, sampleSize));
          const presentation = tick + BigInt(cto); requireValue(presentation >= 0n && presentation + BigInt(sampleDuration) <= LONG_MAX);
          const sync = ((sampleFlags >>> 16) & 1) === 0;
          if (track.handler === 'vide' && sync) {
            requireValue(((sampleFlags >>> 24) & 3) === 2 && isIdr(bytes, data, sampleSize, track.nalLength));
            requireValue(entries.length < MAX_INDEX_ENTRIES);
            entries.push({ trackId: track.id, time: presentation, moofOffset: moof.offset,
              trafNumber: trafIndex + 1, trunNumber: trunIndex + 1, sampleNumber: sampleIndex + 1 });
          }
          tick += BigInt(sampleDuration); track.end = track.end > presentation + BigInt(sampleDuration) ? track.end : presentation + BigInt(sampleDuration);
          track.decodeEnd = track.decodeEnd > tick ? track.decodeEnd : tick; track.samples++; data += sampleSize;
          track.maxSampleDuration = track.maxSampleDuration > BigInt(sampleDuration) ? track.maxSampleDuration : BigInt(sampleDuration);
        }
        requireValue(trun.left === 0); if (count > 0) intervals.push([runStart, data]); nextData = data;
      }
      if (trafSamples > 0) track.lastDecodeEnd = tick;
    }
  }
  requireValue(fragments > 0 && entries.length > 0 && [...movie.tracks.values()].every(track => track.samples > 0));
  intervals.sort((a, b) => a[0] - b[0]); for (let i = 1; i < intervals.length; i++) requireValue(intervals[i][0] >= intervals[i - 1][1]);
  for (let i = 1; i < entries.length; i++) requireValue(entries[i].time > entries[i - 1].time && entries[i].moofOffset >= entries[i - 1].moofOffset);
  return { entries, fragments };
}
function box(type, payload) {
  const bytes = new Uint8Array(payload.length + 8); view(bytes).setUint32(0, bytes.length);
  for (let i = 0; i < 4; i++) bytes[4 + i] = type.charCodeAt(i); bytes.set(payload, 8); return bytes;
}
function concat(parts) { const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; } return bytes; }
function mfra(entries) {
  const payload = new Uint8Array(16 + entries.length * 28), d = view(payload);
  d.setUint32(0, 0x01000000); d.setUint32(4, entries[0].trackId); d.setUint32(8, 0x3f); d.setUint32(12, entries.length);
  let pos = 16; for (const entry of entries) {
    d.setBigUint64(pos, entry.time); d.setBigUint64(pos + 8, BigInt(entry.moofOffset));
    d.setUint32(pos + 16, entry.trafNumber); d.setUint32(pos + 20, entry.trunNumber); d.setUint32(pos + 24, entry.sampleNumber); pos += 28;
  }
  const tfra = box('tfra', payload), mfroPayload = new Uint8Array(8); view(mfroPayload).setUint32(4, 8 + tfra.length + 16);
  return box('mfra', concat([tfra, box('mfro', mfroPayload)]));
}
function ceilScale(ticks, from, to) { return (ticks * BigInt(to) + BigInt(from) - 1n) / BigInt(from); }

/** Returns null for unsupported/encrypted/malformed input; otherwise derives a NEW copy only. */
export function buildOriginalMp4Index(input, { repairDurationHeaders = false } = {}) {
  try {
    requireValue(input instanceof Uint8Array && input.length >= 32 && input.length <= MAX_BYTES);
    const top = boxes(input); scanForbidden(input, top); const moov = only(top, 'moov'); only(top, 'ftyp');
    requireValue(top.some(box => box.type === 'moof') && moov.offset < top.find(box => box.type === 'moof').offset);
    const movie = parseMovie(input, moov), parsed = parseFragments(input, top, movie), tail = mfra(parsed.entries);
    const bytes = new Uint8Array(input.length + tail.length); bytes.set(input); bytes.set(tail, input.length);
    const patches = [], tracks = []; let movieTicks = 0n;
    function patch(header, ticks, trackId = null) {
      requireValue(ticks >= 0n && ticks <= (header.width === 4 ? 0xffffffffn : LONG_MAX));
      if (repairDurationHeaders && ticks !== header.ticks) {
        if (header.width === 4) view(bytes).setUint32(header.durationOffset, Number(ticks)); else view(bytes).setBigUint64(header.durationOffset, ticks);
        patches.push({ box: header.type, trackId, offset: header.durationOffset, length: header.width, beforeTicks: header.ticks.toString(), afterTicks: ticks.toString() });
      }
    }
    for (const track of movie.tracks.values()) {
      const ticks = track.end > track.decodeEnd ? track.end : track.decodeEnd;
      const tkhdTicks = ceilScale(ticks, track.mdhd.timescale, movie.movie.timescale); movieTicks = movieTicks > tkhdTicks ? movieTicks : tkhdTicks;
      patch(track.mdhd, ticks, track.id); patch(track.tkhd, tkhdTicks, track.id);
      tracks.push({ id: track.id, type: track.handler, timescale: track.mdhd.timescale, samples: track.samples,
        completeDurationTicks: ticks.toString(), completeDurationMs: Number(ticks) * 1000 / track.mdhd.timescale,
        originalTkhdDurationMs: Number(track.tkhd.ticks) * 1000 / movie.movie.timescale,
        preservedDecodeOverlaps: track.decodeOverlapCount });
    }
    patch(movie.movie, movieTicks); if (movie.mehd) patch(movie.mehd, movieTicks);
    return { bytes, originalSize: input.length, appendedSize: tail.length, headerPatches: patches,
      durationHeadersRepaired: repairDurationHeaders, completeDurationMs: Number(movieTicks) * 1000 / movie.movie.timescale,
      fragments: parsed.fragments, tracks, entries: parsed.entries.map(e => ({ ...e, time: e.time.toString() })) };
  } catch { return null; }
}
