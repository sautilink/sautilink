const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const STREAM_READINESS_AHEAD = 5;
const MAX_RECORDS = 8;
const MAX_BYTES = 12 * 1024 * 1024;
const MAX_CLIP_BYTES = 2 * 1024 * 1024;

function resourceUrl(value, base, mediaId, origin) {
  try {
    const url = new URL(value, base);
    if (url.origin !== origin || url.protocol !== 'https:' || url.username || url.password || url.hash
      || !new RegExp(`^/api/sauti-media/${mediaId}/hls/[A-Za-z0-9_-]{1,4096}$`, 'i').test(url.pathname)
      || url.searchParams.getAll('c').length !== 1 || [...url.searchParams.keys()].some((key) => key !== 'c')
      || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('c'))) return null;
    return url.href;
  } catch { return null; }
}

export function initialHlsResources(text, base, mediaId, origin) {
  if (typeof text !== 'string' || !text.startsWith('#EXTM3U') || text.length > 65536) return null;
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.some((line) => line.startsWith('#EXT-X-SESSION-KEY:') || line.startsWith('#EXT-X-BYTERANGE:')
    || (line.startsWith('#EXT-X-KEY:') && !/(?:^|[:,])METHOD=NONE(?:,|$)/.test(line)))) return null;
  const variants = [];
  for (let index = 0; index < lines.length; index++) {
    if (!lines[index].startsWith('#EXT-X-STREAM-INF:')) continue;
    const bandwidth = Number(lines[index].match(/(?:^|[:,])BANDWIDTH=(\d+)/)?.[1]);
    const url = resourceUrl(lines[index + 1], base, mediaId, origin);
    if (url && bandwidth > 0) variants.push({ url, bandwidth,
      audioGroup: lines[index].match(/(?:^|[:,])AUDIO="([^"]+)"/)?.[1] });
  }
  if (variants.length) {
    const selected = variants.sort((a, b) => a.bandwidth - b.bandwidth)[0];
    const plan = { playlist: selected.url };
    if (selected.audioGroup) {
      const audio = lines.filter((line) => line.startsWith('#EXT-X-MEDIA:') && /(?:^|[:,])TYPE=AUDIO(?:,|$)/.test(line)
        && line.match(/(?:^|[:,])GROUP-ID="([^"]+)"/)?.[1] === selected.audioGroup)
        .sort((a, b) => Number(/(?:^|[:,])DEFAULT=YES(?:,|$)/.test(b)) - Number(/(?:^|[:,])DEFAULT=YES(?:,|$)/.test(a)))
        .find((line) => /(?:^|[:,])URI="/.test(line));
      if (audio) {
        const url = resourceUrl(audio.match(/(?:^|[:,])URI="([^"]+)"/)?.[1], base, mediaId, origin);
        if (!url) return null;
        plan.audioPlaylist = url;
      }
    }
    return plan;
  }
  // Do not speculate on live, encrypted or ranged objects. Their normal SDK
  // loader remains authoritative; a guessed whole-file range can be enormous.
  if (!lines.includes('#EXT-X-ENDLIST')) return null;
  let init = null;
  for (const line of lines) {
    if (line.startsWith('#EXT-X-MAP:')) {
      if (/BYTERANGE=/.test(line)) return null;
      init = resourceUrl(line.match(/URI="([^"]+)"/)?.[1], base, mediaId, origin);
      if (!init) return null;
    } else if (!line.startsWith('#')) {
      const fragment = resourceUrl(line, base, mediaId, origin);
      return fragment ? { resources: [...new Set([init, fragment].filter(Boolean))] } : null;
    }
  }
  return null;
}

/** Only short-lived, same-origin, already authorized HLS responses live here.
 * There is no disk cache, capability rewriting, token log or decoded player. */
export function createStreamReadiness({ origin, ensureSession, validateDescriptor,
  fetcher = (...args) => fetch(...args), now = () => Date.now(),
  setTimer = setTimeout, clearTimer = clearTimeout, onChange = () => {} } = {}) {
  const records = new Map(), jobs = new Map(), failed = new Map(), retries = new Map(), diagnostics = new Map();
  let wanted = [], generation = 0, paused = false, bytes = 0, retryTimer = null;
  const reason = (code, transient = false, http = 0) => Object.assign(new Error(code), { readinessReason: code, transient, http });
  function status(id) {
    const item = diagnostics.get(id), record = records.get(id);
    if (!item && !record) return null;
    return { state: item?.state || (record?.complete ? 'ready' : 'partial'), reason: item?.reason || 'none',
      http: item?.http || 0, bytes: record?.bytes || 0, resources: record?.resources.size || 0,
      retry: retries.get(id) || 0, elapsedMs: Math.min(3600000, Math.max(0, Math.round(item?.elapsedMs || 0))),
      hits: item?.hits || 0, misses: item?.misses || 0 };
  }
  function emit(id, value) { try { onChange(id, value); } catch { /* Diagnostic consumers never interrupt private media. */ } }
  function announce(id) { emit(id, status(id)); }
  function note(id, update) {
    if (!UUID.test(id)) return;
    const previous = diagnostics.get(id) || { state: 'idle', reason: 'none', http: 0, elapsedMs: 0, hits: 0, misses: 0 };
    diagnostics.delete(id); diagnostics.set(id, { ...previous, ...update });
    while (diagnostics.size > MAX_RECORDS * 2) {
      const oldest = diagnostics.keys().next().value; diagnostics.delete(oldest); emit(oldest, null);
    }
    announce(id);
  }
  const remove = (id) => {
    const record = records.get(id);
    if (record) { bytes -= record.bytes; records.delete(id); }
  };
  function trim() {
    for (const [id, record] of records) if (record.expiry <= now()) {
      remove(id); note(id, { state: 'expired', reason: 'expired', hits: 0, misses: 0 });
    }
    while (records.size > MAX_RECORDS || bytes > MAX_BYTES) {
      const oldest = records.keys().next().value; remove(oldest);
      diagnostics.delete(oldest); emit(oldest, null);
    }
  }
  function cancelRetryTimer() { if (retryTimer !== null) clearTimer(retryTimer); retryTimer = null; }
  function scheduleRetry() {
    cancelRetryTimer();
    if (paused || jobs.size >= 2) return;
    const next = [...failed].filter(([id, failure]) => wanted.includes(id) && !jobs.has(id)
      && !failure.terminal && !(retries.get(id) || 0)).map(([, failure]) => failure.at).sort((a, b) => a - b)[0];
    if (next === undefined) return;
    retryTimer = setTimer(() => { retryTimer = null; pump(); }, Math.max(0, next - now()));
    retryTimer?.unref?.();
  }
  function current(job) { return !job.controller.signal.aborted && job.generation === generation && wanted.includes(job.id) && !paused; }
  async function read(job, url, limit, text = false) {
    if (!current(job)) throw reason('cancelled');
    if (limit <= 0) throw reason('clip-budget');
    const started = now();
    const response = await fetcher(url, { credentials: 'same-origin', cache: 'no-store', redirect: 'error', priority: 'low',
      signal: AbortSignal.any([job.controller.signal, AbortSignal.timeout(8000)]) });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      const http = Number.isInteger(response.status) ? response.status : 0;
      throw reason([401, 403].includes(http) ? 'auth-denied' : 'http', [408, 425, 429].includes(http) || http >= 500, http);
    }
    if (!response.body || Number(response.headers.get('Content-Length') || 0) > limit) {
      await response.body?.cancel().catch(() => {}); throw reason(text ? 'metadata-budget' : 'clip-budget');
    }
    const reader = response.body.getReader(), chunks = [];
    let total = 0;
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        total += result.value.byteLength;
        if (!current(job)) throw reason('cancelled');
        if (total > limit) throw reason(text ? 'metadata-budget' : 'clip-budget');
        chunks.push(result.value);
      }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    finally { reader.releaseLock(); }
    if (!current(job)) throw reason('cancelled');
    const data = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
    return { data: text ? new TextDecoder().decode(data) : data.buffer, size: total, duration: Math.max(1, now() - started) };
  }
  function save(record, url, result) {
    if (records.get(record.id) !== record) throw reason('cancelled');
    if (record.resources.has(url)) return;
    if (result.size + record.bytes > MAX_CLIP_BYTES) throw reason('clip-budget');
    record.resources.set(url, result); record.bytes += result.size; bytes += result.size; trim(); announce(record.id);
  }
  async function retainedRead(job, record, url, text = false) {
    if (!current(job) || record.generation !== generation || record.expiry <= now() + 15000) throw reason('expired');
    const prior = record.resources.get(url);
    if (prior) return prior;
    const result = await read(job, url, Math.min(text ? 65536 : MAX_CLIP_BYTES, MAX_CLIP_BYTES - record.bytes), text);
    save(record, url, result); return result;
  }
  function playlistPlan(text, url, job) {
    const plan = initialHlsResources(text, url, job.id, origin());
    if (plan) return plan;
    if (typeof text !== 'string' || !text.startsWith('#EXTM3U')) throw reason('invalid-playlist');
    if (/(?:^|\n)#EXT-X-BYTERANGE:|#EXT-X-MAP:[^\n]*BYTERANGE=/.test(text)) throw reason('byte-range');
    if (/(?:^|\n)#EXT-X-SESSION-KEY:/.test(text)
      || text.split(/\r?\n/).some((line) => line.startsWith('#EXT-X-KEY:') && !/(?:^|[:,])METHOD=NONE(?:,|$)/.test(line))) throw reason('encrypted');
    if (!text.includes('#EXT-X-STREAM-INF:') && !text.split(/\r?\n/).includes('#EXT-X-ENDLIST')) throw reason('non-vod');
    throw reason('unsafe-playlist');
  }
  async function warm(job) {
    await ensureSession();
    if (!current(job)) return;
    let record = records.get(job.id);
    // Partial progress belongs to the exact original authorization, not a new
    // descriptor with different signed child URLs. Never extend this lease.
    if (!record || record.generation !== generation || record.expiry <= now() + 15000) {
      remove(job.id);
      const control = await read(job, `/api/sauti-media/${job.id}/playback`, 16384, true);
      let payload;
      try { payload = JSON.parse(control.data); } catch { throw reason('invalid-descriptor'); }
      const descriptor = validateDescriptor(payload?.ok === true ? payload.data : null, job.id, origin(), now());
      if (!current(job)) return;
      if (!descriptor) throw reason('invalid-descriptor');
      if (descriptor.type !== 'hls') throw reason('processing', true);
      record = { id: job.id, descriptor, expiry: descriptor.expiry, generation, resources: new Map(), bytes: 0, complete: false };
      records.set(job.id, record); trim(); announce(job.id);
    }
    let url = record.descriptor.url, audioPlaylist = null;
    for (let depth = 0; depth < 2; depth++) {
      const playlist = await retainedRead(job, record, url, true);
      const plan = playlistPlan(playlist.data, url, job);
      if (plan.playlist) { url = plan.playlist; audioPlaylist = plan.audioPlaylist || null; continue; }
      for (const resource of plan.resources) await retainedRead(job, record, resource);
      if (audioPlaylist) {
        const audio = await retainedRead(job, record, audioPlaylist, true);
        const audioPlan = playlistPlan(audio.data, audioPlaylist, job);
        if (!audioPlan.resources) throw reason('nested-playlist');
        for (const resource of audioPlan.resources) await retainedRead(job, record, resource);
      }
      record.complete = true; note(job.id, { state: 'ready', reason: 'none', http: 0, elapsedMs: now() - job.started }); return;
    }
    throw reason('nested-playlist');
  }
  function pump() {
    if (paused) { cancelRetryTimer(); return; }
    trim();
    for (const id of wanted) {
      if (jobs.size >= 2) break;
      const failure = failed.get(id);
      if (jobs.has(id) || records.get(id)?.complete || failure?.terminal || failure?.at > now()) continue;
      if (failure) { retries.set(id, 1); failed.delete(id); }
      const job = { id, generation, controller: new AbortController(), started: now() };
      jobs.set(id, job); note(id, { state: 'warming', reason: 'none', http: 0 });
      void warm(job).catch((error) => {
        if (!current(job)) return;
        const code = error.readinessReason || (['AbortError', 'TimeoutError'].includes(error.name) ? 'timeout' : 'network');
        const transient = error.readinessReason ? error.transient === true : true;
        const terminal = !transient || (retries.get(id) || 0) >= 1;
        failed.set(id, { terminal, at: now() + 20000 });
        note(id, { state: terminal ? 'failed' : 'backoff', reason: code, http: error.http || 0, elapsedMs: now() - job.started });
      }).finally(() => {
        if (job.generation !== generation) return;
        if (jobs.get(id) === job) jobs.delete(id);
        if (job.controller.signal.aborted) note(id, { state: paused ? 'suspended' : 'partial', reason: paused ? 'suspended' : 'window', elapsedMs: now() - job.started });
        pump();
      });
    }
    scheduleRetry();
  }
  return Object.freeze({
    update(ids, { suspended = false } = {}) {
      const next = [...new Set(ids.filter((id) => UUID.test(id)))].slice(0, STREAM_READINESS_AHEAD);
      for (const id of wanted) if (!next.includes(id)) { failed.delete(id); retries.delete(id); }
      wanted = next; paused = suspended;
      for (const [id, job] of jobs) if (paused || !wanted.includes(id)) job.controller.abort();
      for (const id of wanted) if (paused && !jobs.has(id) && !records.get(id)?.complete && !failed.has(id)) {
        note(id, { state: 'suspended', reason: 'suspended' });
      }
      pump();
    },
    descriptor(id) {
      trim(); const record = records.get(id);
      return record?.generation === generation && record.expiry > now() + 15000 ? record.descriptor : null;
    },
    resource(id, url) {
      trim(); const record = records.get(id), value = record?.resources.get(url);
      if (!value || record.generation !== generation || record.expiry <= now()) return null;
      records.delete(id); records.set(id, record);
      return { ...value, data: typeof value.data === 'string' ? value.data : value.data.slice(0),
        isCurrent: () => record.generation === generation && record.expiry > now() };
    },
    hit(id) { note(id, { hits: Math.min(1000000, (diagnostics.get(id)?.hits || 0) + 1) }); },
    miss(id) { note(id, { misses: Math.min(1000000, (diagnostics.get(id)?.misses || 0) + 1) }); },
    status(id) { trim(); return status(id); },
    forget(id) { diagnostics.delete(id); emit(id, null); },
    clear() {
      const ids = new Set([...diagnostics.keys(), ...records.keys()]);
      generation++; wanted = []; cancelRetryTimer(); for (const job of jobs.values()) job.controller.abort();
      jobs.clear(); records.clear(); failed.clear(); retries.clear(); diagnostics.clear(); bytes = 0;
      for (const id of ids) emit(id, null);
    },
    snapshot() { trim(); return { records: records.size, bytes, inFlight: jobs.size, wanted: [...wanted] }; },
  });
}

export function readinessLoader(DefaultLoader, cache, mediaId) {
  return class extends DefaultLoader {
    load(context, config, callbacks) {
      this.__readinessTicket = null;
      const ranged = Number(context.rangeStart || 0) !== 0 || Number(context.rangeEnd || 0) !== 0
        || Object.keys(context.headers || {}).some((key) => key.toLowerCase() === 'range');
      const value = !ranged ? cache.resource(mediaId, context.url) : null;
      if (!value || (context.responseType === 'arraybuffer') !== (typeof value.data !== 'string')) {
        cache.miss?.(mediaId); return super.load(context, config, callbacks);
      }
      this.context = context;
      this.config = config;
      this.callbacks = callbacks;
      const time = Math.max(1, globalThis.performance?.now?.() || 1);
      const duration = Number.isFinite(value.duration) ? Math.max(1, value.duration) : 1;
      const start = Math.max(0, time - duration);
      Object.assign(this.stats, { aborted: false, loaded: value.size, total: value.size, chunkCount: 1 });
      // The retained duration covers the original complete network fetch; its
      // first-byte timestamp was not retained. Count that duration as transfer
      // time conservatively. first=end would misclassify it all as TTFB, letting
      // ABR measure memory/decode speed instead of the observed network speed.
      Object.assign(this.stats.loading, { start, first: start, end: time });
      const ticket = this.__readinessTicket = {};
      queueMicrotask(() => {
        if (this.__readinessTicket === ticket && !this.stats.aborted && value.isCurrent?.() !== false) {
          this.__readinessTicket = null;
          cache.hit?.(mediaId);
          callbacks.onSuccess({ url: context.url, data: value.data, code: 200 }, this.stats, context, null);
        } else if (this.__readinessTicket === ticket && !this.stats.aborted) {
          this.__readinessTicket = null;
          callbacks.onError?.({ code: 0, text: 'READINESS_INVALIDATED' }, context, null, this.stats);
        }
      });
    }
    abort() {
      if (!this.__readinessTicket) return super.abort();
      this.__readinessTicket = null;
      const callbacks = this.callbacks;
      this.callbacks = null;
      if (this.stats) this.stats.aborted = true;
      super.abort();
      callbacks?.onAbort?.(this.stats, this.context, null);
    }
    destroy() { this.__readinessTicket = null; super.destroy(); }
  };
}
