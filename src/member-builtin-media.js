/* Presentation for media still using browser controls. Sources, recording and
 * trim handlers remain on the original media node; no media is loaded here. */
(() => {
  'use strict';
  const records = new Map();
  const hosts = new Map();
  const rates = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  const events = ['loadedmetadata', 'durationchange', 'timeupdate', 'progress', 'play', 'pause', 'ended', 'volumechange', 'ratechange', 'emptied', 'loadstart', 'waiting', 'playing', 'canplay', 'error', 'seeked', 'enterpictureinpicture', 'leavepictureinpicture'];
  let queued = false;
  let serial = 0;
  const set = (node, name, value) => { if (node.getAttribute(name) !== String(value)) node.setAttribute(name, String(value)); };
  const copy = (node, value) => { if (node.textContent !== value) node.textContent = value; };
  const memberVisible = () => {
    const member = document.getElementById('member-view');
    return Boolean(member && !member.hidden && !document.body.classList.contains('auth-entry'));
  };
  const existingPlayer = (media) => media.tagName === 'VIDEO' && Boolean(media.closest('.sauti-media-tile, #sauti-media-viewer-content, .has-sauti-video-player') || media.getAttribute('data-sauti-video-player-ready') === 'true');
  const memberMedia = (media) => memberVisible() && !media.closest('#auth-view, .auth-view, #login-panel, #signup-panel');
  const time = (seconds) => {
    const value = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
    const hours = Math.floor(value / 3600);
    return `${hours ? `${hours}:` : ''}${hours ? String(Math.floor(value / 60) % 60).padStart(2, '0') : Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
  };
  function icon(name, geometry) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', 'aria-hidden': 'true', 'data-sl-icon-name': name })) svg.setAttribute(key, value);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', geometry); svg.append(path); return svg;
  }
  function button(className, label, name, geometry) {
    const control = document.createElement('button');
    control.type = 'button'; control.className = `sl-media-button ${className}`;
    control.setAttribute('aria-label', label); control.append(icon(name, geometry)); return control;
  }
  function changeIcon(control, key, geometry) {
    if (control.getAttribute('data-media-icon') === key) return;
    set(control, 'data-media-icon', key); control.replaceChildren(icon(key, geometry));
  }
  function hasSource(media) {
    return Boolean(media.currentSrc || media.getAttribute('src') || media.srcObject || media.querySelector('source[src]'));
  }
  function downloadUrl(media) {
    try {
      if (media.srcObject) return '';
      const source = media.currentSrc || media.getAttribute('src') || media.querySelector('source[src]')?.getAttribute('src');
      if (!source) return '';
      const url = new URL(source, window.location.href);
      return (url.protocol === 'blob:' || (url.origin === window.location.origin && /^https?:$/.test(url.protocol))) && hasSource(media) ? url.href : '';
    } catch { return ''; }
  }
  function sync(record) {
    const { media, controls, play, seek, elapsed, mute, volume, settings, speed, rateLabel, fullscreen, pip, download, status } = record;
    const unavailable = Boolean(media.error || media.hasAttribute('disabled') || !hasSource(media));
    const duration = Number(media.duration);
    const finite = Number.isFinite(duration) && duration > 0;
    const position = Number.isFinite(media.currentTime) ? Math.max(0, media.currentTime) : 0;
    if (controls.hidden !== media.hidden) controls.hidden = media.hidden;
    if (play.disabled !== unavailable) play.disabled = unavailable;
    if (seek.disabled !== (unavailable || !finite)) seek.disabled = unavailable || !finite;
    if (mute.disabled !== unavailable) mute.disabled = unavailable;
    if (volume.disabled !== unavailable) volume.disabled = unavailable;
    set(seek, 'max', finite ? duration : 0);
    if (Number(seek.value) !== (finite ? Math.min(duration, position) : 0)) seek.value = String(finite ? Math.min(duration, position) : 0);
    set(seek, 'aria-valuetext', `${time(position)}${finite ? ` of ${time(duration)}` : ''}`);
    copy(elapsed, `${time(position)} / ${duration === Infinity ? 'Live' : time(duration)}`);
    const playing = !media.paused && !media.ended;
    set(play, 'aria-label', `${playing ? 'Pause' : 'Play'} ${record.kind}`);
    changeIcon(play, playing ? 'pause' : 'play', playing ? 'M8 5v14M16 5v14' : 'M8 5v14l11-7Z');
    const muted = media.muted || media.volume === 0;
    set(mute, 'aria-label', `${muted ? 'Unmute' : 'Mute'} ${record.kind}`);
    set(mute, 'aria-pressed', muted);
    changeIcon(mute, muted ? 'volume-off' : 'volume-high', muted ? 'M5 10v4h3l4 3V7l-4 3H5Zm11-1 5 6m0-6-5 6' : 'M5 10v4h3l4 3V7l-4 3H5Zm10.5-.5a3.6 3.6 0 0 1 0 5M18.3 7a7 7 0 0 1 0 10');
    if (Number(volume.value) !== Number(media.volume)) volume.value = String(media.volume);
    copy(rateLabel, `Speed · ${media.playbackRate || 1}×`);
    for (const control of speed.children) {
      set(control, 'aria-pressed', Number(control.getAttribute('data-rate')) === media.playbackRate);
      if (control.disabled !== unavailable) control.disabled = unavailable;
    }
    const canFullscreen = record.kind === 'video' && !media.controlsList?.contains('nofullscreen') && (typeof record.host.requestFullscreen === 'function' || typeof media.webkitEnterFullscreen === 'function');
    if (fullscreen.hidden !== !canFullscreen) fullscreen.hidden = !canFullscreen;
    if (fullscreen.disabled !== unavailable) fullscreen.disabled = unavailable;
    set(fullscreen, 'aria-label', document.fullscreenElement === record.host ? 'Exit full screen' : 'Full screen');
    const canPip = record.kind === 'video' && !media.disablePictureInPicture && document.pictureInPictureEnabled && typeof media.requestPictureInPicture === 'function';
    if (pip.hidden !== !canPip) pip.hidden = !canPip;
    if (pip.disabled !== (unavailable || media.readyState === 0)) pip.disabled = unavailable || media.readyState === 0;
    set(pip, 'aria-label', document.pictureInPictureElement === media ? 'Exit picture in picture' : 'Picture in picture');
    const link = downloadUrl(media);
    const noDownload = !link || Boolean(media.controlsList?.contains('nodownload'));
    if (download.hidden !== noDownload) download.hidden = noDownload;
    if (link) set(download, 'href', link); else download.removeAttribute('href');
    const message = media.error ? 'Media is unavailable.' : record.message || (record.waiting && hasSource(media) ? 'Loading…' : '');
    copy(status, message); if (status.hidden !== !message) status.hidden = !message;
    set(controls, 'aria-busy', Boolean(record.waiting && !media.error));
    if (media.hidden && settings.open) settings.open = false;
  }
  function enhance(media) {
    if (records.has(media) || !memberMedia(media) || !media.controls || existingPlayer(media)) return;
    const host = media.parentElement;
    if (!host) return;
    const kind = media.tagName === 'VIDEO' ? 'video' : 'audio';
    const controls = document.createElement('div');
    controls.className = `sl-media-controls sl-media-${kind}`;
    controls.setAttribute('data-sl-built-in', 'media');
    controls.setAttribute('role', 'group');
    controls.setAttribute('aria-label', `SautiLink ${kind} controls`);
    const play = button('sl-media-play', `Play ${kind}`, 'play', 'M8 5v14l11-7Z');
    const seek = document.createElement('input');
    seek.type = 'range'; seek.className = 'sl-media-seek'; seek.min = '0'; seek.max = '0'; seek.step = '0.1'; seek.value = '0';
    seek.setAttribute('aria-label', `Seek ${kind}`);
    const elapsed = document.createElement('span'); elapsed.className = 'sl-media-time';
    const mute = button('sl-media-mute', `Mute ${kind}`, 'volume-high', 'M5 10v4h3l4 3V7l-4 3H5Zm10.5-.5a3.6 3.6 0 0 1 0 5');
    const settings = document.createElement('details'); settings.className = 'sl-media-settings';
    const summary = document.createElement('summary'); summary.className = 'sl-media-button'; summary.setAttribute('aria-label', 'Playback options');
    summary.append(icon('settings-0-1', 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M9 3 8 6 5 7 3 10l2 3 1 3 3 1 1 3h4l1-3 3-1 1-3 2-3-2-3-3-1-1-3Z'));
    const panel = document.createElement('div'); panel.className = 'sl-media-options'; panel.id = `sl-media-options-${++serial}`;
    summary.setAttribute('aria-controls', panel.id);
    const volumeLabel = document.createElement('label'); volumeLabel.className = 'sl-media-volume-label';
    const volumeCopy = document.createElement('span'); volumeCopy.textContent = 'Volume';
    const volume = document.createElement('input'); volume.type = 'range'; volume.min = '0'; volume.max = '1'; volume.step = '0.05'; volume.value = String(media.volume); volume.className = 'sl-media-volume'; volume.setAttribute('aria-label', `${kind} volume`);
    volumeLabel.append(volumeCopy, volume);
    const rateLabel = document.createElement('span'); rateLabel.className = 'sl-media-rate-label';
    const speed = document.createElement('div'); speed.className = 'sl-media-rates'; speed.setAttribute('role', 'group'); speed.setAttribute('aria-label', 'Playback speed');
    for (const rate of rates) {
      const control = document.createElement('button'); control.type = 'button'; control.textContent = `${rate}×`; control.setAttribute('data-rate', rate); control.setAttribute('aria-label', `${rate} times speed`);
      control.addEventListener('click', () => { if (!control.disabled) { media.playbackRate = rate; sync(record); } });
      speed.append(control);
    }
    const fullscreen = button('sl-media-fullscreen', 'Full screen', 'full-screen', 'M8 4H4v4m12-4h4v4m0 8v4h-4M4 16v4h4');
    const pip = button('sl-media-pip', 'Picture in picture', 'lucide:picture-in-picture', 'M4 6h16v12H4Zm8.5 5.5h6v4.5h-6Z');
    const download = document.createElement('a'); download.className = 'sl-media-download'; download.setAttribute('download', '');
    download.append(icon('download', 'M12 3v13m-4-4 4 4 4-4M4 17v4h16v-4'));
    const downloadLabel = document.createElement('span'); downloadLabel.textContent = `Download ${kind}`; download.append(downloadLabel);
    const videoActions = document.createElement('div'); videoActions.className = 'sl-media-video-actions'; videoActions.hidden = kind !== 'video'; videoActions.append(fullscreen, pip);
    panel.append(volumeLabel, rateLabel, speed, videoActions, download); settings.append(summary, panel);
    const bar = document.createElement('div'); bar.className = 'sl-media-bar'; bar.append(play, elapsed, mute, settings);
    const status = document.createElement('small'); status.className = 'sl-media-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.hidden = true;
    controls.append(seek, bar, status);
    const record = { media, host, kind, controls, play, seek, elapsed, mute, volume, settings, summary, speed, rateLabel, fullscreen, pip, download, status, originalControls: media.controls, originalAttribute: media.getAttribute('controls'), waiting: false, message: '' };
    records.set(media, record);
    if (!hosts.has(host)) hosts.set(host, { base: host.classList.contains('sl-media-host'), audio: host.classList.contains('sl-media-audio-host'), video: host.classList.contains('sl-media-video-host') });
    host.classList.add('sl-media-host', `sl-media-${kind}-host`);
    media.after(controls);
    if (kind === 'audio') media.classList.add('sl-media-audio-native');
    play.addEventListener('click', () => {
      if (play.disabled) return;
      record.message = '';
      if (!media.paused && !media.ended) media.pause();
      else {
        try {
          const result = media.play();
          result?.catch?.(() => { if (records.has(media)) { record.message = 'Playback could not start. Try again.'; record.waiting = false; sync(record); } });
        } catch { record.message = 'Playback could not start. Try again.'; }
      }
      sync(record);
    });
    seek.addEventListener('input', () => {
      if (!seek.disabled && Number.isFinite(media.duration)) media.currentTime = Math.max(0, Math.min(media.duration, Number(seek.value) || 0));
      sync(record);
    });
    mute.addEventListener('click', () => {
      if (mute.disabled) return;
      if (media.volume === 0) { media.volume = 0.5; media.muted = false; } else media.muted = !media.muted;
      sync(record);
    });
    volume.addEventListener('input', () => { if (!volume.disabled) { media.volume = Math.max(0, Math.min(1, Number(volume.value) || 0)); media.muted = media.volume === 0; sync(record); } });
    const runDisplayAction = (action) => {
      try { action()?.catch?.(() => { record.message = 'This playback option is unavailable.'; sync(record); }); }
      catch { record.message = 'This playback option is unavailable.'; sync(record); }
    };
    fullscreen.addEventListener('click', () => {
      if (fullscreen.disabled) return;
      if (document.fullscreenElement === host) runDisplayAction(() => document.exitFullscreen());
      else if (typeof host.requestFullscreen === 'function') runDisplayAction(() => host.requestFullscreen());
      else if (typeof media.webkitEnterFullscreen === 'function') runDisplayAction(() => media.webkitEnterFullscreen());
    });
    pip.addEventListener('click', () => {
      if (pip.disabled) return;
      if (document.pictureInPictureElement === media) runDisplayAction(() => document.exitPictureInPicture());
      else runDisplayAction(() => media.requestPictureInPicture());
    });
    controls.addEventListener('click', event => event.stopPropagation());
    controls.addEventListener('pointerdown', event => event.stopPropagation());
    settings.addEventListener('toggle', () => { if (settings.open) for (const other of records.values()) if (other !== record && other.settings.open) other.settings.open = false; });
    controls.addEventListener('keydown', event => {
      if (event.key === 'Escape' && settings.open) { event.preventDefault(); event.stopPropagation(); settings.open = false; summary.focus(); }
      else if (event.key !== 'Escape') event.stopPropagation();
    });
    record.onMedia = (event) => {
      if (['waiting', 'loadstart'].includes(event.type)) record.waiting = true;
      if (['playing', 'canplay', 'error', 'emptied', 'pause', 'ended'].includes(event.type)) record.waiting = false;
      if (['playing', 'emptied', 'loadstart'].includes(event.type)) record.message = '';
      sync(record);
    };
    for (const event of events) media.addEventListener(event, record.onMedia);
    // Native controls are removed only after every replacement action is ready.
    sync(record); media.controls = false; media.removeAttribute('controls');
  }
  function destroy(record) {
    const { media, host, controls } = record;
    for (const event of events) media.removeEventListener(event, record.onMedia);
    controls.remove(); media.classList.remove('sl-media-audio-native'); records.delete(media);
    if (!existingPlayer(media)) {
      media.controls = record.originalControls;
      if (record.originalAttribute !== null) media.setAttribute('controls', record.originalAttribute);
      else if (!record.originalControls) media.removeAttribute('controls');
    }
    const original = hosts.get(host);
    const remaining = [...records.values()].filter(item => item.host === host);
    if (!remaining.some(item => item.kind === 'audio') && !original?.audio) host.classList.remove('sl-media-audio-host');
    if (!remaining.some(item => item.kind === 'video') && !original?.video) host.classList.remove('sl-media-video-host');
    if (!remaining.length) { if (!original?.base) host.classList.remove('sl-media-host'); hosts.delete(host); }
  }
  function refresh() {
    for (const record of records.values()) {
      if (!memberMedia(record.media) || !record.media.isConnected || record.media.parentElement !== record.host || record.controls.parentElement !== record.host || existingPlayer(record.media)) destroy(record);
      else sync(record);
    }
    if (memberVisible()) document.querySelectorAll('audio[controls], video[controls]').forEach(enhance);
  }
  function schedule() { if (queued) return; queued = true; queueMicrotask(() => { queued = false; refresh(); }); }
  function install() {
    new MutationObserver(mutations => {
      if (mutations.some(mutation => !mutation.target.closest?.('[data-sl-built-in="media"]'))) schedule();
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'class', 'controls', 'src', 'disabled', 'disablepictureinpicture', 'controlslist', 'data-sauti-video-player-ready'] });
    document.addEventListener('fullscreenchange', () => { for (const record of records.values()) sync(record); });
    document.addEventListener('pointerdown', event => { for (const record of records.values()) if (record.settings.open && !record.controls.contains(event.target)) record.settings.open = false; }, true);
    document.addEventListener('focusin', event => { for (const record of records.values()) if (record.settings.open && !record.controls.contains(event.target)) record.settings.open = false; });
    refresh();
  }
  window.SautiMemberMedia = Object.freeze({ refresh });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
