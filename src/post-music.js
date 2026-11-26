import { audioClipUrl } from './social-presentation.js';
import { getActivePlaybackVideo } from './video-playback-coordinator.js';
let settings = null, audio = null, active = null, generation = 0, observer = null, commentsOpen = false;
const records = new Map();
const ratios = new Map();

function stop() {
  generation++; audio?.pause();
  if (audio) { audio.removeAttribute('src'); audio.load(); }
  audio = null; active = null;
}
function allowed(record) {
  const gallery = record.card.querySelector('.sauti-media-gallery');
  if (gallery?.classList.contains('loading')) return false;
  if (gallery) {
    const tiles = [...gallery.children].filter(node => node.classList.contains('sauti-media-tile'));
    const index = gallery.classList.contains('is-carousel') && gallery.clientWidth ? Math.round(gallery.scrollLeft / gallery.clientWidth) : 0;
    const selected = tiles[index];
    if (selected?.dataset.mediaKind === 'video' && !selected.querySelector('video')) return false;
  }
  return record.card.isConnected && !document.hidden && !commentsOpen && !record.card.closest('[hidden]')
    && !record.card.closest('dialog:not([open])') && !document.querySelector('dialog[open]')
    && (ratios.get(record.card) || 0) >= .52;
}
function sourceVideo(record) {
  const gallery = record.card.querySelector('.sauti-media-gallery.is-carousel');
  if (gallery?.clientWidth) {
    const tiles = [...gallery.children].filter(node => node.classList.contains('sauti-media-tile'));
    const index = Math.max(0, Math.min(tiles.length - 1, Math.round(gallery.scrollLeft / gallery.clientWidth)));
    return tiles[index]?.querySelector('video') || null;
  }
  const playing = getActivePlaybackVideo();
  return playing && record.card.contains(playing) ? playing : record.card.querySelector('video');
}
function needsGesture(record) {
  if (active !== record) return;
  record.button.dataset.needsPlay = 'true';
  if (record.muteButton) { record.muteButton.textContent = '▶'; record.muteButton.setAttribute('aria-label', 'Play sound'); }
}
function soundStarted(record) {
  if (active !== record) return;
  delete record.button.dataset.needsPlay;
  if (!record.muteButton) return;
  const muted = sourceVideo(record)?.muted ?? record.muted;
  record.muteButton.textContent = muted ? '♫̸' : '♪';
  record.muteButton.setAttribute('aria-label', muted ? 'Unmute music' : 'Mute music');
  record.muteButton.setAttribute('aria-pressed', String(muted));
}
function afterVideoFrame(record, callback) {
  const video = sourceVideo(record), epoch = (record.frameEpoch || 0) + 1;
  record.frameEpoch = epoch; record.presented = false;
  const ready = () => {
    if (record !== active || epoch !== record.frameEpoch || !allowed(record) || video.paused || video.seeking) return;
    record.presented = true; callback();
  };
  if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(ready); else requestAnimationFrame(ready);
}
function syncVideo(record, force = false) {
  const video = sourceVideo(record);
  if (record !== active || !audio || !video) return;
  if (!record.presented || !allowed(record) || video.paused || video.seeking || video.readyState < 2) { audio.pause(); return; }
  const duration = record.selection.durationMs / 1000;
  const position = Math.max(0, video.currentTime % duration);
  if (Number.isFinite(audio.duration) && (force || Math.abs(audio.currentTime - position) > .22)) audio.currentTime = Math.min(position, Math.max(0, audio.duration - .01));
  audio.volume = record.selection.musicVolume ?? 1; audio.muted = video.muted;
  audio.playbackRate = video.playbackRate || 1;
  video.volume = record.selection.originalVolume ?? 0;
  if (audio.paused) void audio.play().then(() => soundStarted(record)).catch(() => needsGesture(record));
}
function begin(record, { gesture = false } = {}) {
  if (!allowed(record)) return;
  const video = sourceVideo(record);
  if (video && (video.paused || video.seeking || video.readyState < 2 || !video.videoWidth)) return;
  if (active === record && audio) {
    if (video && record.presented) syncVideo(record);
    else if (video) afterVideoFrame(record, () => syncVideo(record, true));
    else if (audio.paused) void audio.play().then(() => soundStarted(record)).catch(() => needsGesture(record));
    return;
  }
  stop(); const own = generation; active = record;
  audio = new Audio(audioClipUrl(record.selection)); audio.preload = 'auto'; audio.loop = true;
  audio.volume = record.selection.musicVolume ?? 1;
  audio.muted = record.muted || video?.muted || false;
  audio.addEventListener('loadedmetadata', () => { if (own === generation && video) syncVideo(record, true); }, { once: true });
  audio.addEventListener('error', () => { if (active === record) { record.button.dataset.unavailable = 'true'; stop(); } });
  const play = () => {
    if (own !== generation || !allowed(record)) return;
    if (video) syncVideo(record, true);
    else void audio.play().then(() => soundStarted(record)).catch(() => needsGesture(record));
  };
  // Start a video soundtrack only once an actual video frame is presented.
  if (video) afterVideoFrame(record, play);
  else if (gesture || !video) play(); else requestAnimationFrame(play);
}
function choosePhoto() {
  if (document.hidden || document.querySelector('dialog[open]')) { stop(); return; }
  if (active && sourceVideo(active) && !sourceVideo(active).paused) return;
  if (getActivePlaybackVideo() && !getActivePlaybackVideo().paused) return;
  const candidates = [...records.values()].filter(row => allowed(row) && !sourceVideo(row));
  const selected = candidates.sort((a, b) => (ratios.get(b.card) || 0) - (ratios.get(a.card) || 0))[0];
  if (selected) begin(selected); else if (active && !allowed(active)) stop();
}

export function configurePostMusic(value) {
  settings = value;
  if (observer) return;
  observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const record = records.get(entry.target); if (record && entry.target.isConnected) record.connected = true;
      const visible = entry.intersectionRect.height / Math.max(1, Math.min(entry.boundingClientRect.height, entry.rootBounds?.height || innerHeight));
      ratios.set(entry.target, entry.isIntersecting ? Math.min(1, visible) : 0);
    }
    if (active && !allowed(active)) stop();
    const playing = getActivePlaybackVideo();
    const record = playing && records.get(playing.closest('.sauti-card, .sauti-short-video-slide, .profile-activity-card'));
    if (record) begin(record); else choosePhoto();
  }, { threshold: [0, .05, .1, .15, .2, .3, .4, .5, .6, .7, .8, .9, 1] });
  document.addEventListener('playing', event => {
    if (event.target.nodeName === 'AUDIO') { stop(); return; }
    if (event.target.nodeName !== 'VIDEO') return;
    const card = event.target.closest('.sauti-card, .sauti-short-video-slide, .profile-activity-card'); const record = records.get(card);
    if (record) begin(record); else stop();
  }, true);
  for (const name of ['pause', 'waiting', 'seeking', 'ended']) document.addEventListener(name, event => {
    if (active && sourceVideo(active) === event.target) { active.presented = false; active.frameEpoch = (active.frameEpoch || 0) + 1; audio?.pause(); }
  }, true);
  for (const name of ['timeupdate', 'seeked', 'volumechange']) document.addEventListener(name, event => {
    if (active && sourceVideo(active) === event.target) {
      if (name === 'seeked') { const record = active; afterVideoFrame(record, () => syncVideo(record, true)); }
      else syncVideo(active);
    }
  }, true);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else choosePhoto(); });
  document.addEventListener('sautilink:music-dialog-toggle', () => { if (document.querySelector('dialog[open]')) { getActivePlaybackVideo()?.pause(); stop(); } else choosePhoto(); });
  document.addEventListener('sautilink:comment-sheet-toggle', event => { commentsOpen = Boolean(event.detail?.open); if (commentsOpen) stop(); else choosePhoto(); });
  window.addEventListener('pagehide', stop);
  let mediaFrame = 0;
  new MutationObserver(changes => {
    if (!changes.some(change => change.target.closest?.('.sauti-media-gallery')
        || [...change.removedNodes].some(node => node.matches?.('.sauti-media-gallery')))) return;
    if (mediaFrame) return;
    mediaFrame = requestAnimationFrame(() => {
      mediaFrame = 0;
      if (active && !allowed(active)) stop();
      choosePhoto();
    });
  }).observe(document.body, { childList: true, subtree: true });
  document.addEventListener('scroll', event => {
    if (!event.target.matches?.('.sauti-media-gallery.is-carousel')) return;
    const record = records.get(event.target.closest('.sauti-card'));
    if (!record) return;
    const index = Math.round(event.target.scrollLeft / Math.max(1, event.target.clientWidth));
    if (record.carouselIndex === index) return;
    record.carouselIndex = index;
    const playing = getActivePlaybackVideo(), selected = sourceVideo(record);
    if (playing && record.card.contains(playing) && playing !== selected) playing.pause();
    if (active === record) stop();
    if (selected && !selected.paused) begin(record); else choosePhoto();
  }, { capture: true, passive: true });
}

export function installPostAudio(card, post, { identity, profileLink, time, short = false } = {}) {
  const selection = post?.audio_selection;
  if (!audioClipUrl(selection) || !identity || !settings) return;
  const slot = document.createElement('div'); slot.className = 'post-music-slot';
  const metadata = document.createElement('div'); metadata.className = 'post-music-username';
  metadata.append(profileLink); if (time) metadata.append(time);
  const button = document.createElement('button'); button.type = 'button'; button.className = 'post-music-title';
  button.textContent = `♫ ${selection.artist} · ${selection.title}`;
  button.setAttribute('aria-label', `Audio: ${selection.title} by ${selection.artist}. View audio details`);
  button.addEventListener('click', () => settings.details(selection));
  slot.append(metadata, button); identity.append(slot); card.dataset.audioSelection = JSON.stringify(selection);
  const record = { card, selection, button, short, muted: false, connected: false }; records.set(card, record); observer.observe(card);
  const mute = document.createElement('button'); mute.type = 'button'; mute.className = 'post-audio-toggle';
  record.muteButton = mute;
  mute.textContent = '♪'; mute.setAttribute('aria-label', 'Mute music'); mute.setAttribute('aria-pressed', 'false');
  mute.addEventListener('click', () => {
    if (record === active && audio && record.button.dataset.needsPlay === 'true') {
      record.muted = false; audio.muted = false; delete record.button.dataset.needsPlay;
      const video = sourceVideo(record); if (video) video.muted = false;
      void audio.play().then(() => { mute.textContent = '♪'; mute.setAttribute('aria-label', 'Mute music'); }).catch(() => needsGesture(record)); return;
    }
    const video = sourceVideo(record); record.muted = !record.muted;
    if (video) video.muted = record.muted;
    if (active === record && audio) audio.muted = record.muted;
    else begin(record, { gesture: true });
    mute.textContent = record.muted ? '♫̸' : '♪'; mute.setAttribute('aria-pressed', String(record.muted)); mute.setAttribute('aria-label', record.muted ? 'Unmute music' : 'Mute music');
  });
  identity.append(mute);
  for (const [old, oldRecord] of records) if (old !== card && oldRecord.connected && !old.isConnected) {
    observer.unobserve(old); records.delete(old); ratios.delete(old); if (active === oldRecord) stop();
  }
}

export function installShortPostAudio(slide, card, identity, username) {
  let selection; try { selection = JSON.parse(card.dataset.audioSelection || 'null'); } catch { return; }
  installPostAudio(slide, { audio_selection: selection }, { identity, profileLink: username, short: true });
}
