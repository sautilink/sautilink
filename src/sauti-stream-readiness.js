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
  fetcher = (...args) => fetch(...args), now = () => Date.now() } = {}) {
  const records = new Map(), jobs = new Map(), failed = new Map();
  let wanted = [], generation = 0, paused = false, bytes = 0;
  const remove = (id) => {
    const record = records.get(id);
    if (record) { bytes -= record.bytes; records.delete(id); }
  };
  function trim() {
    for (const [id, record] of records) if (record.expiry <= now()) remove(id);
    while (records.size > MAX_RECORDS || bytes > MAX_BYTES) remove(records.keys().next().value);
  }
  function current(job) { return !job.controller.signal.aborted && job.generation === generation && wanted.includes(job.id) && !paused; }
  async function read(job, url, limit, text = false) {
    if (!current(job) || limit <= 0) throw new Error('READINESS_CANCELLED');
    const started = now();
    const response = await fetcher(url, { credentials: 'same-origin', cache: 'no-store', redirect: 'error', priority: 'low',
      signal: AbortSignal.any([job.controller.signal, AbortSignal.timeout(8000)]) });
    if (!response.ok || !response.body || Number(response.headers.get('Content-Length') || 0) > limit) {
      await response.body?.cancel().catch(() => {}); throw new Error('READINESS_RESPONSE');
    }
    const reader = response.body.getReader(), chunks = [];
    let total = 0;
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        total += result.value.byteLength;
        if (!current(job) || total > limit) throw new Error('READINESS_BOUND');
        chunks.push(result.value);
      }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    finally { reader.releaseLock(); }
    if (!current(job)) throw new Error('READINESS_CANCELLED');
    const data = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
    return { data: text ? new TextDecoder().decode(data) : data.buffer, size: total, duration: Math.max(1, now() - started) };
  }
  function save(record, url, result) {
    if (!records.has(record.id) || result.size + record.bytes > MAX_CLIP_BYTES) return false;
    record.resources.set(url, result); record.bytes += result.size; bytes += result.size; trim();
    return records.get(record.id) === record;
  }
  async function warm(job) {
    await ensureSession();
    if (!current(job)) return;
    const control = await read(job, `/api/sauti-media/${job.id}/playback`, 16384, true);
    const payload = JSON.parse(control.data);
    const descriptor = validateDescriptor(payload?.ok === true ? payload.data : null, job.id, origin(), now());
    if (!current(job) || descriptor?.type !== 'hls') return;
    const record = { id: job.id, descriptor, expiry: descriptor.expiry, generation, resources: new Map(), bytes: 0, complete: false };
    remove(job.id); records.set(job.id, record); trim();
    let url = descriptor.url;
    let audioPlaylist = null;
    for (let depth = 0; depth < 2; depth++) {
      const playlist = await read(job, url, Math.min(65536, MAX_CLIP_BYTES - record.bytes), true);
      const plan = initialHlsResources(playlist.data, url, job.id, origin());
      if (!plan || !save(record, url, playlist)) return;
      if (plan.playlist) { url = plan.playlist; audioPlaylist = plan.audioPlaylist || null; continue; }
      for (const resource of plan.resources) {
        const result = await read(job, resource, MAX_CLIP_BYTES - record.bytes);
        if (!save(record, resource, result)) return;
      }
      if (audioPlaylist) {
        const audio = await read(job, audioPlaylist, Math.min(65536, MAX_CLIP_BYTES - record.bytes), true);
        const audioPlan = initialHlsResources(audio.data, audioPlaylist, job.id, origin());
        if (!audioPlan?.resources || !save(record, audioPlaylist, audio)) return;
        for (const resource of audioPlan.resources) {
          const result = await read(job, resource, MAX_CLIP_BYTES - record.bytes);
          if (!save(record, resource, result)) return;
        }
      }
      record.complete = true; return;
    }
  }
  function pump() {
    if (paused) return;
    trim();
    for (const id of wanted) {
      if (jobs.size >= 2) break;
      if (jobs.has(id) || records.get(id)?.complete || (failed.get(id) || 0) > now()) continue;
      const job = { id, generation, controller: new AbortController() };
      jobs.set(id, job);
      void warm(job).catch(() => {
        if (!job.controller.signal.aborted && job.generation === generation) failed.set(id, now() + 20000);
      }).finally(() => {
        if (!job.controller.signal.aborted && job.generation === generation && !records.get(id)?.complete) failed.set(id, now() + 20000);
        if (jobs.get(id) === job) jobs.delete(id);
        pump();
      });
    }
  }
  return Object.freeze({
    update(ids, { suspended = false } = {}) {
      wanted = [...new Set(ids.filter((id) => UUID.test(id)))].slice(0, STREAM_READINESS_AHEAD);
      paused = suspended;
      for (const [id, job] of jobs) if (paused || !wanted.includes(id)) job.controller.abort();
      for (const id of failed.keys()) if (!wanted.includes(id)) failed.delete(id);
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
    clear() { generation++; wanted = []; for (const job of jobs.values()) job.controller.abort(); records.clear(); failed.clear(); bytes = 0; },
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
      if (!value || (context.responseType === 'arraybuffer') !== (typeof value.data !== 'string')) return super.load(context, config, callbacks);
      this.context = context;
      this.config = config;
      this.callbacks = callbacks;
      const time = globalThis.performance?.now?.() || 1;
      Object.assign(this.stats, { aborted: false, loaded: value.size, total: value.size, chunkCount: 1 });
      Object.assign(this.stats.loading, { start: Math.max(0, time - value.duration), first: time, end: time });
      const ticket = this.__readinessTicket = {};
      queueMicrotask(() => {
        if (this.__readinessTicket === ticket && !this.stats.aborted && value.isCurrent?.() !== false) {
          this.__readinessTicket = null;
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
