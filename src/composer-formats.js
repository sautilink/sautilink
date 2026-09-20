const SHORT_VIDEO_LIMIT_SECONDS = 30;
const MAX_TRIMMABLE_VIDEO_SECONDS = 120;
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
  if (document.querySelector('link[data-composer-formats]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/app/assets/composer-formats.css';
  link.dataset.composerFormats = 'true';
  document.head.append(link);
}

function setPickerMode(mode) {
  const input = document.getElementById('sauti-media-file');
  if (!input) return;
  if (mode === 'video') {
    input.accept = 'video/mp4';
    input.multiple = false;
  } else {
    input.accept = 'image/jpeg,image/png,image/webp';
    input.multiple = true;
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

async function trimVideoFile(file, startSeconds, endSeconds, onProgress) {
  const mimeType = supportedMp4RecorderType();
  const capture = HTMLMediaElement.prototype.captureStream || HTMLMediaElement.prototype.mozCaptureStream;
  if (!mimeType || typeof capture !== 'function') {
    throw new Error('This browser cannot trim MP4 video yet. Choose a video that is 30 seconds or shorter.');
  }

  const sourceUrl = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.playsInline = true;
  video.muted = true;
  video.src = sourceUrl;

  let stream = null;
  let recorder = null;
  let timer = 0;
  let frame = 0;
  try {
    await waitForMediaEvent(video, 'loadeddata');
    video.currentTime = Math.max(0, startSeconds);
    await waitForMediaEvent(video, 'seeked');

    stream = capture.call(video);
    if (!stream?.getVideoTracks?.().length) throw new Error('This browser could not read the selected video track.');
    recorder = new MediaRecorder(stream, {
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

    const clipDuration = Math.min(SHORT_VIDEO_LIMIT_SECONDS, Math.max(MIN_TRIM_SECONDS, endSeconds - startSeconds));
    const stopAt = Math.min(Number(video.duration) || endSeconds, startSeconds + clipDuration);
    const stopRecording = () => {
      if (recorder?.state !== 'inactive') recorder.stop();
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
    if (blob.size > 25 * 1024 * 1024) throw new Error('The trimmed video is larger than 25 MB. Choose a shorter section or another file.');

    const baseName = String(file.name || 'video').replace(/\.[^.]+$/, '').slice(0, 80) || 'video';
    return new File([blob], `${baseName}-trimmed.mp4`, { type: 'video/mp4', lastModified: Date.now() });
  } finally {
    window.clearTimeout(timer);
    window.cancelAnimationFrame(frame);
    video.pause();
    if (recorder?.state !== 'inactive') recorder.stop();
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
        <div><p>Short video</p><h2 id="sauti-video-trimmer-title">Trim video</h2></div>
        <button type="button" class="composer-trim-close" data-trim-cancel aria-label="Cancel trimming">×</button>
      </header>
      <video data-trim-preview controls playsinline preload="metadata"></video>
      <div class="composer-trim-range">
        <label><span>Start</span><output data-trim-start-output>0:00</output><input data-trim-start type="range" min="0" step="0.1" value="0"></label>
        <label><span>End</span><output data-trim-end-output>0:30</output><input data-trim-end type="range" min="1" step="0.1" value="30"></label>
      </div>
      <p class="composer-trim-summary" data-trim-summary>Select a clip up to 30 seconds.</p>
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

    start.max = String(Math.max(0, duration - MIN_TRIM_SECONDS));
    start.value = '0';
    end.max = String(duration);
    end.value = String(Math.min(SHORT_VIDEO_LIMIT_SECONDS, duration));
    preview.src = objectUrl;
    status.textContent = '';

    const sync = (changed) => {
      let from = Number(start.value);
      let to = Number(end.value);
      if (changed === start) {
        to = Math.max(to, from + MIN_TRIM_SECONDS);
        to = Math.min(duration, from + SHORT_VIDEO_LIMIT_SECONDS, to);
      } else {
        from = Math.min(from, to - MIN_TRIM_SECONDS);
        from = Math.max(0, to - SHORT_VIDEO_LIMIT_SECONDS, from);
      }
      start.value = String(from);
      end.value = String(to);
      startOutput.textContent = formatTrimTime(from);
      endOutput.textContent = formatTrimTime(to);
      summary.textContent = `${formatTrimTime(to - from)} clip · maximum 0:30`;
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

async function validateSelectedShortVideo(event) {
  const input = event.currentTarget;
  if (input.dataset.shortVideoValidated === 'true') {
    delete input.dataset.shortVideoValidated;
    return;
  }

  const files = [...(input.files || [])];
  const videos = files.filter((file) => String(file.type || '').toLowerCase() === 'video/mp4');
  if (!videos.length) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  for (const file of videos) {
    const duration = await videoDuration(file);
    if (duration != null && duration > MAX_TRIMMABLE_VIDEO_SECONDS + 0.05) {
      input.value = '';
      composerMessage('Videos longer than 2 minutes cannot be trimmed here. Choose another file.');
      return;
    }
    if (duration != null && duration > SHORT_VIDEO_LIMIT_SECONDS + 0.05) {
      input.value = '';
      const trimmed = await promptVideoTrim(file, duration);
      if (!trimmed) return;
      const transfer = new DataTransfer();
      files.forEach((selected) => transfer.items.add(selected === file ? trimmed : selected));
      input.files = transfer.files;
    }
  }

  input.dataset.shortVideoValidated = 'true';
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function updateMediaCopy() {
  const heading = document.querySelector('#sauti-media-queue .composer-media-heading strong');
  if (heading) heading.textContent = 'Photos & videos';
  const note = document.querySelector('#sauti-media-queue .composer-media-note');
  if (note) note.textContent = 'Photos: JPEG, PNG or WebP up to 8 MB. Videos: MP4 up to 25 MB; trim videos up to 2 minutes into a 30-second clip. Add alternative text for accessibility.';
}

function buildVideoTool(photoButton, fileInput) {
  if (document.getElementById('sauti-video-add')) return document.getElementById('sauti-video-add');
  const button = document.createElement('button');
  button.className = 'composer-tool video-tool';
  button.id = 'sauti-video-add';
  button.type = 'button';
  button.title = 'Add short video (up to 30 seconds)';
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

  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = POLL_OPTION_MAX_LENGTH;
  input.placeholder = `Option ${index + 1}`;
  input.setAttribute('aria-label', `Poll option ${index + 1}`);
  input.dataset.pollOption = 'true';
  row.append(input);

  if (index >= POLL_MIN_OPTIONS) {
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'text-action';
    remove.textContent = 'Remove';
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
    const input = row.querySelector('[data-poll-option]');
    if (input) {
      input.placeholder = `Option ${index + 1}`;
      input.setAttribute('aria-label', `Poll option ${index + 1}`);
    }
    const remove = row.querySelector('button');
    if (index < POLL_MIN_OPTIONS && remove) remove.remove();
  });
}

function syncAddOptionButton() {
  const editor = pollEditor();
  const button = document.getElementById('sauti-poll-add-option');
  if (!editor || !button) return;
  button.disabled = editor.querySelectorAll('[data-poll-option]').length >= POLL_MAX_OPTIONS;
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
  title.textContent = 'Poll';
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'text-action composer-poll-remove';
  remove.textContent = 'Remove poll';
  remove.addEventListener('click', clearPollEditor);
  heading.append(title, remove);

  const note = document.createElement('p');
  note.className = 'composer-poll-note';
  note.textContent = 'Use the post text above as your poll question. Add 2 to 4 options.';

  const options = document.createElement('div');
  options.className = 'composer-poll-options';
  options.append(optionRow(0), optionRow(1));

  const actions = document.createElement('div');
  actions.className = 'composer-poll-actions';
  const add = document.createElement('button');
  add.id = 'sauti-poll-add-option';
  add.type = 'button';
  add.className = 'secondary-action';
  add.textContent = 'Add option';
  add.addEventListener('click', () => {
    const count = options.querySelectorAll('[data-poll-option]').length;
    if (count >= POLL_MAX_OPTIONS) return;
    options.append(optionRow(count));
    syncAddOptionButton();
    options.lastElementChild?.querySelector('input')?.focus();
  });
  actions.append(add);

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
  buildPollEditor(textarea);
  const disabledPoll = document.querySelector('.composer-tool.disabled-feature');
  const pollButton = disabledPoll ? buildPollTool(disabledPoll, textarea) : document.getElementById('sauti-poll-add');
  if (videoButton && pollButton) syncComposerTools(textarea, videoButton, pollButton);
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
