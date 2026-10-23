import { updateSautiStreamReadiness } from './sauti-stream-web-player.js';
import { STREAM_READINESS_AHEAD } from './sauti-stream-readiness.js';
import { wakeMediaPreviewRequests } from './media-preview-queue.js';

let preparedTiles = new Set();
function markPreparedTiles(tiles) {
  for (const tile of preparedTiles) delete tile.dataset.sautiReadiness;
  preparedTiles = new Set(tiles);
  for (const tile of preparedTiles) tile.dataset.sautiReadiness = 'true';
  wakeMediaPreviewRequests();
}

export function nextMediaReadinessItems(items, index) {
  return index >= 0 ? items.slice(index + 1, index + 1 + STREAM_READINESS_AHEAD) : [];
}

export function updateShortsMediaReadiness(slides, index) {
  const ahead = nextMediaReadinessItems(slides, index);
  updateSautiStreamReadiness(ahead.map((slide) => slide.dataset.mediaId));
  const ids = new Set(ahead.map((slide) => slide.dataset.mediaId));
  const tiles = [...document.querySelectorAll('#stream-feed .sauti-media-tile[data-open-media-id]')]
    .filter((tile) => ids.has(tile.dataset.openMediaId));
  markPreparedTiles(tiles);
  for (const tile of tiles) tile.dispatchEvent(new CustomEvent('sautilink:request-media-poster'));
}

function installHomeMediaReadiness() {
  const feed = document.getElementById('stream-feed');
  if (!feed || typeof IntersectionObserver !== 'function') return;
  const visible = new Map(), observed = new Set();
  let items = [], scheduled = false;
  const refresh = () => {
    scheduled = false;
    if (document.documentElement.classList.contains('sauti-short-videos-open')) return;
    const active = !document.getElementById('member-view')?.hidden && !document.getElementById('stream-surface')?.hidden
      && document.visibilityState !== 'hidden' && !document.querySelector('dialog[open]');
    const connection = globalThis.navigator?.connection;
    if (!active || connection?.saveData || ['slow-2g', '2g'].includes(connection?.effectiveType)) {
      updateSautiStreamReadiness([]); markPreparedTiles([]); return;
    }
    const viewportMiddle = (window.innerHeight || 720) / 2;
    const current = [...visible.entries()].filter(([tile, entry]) => tile.isConnected && entry.isIntersecting)
      .sort((a, b) => Math.abs(a[1].boundingClientRect.top + a[1].boundingClientRect.height / 2 - viewportMiddle)
        - Math.abs(b[1].boundingClientRect.top + b[1].boundingClientRect.height / 2 - viewportMiddle))[0]?.[0];
    const ahead = nextMediaReadinessItems(items, items.indexOf(current));
    markPreparedTiles(ahead);
    updateSautiStreamReadiness(ahead.filter((tile) => tile.dataset.mediaKind === 'video').map((tile) => tile.dataset.openMediaId));
    for (const tile of ahead) {
      // Poster/image readiness never attaches another video decoder.
      tile.dispatchEvent(new CustomEvent(tile.dataset.mediaKind === 'video' ? 'sautilink:request-media-poster' : 'sautilink:request-media-load'));
    }
  };
  const schedule = () => {
    if (!scheduled) { scheduled = true; queueMicrotask(refresh); }
  };
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) visible.set(entry.target, entry);
    schedule();
  }, { threshold: [0, 0.15, 0.5, 0.85] });
  const scan = () => {
    items = [...feed.querySelectorAll('.sauti-media-tile[data-open-media-id]')];
    const present = new Set(items);
    for (const tile of observed) if (!present.has(tile)) { observer.unobserve(tile); observed.delete(tile); visible.delete(tile); }
    for (const tile of items) if (!observed.has(tile)) { observed.add(tile); observer.observe(tile); }
    schedule();
  };
  new MutationObserver(scan).observe(feed, { childList: true, subtree: true });
  new MutationObserver(schedule).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  new MutationObserver((changes) => {
    if (changes.some((change) => change.target.tagName === 'DIALOG' || change.target === document.body)) schedule();
  }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open', 'class'] });
  for (const id of ['member-view', 'stream-surface']) {
    const surface = document.getElementById(id);
    if (surface) new MutationObserver(schedule).observe(surface, { attributes: true, attributeFilter: ['hidden'] });
  }
  document.addEventListener('visibilitychange', () => { schedule(); wakeMediaPreviewRequests(); });
  globalThis.navigator?.connection?.addEventListener?.('change', () => { schedule(); wakeMediaPreviewRequests(); });
  scan();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installHomeMediaReadiness, { once: true });
  else queueMicrotask(installHomeMediaReadiness);
}
