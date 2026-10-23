import { appendFormattedPostText } from './caption-entities.js';
import { insertPostFormatting } from './post-text-formatting.js';

const POST_VIDEO_LIMIT_SECONDS = 180;
const POST_VIDEO_MAX_BYTES = 250 * 1024 * 1024;
const preparedPostVideos = new WeakSet();
const MIN_TRIM_SECONDS = 1;
const POLL_MIN_OPTIONS = 2;
const POLL_MAX_OPTIONS = 4;
const POLL_OPTION_MAX_LENGTH = 80;

const nativeFetch = globalThis.fetch.bind(globalThis);
let latestAuthorization = '';
let pollRefreshTimer = 0;

function urlFor(input) {
  try {
    const raw = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
    return new URL(raw || '', globalThis.location?.origin || 'https://sautilink.com');
  } catch {
    return null;
  }
}

function methodFor(input, init) {
  return String(init?.method || input?.method || 'GET').toUpperCase();
}

function captureAuthorization(input, init) {
  try {
    const headers = new Headers(init?.headers || input?.headers || undefined);
    const value = String(headers.get('Authorization') || '').trim();
    if (/^Bearer\s+\S+/i.test(value)) latestAuthorization = value;
  } catch {
    // Ignore malformed request metadata and leave the original request untouched.
  }
}

function composerMessage(text) {
  const message = document.getElementById('sauti-message');
  if (!message) return;
  message.textContent = text;
  message.hidden = false;
}

function pollEditor() {
  return document.getElementById('sauti-poll-editor');
}

function pollIsActive() {
  const editor = pollEditor();
  return Boolean(editor && !editor.hidden);
}

function pollOptionValues() {
  const editor = pollEditor();
  if (!editor || editor.hidden) return [];
  return [...editor.querySelectorAll('[data-poll-option]')].map((input) => String(input.value || '').trim());
}

function validatePoll(body) {
  if (!pollIsActive()) return { ok: true, options: [] };
  if (!String(body || '').trim()) {
    return { ok: false, message: 'Write the poll question in your post text before posting.' };
  }
  const options = pollOptionValues();
  if (options.length < POLL_MIN_OPTIONS || options.length > POLL_MAX_OPTIONS) {
    return { ok: false, message: 'A poll needs between 2 and 4 options.' };
  }
  if (options.some((value) => !value)) {
    return { ok: false, message: 'Fill in every poll option before posting.' };
  }
  if (options.some((value) => value.length > POLL_OPTION_MAX_LENGTH)) {
    return { ok: false, message: `Poll options must be ${POLL_OPTION_MAX_LENGTH} characters or fewer.` };
  }
  const normalized = options.map((value) => value.toLocaleLowerCase());
  if (new Set(normalized).size !== normalized.length) {
    return { ok: false, message: 'Poll options must be different from each other.' };
  }
  return { ok: true, options };
}

function apiErrorResponse(message) {
  return new Response(JSON.stringify({ ok: false, error: { code: 'INVALID_POLL', message } }), {
    status: 400,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function fetchWithComposerFeatures(input, init) {
  captureAuthorization(input, init);
  const url = urlFor(input);
  const method = methodFor(input, init);

  if (url?.origin === globalThis.location?.origin && url.pathname === '/api/sauti' && method === 'POST' && typeof init?.body === 'string') {
    let payload;
    try {
      payload = JSON.parse(init.body);
    } catch {
      return nativeFetch(input, init);
    }

    const poll = validatePoll(payload?.body);
    if (!poll.ok) return apiErrorResponse(poll.message);
    if (poll.options.length) payload.poll_options = poll.options;

    const response = await nativeFetch(input, { ...init, body: JSON.stringify(payload) });
    if (response.ok && poll.options.length) {
      response.clone().json().then((result) => {
        if (result?.data?.post?.id) {
          clearPollEditor();
          schedulePollRefresh();
        }
      }).catch(() => {});
    }
    return response;
  }

  return nativeFetch(input, init);
}

globalThis.fetch = fetchWithComposerFeatures;

function createSvg(paths, viewBox = '0 0 24 24') {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('aria-hidden', 'true');
  for (const item of paths) {
    const node = document.createElementNS(ns, item.tag || 'path');
    for (const [name, value] of Object.entries(item.attrs || {})) node.setAttribute(name, value);
    svg.append(node);
  }
  return svg;
}

function replaceToolLabel(button, label) {
  for (const node of [...button.childNodes]) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
      node.textContent = `\n                    ${label}\n                  `;
      return;
    }
  }
  button.append(document.createTextNode(label));
}

function loadStylesheet() {
  if (!document.querySelector('link[data-composer-formats]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/app/assets/composer-formats.css';
    link.dataset.composerFormats = 'true';
    document.head.append(link);
  }
  if (!document.querySelector('link[data-composer-native-style]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/app/assets/composer-native.css?v=20261020-v1111';
    link.dataset.composerNativeStyle = 'true';
    document.head.append(link);
  }
}

function composerSectionIcon(name) {
  const paths = {
    globe: 'M3 12h18M12 3c5 5 5 13 0 18M12 3c-5 5-5 13 0 18M3 12a9 9 0 1 0 18 0 9 9 0 1 0-18 0',
    'user-group': 'M3 20c.5-4 2-6 6-6s5.5 2 6 6M15 14c4-1 6 1 6 5M9 3a4 4 0 1 0 0 8 4 4 0 1 0 0-8M18 5a3 3 0 1 1-2 5',
    'text-font': 'M4 5h16M12 5v15M8 20h8',
    'image-0-1': 'M3 4h18v16H3V4ZM5 17l5-5 4 4 3-3 4 4M7 8h2',
    'analytics-0-1': 'M6 20V10M12 20V4M18 20v-7',
    'add-0-1': 'M12 5v14M5 12h14',
    'cancel-0-1': 'm6 6 12 12M18 6 6 18',
  };
  const svg = createSvg([{ attrs: { d: paths[name] || 'M21 12a8 8 0 0 1-8 8H7l-4 3v-6.5A8 8 0 1 1 21 12Z' } }]);
  svg.dataset.slIconName = name === 'globe' ? 'globe-0-2' : name === 'comment-01' ? 'message-0-1' : name;
  return svg;
}

function composerChoiceOptions(select) {
  return [...select.options].filter((option) => !option.hidden && !option.parentElement?.hidden).map((option) => ({
    value: option.value,
    label: option.label || option.textContent,
    group: option.parentElement?.tagName === 'OPTGROUP' ? option.parentElement.label : '',
    disabled: Boolean(select.disabled || select.matches(':disabled') || option.disabled || option.parentElement?.disabled),
    selected: option.selected,
  }));
}

function installComposerChoices(select, title, iconName, host) {
  if (!select || select.dataset.composerNativeChoices) return null;
  select.dataset.composerNativeChoices = 'true';
  const fieldset = document.createElement('fieldset');
  fieldset.className = 'composer-native-choice';
  const legend = document.createElement('legend');
  legend.append(composerSectionIcon(iconName), document.createTextNode(title));
  const choices = document.createElement('div');
  choices.className = 'composer-native-chips';
  choices.setAttribute('role', 'radiogroup');
  choices.setAttribute('aria-label', title);
  fieldset.append(legend, choices);
  host.append(fieldset);
  const buttons = new Map();
  let signature = '';
  function refresh() {
    const options = composerChoiceOptions(select);
    const next = JSON.stringify(options);
    if (next === signature) return;
    signature = next;
    const keep = new Set();
    const selected = options.find((option) => option.selected && !option.disabled) || options.find((option) => !option.disabled);
    options.forEach((option, index) => {
      const key = `${index}:${option.value}`;
      keep.add(key);
      let button = buttons.get(key);
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'composer-native-chip';
        button.setAttribute('role', 'radio');
        button.dataset.composerChoice = option.value;
        const caption = document.createElement('span');
        button.append(composerSectionIcon(option.value === 'public' || option.value === 'everyone' ? 'globe' : 'user-group'), caption);
        button.addEventListener('click', () => {
          if (button.disabled) return;
          select.value = button.dataset.composerChoice;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          refresh();
        });
        buttons.set(key, button);
      }
      const caption = button.querySelector('span');
      const label = option.group ? `${option.group}: ${option.label}` : option.label;
      if (caption.textContent !== label) caption.textContent = label;
      button.disabled = option.disabled;
      button.setAttribute('aria-checked', String(option.selected));
      button.dataset.active = String(option.selected);
      button.tabIndex = option === selected ? 0 : -1;
      if (choices.children[index] !== button) choices.insertBefore(button, choices.children[index] || null);
    });
    for (const [key, button] of buttons) if (!keep.has(key)) { button.remove(); buttons.delete(key); }
  }
  choices.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const enabled = [...choices.querySelectorAll('button')].filter((button) => !button.disabled);
    if (!enabled.length) return;
    event.preventDefault();
    const index = enabled.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1
      : (index + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + enabled.length) % enabled.length;
    enabled[next].click();
    enabled[next].focus({ preventScroll: true });
  });
  // Preserve any existing built-in select adapter while also reflecting silent
  // draft restoration assignments. Only these two composer fields are wrapped.
  for (const name of ['value', 'selectedIndex']) {
    const descriptor = Object.getOwnPropertyDescriptor(select, name) || Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, name);
    if (!descriptor?.get || !descriptor.set || descriptor.configurable === false) continue;
    Object.defineProperty(select, name, { configurable: true, enumerable: descriptor.enumerable,
      get() { return descriptor.get.call(this); },
      set(value) { descriptor.set.call(this, value); refresh(); },
    });
  }
  select.addEventListener('change', refresh);
  new MutationObserver(refresh).observe(select, { subtree: true, childList: true, characterData: true, attributes: true,
    attributeFilter: ['disabled', 'hidden', 'selected', 'label', 'value'] });
  refresh();
  return refresh;
}

function installComposerViewport(dialog) {
  if (dialog.composerViewportController) return dialog.composerViewportController;
  const viewport = window.visualViewport;
  let active = false;
  let frame = 0;
  let suspended = false;
  const visible = () => !suspended && dialog.open && !document.body.classList.contains('auth-entry')
    && Boolean(document.getElementById('member-view') && !document.getElementById('member-view').hidden);
  function stop() {
    if (active) {
      window.removeEventListener('resize', schedule);
      viewport?.removeEventListener('resize', schedule);
      viewport?.removeEventListener('scroll', schedule);
      active = false;
    }
    if (frame) window.cancelAnimationFrame(frame);
    frame = 0;
    for (const name of ['--composer-viewport-height', '--composer-viewport-top']) {
      if (dialog.style.getPropertyValue(name)) dialog.style.removeProperty(name);
    }
  }
  function update() {
    frame = 0;
    if (!visible()) { stop(); return; }
    const height = Number(viewport?.height || window.innerHeight || document.documentElement.clientHeight);
    const top = Math.max(0, Number(viewport?.offsetTop) || 0);
    if (!Number.isFinite(height) || height <= 0) return;
    for (const [name, value] of [['--composer-viewport-height', `${height}px`], ['--composer-viewport-top', `${top}px`]]) {
      if (dialog.style.getPropertyValue(name) !== value) dialog.style.setProperty(name, value);
    }
  }
  function schedule() {
    if (visible() && !frame) frame = window.requestAnimationFrame(update);
  }
  function sync() {
    if (!visible()) { stop(); return; }
    if (!active) {
      active = true;
      window.addEventListener('resize', schedule);
      viewport?.addEventListener('resize', schedule);
      viewport?.addEventListener('scroll', schedule);
    }
    schedule();
  }
  const observer = new MutationObserver(sync);
  observer.observe(dialog, { attributes: true, attributeFilter: ['open'] });
  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  const member = document.getElementById('member-view');
  if (member) observer.observe(member, { attributes: true, attributeFilter: ['hidden'] });
  dialog.addEventListener('close', stop);
  window.addEventListener('pagehide', () => { suspended = true; stop(); });
  window.addEventListener('pageshow', () => { suspended = false; sync(); });
  dialog.composerViewportController = Object.freeze({ refresh: sync });
  sync();
  return dialog.composerViewportController;
}

function installNativeComposerPresentation() {
  const dialog = document.getElementById('sauti-composer-dialog');
  const body = dialog?.querySelector('.composer-body');
  if (!dialog || !body || dialog.dataset.composerNativeReady) return;
  const host = document.createElement('div');
  host.id = 'composer-native-choices';
  const refreshers = [
    installComposerChoices(document.getElementById('sauti-audience'), 'Audience', 'globe', host),
    installComposerChoices(document.getElementById('sauti-reply-access'), 'Who can comment?', 'comment-01', host),
  ].filter(Boolean);
  const meta = body.querySelector('.composer-meta');
  if (meta) meta.before(host); else body.append(host);
  const avatar = document.getElementById('member-avatar');
  const author = dialog.querySelector('.composer-author');
  if (avatar && author) author.prepend(avatar);
  const styleTitle = dialog.querySelector('.composer-format-bar > span');
  if (styleTitle) {
    const icon = composerSectionIcon('text-font');
    styleTitle.prepend(icon);
  }
  const mediaTitle = dialog.querySelector('.composer-media-heading strong');
  if (mediaTitle) mediaTitle.prepend(composerSectionIcon('image-0-1'));
  const mediaQueue = document.getElementById('sauti-media-queue');
  const mediaTools = dialog.querySelector('.composer-tools');
  if (mediaQueue && mediaTools) mediaQueue.before(mediaTools);
  const submit = document.getElementById('sauti-submit');
  if (submit) {
    const footer = document.createElement('div');
    footer.className = 'composer-native-publish';
    footer.append(submit);
    body.append(footer);
  }
  dialog.dataset.composerNativeReady = 'true';
  const pausePreviews = () => dialog.querySelectorAll('.composer-media-preview video').forEach((video) => video.pause());
  dialog.addEventListener('close', pausePreviews);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pausePreviews(); });
  const viewport = installComposerViewport(dialog);
  const refresh = () => { refreshers.forEach((update) => update()); viewport.refresh(); };
  new MutationObserver(refresh).observe(dialog, { attributes: true, attributeFilter: ['open'] });
  window.SautiLinkComposerPresentation = Object.freeze({ refresh });
}

function setPickerMode(mode) {
  const input = document.getElementById('sauti-media-file');
  if (!input) return;
  if (mode === 'video') {
    input.accept = 'video/mp4';
    input.multiple = false;
  } else if (mode === 'all') {
    input.accept = 'image/jpeg,image/png,image/webp,video/mp4';
    input.multiple = true;
  } else {
    input.accept = 'image/jpeg,image/png,image/webp';
    input.multiple = true;
  }
}

function installPostTextTools(textarea) {
  const preview = document.getElementById('composer-format-preview');
  const previewText = document.getElementById('composer-preview-text');
  const toggle = document.getElementById('composer-preview-toggle');
  let resizeFrame = 0;
  const resize = () => {
    window.cancelAnimationFrame(resizeFrame);
    const previous = Math.max(150, textarea.getBoundingClientRect().height);
    textarea.style.height = 'auto';
    const target = Math.max(150, Math.min(400, textarea.scrollHeight));
    textarea.style.height = `${previous}px`;
    textarea.style.overflowY = textarea.scrollHeight > 400 ? 'auto' : 'hidden';
    resizeFrame = window.requestAnimationFrame(() => { textarea.style.height = `${target}px`; });
  };
  const renderPreview = () => {
    if (!preview || !previewText || preview.hidden) return;
    previewText.replaceChildren();
    if (textarea.value.trim()) appendFormattedPostText(previewText, textarea.value, previewText);
    else previewText.textContent = 'Your post will appear here.';
  };
  document.querySelectorAll('[data-post-format]').forEach((button) => {
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => {
      if (insertPostFormatting(textarea, button.dataset.postFormat)) {
        if (preview) preview.hidden = false;
        if (toggle) toggle.setAttribute('aria-expanded', 'true');
        renderPreview();
      }
    });
  });
  toggle?.addEventListener('click', () => {
    preview.hidden = !preview.hidden;
    toggle.setAttribute('aria-expanded', String(!preview.hidden));
    renderPreview();
  });
  textarea.addEventListener('input', () => { resize(); renderPreview(); });
  document.getElementById('sauti-composer-dialog')?.addEventListener('close', () => {
    if (preview) preview.hidden = true;
    toggle?.setAttribute('aria-expanded', 'false');
  });
  // Draft restoration updates textarea.value without firing an input event.
  new MutationObserver(resize).observe(textarea, { attributes: true, attributeFilter: ['disabled'] });
  resize();
  window.SautiLinkResizePostComposer = resize;
}

function installUploadZone(textarea, photoButton, videoButton, fileInput) {
  const zone = document.getElementById('composer-upload-zone');
  const tools = document.querySelector('.composer-dialog .composer-actions .composer-tools');
  const photo = document.getElementById('composer-upload-photo');
  const video = document.getElementById('composer-upload-video');
  photo?.addEventListener('click', () => photoButton.click());
  video?.addEventListener('click', () => videoButton.click());
  for (const target of [zone, tools].filter(Boolean)) {
    target.addEventListener('dragover', (event) => {
      if (textarea.disabled || photoButton.disabled) return;
      event.preventDefault();
      target.classList.add('drag-over');
    });
    target.addEventListener('dragleave', () => target.classList.remove('drag-over'));
    target.addEventListener('drop', (event) => {
      target.classList.remove('drag-over');
      if (textarea.disabled || photoButton.disabled) return;
      event.preventDefault();
      const files = [...(event.dataTransfer?.files || [])];
      if (!files.length) return;
      const transfer = new DataTransfer();
      files.forEach((file) => transfer.items.add(file));
      setPickerMode('all');
      fileInput.files = transfer.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
}

function videoDuration(file) {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    const objectUrl = URL.createObjectURL(file);
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(objectUrl);
      video.removeAttribute('src');
      resolve(value);
    };
    const timer = window.setTimeout(() => finish(null), 8000);
    video.preload = 'metadata';
    video.addEventListener('loadedmetadata', () => {
      window.clearTimeout(timer);
      finish(Number.isFinite(video.duration) ? video.duration : null);
    }, { once: true });
    video.addEventListener('error', () => {
      window.clearTimeout(timer);
      finish(null);
    }, { once: true });
    video.src = objectUrl;
  });
}

function formatTrimTime(value) {
  const seconds = Math.max(0, Number(value) || 0);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

function supportedMp4RecorderType() {
  if (typeof MediaRecorder !== 'function' || typeof MediaRecorder.isTypeSupported !== 'function') return '';
  return [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4;codecs=avc1.42E01E',
    'video/mp4',
  ].find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

function waitForMediaEvent(media, name, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error('The video could not be prepared for trimming.'));
    }, timeoutMs);
    const cleanup = () => {
      window.clearTimeout(timer);
      media.removeEventListener(name, done);
      media.removeEventListener('error', failed);
    };
    const done = () => {
      cleanup();
      resolve();
    };
    const failed = () => {
      cleanup();
      reject(new Error('The video could not be prepared for trimming.'));
    };
    media.addEventListener(name, done, { once: true });
    media.addEventListener('error', failed, { once: true });
  });
}

async function prepareTrimRecordingStream(stream) {
  if (!stream.getAudioTracks?.().length) return { stream, release: async () => {} };
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (typeof AudioContext !== 'function') throw new Error('This browser cannot prepare the video audio for trimming. Choose a video that is 3 minutes or shorter.');
  let context = null;
  let source = null;
  let destination = null;
  const release = async () => {
    try { source?.disconnect(); } catch { /* A partially prepared graph may already be disconnected. */ }
    try { destination?.disconnect(); } catch { /* No output connection is required for recording. */ }
    destination?.stream.getTracks().forEach((track) => track.stop());
    try { if (context && context.state !== 'closed') await context.close(); } catch { /* Keep the original export error. */ }
  };
  try {
    // Windows AAC accepts 44.1/48 kHz; captured video audio can be 8 kHz.
    // Resample locally while retaining the original video and audible content.
    context = new AudioContext({ sampleRate: 48_000 });
    source = context.createMediaStreamSource(stream);
    destination = context.createMediaStreamDestination();
    source.connect(destination);
    await context.resume();
    const recording = new MediaStream([...stream.getVideoTracks(), ...destination.stream.getAudioTracks()]);
    return { stream: recording, release };
  } catch (error) {
    await release();
    throw error;
  }
}

async function trimVideoFile(file, startSeconds, endSeconds, onProgress) {
  const mimeType = supportedMp4RecorderType();
  const capture = HTMLMediaElement.prototype.captureStream || HTMLMediaElement.prototype.mozCaptureStream;
  if (!mimeType || typeof capture !== 'function') {
    throw new Error('This browser cannot trim MP4 video yet. Choose a video that is 3 minutes or shorter.');
  }

  const sourceUrl = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.playsInline = true;
  video.muted = true;
  video.src = sourceUrl;

  let stream = null;
  let recording = null;
  let recorder = null;
  let timer = 0;
  let frame = 0;
  try {
    await waitForMediaEvent(video, 'loadeddata');
    if (Math.abs(video.currentTime - Math.max(0, startSeconds)) > 0.01) {
      video.currentTime = Math.max(0, startSeconds);
      await waitForMediaEvent(video, 'seeked');
    }

    stream = capture.call(video);
    if (!stream?.getVideoTracks?.().length) throw new Error('This browser could not read the selected video track.');
    recording = await prepareTrimRecordingStream(stream);
    recorder = new MediaRecorder(recording.stream, {
      mimeType,
      videoBitsPerSecond: 4_500_000,
      audioBitsPerSecond: 128_000,
    });

    const chunks = [];
    const result = new Promise((resolve, reject) => {
      recorder.addEventListener('dataavailable', (event) => {
        if (event.data?.size) chunks.push(event.data);
      });
      recorder.addEventListener('error', () => reject(new Error('The video could not be trimmed. Try another file.')), { once: true });
      recorder.addEventListener('stop', () => {
        if (!chunks.length) {
          reject(new Error('The browser did not produce a trimmed video. Try another file.'));
          return;
        }
        resolve(new Blob(chunks, { type: 'video/mp4' }));
      }, { once: true });
    });

    const clipDuration = Math.min(POST_VIDEO_LIMIT_SECONDS, Math.max(MIN_TRIM_SECONDS, endSeconds - startSeconds));
    const stopAt = Math.min(Number(video.duration) || endSeconds, startSeconds + clipDuration);
    const stopRecording = () => {
      if (recorder && recorder.state !== 'inactive') recorder.stop();
    };
    const update = () => {
      const elapsed = Math.max(0, video.currentTime - startSeconds);
      onProgress?.(Math.min(100, (elapsed / clipDuration) * 100));
      if (video.ended || video.currentTime >= stopAt - 0.04) {
        video.pause();
        stopRecording();
        return;
      }
      frame = window.requestAnimationFrame(update);
    };

    recorder.start(250);
    await video.play();
    frame = window.requestAnimationFrame(update);
    timer = window.setTimeout(stopRecording, Math.ceil(clipDuration * 1000) + 3000);
    const blob = await result;
    if (!blob.size) throw new Error('The trimmed video is empty. Try another file.');
    if (blob.size > POST_VIDEO_MAX_BYTES) throw new Error('The trimmed video is larger than 250 MiB. Choose a shorter section or another file.');

    const baseName = String(file.name || 'video').replace(/\.[^.]+$/, '').slice(0, 80) || 'video';
    return new File([blob], `${baseName}-trimmed.mp4`, { type: 'video/mp4', lastModified: Date.now() });
  } finally {
    window.clearTimeout(timer);
    window.cancelAnimationFrame(frame);
    video.pause();
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    await recording?.release();
    stream?.getTracks?.().forEach((track) => track.stop());
    video.removeAttribute('src');
    URL.revokeObjectURL(sourceUrl);
  }
}

function trimDialog() {
  let dialog = document.getElementById('sauti-video-trimmer');
  if (dialog) return dialog;

  dialog = document.createElement('dialog');
  dialog.id = 'sauti-video-trimmer';
  dialog.className = 'composer-trim-dialog';
  dialog.setAttribute('aria-labelledby', 'sauti-video-trimmer-title');
  dialog.innerHTML = `
    <form method="dialog" class="composer-trim-card">
      <header>
        <div><p>Post video</p><h2 id="sauti-video-trimmer-title">Trim video</h2></div>
        <button type="button" class="composer-trim-close" data-trim-cancel aria-label="Cancel trimming">×</button>
      </header>
      <video data-trim-preview controls playsinline preload="metadata"></video>
      <div class="composer-trim-range">
        <label><span>Start</span><output data-trim-start-output>0:00</output><input data-trim-start type="range" min="0" step="0.1" value="0"></label>
        <label><span>End</span><output data-trim-end-output>3:00</output><input data-trim-end type="range" min="1" step="0.1" value="180"></label>
      </div>
      <p class="composer-trim-summary" data-trim-summary>Select a clip up to 3 minutes.</p>
      <p class="composer-trim-status" data-trim-status role="status" aria-live="polite"></p>
      <footer><button type="button" class="secondary-action" data-trim-cancel>Cancel</button><button type="button" data-trim-use>Use clip</button></footer>
    </form>`;
  document.body.append(dialog);
  return dialog;
}

function promptVideoTrim(file, duration) {
  return new Promise((resolve) => {
    const dialog = trimDialog();
    const preview = dialog.querySelector('[data-trim-preview]');
    const start = dialog.querySelector('[data-trim-start]');
    const end = dialog.querySelector('[data-trim-end]');
    const startOutput = dialog.querySelector('[data-trim-start-output]');
    const endOutput = dialog.querySelector('[data-trim-end-output]');
    const summary = dialog.querySelector('[data-trim-summary]');
    const status = dialog.querySelector('[data-trim-status]');
    const use = dialog.querySelector('[data-trim-use]');
    const cancels = [...dialog.querySelectorAll('[data-trim-cancel]')];
    const objectUrl = URL.createObjectURL(file);
    let busy = false;
    let settled = false;

    // The same dialog is reused after a successful export.
    use.disabled = false;
    cancels.forEach((button) => { button.disabled = false; });
    start.max = String(Math.max(0, duration - MIN_TRIM_SECONDS));
    start.value = '0';
    end.max = String(duration);
    end.value = String(Math.min(POST_VIDEO_LIMIT_SECONDS, duration));
    preview.src = objectUrl;
    status.textContent = '';

    const sync = (changed) => {
      let from = Number(start.value);
      let to = Number(end.value);
      if (changed === start) {
        to = Math.max(to, from + MIN_TRIM_SECONDS);
        to = Math.min(duration, from + POST_VIDEO_LIMIT_SECONDS, to);
      } else {
        from = Math.min(from, to - MIN_TRIM_SECONDS);
        from = Math.max(0, to - POST_VIDEO_LIMIT_SECONDS, from);
      }
      start.value = String(from);
      end.value = String(to);
      startOutput.textContent = formatTrimTime(from);
      endOutput.textContent = formatTrimTime(to);
      summary.textContent = `${formatTrimTime(to - from)} clip · maximum 3:00`;
      preview.currentTime = changed === end ? Math.max(from, to - 0.1) : from;
    };

    const finish = (value) => {
      if (settled) return;
      settled = true;
      preview.pause();
      preview.removeAttribute('src');
      URL.revokeObjectURL(objectUrl);
      if (dialog.open) dialog.close();
      resolve(value);
    };

    const cancel = () => {
      if (!busy) finish(null);
    };
    start.oninput = () => sync(start);
    end.oninput = () => sync(end);
    cancels.forEach((button) => { button.onclick = cancel; });
    dialog.oncancel = (event) => {
      event.preventDefault();
      cancel();
    };
    use.onclick = async () => {
      if (busy) return;
      busy = true;
      use.disabled = true;
      cancels.forEach((button) => { button.disabled = true; });
      status.textContent = 'Trimming… 0%';
      try {
        const trimmed = await trimVideoFile(file, Number(start.value), Number(end.value), (progress) => {
          status.textContent = `Trimming… ${Math.round(progress)}%`;
        });
        finish(trimmed);
      } catch (error) {
        busy = false;
        use.disabled = false;
        cancels.forEach((button) => { button.disabled = false; });
        status.textContent = error?.message || 'The video could not be trimmed.';
      }
    };

    sync(start);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  });
}

export async function preparePostComposerFiles(files) {
  const prepared = [];
  for (const file of files) {
    if (String(file.type || '').toLowerCase() !== 'video/mp4' || preparedPostVideos.has(file)) {
      prepared.push(file);
      continue;
    }
    if (file.size > POST_VIDEO_MAX_BYTES) throw new Error('Videos must be 250 MiB or smaller.');
    const duration = await videoDuration(file);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('The video duration could not be read. Choose a playable MP4 file.');
    const selected = duration > POST_VIDEO_LIMIT_SECONDS ? await promptVideoTrim(file, duration) : file;
    if (!selected) return [];
    preparedPostVideos.add(selected);
    prepared.push(selected);
  }
  return prepared;
}

async function validateSelectedShortVideo(event) {
  const input = event.currentTarget;
  if (input.dataset.shortVideoValidated === 'true') {
    delete input.dataset.shortVideoValidated;
    return;
  }
  const files = [...(input.files || [])];
  if (!files.some((file) => String(file.type || '').toLowerCase() === 'video/mp4')) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  try {
    const preparedFiles = await preparePostComposerFiles(files);
    input.value = '';
    if (!preparedFiles.length) return;
    const transfer = new DataTransfer();
    preparedFiles.forEach((selected) => transfer.items.add(selected));
    input.files = transfer.files;
    input.dataset.shortVideoValidated = 'true';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  } catch (error) {
    input.value = '';
    composerMessage(error?.message || 'The selected video could not be prepared.');
  }
}

function updateMediaCopy() {
  const heading = document.querySelector('#sauti-media-queue .composer-media-heading strong');
  if (heading) heading.textContent = 'Photos & videos';
  const note = document.querySelector('#sauti-media-queue .composer-media-note');
  if (note) note.textContent = 'Photos: up to 10 JPEG, PNG or WebP images, 5 MiB each. Videos: MP4 up to 250 MiB and 3 minutes; trim longer videos before uploading. Add alternative text for accessibility.';
}

function buildVideoTool(photoButton, fileInput) {
  if (document.getElementById('sauti-video-add')) return document.getElementById('sauti-video-add');
  const button = document.createElement('button');
  button.className = 'composer-tool video-tool';
  button.id = 'sauti-video-add';
  button.type = 'button';
  button.title = 'Add video (up to 3 minutes)';
  button.disabled = Boolean(document.getElementById('sauti-body')?.disabled);
  button.append(
    createSvg([
      { tag: 'rect', attrs: { x: '3', y: '4', width: '18', height: '16', rx: '3' } },
      { attrs: { d: 'M4 9h16M7 4l3 5M13 4l3 5' } },
      { attrs: { d: 'm10 12 5 3-5 3v-6Z' } },
    ]),
    document.createTextNode('Video'),
  );
  button.addEventListener('click', () => {
    setPickerMode('video');
    fileInput.click();
  });
  photoButton.after(button);
  return button;
}

function optionRow(index) {
  const row = document.createElement('div');
  row.className = 'composer-poll-option';
  row.dataset.pollOptionRow = String(index);

  const number = document.createElement('span');
  number.className = 'composer-poll-number';
  number.setAttribute('aria-hidden', 'true');
  number.textContent = String(index + 1).padStart(2, '0');

  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = POLL_OPTION_MAX_LENGTH;
  input.placeholder = `Option ${index + 1}`;
  input.setAttribute('aria-label', `Poll option ${index + 1}`);
  input.dataset.pollOption = 'true';
  row.append(number, input);

  if (index >= POLL_MIN_OPTIONS) {
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'text-action composer-poll-option-remove';
    remove.setAttribute('aria-label', `Remove poll option ${index + 1}`);
    remove.title = `Remove option ${index + 1}`;
    remove.append(composerSectionIcon('cancel-0-1'));
    remove.addEventListener('click', () => {
      row.remove();
      renumberPollOptions();
      syncAddOptionButton();
    });
    row.append(remove);
  }
  return row;
}

function renumberPollOptions() {
  const rows = [...(pollEditor()?.querySelectorAll('[data-poll-option-row]') || [])];
  rows.forEach((row, index) => {
    row.dataset.pollOptionRow = String(index);
    const number = row.querySelector('.composer-poll-number');
    if (number) number.textContent = String(index + 1).padStart(2, '0');
    const input = row.querySelector('[data-poll-option]');
    if (input) {
      input.placeholder = `Option ${index + 1}`;
      input.setAttribute('aria-label', `Poll option ${index + 1}`);
    }
    const remove = row.querySelector('button');
    if (index < POLL_MIN_OPTIONS && remove) remove.remove();
    else if (remove) {
      remove.setAttribute('aria-label', `Remove poll option ${index + 1}`);
      remove.title = `Remove option ${index + 1}`;
    }
  });
}

function syncAddOptionButton() {
  const editor = pollEditor();
  const button = document.getElementById('sauti-poll-add-option');
  if (!editor || !button) return;
  const count = editor.querySelectorAll('[data-poll-option]').length;
  button.disabled = count >= POLL_MAX_OPTIONS;
  const countLabel = editor.querySelector('.composer-poll-count');
  if (countLabel) countLabel.textContent = `${count} / ${POLL_MAX_OPTIONS} options`;
}

function clearPollEditor() {
  const editor = pollEditor();
  if (!editor) return;
  editor.hidden = true;
  const options = editor.querySelector('.composer-poll-options');
  if (options) {
    options.replaceChildren(optionRow(0), optionRow(1));
  }
  syncAddOptionButton();
  const tool = document.getElementById('sauti-poll-add');
  if (tool) tool.setAttribute('aria-pressed', 'false');
}

function togglePollEditor() {
  const editor = pollEditor();
  if (!editor) return;
  editor.hidden = !editor.hidden;
  const tool = document.getElementById('sauti-poll-add');
  if (tool) tool.setAttribute('aria-pressed', String(!editor.hidden));
  if (!editor.hidden) editor.querySelector('[data-poll-option]')?.focus();
}

function buildPollEditor(textarea) {
  if (pollEditor()) return pollEditor();
  const editor = document.createElement('section');
  editor.id = 'sauti-poll-editor';
  editor.className = 'composer-poll-editor';
  editor.hidden = true;
  editor.setAttribute('aria-label', 'Poll options');

  const heading = document.createElement('div');
  heading.className = 'composer-poll-heading';
  const title = document.createElement('strong');
  title.append(composerSectionIcon('analytics-0-1'), document.createTextNode('Poll'));
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'text-action composer-poll-remove';
  remove.setAttribute('aria-label', 'Remove poll');
  remove.title = 'Remove poll';
  remove.append(composerSectionIcon('cancel-0-1'));
  remove.addEventListener('click', clearPollEditor);
  heading.append(title, remove);

  const note = document.createElement('p');
  note.className = 'composer-poll-note';
  note.textContent = 'Ask your question above. Add 2–4 choices below.';

  const options = document.createElement('div');
  options.className = 'composer-poll-options';
  options.append(optionRow(0), optionRow(1));

  const actions = document.createElement('div');
  actions.className = 'composer-poll-actions';
  const add = document.createElement('button');
  add.id = 'sauti-poll-add-option';
  add.type = 'button';
  add.className = 'secondary-action';
  add.append(composerSectionIcon('add-0-1'), document.createTextNode('Add option'));
  add.addEventListener('click', () => {
    const count = options.querySelectorAll('[data-poll-option]').length;
    if (count >= POLL_MAX_OPTIONS) return;
    options.append(optionRow(count));
    syncAddOptionButton();
    options.lastElementChild?.querySelector('input')?.focus();
  });
  const countLabel = document.createElement('span');
  countLabel.className = 'composer-poll-count';
  countLabel.textContent = `${POLL_MIN_OPTIONS} / ${POLL_MAX_OPTIONS} options`;
  actions.append(add, countLabel);

  editor.append(heading, note, options, actions);
  textarea.after(editor);
  return editor;
}

function buildPollTool(disabledPoll, textarea) {
  if (document.getElementById('sauti-poll-add')) return document.getElementById('sauti-poll-add');
  const button = document.createElement('button');
  button.className = 'composer-tool poll-tool';
  button.id = 'sauti-poll-add';
  button.type = 'button';
  button.title = 'Add poll';
  button.setAttribute('aria-pressed', 'false');
  button.disabled = Boolean(textarea.disabled);
  button.append(
    createSvg([
      { attrs: { d: 'M6 20V10M12 20V4M18 20v-7' } },
    ]),
    document.createTextNode('Poll'),
  );
  button.addEventListener('click', togglePollEditor);
  disabledPoll.replaceWith(button);
  return button;
}

function syncComposerTools(textarea, videoButton, pollButton) {
  const sync = () => {
    const disabled = Boolean(textarea.disabled);
    videoButton.disabled = disabled;
    pollButton.disabled = disabled;
  };
  sync();
  new MutationObserver(sync).observe(textarea, { attributes: true, attributeFilter: ['disabled'] });
}

function installComposerTools() {
  const photoButton = document.getElementById('sauti-media-add');
  const fileInput = document.getElementById('sauti-media-file');
  const textarea = document.getElementById('sauti-body');
  if (!photoButton || !fileInput || !textarea) return;

  loadStylesheet();
  updateMediaCopy();
  replaceToolLabel(photoButton, 'Photo');
  photoButton.title = 'Add photo';
  photoButton.addEventListener('click', () => setPickerMode('photo'), true);
  fileInput.addEventListener('change', validateSelectedShortVideo, true);

  const videoButton = buildVideoTool(photoButton, fileInput);
  installPostTextTools(textarea);
  installUploadZone(textarea, photoButton, videoButton, fileInput);
  buildPollEditor(textarea);
  const disabledPoll = document.querySelector('.composer-tool.disabled-feature');
  const pollButton = disabledPoll ? buildPollTool(disabledPoll, textarea) : document.getElementById('sauti-poll-add');
  if (videoButton && pollButton) syncComposerTools(textarea, videoButton, pollButton);
  installNativeComposerPresentation();
}

function pollHeaders() {
  const headers = new Headers({ Accept: 'application/json' });
  if (latestAuthorization) headers.set('Authorization', latestAuthorization);
  return headers;
}

function pollNode(poll) {
  const section = document.createElement('section');
  section.className = 'sauti-poll';
  section.dataset.pollPostId = poll.post_id;
  section.setAttribute('aria-label', 'Poll');

  const total = Number(poll.total_votes || 0);
  for (const option of poll.options || []) {
    const votes = Number(option.vote_count || 0);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sauti-poll-option';
    button.disabled = Boolean(poll.voted_option_id);
    button.dataset.optionId = String(option.id || '');
    button.dataset.selected = String(poll.voted_option_id === option.id);

    const copy = document.createElement('span');
    copy.className = 'sauti-poll-option-copy';
    const label = document.createElement('strong');
    label.textContent = String(option.label || 'Option');
    const percent = document.createElement('span');
    percent.textContent = `${total ? Math.round((votes / total) * 100) : 0}%`;
    copy.append(label, percent);

    const progress = document.createElement('progress');
    progress.max = Math.max(total, 1);
    progress.value = votes;
    progress.setAttribute('aria-label', `${votes} votes`);

    const meta = document.createElement('span');
    meta.className = 'sauti-poll-option-meta';
    const votesText = document.createElement('span');
    votesText.textContent = `${votes} ${votes === 1 ? 'vote' : 'votes'}`;
    const selected = document.createElement('span');
    selected.textContent = poll.voted_option_id === option.id ? 'Your vote' : '';
    meta.append(votesText, selected);

    button.append(copy, progress, meta);
    button.addEventListener('click', () => voteInPoll(poll.post_id, option.id, button));
    section.append(button);
  }

  const summary = document.createElement('p');
  summary.className = 'sauti-poll-summary';
  summary.textContent = `${total} ${total === 1 ? 'vote' : 'votes'}`;
  section.append(summary);
  return section;
}

async function voteInPoll(postId, optionId, button) {
  if (!latestAuthorization) {
    composerMessage('Sign in to vote in this poll.');
    return;
  }
  button.disabled = true;
  const response = await nativeFetch('/api/sauti/polls/vote', {
    method: 'POST',
    headers: { Authorization: latestAuthorization, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ post_id: postId, option_id: optionId }),
  }).catch(() => null);
  if (!response) return;
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    composerMessage(result?.error?.message || 'Your vote could not be recorded.');
  }
  document.querySelectorAll(`.sauti-card[data-post-id="${CSS.escape(postId)}"]`).forEach((card) => {
    delete card.dataset.pollChecked;
    card.querySelector('.sauti-poll')?.remove();
  });
  await refreshPolls([postId]);
}

function insertPoll(card, poll) {
  const existing = card.querySelector('.sauti-poll');
  if (existing) existing.remove();
  const main = card.querySelector('.sauti-card-main');
  const footer = main?.querySelector('.sauti-card-footer');
  if (!main) return;
  const node = pollNode(poll);
  if (footer) footer.before(node);
  else main.append(node);
}

async function refreshPolls(onlyPostIds = null) {
  const cards = [...document.querySelectorAll('.sauti-card[data-post-id]')];
  const ids = [...new Set((onlyPostIds || cards.filter((card) => card.dataset.pollChecked !== 'true').map((card) => card.dataset.postId)).filter(Boolean))].slice(0, 30);
  if (!ids.length) return;

  const params = new URLSearchParams({ post_ids: ids.join(',') });
  const response = await nativeFetch(`/api/sauti/polls?${params}`, { headers: pollHeaders() }).catch(() => null);
  if (!response?.ok) return;
  const result = await response.json().catch(() => null);
  const polls = new Map((result?.data?.polls || []).map((poll) => [poll.post_id, poll]));

  for (const card of cards) {
    if (!ids.includes(card.dataset.postId)) continue;
    card.dataset.pollChecked = 'true';
    const poll = polls.get(card.dataset.postId);
    if (poll) insertPoll(card, poll);
  }
}

function schedulePollRefresh() {
  if (pollRefreshTimer) window.clearTimeout(pollRefreshTimer);
  pollRefreshTimer = window.setTimeout(() => {
    pollRefreshTimer = 0;
    refreshPolls().catch(() => {});
  }, 60);
}

function installPollObserver() {
  const observer = new MutationObserver((records) => {
    if (records.some((record) => [...record.addedNodes].some((node) => node.nodeType === Node.ELEMENT_NODE && (node.matches?.('.sauti-card') || node.querySelector?.('.sauti-card'))))) {
      schedulePollRefresh();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  schedulePollRefresh();
}

function install() {
  installComposerTools();
  installPollObserver();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', install, { once: true });
} else {
  queueMicrotask(install);
}
