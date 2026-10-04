import { getVideoAutoplayPreference } from './video-autoplay-preference.js';
import { VIDEO_VARIANT_QUALITIES, availableVideoQualities } from './video-quality-levels.js';

const VIDEO_QUALITY_STORAGE_KEY = 'sautilink:video-quality:v1';
const VIDEO_QUALITY_EVENT = 'sautilink:video-quality-preference';
const VIDEO_QUALITY_APPLIED_EVENT = 'sautilink:video-quality-applied';
const VIDEO_QUALITY_VALUES = Object.freeze(['auto', 'data-saver', ...VIDEO_VARIANT_QUALITIES.map(String), 'original']);
const VIDEO_QUALITY_LEVELS = Object.freeze([...VIDEO_VARIANT_QUALITIES.map(String), 'original']);
const managedVideos = new Set();
const mediaMetadata = new Map();

export function registerVideoMediaMetadata(media) {
  const id = String(media?.id || '').trim();
  if (!id || media?.media_kind !== 'video') return;
  mediaMetadata.set(id, { width: Number(media.width), height: Number(media.height), duration_ms: Number(media.duration_ms) });
  if (mediaMetadata.size > 500) mediaMetadata.delete(mediaMetadata.keys().next().value);
}

export function availableVideoQualitiesForMedia(mediaId) {
  return availableVideoQualities(mediaMetadata.get(String(mediaId || '').trim()));
}

export function resolveVideoQuality(requested, media) {
  const qualities = availableVideoQualities(media);
  if (!qualities.length || requested === 'original') return 'original';
  if (requested === 'data-saver') return String(qualities[0]);
  const target = Number(requested);
  if (!Number.isFinite(target)) return 'original';
  const shortEdge = Math.min(Number(media?.width), Number(media?.height));
  if (shortEdge <= target) return 'original';
  return String(qualities.filter((quality) => quality <= target).at(-1) ?? qualities[0]);
}

export function normalizeVideoQualityPreference(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return VIDEO_QUALITY_VALUES.includes(normalized) ? normalized : 'auto';
}

export function selectAdaptiveVideoQuality(connection = {}, stallCount = 0) {
  const effectiveType = String(connection?.effectiveType || '').toLowerCase();
  const downlink = Number(connection?.downlink || 0);
  if (connection?.saveData || stallCount >= 2 || effectiveType === 'slow-2g' || effectiveType === '2g') return '240';
  if (stallCount >= 1 || effectiveType === '3g' || (downlink > 0 && downlink < 2.5)) return '360';
  if (downlink >= 6) return '720';
  return '360';
}

export function videoQualityForPreference(preference, connection = {}, context = 'home', stallCount = 0) {
  const normalized = normalizeVideoQualityPreference(preference);
  if (context === 'short' || normalized === 'auto') {
    return selectAdaptiveVideoQuality(connection, stallCount);
  }
  if (normalized === 'data-saver') return 'data-saver';
  return normalized;
}

export function deliveredVideoQuality(requested, width, height) {
  const quality = VIDEO_QUALITY_LEVELS.includes(String(requested)) ? String(requested) : 'original';
  const shortEdge = Math.min(Number(width) || 0, Number(height) || 0);
  // A cold or failed variant can serve the original under a quality URL.
  if (quality !== 'original' && shortEdge > 0 && Math.abs(shortEdge - Number(quality)) > 2) return 'original';
  return quality;
}

function currentConnection() {
  if (typeof navigator === 'undefined') return {};
  return navigator.connection || navigator.mozConnection || navigator.webkitConnection || {};
}

export function getVideoQualityPreference() {
  if (typeof localStorage === 'undefined') return 'auto';
  try {
    return normalizeVideoQualityPreference(localStorage.getItem(VIDEO_QUALITY_STORAGE_KEY));
  } catch {
    return 'auto';
  }
}

export function setVideoQualityPreference(value) {
  const preference = normalizeVideoQualityPreference(value);
  try {
    localStorage.setItem(VIDEO_QUALITY_STORAGE_KEY, preference);
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
  document.dispatchEvent(new CustomEvent(VIDEO_QUALITY_EVENT, { detail: { preference } }));
  return preference;
}

export function sautiVideoSourceUrl(mediaId, quality = 'original') {
  const id = String(mediaId || '').trim();
  if (!id) return '';
  const url = new URL(`/api/sauti-media/${encodeURIComponent(id)}`, window.location.origin);
  const normalized = VIDEO_QUALITY_LEVELS.includes(String(quality)) ? String(quality) : 'original';
  if (normalized !== 'original') url.searchParams.set('quality', normalized);
  return `${url.pathname}${url.search}`;
}

function mediaIdForVideo(video) {
  return String(
    video?.dataset?.sautiMediaId
    || video?.closest?.('[data-open-media-id]')?.dataset?.openMediaId
    || video?.closest?.('[data-media-id]')?.dataset?.mediaId
    || '',
  ).trim();
}

function relativeVideoUrl(value) {
  try {
    const url = new URL(String(value || ''), window.location.origin);
    return `${url.pathname}${url.search}`;
  } catch {
    return String(value || '');
  }
}

function qualityRank(quality) {
  return VIDEO_QUALITY_LEVELS.indexOf(quality);
}

export function shouldSwitchVideoQuality(state, quality, currentSource, targetSource) {
  if (state.switching || !VIDEO_QUALITY_LEVELS.includes(quality)) return false;
  if (state.quality !== quality) return true;
  // An older startup URL may still be attached when a manual choice is made.
  // Replace it with the canonical URL for the selected rendition.
  return state.context === 'home'
    && state.preference !== 'auto'
    && currentSource !== targetSource;
}

async function applyVideoQuality(video, state, quality) {
  const source = sautiVideoSourceUrl(state.mediaId, quality);
  const currentSource = relativeVideoUrl(video.currentSrc || video.src);
  if (!shouldSwitchVideoQuality(state, quality, currentSource, source)) return;
  if (!source || currentSource === source) {
    state.quality = quality;
    video.dataset.sautiQuality = quality;
    return;
  }

  state.switching = true;
  const currentTime = Number(video.currentTime || 0);
  const wasPaused = video.paused;
  const playbackRate = video.playbackRate;
  const muted = video.muted;
  const volume = video.volume;

  try {
    await window.SautiLinkVideoMediaSession?.ensure?.();
    await new Promise((resolve, reject) => {
      let timer = 0;
      const finish = (error = null) => {
        window.clearTimeout(timer);
        video.removeEventListener('loadedmetadata', loaded);
        video.removeEventListener('error', failed);
        if (error) reject(error);
        else resolve();
      };
      const loaded = () => finish();
      const failed = () => finish(new Error('VIDEO_QUALITY_LOAD_FAILED'));
      video.addEventListener('loadedmetadata', loaded, { once: true });
      video.addEventListener('error', failed, { once: true });
      timer = window.setTimeout(() => finish(), 8000);
      video.src = source;
      video.load();
    });
    video.playbackRate = playbackRate;
    video.muted = muted;
    video.defaultMuted = muted;
    video.volume = volume;
    if (Number.isFinite(video.duration) && currentTime > 0) {
      video.currentTime = Math.min(currentTime, Math.max(0, video.duration - 0.05));
    }
    state.quality = quality;
    state.stalls = 0;
    video.dataset.sautiQuality = quality;
    video.dispatchEvent(new CustomEvent(VIDEO_QUALITY_APPLIED_EVENT, {
      detail: { quality, preference: state.preference, context: state.context },
    }));
    if (!wasPaused && video.dataset.sautiUserPaused !== 'true'
      && (getVideoAutoplayPreference() || video.dataset.sautiManualPlay === 'true')) {
      await video.play().catch(() => {});
    }
  } catch {
    // Keep the currently playable source when a variant cannot be loaded.
  } finally {
    state.switching = false;
  }
}

function targetQuality(state) {
  state.preference = state.context === 'short' ? 'auto' : getVideoQualityPreference();
  const requested = videoQualityForPreference(state.preference, currentConnection(), state.context, state.stalls);
  return resolveVideoQuality(requested, mediaMetadata.get(state.mediaId));
}

function refreshManagedVideos() {
  managedVideos.forEach((video) => {
    if (!video.isConnected) {
      managedVideos.delete(video);
      return;
    }
    const state = video.__sautiVideoQualityState;
    if (state) void applyVideoQuality(video, state, targetQuality(state));
  });
}

export function enhanceSautiVideoQuality(video, { context = 'home' } = {}) {
  if (!(video instanceof HTMLVideoElement) || video.dataset.sautiQualityManaged === 'true') return;
  if (!video.getAttribute('src') && !video.currentSrc) return;
  const mediaId = mediaIdForVideo(video);
  if (!mediaId) return;

  const inferred = new URL(video.currentSrc || video.src || window.location.origin, window.location.origin).searchParams.get('quality');
  const state = {
    mediaId,
    context: context === 'short' ? 'short' : 'home',
    preference: context === 'short' ? 'auto' : getVideoQualityPreference(),
    quality: VIDEO_QUALITY_LEVELS.includes(inferred) ? inferred : (video.dataset.sautiQuality || 'original'),
    stalls: 0,
    switching: false,
    stableTimer: 0,
  };
  video.__sautiVideoQualityState = state;
  video.dataset.sautiQualityManaged = 'true';
  video.dataset.sautiQualityContext = state.context;
  video.dataset.sautiQuality = state.quality;
  managedVideos.add(video);

  const markStall = () => {
    if (state.switching || (state.context !== 'short' && state.preference !== 'auto')) return;
    state.stalls = Math.min(3, state.stalls + 1);
    const target = targetQuality(state);
    if (qualityRank(target) < qualityRank(state.quality)) void applyVideoQuality(video, state, target);
  };
  const markStable = () => {
    window.clearTimeout(state.stableTimer);
    if (state.context !== 'short' && state.preference !== 'auto') return;
    state.stableTimer = window.setTimeout(() => {
      state.stalls = 0;
    }, 10_000);
  };

  video.addEventListener('waiting', markStall);
  video.addEventListener('stalled', markStall);
  video.addEventListener('playing', markStable);
  video.addEventListener('pause', () => window.clearTimeout(state.stableTimer));
  void applyVideoQuality(video, state, targetQuality(state));
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const diagnosticId = new URLSearchParams(window.location.search).get('video_probe') || '';
  if (/^[0-9a-f-]{36}$/i.test(diagnosticId)) {
    const result = document.createElement('pre');
    result.id = 'sauti-video-probe-result';
    result.textContent = 'Checking video rendition…';
    result.style.cssText = 'position:fixed;inset:1rem;z-index:2147483647;overflow:auto;background:white;color:black;padding:1rem;white-space:pre-wrap;';
    document.body.append(result);
    fetch(`/api/sauti-media/${encodeURIComponent(diagnosticId)}?quality=360&diagnose=1`, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    }).then(async (response) => {
      result.textContent = JSON.stringify({ status: response.status, body: await response.json() }, null, 2);
    }).catch((error) => { result.textContent = String(error?.message || error); });
  }
  const connection = currentConnection();
  connection?.addEventListener?.('change', refreshManagedVideos);
  document.addEventListener(VIDEO_QUALITY_EVENT, refreshManagedVideos);
  window.SautiLinkVideoQuality = Object.freeze({
    enhance: enhanceSautiVideoQuality,
    getPreference: getVideoQualityPreference,
    setPreference: setVideoQualityPreference,
    qualityFor({ context = 'home', stalls = 0, mediaId = '' } = {}) {
      const preference = context === 'short' ? 'auto' : getVideoQualityPreference();
      return resolveVideoQuality(videoQualityForPreference(preference, currentConnection(), context, stalls), mediaMetadata.get(mediaId));
    },
    registerMedia: registerVideoMediaMetadata,
    availableFor: availableVideoQualitiesForMedia,
    metadataFor: (id) => mediaMetadata.get(String(id || '').trim()) || null,
    sourceUrl: sautiVideoSourceUrl,
    deliveredQuality: deliveredVideoQuality,
    values: VIDEO_QUALITY_VALUES,
  });
}
