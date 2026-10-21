import { getVideoAutoplayPreference } from './video-autoplay-preference.js';
import { getVideoQualityPreference } from './video-quality-preference.js';
import { getActivePlaybackVideo } from './video-playback-coordinator.js';

const states = new Set();
const mediaLevels = new Map();
let runtimePromise;
const authClients = new WeakSet();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function validatedStreamDescriptor(value, mediaId, origin, now = Date.now()) {
  if (!UUID.test(mediaId) || !value || !['hls', 'mp4'].includes(value.type)) return null;
  try {
    const url = new URL(value.url, origin);
    const expiry = new Date(value.expires_at).getTime();
    if (url.origin !== origin || url.username || url.password || url.hash || url.protocol !== 'https:'
      || !Number.isFinite(expiry) || expiry <= now || expiry > now + 305000
      || !Number.isInteger(value.expires_in) || value.expires_in < 1 || value.expires_in > 300) return null;
    if (value.type === 'hls') {
      if (!new RegExp(`^/api/sauti-media/${mediaId}/hls/[A-Za-z0-9_-]{1,4096}$`).test(url.pathname)
        || url.searchParams.getAll('c').length !== 1 || [...url.searchParams.keys()].some((key) => key !== 'c')
        || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('c'))) return null;
    } else if (url.pathname !== `/api/sauti-media/${mediaId}` || url.search) return null;
    return { ...value, url: url.href, expiry };
  } catch { return null; }
}

export function hlsQualityLevels(levels) {
  return [...new Set((levels || []).map((level) => Math.min(Number(level.width), Number(level.height)))
    .filter((edge) => Number.isFinite(edge) && edge > 0 && edge <= 8192))].sort((a, b) => a - b);
}

export function hlsLevelForPreference(levels, preference) {
  if (preference === 'auto') return -1;
  const valid = (levels || []).map((level, index) => ({ index, edge: Math.min(Number(level.width), Number(level.height)), bitrate: Number(level.bitrate) || 0 }))
    .filter((level) => level.edge > 0).sort((a, b) => a.edge - b.edge || a.bitrate - b.bitrate);
  if (!valid.length) return -1;
  if (preference === 'original') return valid.at(-1).index;
  if (preference === 'data-saver') return valid[0].index;
  const target = Number(preference);
  return Number.isFinite(target) ? (valid.filter((level) => level.edge <= target).at(-1) || valid[0]).index : -1;
}

function loadHlsRuntime() {
  if (window.Hls) return Promise.resolve(window.Hls);
  if (!runtimePromise) runtimePromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/app/assets/vendor/hls-1.7.3.min.js';
    script.async = true;
    script.onload = () => window.Hls ? resolve(window.Hls) : reject(new Error('HLS_RUNTIME_MISSING'));
    script.onerror = () => { script.remove(); runtimePromise = null; reject(new Error('HLS_RUNTIME_FAILED')); };
    document.head.append(script);
  });
  return runtimePromise;
}
function allowedToResume(video, wasPlaying) {
  const active = getActivePlaybackVideo();
  return wasPlaying && video.isConnected && document.visibilityState !== 'hidden'
    && video.dataset.sautiUserPaused !== 'true' && (!active || active === video)
    && (getVideoAutoplayPreference() || video.dataset.sautiManualPlay === 'true');
}
function notify(video) { video.dispatchEvent(new CustomEvent('sautilink:video-quality-applied')); }
function selectedPreference(video, levels = []) {
  return video.closest('#sauti-short-videos') ? 'auto' : getVideoQualityPreference({ streamLevels: levels });
}
function applyPreference(state) {
  if (!state.hls || !state.ready) return;
  const preference = selectedPreference(state.video, hlsQualityLevels(state.hls.levels));
  const level = hlsLevelForPreference(state.hls.levels, preference);
  // Replace later buffered fragments at the next safe switch, without reloading
  // the video or interrupting its current fragment. loadLevel would wait for the
  // entire existing buffer, which can outlast a short clip.
  state.hls.nextLevel = level;
  state.preference = preference;
  notify(state.video);
}
function restorePlayback(state, position, wasPlaying, rate) {
  const video = state.video;
  if (state.restoreListener) video.removeEventListener('loadedmetadata', state.restoreListener);
  const restore = () => {
    if (state.restoreListener !== restore) return;
    state.restoreListener = null;
    state.restoreIntent = null;
    if (state.destroyed || video.__sautiStreamState !== state || !video.isConnected) return;
    video.playbackRate = rate;
    if (position > 0 && Number.isFinite(video.duration)) video.currentTime = Math.min(position, Math.max(0, video.duration - 0.05));
    if (allowedToResume(video, wasPlaying)) void video.play().catch(() => {});
  };
  state.restoreListener = restore;
  state.restoreIntent = { position, wasPlaying };
  video.addEventListener('loadedmetadata', restore, { once: true });
}
function fallback(state) {
  const video = state.video;
  const measured = Number(video.currentTime);
  const pending = state.restoreListener ? state.restoreIntent : null;
  const position = measured === 0 && pending ? pending.position
    : Number.isFinite(measured) && measured >= 0 ? measured : state.position || 0;
  // A previous attach's play state is not current user intent. In particular,
  // an explicit pause/seek-to-zero must survive a later provider failure.
  // An attach may have reset currentTime/paused before its metadata event. Only
  // that still-pending restoration can retain intent; a completed attach cannot.
  const wasPlaying = !video.paused || Boolean(pending?.wasPlaying);
  const rate = video.playbackRate;
  const previous = state.hls;
  state.hls = null; state.ready = false;
  previous?.destroy();
  delete video.dataset.sautiStreamManaged;
  mediaLevels.delete(state.mediaId);
  restorePlayback(state, position, wasPlaying, rate);
  video.src = `/api/sauti-media/${state.mediaId}`;
  video.load();
  notify(video);
}

const FATAL_TYPES = new Set(['networkError', 'mediaError', 'keySystemError', 'muxError', 'otherError']);
const FATAL_DETAILS = new Set(['manifestLoadError', 'manifestLoadTimeOut', 'manifestParsingError',
  'manifestIncompatibleCodecsError', 'levelEmptyError', 'levelLoadError', 'levelLoadTimeOut', 'levelParsingError',
  'levelSwitchError', 'audioTrackLoadError', 'audioTrackLoadTimeOut', 'subtitleTrackLoadError',
  'subtitleTrackLoadTimeOut', 'fragLoadError', 'fragLoadTimeOut', 'fragDecryptError', 'fragParsingError',
  'fragGap', 'keyLoadError', 'keyLoadTimeOut', 'bufferAppendError', 'bufferAddingCodecError',
  'bufferStalledError', 'bufferFullError', 'bufferSeekOverHole', 'bufferNudgeOnStall', 'internalException', 'remuxAllocError']);
function reportFatal(state, hls, detail) {
  const type = FATAL_TYPES.has(detail.type) ? detail.type : 'unknown';
  const details = FATAL_DETAILS.has(detail.details) ? detail.details : 'unknown';
  const responseStatus = Number(detail.response?.code ?? detail.networkDetails?.status);
  const status = Number.isInteger(responseStatus) && responseStatus >= 100 && responseStatus <= 599 ? responseStatus : 0;
  const signature = `${type}:${details}:${status}`;
  if (state.lastFatal?.hls === hls && state.lastFatal.signature === signature) return;
  state.lastFatal = { hls, signature };
  // Never log the SDK error object: it may contain a signed URL, response body,
  // request headers or a provider token. These fields are enums/status only.
  console.warn(`[SautiLink video] HLS fatal ${JSON.stringify({ type, details, status })}`);
}

function resolvePlayback(state, force = false) {
  // A fatal old fragment may arrive while the timer/session already renews its
  // descriptor. Join that exact request instead of starting another or falling
  // back before its successful replacement can commit.
  if (state.resolving) return state.resolvePromise || Promise.resolve(false);
  const pending = resolvePlaybackAttempt(state, force);
  state.resolvePromise = pending;
  const settled = () => { if (state.resolvePromise === pending) state.resolvePromise = null; };
  void pending.then(settled, settled);
  return pending;
}
async function resolvePlaybackAttempt(state, force = false) {
  const video = state.video;
  if (state.destroyed || !video.isConnected || (!force && Date.now() - state.checkedAt < 20000)) return false;
  state.resolving = true; state.checkedAt = Date.now();
  const controller = new AbortController();
  state.abort = controller;
  try {
    await window.SautiLinkVideoMediaSession?.ensure?.();
    const response = await fetch(`/api/sauti-media/${state.mediaId}/playback`, { credentials: 'same-origin', cache: 'no-store',
      redirect: 'error', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]) });
    if (!response.ok || state.destroyed) return false;
    const json = await response.json();
    const descriptor = validatedStreamDescriptor(json?.ok === true ? json.data : null, state.mediaId, window.location.origin);
    if (!descriptor || descriptor.type !== 'hls' || state.destroyed || !video.isConnected) return false;
    const Hls = await loadHlsRuntime();
    if (state.destroyed || !video.isConnected) return false;
    const position = Number(video.currentTime) || 0;
    const wasPlaying = !video.paused;
    const rate = video.playbackRate;
    state.position = position; state.wasPlaying = wasPlaying;
    state.expiresAt = descriptor.expiry;
    video.dataset.sautiStreamManaged = 'true';
    restorePlayback(state, position, wasPlaying, rate);
    if (Hls.isSupported()) {
      const previous = state.hls;
      const hls = new Hls({ enableWorker: false, autoStartLoad: false, capLevelToPlayerSize: true,
        maxBufferLength: 20, maxMaxBufferLength: 40, backBufferLength: 20, maxBufferSize: 24 * 1024 * 1024,
        startPosition: position, xhrSetup(xhr, requestUrl) {
          const target = new URL(requestUrl, window.location.origin);
          if (target.origin !== window.location.origin || !target.pathname.startsWith(`/api/sauti-media/${state.mediaId}/hls/`)) throw new Error('HLS_ORIGIN_REJECTED');
          xhr.withCredentials = true;
        } });
      state.hls = hls;
      state.refreshAttempted = false;
      state.lastFatal = null;
      previous?.destroy();
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (state.hls !== hls || state.destroyed) return;
        state.ready = true;
        mediaLevels.set(state.mediaId, hlsQualityLevels(hls.levels));
        applyPreference(state);
        if (!video.isConnected || document.visibilityState === 'hidden') hls.stopLoad();
        else if (allowedToResume(video, wasPlaying)) { hls.startLoad(position); void video.play().catch(() => {}); }
        else hls.startLoad(position); // Load the first frame for a manually paused player.
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, (_event, detail) => {
        if (state.destroyed || state.hls !== hls) return;
        const current = hls.levels[detail.level];
        state.actualQuality = Math.min(Number(current?.width), Number(current?.height)) || 0;
        notify(video);
      });
      hls.on(Hls.Events.ERROR, (_event, detail) => {
        if (!detail.fatal || state.destroyed || state.hls !== hls) return;
        reportFatal(state, hls, detail);
        if (state.fatalRecovery?.hls === hls) return;
        // Token renewal stays bounded; processing/provider outages keep MP4 usable.
        if (!state.refreshAttempted && (state.resolving || Date.now() >= state.expiresAt - 15000)) {
          state.refreshAttempted = true;
          const pending = resolvePlayback(state, true);
          const recovery = { hls, pending };
          state.fatalRecovery = recovery;
          const complete = () => {
            if (state.fatalRecovery === recovery) state.fatalRecovery = null;
            // A successful unrelated/in-flight attempt must actually replace
            // this failed controller before it counts as recovery.
            if (!state.destroyed && state.hls === hls) fallback(state);
          };
          void pending.then(complete, complete);
        } else fallback(state);
      });
      hls.loadSource(descriptor.url);
      hls.attachMedia(video);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = descriptor.url; video.load(); state.ready = true;
    } else fallback(state);
    window.clearTimeout(state.renewTimer);
    state.renewTimer = window.setTimeout(() => {
      if (!state.destroyed && !video.paused && document.visibilityState !== 'hidden') void resolvePlayback(state, true);
    }, Math.max(1000, descriptor.expiry - Date.now() - 30000));
    return video.dataset.sautiStreamManaged === 'true';
  } catch { return false; /* Existing MP4 delivery remains available while Stream is processing. */ }
  finally { if (state.abort === controller) state.abort = null; state.resolving = false; }
}

export function enhanceSautiStreamPlayback(video) {
  if (!(video instanceof HTMLVideoElement) || video.__sautiStreamState || video.dataset.sautiBlobFallback === 'true') return;
  const mediaId = String(video.dataset.sautiMediaId || video.closest('[data-open-media-id]')?.dataset.openMediaId || video.closest('[data-media-id]')?.dataset.mediaId || '');
  if (!UUID.test(mediaId)) return;
  const state = { video, mediaId, hls: null, ready: false, checkedAt: 0, resolving: false, destroyed: false, renewTimer: 0 };
  video.__sautiStreamState = state; states.add(state);
  state.onPlay = () => {
    if (state.hls && state.expiresAt > Date.now() + 30000) state.hls.startLoad(-1);
    else void resolvePlayback(state, Boolean(state.hls));
  };
  state.onPause = () => state.hls?.stopLoad();
  video.addEventListener('play', state.onPlay);
  video.addEventListener('pause', state.onPause);
  if (!video.paused) void resolvePlayback(state);
}

export function streamQualityState(video) {
  const state = video?.__sautiStreamState;
  return video?.dataset.sautiStreamManaged === 'true' ? { levels: mediaLevels.get(state?.mediaId) || [],
    preference: state?.preference || selectedPreference(video), actual: state?.actualQuality || 0 } : null;
}
function destroyState(state, { clearMedia = false } = {}) {
  if (state.destroyed) return;
  state.destroyed = true; state.abort?.abort(); state.hls?.destroy(); state.video.pause();
  if (state.restoreListener) state.video.removeEventListener('loadedmetadata', state.restoreListener);
  state.restoreListener = null;
  state.restoreIntent = null;
  state.video.removeEventListener('play', state.onPlay);
  state.video.removeEventListener('pause', state.onPause);
  window.clearTimeout(state.renewTimer); mediaLevels.delete(state.mediaId); states.delete(state);
  delete state.video.dataset.sautiStreamManaged;
  if (state.video.__sautiStreamState === state) delete state.video.__sautiStreamState;
  if (clearMedia) {
    // No decoded frames, poster or source from the previous account is retained.
    state.video.removeAttribute('src'); state.video.removeAttribute('poster'); state.video.load();
  }
}

function authIdentity(session) {
  const user = String(session?.user?.id || '');
  if (!UUID.test(user)) return null;
  let sessionId = '';
  try {
    const payload = String(session.access_token || '').split('.')[1];
    const claims = JSON.parse(atob(payload.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - payload.length % 4) % 4)));
    if (UUID.test(String(claims.session_id || ''))) sessionId = claims.session_id;
  } catch { /* Client identity tracking never grants server authorization. */ }
  return `${user}:${sessionId}`;
}

/** Supabase also emits SIGNED_IN on focus for an unchanged authenticated session. */
export function installSautiStreamAuthLifecycle(client) {
  if (!client?.auth?.onAuthStateChange || authClients.has(client)) return;
  authClients.add(client);
  let identity;
  return client.auth.onAuthStateChange((event, session) => {
    if (!['INITIAL_SESSION', 'SIGNED_IN', 'SIGNED_OUT', 'TOKEN_REFRESHED'].includes(event)) return;
    const next = event === 'SIGNED_OUT' ? null : authIdentity(session);
    const changed = identity !== undefined && identity !== next;
    if (event === 'SIGNED_OUT' || changed) states.forEach((state) => destroyState(state, { clearMedia: true }));
    identity = next;
    if (event === 'TOKEN_REFRESHED' && !changed) states.forEach((state) => {
      state.checkedAt = 0; state.expiresAt = 0;
      if (!state.video.paused) void resolvePlayback(state, true);
    });
  });
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  document.addEventListener('sautilink:video-quality-preference', () => states.forEach(applyPreference));
  document.addEventListener('visibilitychange', () => {
    states.forEach((state) => {
      if (!state.video.isConnected) destroyState(state);
      else if (document.visibilityState === 'hidden') state.hls?.stopLoad();
      else if (!state.video.paused) {
        if (state.expiresAt > Date.now() + 30000) state.hls?.startLoad(-1);
        else void resolvePlayback(state, true);
      }
    });
  });
  const observer = new MutationObserver(() => states.forEach((state) => { if (!state.video.isConnected) destroyState(state); }));
  observer.observe(document.documentElement, { childList: true, subtree: true });
  installSautiStreamAuthLifecycle(window.__sautilinkSupabaseAuthClient);
  window.addEventListener('sautilink:auth-client-ready', (event) => installSautiStreamAuthLifecycle(event.detail), { once: true });
}
