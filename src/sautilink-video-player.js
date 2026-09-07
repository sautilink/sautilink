const SAUTILINK_VIDEO_PLAYER_STYLESHEET = '/app/assets/sautilink-video-player.css';
const SAUTILINK_VIDEO_SELECTOR = '.sauti-media-tile video, #sauti-media-viewer-content > video';
const VIDEO_CONTROLS_IDLE_MS = 4000;
const VIDEO_DOUBLE_TAP_WINDOW_MS = 320;
const VIDEO_SEEK_SECONDS = 5;
const VIDEO_RATES = Object.freeze([0.5, 1, 1.5, 2]);
const SVG_NS = 'http://www.w3.org/2000/svg';

function ensureSautiLinkVideoPlayerStylesheet() {
  if (document.querySelector(`link[href="${SAUTILINK_VIDEO_PLAYER_STYLESHEET}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = SAUTILINK_VIDEO_PLAYER_STYLESHEET;
  link.dataset.sautilinkVideoPlayer = 'true';
  document.head.append(link);
}

function videoIcon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');

  const path = (d, className = '') => {
    const node = document.createElementNS(SVG_NS, 'path');
    node.setAttribute('d', d);
    if (className) node.setAttribute('class', className);
    return node;
  };

  if (name === 'play') {
    svg.append(path('M8 5v14l11-7Z', 'sauti-video-icon-fill'));
  } else if (name === 'pause') {
    svg.append(path('M8 5v14M16 5v14'));
  } else if (name === 'replay') {
    svg.append(path('M7.5 8H3.8V4.3'));
    svg.append(path('M4 8a8 8 0 1 1-.4 7'));
  } else if (name === 'volume-muted') {
    svg.append(path('M5 10v4h3l4 3V7l-4 3H5Z'));
    svg.append(path('m16 9 5 6M21 9l-5 6'));
  } else if (name === 'volume') {
    svg.append(path('M5 10v4h3l4 3V7l-4 3H5Z'));
    svg.append(path('M15.5 9.5a3.6 3.6 0 0 1 0 5M18.3 7a7 7 0 0 1 0 10'));
  } else if (name === 'fullscreen') {
    svg.append(path('M8 4H4v4M16 4h4v4M20 16v4h-4M4 16v4h4'));
  } else if (name === 'pip') {
    svg.append(path('M4 6h16v12H4Z'));
    svg.append(path('M12.5 11.5h6v4.5h-6Z'));
  } else if (name === 'expand') {
    svg.append(path('M9 4H4v5M15 4h5v5M20 15v5h-5M4 15v5h5'));
  } else {
    svg.append(path('M12 5v14'));
  }
  return svg;
}

function makeVideoControl(className, label, iconName) {
  const control = document.createElement('span');
  control.className = className;
  control.setAttribute('role', 'button');
  control.setAttribute('tabindex', '0');
  control.setAttribute('aria-label', label);
  control.setAttribute('title', label);
  control.append(videoIcon(iconName));
  return control;
}

function runControlAction(control, action) {
  const activate = (event) => {
    event.preventDefault();
    event.stopPropagation();
    action(event);
  };
  control.addEventListener('pointerdown', (event) => event.stopPropagation());
  control.addEventListener('pointerup', (event) => event.stopPropagation());
  control.addEventListener('click', activate);
  control.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    activate(event);
  });
}

function formatVideoTime(seconds) {
  const value = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const secs = value % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

function clampVideoTime(video, seconds) {
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  if (!duration) return Math.max(0, seconds);
  return Math.max(0, Math.min(duration, seconds));
}

function seekVideoBy(video, seconds) {
  video.currentTime = clampVideoTime(video, (Number(video.currentTime) || 0) + seconds);
}

function playerHostFor(video) {
  const tile = video.closest('.sauti-media-tile');
  if (tile) return { host: tile, mode: 'feed' };
  const viewer = video.parentElement?.id === 'sauti-media-viewer-content' ? video.parentElement : null;
  return viewer ? { host: viewer, mode: 'viewer' } : null;
}

function enhanceSautiLinkVideo(video) {
  if (!(video instanceof HTMLVideoElement) || video.dataset.sautiVideoPlayerReady === 'true') return;
  const context = playerHostFor(video);
  if (!context) return;

  const { host, mode } = context;
  const canOpenViewer = mode === 'feed' && Boolean(host.closest('#stream-feed'));
  video.dataset.sautiVideoPlayerReady = 'true';
  video.controls = false;
  video.removeAttribute('controls');
  host.classList.add('has-sauti-video-player');

  if (mode === 'feed') {
    host.querySelectorAll(':scope > .sauti-video-audio-toggle').forEach((node) => node.remove());
  }

  const player = document.createElement('span');
  player.className = `sauti-video-player sauti-video-player-${mode}`;
  player.dataset.videoPlayer = mode;
  player.setAttribute('aria-label', 'SautiLink video player');

  const gesture = document.createElement('span');
  gesture.className = 'sauti-video-gesture-surface';
  gesture.setAttribute('role', 'button');
  gesture.setAttribute('tabindex', '0');
  gesture.setAttribute('aria-label', 'Video controls. Double tap left or right to seek 5 seconds.');

  const leftHint = document.createElement('span');
  leftHint.className = 'sauti-video-seek-feedback left';
  leftHint.setAttribute('aria-hidden', 'true');
  leftHint.textContent = '−5';

  const rightHint = document.createElement('span');
  rightHint.className = 'sauti-video-seek-feedback right';
  rightHint.setAttribute('aria-hidden', 'true');
  rightHint.textContent = '+5';

  const spinner = document.createElement('span');
  spinner.className = 'sauti-video-buffering';
  spinner.setAttribute('aria-hidden', 'true');

  const center = makeVideoControl('sauti-video-center-control', 'Pause video', 'pause');

  const chrome = document.createElement('span');
  chrome.className = 'sauti-video-chrome';

  const timeline = document.createElement('span');
  timeline.className = 'sauti-video-timeline';
  timeline.setAttribute('role', 'slider');
  timeline.setAttribute('tabindex', '0');
  timeline.setAttribute('aria-label', 'Video progress');
  timeline.setAttribute('aria-valuemin', '0');
  timeline.setAttribute('aria-valuemax', '0');
  timeline.setAttribute('aria-valuenow', '0');

  const buffered = document.createElement('span');
  buffered.className = 'sauti-video-buffered';
  const played = document.createElement('span');
  played.className = 'sauti-video-played';
  const thumb = document.createElement('span');
  thumb.className = 'sauti-video-thumb';
  timeline.append(buffered, played, thumb);

  const row = document.createElement('span');
  row.className = 'sauti-video-control-row';

  const playPause = makeVideoControl('sauti-video-control play-pause', 'Pause video', 'pause');
  const audio = makeVideoControl('sauti-video-control audio', 'Unmute video', 'volume-muted');

  const volume = document.createElement('span');
  volume.className = 'sauti-video-volume';
  volume.setAttribute('role', 'slider');
  volume.setAttribute('tabindex', '0');
  volume.setAttribute('aria-label', 'Volume');
  volume.setAttribute('aria-valuemin', '0');
  volume.setAttribute('aria-valuemax', '100');

  const volumeFill = document.createElement('span');
  volumeFill.className = 'sauti-video-volume-fill';
  const volumeThumb = document.createElement('span');
  volumeThumb.className = 'sauti-video-volume-thumb';
  volume.append(volumeFill, volumeThumb);

  const time = document.createElement('span');
  time.className = 'sauti-video-time';
  time.textContent = '0:00 / 0:00';
  time.setAttribute('aria-live', 'off');

  const rate = document.createElement('span');
  rate.className = 'sauti-video-rate';
  rate.setAttribute('role', 'button');
  rate.setAttribute('tabindex', '0');
  rate.setAttribute('aria-label', 'Change playback speed');
  rate.setAttribute('title', 'Playback speed');
  rate.textContent = '1×';

  const pip = makeVideoControl('sauti-video-control pip', 'Picture in Picture', 'pip');
  const expand = makeVideoControl(
    'sauti-video-control expand',
    canOpenViewer ? 'Open video viewer' : 'Fullscreen',
    canOpenViewer ? 'expand' : 'fullscreen',
  );
  const fullscreen = canOpenViewer
    ? makeVideoControl('sauti-video-control fullscreen', 'Fullscreen', 'fullscreen')
    : null;

  row.append(playPause, audio, volume, time, rate);
  if ('pictureInPictureEnabled' in document && document.pictureInPictureEnabled && typeof video.requestPictureInPicture === 'function') {
    row.append(pip);
  } else {
    pip.hidden = true;
  }
  row.append(expand);
  if (fullscreen) row.append(fullscreen);
  chrome.append(timeline, row);

  player.append(gesture, leftHint, rightHint, spinner, center, chrome);
  host.append(player);

  let controlsTimer = 0;
  let seekFeedbackTimer = 0;
  let lastTapAt = 0;
  let lastTapRegion = '';

  const showControls = ({ hold = false } = {}) => {
    window.clearTimeout(controlsTimer);
    player.classList.add('controls-visible');
    if (!hold && !video.paused && !video.ended) {
      controlsTimer = window.setTimeout(() => {
        player.classList.remove('controls-visible');
      }, VIDEO_CONTROLS_IDLE_MS);
    }
  };

  const syncPlayState = () => {
    const ended = video.ended && !video.loop;
    const paused = video.paused || ended;
    const label = ended ? 'Replay video' : paused ? 'Play video' : 'Pause video';
    const icon = ended ? 'replay' : paused ? 'play' : 'pause';
    [center, playPause].forEach((control) => {
      control.setAttribute('aria-label', label);
      control.setAttribute('title', label);
      control.replaceChildren(videoIcon(icon));
    });
    player.classList.toggle('is-paused', paused);
    player.classList.toggle('is-ended', ended);
    if (video.dataset.sautiUserPaused === 'true' || ended) showControls({ hold: true });
  };

  const syncAudio = () => {
    const muted = video.muted || video.volume === 0;
    const label = muted ? 'Unmute video' : 'Mute video';
    audio.setAttribute('aria-label', label);
    audio.setAttribute('title', label);
    audio.setAttribute('aria-pressed', muted ? 'false' : 'true');
    audio.replaceChildren(videoIcon(muted ? 'volume-muted' : 'volume'));
    const level = muted ? 0 : Math.max(0, Math.min(1, Number(video.volume) || 0));
    volumeFill.style.transform = `scaleX(${level})`;
    volumeThumb.style.left = `${level * 100}%`;
    volume.setAttribute('aria-valuenow', String(Math.round(level * 100)));
    volume.setAttribute('aria-valuetext', `${Math.round(level * 100)} percent`);
  };

  const syncRate = () => {
    const value = Number(video.playbackRate) || 1;
    rate.textContent = `${Number.isInteger(value) ? value : value.toFixed(1)}×`;
    rate.setAttribute('aria-label', `Playback speed ${rate.textContent}. Activate to change.`);
  };

  const syncTimeline = () => {
    const duration = Number.isFinite(video.duration) ? Math.max(0, video.duration) : 0;
    const current = Math.max(0, Number(video.currentTime) || 0);
    const ratio = duration > 0 ? Math.min(1, current / duration) : 0;
    played.style.transform = `scaleX(${ratio})`;
    thumb.style.left = `${ratio * 100}%`;
    timeline.setAttribute('aria-valuemax', String(Math.round(duration)));
    timeline.setAttribute('aria-valuenow', String(Math.round(current)));
    timeline.setAttribute('aria-valuetext', `${formatVideoTime(current)} of ${formatVideoTime(duration)}`);
    time.textContent = `${formatVideoTime(current)} / ${formatVideoTime(duration)}`;
  };

  const syncBuffered = () => {
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    if (!duration || !video.buffered?.length) {
      buffered.style.transform = 'scaleX(0)';
      return;
    }
    let end = 0;
    for (let index = 0; index < video.buffered.length; index += 1) {
      end = Math.max(end, video.buffered.end(index));
    }
    buffered.style.transform = `scaleX(${Math.min(1, end / duration)})`;
  };

  const togglePlayback = () => {
    if (video.paused || video.ended) {
      delete video.dataset.sautiUserPaused;
      if (video.ended && !video.loop) video.currentTime = 0;
      video.play().catch(() => {});
    } else {
      video.dataset.sautiUserPaused = 'true';
      video.pause();
    }
    showControls({ hold: video.paused });
  };

  const flashSeek = (direction) => {
    window.clearTimeout(seekFeedbackTimer);
    const node = direction === 'left' ? leftHint : rightHint;
    leftHint.classList.remove('is-visible');
    rightHint.classList.remove('is-visible');
    void node.offsetWidth;
    node.classList.add('is-visible');
    seekFeedbackTimer = window.setTimeout(() => node.classList.remove('is-visible'), 620);
  };

  const seekFromTimelinePointer = (event) => {
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    if (!duration) return;
    const rect = timeline.getBoundingClientRect();
    if (!rect.width) return;
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    video.currentTime = ratio * duration;
    syncTimeline();
    showControls();
  };

  const requestFullscreen = () => {
    const target = mode === 'viewer' ? host : host;
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
      return;
    }
    if (typeof target.requestFullscreen === 'function') {
      target.requestFullscreen().catch?.(() => {});
      return;
    }
    if (typeof video.webkitEnterFullscreen === 'function') video.webkitEnterFullscreen();
  };

  runControlAction(center, togglePlayback);
  runControlAction(playPause, togglePlayback);
  runControlAction(audio, () => {
    video.muted = !video.muted;
    video.defaultMuted = video.muted;
    syncAudio();
    showControls();
  });
  runControlAction(rate, () => {
    const current = Number(video.playbackRate) || 1;
    const index = VIDEO_RATES.findIndex((value) => Math.abs(value - current) < 0.01);
    video.playbackRate = VIDEO_RATES[(index + 1 + VIDEO_RATES.length) % VIDEO_RATES.length];
    syncRate();
    showControls();
  });
  runControlAction(pip, async () => {
    try {
      if (document.pictureInPictureElement === video) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
    } catch {
      // Picture in Picture is optional and may be rejected by browser policy.
    }
    showControls();
  });

  if (canOpenViewer) {
    runControlAction(expand, () => {
      showControls();
      host.click();
    });
    runControlAction(fullscreen, requestFullscreen);
  } else {
    runControlAction(expand, requestFullscreen);
  }

  const setVolumeFromPointer = (event) => {
    const rect = volume.getBoundingClientRect();
    if (!rect.width) return;
    const level = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    video.volume = level;
    video.muted = level === 0;
    video.defaultMuted = video.muted;
    syncAudio();
    showControls();
  };

  const stopVolumeEvent = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  volume.addEventListener('pointerdown', (event) => {
    stopVolumeEvent(event);
    volume.setPointerCapture?.(event.pointerId);
    setVolumeFromPointer(event);
  });
  volume.addEventListener('pointermove', (event) => {
    if (!volume.hasPointerCapture?.(event.pointerId)) return;
    stopVolumeEvent(event);
    setVolumeFromPointer(event);
  });
  volume.addEventListener('pointerup', (event) => {
    stopVolumeEvent(event);
    volume.releasePointerCapture?.(event.pointerId);
  });
  volume.addEventListener('click', stopVolumeEvent);
  volume.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Home') video.volume = 0;
    else if (event.key === 'End') video.volume = 1;
    else {
      const delta = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -0.1 : 0.1;
      video.volume = Math.max(0, Math.min(1, video.volume + delta));
    }
    video.muted = video.volume === 0;
    video.defaultMuted = video.muted;
    syncAudio();
    showControls();
  });

  const stopTimelineEvent = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  timeline.addEventListener('pointerdown', (event) => {
    stopTimelineEvent(event);
    timeline.setPointerCapture?.(event.pointerId);
    seekFromTimelinePointer(event);
  });
  timeline.addEventListener('pointermove', (event) => {
    if (!timeline.hasPointerCapture?.(event.pointerId)) return;
    stopTimelineEvent(event);
    seekFromTimelinePointer(event);
  });
  timeline.addEventListener('pointerup', (event) => {
    stopTimelineEvent(event);
    timeline.releasePointerCapture?.(event.pointerId);
  });
  timeline.addEventListener('click', stopTimelineEvent);
  timeline.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'ArrowLeft') seekVideoBy(video, -VIDEO_SEEK_SECONDS);
    else if (event.key === 'ArrowRight') seekVideoBy(video, VIDEO_SEEK_SECONDS);
    else if (event.key === 'Home') video.currentTime = 0;
    else if (event.key === 'End' && Number.isFinite(video.duration)) video.currentTime = video.duration;
    syncTimeline();
    showControls();
  });

  gesture.addEventListener('pointerdown', (event) => {
    if (event.isPrimary === false) return;
    event.stopPropagation();
  });
  gesture.addEventListener('pointerup', (event) => {
    if (event.isPrimary === false || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    event.stopPropagation();
    showControls();

    const rect = gesture.getBoundingClientRect();
    const ratio = rect.width ? (event.clientX - rect.left) / rect.width : 0.5;
    const region = ratio < 0.42 ? 'left' : ratio > 0.58 ? 'right' : 'center';
    const now = Date.now();
    const isSeekDoubleTap = region !== 'center'
      && region === lastTapRegion
      && now - lastTapAt <= VIDEO_DOUBLE_TAP_WINDOW_MS;

    if (isSeekDoubleTap) {
      seekVideoBy(video, region === 'left' ? -VIDEO_SEEK_SECONDS : VIDEO_SEEK_SECONDS);
      flashSeek(region);
      syncTimeline();
      lastTapAt = 0;
      lastTapRegion = '';
      return;
    }
    lastTapAt = now;
    lastTapRegion = region;
  });
  gesture.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  gesture.addEventListener('dblclick', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  gesture.addEventListener('keydown', (event) => {
    if (!['Enter', ' ', 'ArrowLeft', 'ArrowRight', 'm', 'M', 'f', 'F', 'p', 'P'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Enter' || event.key === ' ') togglePlayback();
    else if (event.key === 'ArrowLeft') {
      seekVideoBy(video, -VIDEO_SEEK_SECONDS);
      flashSeek('left');
    } else if (event.key === 'ArrowRight') {
      seekVideoBy(video, VIDEO_SEEK_SECONDS);
      flashSeek('right');
    } else if (event.key === 'm' || event.key === 'M') {
      video.muted = !video.muted;
      video.defaultMuted = video.muted;
      syncAudio();
    } else if (event.key === 'f' || event.key === 'F') {
      requestFullscreen();
    } else if ((event.key === 'p' || event.key === 'P') && !pip.hidden) {
      if (document.pictureInPictureElement === video) document.exitPictureInPicture?.().catch?.(() => {});
      else video.requestPictureInPicture?.().catch?.(() => {});
    }
    syncTimeline();
    showControls();
  });

  ['pointermove', 'pointerenter', 'touchstart'].forEach((eventName) => {
    player.addEventListener(eventName, () => showControls(), { passive: true });
  });

  video.addEventListener('play', () => {
    syncPlayState();
    showControls();
  });
  video.addEventListener('pause', syncPlayState);
  video.addEventListener('ended', syncPlayState);
  video.addEventListener('volumechange', syncAudio);
  video.addEventListener('ratechange', syncRate);
  video.addEventListener('loadedmetadata', () => {
    syncTimeline();
    syncBuffered();
  });
  video.addEventListener('durationchange', syncTimeline);
  video.addEventListener('timeupdate', syncTimeline);
  video.addEventListener('progress', syncBuffered);
  video.addEventListener('waiting', () => player.classList.add('is-buffering'));
  video.addEventListener('stalled', () => player.classList.add('is-buffering'));
  video.addEventListener('playing', () => player.classList.remove('is-buffering'));
  video.addEventListener('canplay', () => player.classList.remove('is-buffering'));

  syncPlayState();
  syncAudio();
  syncRate();
  syncTimeline();
  syncBuffered();
  showControls({ hold: video.paused });
}

function scanSautiLinkVideos(root = document) {
  root.querySelectorAll?.(SAUTILINK_VIDEO_SELECTOR).forEach(enhanceSautiLinkVideo);
  if (root.matches?.(SAUTILINK_VIDEO_SELECTOR)) enhanceSautiLinkVideo(root);
}

function installSautiLinkVideoPlayer() {
  ensureSautiLinkVideoPlayerStylesheet();
  scanSautiLinkVideos();

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.matches?.('.sauti-video-audio-toggle')) {
          const legacyHost = node.closest?.('.sauti-media-tile');
          if (legacyHost?.querySelector?.('video[data-sauti-video-player-ready="true"]')) {
            node.remove();
            continue;
          }
        }
        scanSautiLinkVideos(node);
      }
    }
  });
  observer.observe(document.body, { subtree: true, childList: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installSautiLinkVideoPlayer, { once: true });
} else {
  installSautiLinkVideoPlayer();
}
