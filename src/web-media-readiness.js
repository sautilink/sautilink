import { updateSautiStreamReadiness, sautiStreamReadinessState, forgetSautiStreamReadinessState } from './sauti-stream-web-player.js';
import { STREAM_READINESS_AHEAD } from './sauti-stream-readiness.js';
import { wakeMediaPreviewRequests } from './media-preview-queue.js';

let preparedTiles = new Set();
const WARM_ATTRIBUTES = ['sautiWarmState', 'sautiWarmReason', 'sautiWarmHttp', 'sautiWarmBytes', 'sautiWarmResources',
  'sautiWarmRetry', 'sautiWarmElapsedMs', 'sautiWarmHits', 'sautiWarmMisses'];
const WARM_STATES = new Set(['idle', 'warming', 'partial', 'ready', 'backoff', 'failed', 'suspended', 'expired']);
const WARM_REASONS = new Set(['none', 'suspended', 'window', 'expired', 'cancelled', 'network', 'timeout', 'http',
  'auth-denied', 'processing', 'clip-budget', 'metadata-budget', 'invalid-descriptor', 'invalid-playlist',
  'byte-range', 'encrypted', 'non-vod', 'unsafe-playlist', 'nested-playlist']);
export function applyStreamReadinessDiagnostics(node, state) {
  if (!node?.dataset) return;
  if (!state) { for (const key of WARM_ATTRIBUTES) if (key in node.dataset) delete node.dataset[key]; return; }
  const number = (value, maximum) => String(Math.max(0, Math.min(maximum, Math.floor(Number(value) || 0))));
  const values = [WARM_STATES.has(state.state) ? state.state : 'idle', WARM_REASONS.has(state.reason) ? state.reason : 'none',
    number(state.http, 599), number(state.bytes, 2 * 1024 * 1024), number(state.resources, 16), number(state.retry, 1),
    number(state.elapsedMs, 3600000), number(state.hits, 1000000), number(state.misses, 1000000)];
  WARM_ATTRIBUTES.forEach((key, index) => { if (node.dataset[key] !== values[index]) node.dataset[key] = values[index]; });
}
function diagnoseTile(tile, state = undefined) {
  const id = tile?.dataset?.openMediaId || tile?.dataset?.mediaId || tile?.dataset?.sautiMediaId;
  if (!id) return;
  const value = state === undefined ? sautiStreamReadinessState(id) : state;
  applyStreamReadinessDiagnostics(tile, value);
  for (const video of tile.querySelectorAll?.('video') || []) applyStreamReadinessDiagnostics(video, value);
}
function readinessChanged(event) {
  const { mediaId, state } = event.detail || {};
  // Compare existing IDs rather than interpolating any event payload in CSS.
  for (const tile of document.querySelectorAll('.sauti-media-tile[data-open-media-id], .sauti-short-video-slide[data-media-id]')) {
    if ((tile.dataset.openMediaId || tile.dataset.mediaId) === mediaId) diagnoseTile(tile, state);
  }
}
function markPreparedTiles(tiles) {
  const next = new Set(tiles);
  for (const tile of preparedTiles) if (!next.has(tile)) delete tile.dataset.sautiReadiness;
  for (const tile of next) {
    if (!preparedTiles.has(tile)) tile.dataset.sautiReadiness = 'true';
    diagnoseTile(tile);
  }
  preparedTiles = next;
  wakeMediaPreviewRequests();
}

const MEDIA_TILE_SELECTOR = '.sauti-media-tile[data-open-media-id]';
function changesMediaTiles(changes) {
  // Player clocks, seek bars and loading controls update inside this subtree.
  // Re-index the feed only when an actual media tile was inserted or removed.
  return changes.some((change) => [...change.addedNodes, ...change.removedNodes].some((node) =>
    node.nodeType === 1 && (node.matches(MEDIA_TILE_SELECTOR) || node.querySelector(MEDIA_TILE_SELECTOR))));
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
    items = [...feed.querySelectorAll(MEDIA_TILE_SELECTOR)];
    const present = new Set(items);
    for (const tile of observed) if (!present.has(tile)) {
      observer.unobserve(tile); observed.delete(tile); visible.delete(tile);
      diagnoseTile(tile, null);
      if (tile.dataset.openMediaId) forgetSautiStreamReadinessState(tile.dataset.openMediaId);
    }
    for (const tile of items) if (!observed.has(tile)) { observed.add(tile); observer.observe(tile); diagnoseTile(tile); }
    schedule();
  };
  new MutationObserver((changes) => { if (changesMediaTiles(changes)) scan(); })
    .observe(feed, { childList: true, subtree: true });
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
  document.addEventListener('sautilink:stream-readiness-state', readinessChanged);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installHomeMediaReadiness, { once: true });
  else queueMicrotask(installHomeMediaReadiness);
}
