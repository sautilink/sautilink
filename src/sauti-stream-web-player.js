import { getVideoAutoplayPreference } from './video-autoplay-preference.js';
import { getVideoQualityPreference } from './video-quality-preference.js';
import { getActivePlaybackVideo } from './video-playback-coordinator.js';
import { createStreamReadiness, readinessLoader } from './sauti-stream-readiness.js';
import { setMediaPreviewPlaybackWaiting } from './media-preview-queue.js';

const states = new Set();
const mediaLevels = new Map();
let runtimePromise;
let readinessRuntimeAttempted = false;
const authClients = new WeakSet();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function announceReadiness(mediaId, state) {
  if (typeof document !== 'undefined' && typeof CustomEvent !== 'undefined') {
    document.dispatchEvent?.(new CustomEvent('sautilink:stream-readiness-state', { detail: { mediaId, state } }));
  }
}
const readiness = createStreamReadiness({ origin: () => window.location.origin,
  ensureSession: () => window.SautiLinkVideoMediaSession?.ensure?.(), validateDescriptor: validatedStreamDescriptor,
  onChange: announceReadiness });
let readinessIds = [];
const bufferingVideos = new Set();

function syncReadiness() {
  const connection = globalThis.navigator?.connection;
  for (const video of bufferingVideos) if (!video.isConnected || (video.paused && video.dataset.sautiPreparing !== 'true')) bufferingVideos.delete(video);
  const suspended = document.visibilityState === 'hidden' || connection?.saveData
    || ['slow-2g', '2g'].includes(connection?.effectiveType) || bufferingVideos.size > 0
    || Boolean(document.querySelector?.('dialog[open]'));
  readiness.update(readinessIds, { suspended });
  const hasWantedVideo = readinessIds.some((id) => typeof id === 'string' && UUID.test(id));
  if (!hasWantedVideo) readinessRuntimeAttempted = false;
  else if (!suspended && !readinessRuntimeAttempted && (window.MediaSource || window.ManagedMediaSource)) {
    // Overlap the pinned public code with an already requested media window.
    // This creates no player/worker and never retries on observer churn.
    readinessRuntimeAttempted = true;
    void loadHlsRuntime().catch(() => {});
  }
}

export function updateSautiStreamReadiness(ids = []) { readinessIds = ids; syncReadiness(); }
export function sautiStreamReadinessState(id) { return readiness.status(id); }
export function forgetSautiStreamReadinessState(id) { readiness.forget(id); }
export function setSautiStreamBuffering(video, waiting) {
  if (waiting) bufferingVideos.add(video); else bufferingVideos.delete(video);
  setMediaPreviewPlaybackWaiting(video, waiting);
  syncReadiness();
}

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
    let timer;
    const failed = () => { window.clearTimeout(timer); script.remove(); runtimePromise = null; reject(new Error('HLS_RUNTIME_FAILED')); };
    script.src = '/app/assets/vendor/hls-1.7.3.min.js';
    script.async = true;
    script.onload = () => { window.clearTimeout(timer); if (window.Hls) resolve(window.Hls); else failed(); };
    script.onerror = failed;
    timer = window.setTimeout(failed, 8000);
    document.head.append(script);
  });
  return runtimePromise;
}
function allowedToResume(video, wasPlaying) {
  const active = getActivePlaybackVideo();
  return wasPlaying && streamPlaybackEligible(video)
    && video.dataset.sautiUserPaused !== 'true' && (!active || active === video)
    && (getVideoAutoplayPreference() || video.dataset.sautiManualPlay === 'true');
}
export function streamPlaybackEligible(video) {
  if (!video?.isConnected || document.visibilityState === 'hidden' || video.closest?.('[hidden]')) return false;
  const dialog = video.closest?.('dialog');
  if (dialog) return dialog.open === true;
  if (document.querySelector?.('dialog[open]')) return false;
  const slide = video.closest?.('.sauti-short-video-slide');
  if (slide) return slide.classList.contains('active') && video.closest('#sauti-short-videos')?.hidden === false;
  if (video.closest?.('#stream-feed') && document.documentElement?.classList.contains('sauti-short-videos-open')) return false;
  if (document.pictureInPictureElement === video || document.fullscreenElement?.contains(video)) return true;
  const bounds = video.getBoundingClientRect?.();
  const height = window.innerHeight || document.documentElement?.clientHeight || 720;
  return !bounds || (bounds.bottom > 0 && bounds.top < height);
}
function validDescriptor(state) {
  return state.descriptor?.expiry > Date.now() + 15000 ? state.descriptor : null;
}
function notify(video) { video.dispatchEvent(new CustomEvent('sautilink:video-quality-applied')); }
function selectedPreference(video, levels = []) {
  return video.closest('#sauti-short-videos') ? 'auto' : getVideoQualityPreference({ streamLevels: levels });
}
function applyPreference(state, { preserveInitialAuto = false } = {}) {
  if (!state.hls || !state.ready) return;
  const preference = selectedPreference(state.video, hlsQualityLevels(state.hls.levels));
  const level = hlsLevelForPreference(state.hls.levels, preference);
  // Replace later buffered fragments at the next safe switch, without reloading
  // the video or interrupting its current fragment. loadLevel would wait for the
  // entire existing buffer, which can outlast a short clip.
  // Setting nextLevel=-1 on the initial manifest overrides config.startLevel
  // in the pinned SDK and turns the warmed first fragment into a bitrate test
  // instead of buffering it. Its default Auto mode already permits later ABR.
  if (!preserveInitialAuto || preference !== 'auto') state.hls.nextLevel = level;
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
  state.hls = null; state.nativeHls = false; state.ready = false;
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
  if (state.destroyed || !video.isConnected || (!force && !validDescriptor(state) && Date.now() - state.checkedAt < 20000)) return false;
  state.resolving = true; state.checkedAt = Date.now();
  const controller = new AbortController();
  state.abort = controller;
  try {
    await window.SautiLinkVideoMediaSession?.ensure?.();
    if (state.destroyed || !video.isConnected || controller.signal.aborted) return false;
    const requestOptions = { credentials: 'same-origin', cache: 'no-store', redirect: 'error',
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]) };
    const warmedDescriptor = force ? null : readiness.descriptor(state.mediaId);
    // A cancelled offscreen preflight can retain another valid grant without
    // ever attaching a controller. Prefer the already warmed grant for this
    // new attach so its exact signed playlists/fragments remain reusable.
    // Live controllers keep their existing grant; forced renewal stays fresh.
    let descriptor = force ? null : ((!state.hls && !state.nativeHls && warmedDescriptor)
      || validDescriptor(state) || warmedDescriptor);
    if (!descriptor) {
      const descriptorUrl = `/api/sauti-media/${state.mediaId}/playback`;
      let response = await fetch(descriptorUrl, requestOptions);
      if (response.status === 401 && typeof window.SautiLinkVideoMediaSession?.ensure === 'function'
        && !state.destroyed && video.isConnected && !requestOptions.signal.aborted) {
        await response.body?.cancel().catch(() => {});
        // The HttpOnly cookie can expire before a later-created playback grant.
        // Recreate it through the existing authenticated endpoint, then retry the
        // normal authorization lookup once. A second denial stays denied.
        await window.SautiLinkVideoMediaSession.ensure({ force: true });
        if (state.destroyed || !video.isConnected || requestOptions.signal.aborted) return false;
        response = await fetch(descriptorUrl, requestOptions);
      }
      if (!response.ok || state.destroyed) return false;
      const json = await response.json();
      descriptor = validatedStreamDescriptor(json?.ok === true ? json.data : null, state.mediaId, window.location.origin);
    }
    if (!descriptor || descriptor.type !== 'hls' || state.destroyed || !video.isConnected) return false;
    state.descriptor = descriptor;
    // A descriptor may finish after a swipe or navigation. Keep only its
    // original short-lived grant; do not start an offscreen SDK/segment load.
    if (!streamPlaybackEligible(video)) return false;
    const nativeOnly = video.canPlayType('application/vnd.apple.mpegurl')
      && !window.MediaSource && !window.ManagedMediaSource;
    const Hls = nativeOnly ? null : await loadHlsRuntime();
    if (state.destroyed || controller.signal.aborted || !streamPlaybackEligible(video)) return false;
    const position = Number(video.currentTime) || 0;
    const wasPlaying = !video.paused;
    const rate = video.playbackRate;
    state.position = position; state.wasPlaying = wasPlaying;
    state.expiresAt = descriptor.expiry;
    video.dataset.sautiStreamManaged = 'true';
    restorePlayback(state, position, wasPlaying, rate);
    if (Hls?.isSupported()) {
      const previous = state.hls;
      const initialAuto = selectedPreference(video) === 'auto';
      const preserveInitialAuto = !force && !previous && !state.nativeHls && initialAuto;
      const hls = new Hls({ enableWorker: true, workerPath: '/app/assets/vendor/hls.worker-1.7.3.js',
        autoStartLoad: false, capLevelToPlayerSize: true,
        maxBufferLength: 20, maxMaxBufferLength: 40, backBufferLength: 60, maxBufferSize: 24 * 1024 * 1024,
        // Preserve the buffered loop beginning when Auto upgrades a later
        // fragment; ordinary sixty-second/byte eviction still bounds memory.
        ...(video.loop ? { loopBackBufferFlush: false } : {}),
        ...(initialAuto ? { startLevel: 0 } : {}),
        ...(Hls.DefaultConfig?.loader ? { loader: readinessLoader(Hls.DefaultConfig.loader, readiness, state.mediaId) } : {}),
        startPosition: position, xhrSetup(xhr, requestUrl) {
          const target = new URL(requestUrl, window.location.origin);
          if (target.origin !== window.location.origin || !target.pathname.startsWith(`/api/sauti-media/${state.mediaId}/hls/`)) throw new Error('HLS_ORIGIN_REJECTED');
          xhr.withCredentials = true;
        } });
      state.hls = hls;
      state.nativeHls = false;
      state.refreshAttempted = false;
      state.lastFatal = null;
      previous?.destroy();
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (state.hls !== hls || state.destroyed) return;
        state.ready = true;
        mediaLevels.set(state.mediaId, hlsQualityLevels(hls.levels));
        applyPreference(state, { preserveInitialAuto });
        if (!streamPlaybackEligible(video)) hls.stopLoad();
        else if (allowedToResume(video, wasPlaying)) { hls.startLoad(position); void video.play().catch(() => {}); }
        else {
          state.firstFrameOnly = video.paused;
          hls.startLoad(position);
        }
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, (_event, detail) => {
        if (state.destroyed || state.hls !== hls) return;
        const current = hls.levels[detail.level];
        state.actualQuality = Math.min(Number(current?.width), Number(current?.height)) || 0;
        notify(video);
      });
      hls.on(Hls.Events.FRAG_BUFFERED, (_event, detail) => {
        if (state.destroyed || state.hls !== hls) return;
        // An attach or manifest alone does not prove protected fragment access.
        // Preserve the one-shot recovery budget across failed replacements.
        state.authorizationRecoveryUsed = false;
        if (state.firstFrameOnly && video.paused && detail?.frag?.type === 'main') {
          state.firstFrameOnly = false; hls.stopLoad();
        }
      });
      hls.on(Hls.Events.ERROR, (_event, detail) => {
        if (!detail.fatal || state.destroyed || state.hls !== hls) return;
        reportFatal(state, hls, detail);
        if (state.fatalRecovery?.hls === hls) return;
        const rejectedSession = Number(detail.response?.code ?? detail.networkDetails?.status) === 401;
        // Token renewal stays bounded; processing/provider outages keep MP4 usable.
        if (!state.refreshAttempted && (!rejectedSession || !state.authorizationRecoveryUsed)
          && (rejectedSession || state.resolving || Date.now() >= state.expiresAt - 15000)) {
          state.refreshAttempted = true;
          if (rejectedSession) state.authorizationRecoveryUsed = true;
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
      video.src = descriptor.url; video.load(); state.ready = true; state.nativeHls = true;
    } else fallback(state);
    window.clearTimeout(state.renewTimer);
    state.renewTimer = window.setTimeout(() => {
      if (!state.destroyed && !video.paused && document.visibilityState !== 'hidden') void resolvePlayback(state, true);
    }, Math.max(1000, descriptor.expiry - Date.now() - 30000));
    return video.dataset.sautiStreamManaged === 'true';
  } catch { return false; /* Existing MP4 delivery remains available while Stream is processing. */ }
  finally {
    // Leaving a clip cancels preparation, rather than recording a failed
    // provider. An immediate return may retry normally instead of waiting for
    // the error backoff and starting its original MP4 in the meantime.
    if (controller.signal.aborted && !state.destroyed) state.checkedAt = 0;
    if (state.abort === controller) state.abort = null;
    state.resolving = false;
    if (!state.destroyed && streamPlaybackEligible(video) && video.dataset.sautiStreamManaged !== 'true') {
      video.dispatchEvent(new CustomEvent('sautilink:stream-availability'));
    }
  }
}

export function enhanceSautiStreamPlayback(video) {
  if (!(video instanceof HTMLVideoElement) || video.__sautiStreamState || video.dataset.sautiBlobFallback === 'true') return;
  const mediaId = String(video.dataset.sautiMediaId || video.closest('[data-open-media-id]')?.dataset.openMediaId || video.closest('[data-media-id]')?.dataset.mediaId || '');
  if (!UUID.test(mediaId)) return;
  const state = { video, mediaId, hls: null, ready: false, checkedAt: 0, resolving: false, destroyed: false, renewTimer: 0 };
  video.__sautiStreamState = state; states.add(state);
  // A warmed record may precede the actual Home/Shorts element. Publish only
  // its sanitized counters when that newly attached element becomes observable.
  announceReadiness(mediaId, readiness.status(mediaId));
  state.onPlay = () => {
    if (!streamPlaybackEligible(video)) { video.pause(); return; }
    state.firstFrameOnly = false;
    if ((state.hls || state.nativeHls) && state.expiresAt > Date.now() + 30000) {
      // startLoad restarts the pinned SDK's active fragment/init/transmux work.
      // Manifest preparation may already be loading when native play fires.
      if (state.hls?.loadingEnabled !== true) state.hls?.startLoad(-1);
    }
    else void resolvePlayback(state, Boolean(state.hls || state.nativeHls));
  };
  state.onPause = () => {
    state.hls?.stopLoad();
    if (!state.hls) state.abort?.abort();
  };
  video.addEventListener('play', state.onPlay);
  video.addEventListener('pause', state.onPause);
  if (!video.paused) void resolvePlayback(state);
}

/** Resolve/attach adaptive playback before a caller starts the legacy MP4.
 * Replays retain their live controller and original grant, never extending it. */
export async function prepareSautiStreamPlayback(video) {
  enhanceSautiStreamPlayback(video);
  const state = video?.__sautiStreamState;
  if (!state || state.destroyed || !streamPlaybackEligible(video)) return false;
  if ((state.hls || state.nativeHls) && state.expiresAt > Date.now() + 30000) return true;
  state.prepareConsumers = (state.prepareConsumers || 0) + 1;
  video.dataset.sautiPreparing = 'true';
  video.dispatchEvent(new CustomEvent('sautilink:video-preparing', { detail: { active: true } }));
  let timer;
  try {
    return await Promise.race([resolvePlayback(state, Boolean(state.hls || state.nativeHls)), new Promise((resolve) => {
      timer = window.setTimeout(() => { state.abort?.abort(); resolve(false); }, 8000);
    })]);
  } finally {
    window.clearTimeout(timer);
    state.prepareConsumers--;
    if (video.__sautiStreamState === state && state.prepareConsumers === 0) {
      delete video.dataset.sautiPreparing;
      video.dispatchEvent(new CustomEvent('sautilink:video-preparing', { detail: { active: false } }));
    }
  }
}

export function streamQualityState(video) {
  const state = video?.__sautiStreamState;
  return video?.dataset.sautiStreamManaged === 'true' ? { levels: mediaLevels.get(state?.mediaId) || [],
    preference: state?.preference || selectedPreference(video), actual: state?.actualQuality || 0 } : null;
}
function destroyState(state, { clearMedia = false } = {}) {
  if (state.destroyed) return;
  state.destroyed = true; state.abort?.abort(); state.hls?.destroy(); state.video.pause();
  bufferingVideos.delete(state.video);
  setMediaPreviewPlaybackWaiting(state.video, false);
  for (const node of [state.video, state.video.closest?.('.sauti-media-tile'), state.video.closest?.('.sauti-short-video-slide')]) {
    for (const key of Object.keys(node?.dataset || {})) if (key.startsWith('sautiWarm')) delete node.dataset[key];
  }
  syncReadiness();
  if (state.restoreListener) state.video.removeEventListener('loadedmetadata', state.restoreListener);
  state.restoreListener = null;
  state.restoreIntent = null;
  state.descriptor = null;
  delete state.video.dataset.sautiPreparing;
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
    if (event === 'INITIAL_SESSION' || event === 'SIGNED_OUT' || changed) {
      for (const video of bufferingVideos) setMediaPreviewPlaybackWaiting(video, false);
      readiness.clear(); readinessIds = []; bufferingVideos.clear(); readinessRuntimeAttempted = false;
      if (event !== 'INITIAL_SESSION') states.forEach((state) => destroyState(state, { clearMedia: true }));
    }
    identity = next;
    if (event === 'TOKEN_REFRESHED' && !changed) states.forEach((state) => {
      state.checkedAt = 0; state.expiresAt = 0;
      if (!state.video.paused) void resolvePlayback(state, true);
    });
  });
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.SautiLinkStreamPlayback = Object.freeze({ prepare: prepareSautiStreamPlayback,
    enhance: enhanceSautiStreamPlayback, eligible: streamPlaybackEligible });
  document.addEventListener('sautilink:video-quality-preference', () => states.forEach(applyPreference));
  document.addEventListener('visibilitychange', () => {
    syncReadiness();
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
  globalThis.navigator?.connection?.addEventListener?.('change', syncReadiness);
}
