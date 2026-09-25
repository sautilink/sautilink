const VIDEO_QUALITY_STORAGE_KEY = 'sautilink:video-quality:v1';
const VIDEO_QUALITY_EVENT = 'sautilink:video-quality-preference';
const VIDEO_QUALITY_APPLIED_EVENT = 'sautilink:video-quality-applied';
const VIDEO_QUALITY_VALUES = Object.freeze(['auto', 'data-saver', '360', '720', 'original']);
const VIDEO_QUALITY_LEVELS = Object.freeze(['360', '720', 'original']);
const managedVideos = new Set();

export function normalizeVideoQualityPreference(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return VIDEO_QUALITY_VALUES.includes(normalized) ? normalized : 'auto';
}

export function selectAdaptiveVideoQuality(connection = {}, stallCount = 0) {
  const effectiveType = String(connection?.effectiveType || '').toLowerCase();
  const downlink = Number(connection?.downlink || 0);
  if (connection?.saveData || stallCount >= 2 || effectiveType === 'slow-2g' || effectiveType === '2g') return '360';
  if (stallCount >= 1 || effectiveType === '3g' || (downlink > 0 && downlink < 2.5)) return '360';
  if (effectiveType === '4g' && downlink >= 6) return 'original';
  if (downlink >= 6) return 'original';
  return '720';
}

export function videoQualityForPreference(preference, connection = {}, context = 'home', stallCount = 0) {
  const normalized = normalizeVideoQualityPreference(preference);
  if (context === 'short' || normalized === 'auto') {
    return selectAdaptiveVideoQuality(connection, stallCount);
  }
  if (normalized === 'data-saver') return '360';
  return normalized;
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

async function applyVideoQuality(video, state, quality) {
  if (!VIDEO_QUALITY_LEVELS.includes(quality) || state.switching || state.quality === quality) return;
  const source = sautiVideoSourceUrl(state.mediaId, quality);
  if (!source || relativeVideoUrl(video.currentSrc || video.src) === source) {
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
    if (!wasPaused && video.dataset.sautiUserPaused !== 'true') await video.play().catch(() => {});
  } catch {
    // Keep the currently playable source when a variant cannot be loaded.
  } finally {
    state.switching = false;
  }
}

function targetQuality(state) {
  state.preference = state.context === 'short' ? 'auto' : getVideoQualityPreference();
  return videoQualityForPreference(state.preference, currentConnection(), state.context, state.stalls);
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
      void applyVideoQuality(video, state, targetQuality(state));
    }, 10_000);
  };

  video.addEventListener('waiting', markStall);
  video.addEventListener('stalled', markStall);
  video.addEventListener('playing', markStable);
  video.addEventListener('pause', () => window.clearTimeout(state.stableTimer));
  void applyVideoQuality(video, state, targetQuality(state));
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const connection = currentConnection();
  connection?.addEventListener?.('change', refreshManagedVideos);
  document.addEventListener(VIDEO_QUALITY_EVENT, refreshManagedVideos);
  window.SautiLinkVideoQuality = Object.freeze({
    enhance: enhanceSautiVideoQuality,
    getPreference: getVideoQualityPreference,
    setPreference: setVideoQualityPreference,
    qualityFor({ context = 'home', stalls = 0 } = {}) {
      const preference = context === 'short' ? 'auto' : getVideoQualityPreference();
      return videoQualityForPreference(preference, currentConnection(), context, stalls);
    },
    sourceUrl: sautiVideoSourceUrl,
    values: VIDEO_QUALITY_VALUES,
  });
}
