export function createMediaPreviewQueue(limit = 2) {
  const pending = [];
  const active = new Set();
  let running = 0;
  function drain() {
    for (const job of active) {
      if (job.isCurrent?.() === false || job.priority?.() === Infinity) job.controller.abort();
    }
    for (let index = pending.length - 1; index >= 0; index--) {
      if (pending[index].isCurrent?.() === false) pending.splice(index, 1)[0].reject(new Error('MEDIA_PREVIEW_CANCELLED'));
    }
    while (running < limit && pending.length) {
      let selected = -1, priority = Infinity;
      for (let index = 0; index < pending.length; index++) {
        const candidate = pending[index].priority?.() ?? 0;
        if (candidate < priority) { priority = candidate; selected = index; }
      }
      // An offscreen job retains only its small task, not a running request or
      // response body. A later viewport change wakes it without an error tile.
      if (selected < 0) break;
      const job = pending.splice(selected, 1)[0];
      job.controller = new AbortController();
      active.add(job);
      running++;
      Promise.resolve().then(() => job.task(job.controller.signal)).then((value) => {
        if (job.controller.signal.aborted && job.isCurrent?.() !== false) pending.push(job);
        else job.resolve(value);
      }, (error) => {
        if (job.controller.signal.aborted && job.isCurrent?.() !== false) pending.push(job);
        else job.reject(error);
      }).finally(() => { active.delete(job); running--; drain(); });
    }
  }
  const run = (task, { isCurrent, priority } = {}) => new Promise((resolve, reject) => {
    pending.push({ task, resolve, reject, isCurrent, priority }); drain();
  });
  run.wake = drain;
  return run;
}

// Hold the slot through response-body completion, not merely response headers.
export const runMediaPreviewRequest = createMediaPreviewQueue(2);
export const wakeMediaPreviewRequests = () => runMediaPreviewRequest.wake();

const waitingPlayback = new Set();
export function setMediaPreviewPlaybackWaiting(video, waiting) {
  if (waiting) waitingPlayback.add(video); else waitingPlayback.delete(video);
  wakeMediaPreviewRequests();
}

function playbackNeedsNetwork() {
  for (const video of waitingPlayback) {
    if (!video.isConnected || video.ended || video.error
      || (video.paused && video.dataset?.sautiPreparing !== 'true')) waitingPlayback.delete(video);
  }
  return waitingPlayback.size > 0;
}

export function mediaPreviewPriority(tile) {
  if (!tile) return 0;
  if (!tile.isConnected || tile.closest('[hidden]')) return Infinity;
  if (globalThis.document?.visibilityState === 'hidden' || document.querySelector('dialog[open]')) return Infinity;
  if (document.documentElement.classList.contains('sauti-short-videos-open') && tile.closest('#stream-feed')
    && tile.dataset.sautiReadiness !== 'true') return Infinity;
  const bounds = tile.getBoundingClientRect();
  const height = window.innerHeight || 720;
  if (bounds.bottom > 0 && bounds.top < height) return 0;
  // A visible video's first frame/audio must not queue behind future posters.
  // Keep visible image requests available; park only speculative offscreen work.
  if (playbackNeedsNetwork()) return Infinity;
  const connection = globalThis.navigator?.connection;
  if (connection?.saveData || ['slow-2g', '2g'].includes(connection?.effectiveType)) return Infinity;
  if (tile.dataset.sautiReadiness === 'true') return 1;
  return bounds.bottom > -128 && bounds.top < height + 320 ? 2 : Infinity;
}

export async function readMediaPreviewBlob(response, maxBytes = 8 * 1024 * 1024) {
  if (Number(response.headers.get('Content-Length') || 0) > maxBytes || !response.body) {
    await response.body?.cancel().catch(() => {}); throw new Error('MEDIA_PREVIEW_TOO_LARGE');
  }
  const reader = response.body.getReader(), chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > maxBytes) throw new Error('MEDIA_PREVIEW_TOO_LARGE');
      chunks.push(result.value);
    }
    return new Blob(chunks, { type: response.headers.get('Content-Type') || 'application/octet-stream' });
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
}
