const messagesMediaSurface = document.getElementById('messages-surface');
const messagesMediaComposer = document.getElementById('message-composer');
const messagesMediaBody = document.getElementById('message-body');
const messagesMediaSend = document.getElementById('message-send');
const messagesMediaFeed = document.getElementById('message-thread-feed');
const messagesMediaMessage = document.getElementById('message-composer-message');

const DM_MEDIA_MAX_BYTES = 5 * 1024 * 1024;
const DM_VOICE_MAX_MS = 5 * 60 * 1000;
const DM_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DM_FILE_TYPES = Object.freeze({
  pdf: 'application/pdf',
  txt: 'text/plain',
  csv: 'text/csv',
  rtf: 'application/rtf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
});

const DM_PHOTO_TYPES = Object.freeze({
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
});

let pendingMessageAttachment = null;
let activeVoiceRecording = null;
let messageMediaHydrateTimer = 0;
const hydratedMediaUrls = new Set();

function ensureMessagesMediaStyles() {
  if (document.querySelector('link[data-messages-media-style]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/app/assets/messages-media.css?v=20260912-media1';
  link.dataset.messagesMediaStyle = 'true';
  document.head.append(link);
}

function svgIcon(paths, viewBox = '0 0 24 24') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const d of paths) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

function conversationIdFromLocation() {
  const match = window.location.pathname.match(/^(?:\/app)?\/messages\/([^/]+)\/?$/i);
  const id = String(match?.[1] || '').toLowerCase();
  return DM_UUID_PATTERN.test(id) ? id : '';
}

async function messagesAuthorizationHeaders() {
  const helper = window.__sautilinkMessagesAuthorizationHeaders;
  if (typeof helper !== 'function') throw new Error('AUTH_NOT_READY');
  const headers = await helper();
  if (!headers?.Authorization) throw new Error('AUTH_REQUIRED');
  return headers;
}

function setMessagesMediaMessage(text = '', type = 'error') {
  if (!messagesMediaMessage) return;
  messagesMediaMessage.textContent = text;
  messagesMediaMessage.className = `form-message composer-message${type === 'success' ? ' success' : ''}`;
  messagesMediaMessage.hidden = !text;
}

function extensionOf(name) {
  const match = String(name || '').toLowerCase().match(/\.([a-z0-9]{1,8})$/);
  return match ? match[1] : '';
}

function normalizedFileType(file, kind) {
  const declared = String(file?.type || '').split(';')[0].toLowerCase();
  const extension = extensionOf(file?.name);
  if (kind === 'photo') return DM_PHOTO_TYPES[extension] || (Object.values(DM_PHOTO_TYPES).includes(declared) ? declared : '');
  if (kind === 'file') return DM_FILE_TYPES[extension] || '';
  return declared;
}

function formatBytes(value) {
  const bytes = Math.max(0, Number(value || 0));
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(value) {
  const seconds = Math.max(0, Math.floor(Number(value || 0) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

function trackObjectUrl(blob) {
  const url = URL.createObjectURL(blob);
  hydratedMediaUrls.add(url);
  return url;
}

function revokeObjectUrl(url) {
  if (!url || !hydratedMediaUrls.has(url)) return;
  hydratedMediaUrls.delete(url);
  URL.revokeObjectURL(url);
}

function revokeUrlsInside(node) {
  if (!(node instanceof Element)) return;
  const urls = [node, ...node.querySelectorAll('[data-dm-object-url]')]
    .map((element) => element.dataset?.dmObjectUrl)
    .filter(Boolean);
  urls.forEach(revokeObjectUrl);
}

function clearPendingLocalUrl() {
  const url = pendingMessageAttachment?.localUrl || '';
  if (url) revokeObjectUrl(url);
}

function syncAttachmentSendState() {
  if (!messagesMediaSend || !messagesMediaBody || !pendingMessageAttachment) return;
  const blocked = messagesMediaBody.disabled;
  const ready = pendingMessageAttachment.status === 'ready' && Boolean(pendingMessageAttachment.id);
  const lengthOkay = messagesMediaBody.value.trim().length <= 4000;
  messagesMediaSend.disabled = blocked || !ready || !lengthOkay;
}

function resetTextComposerState() {
  messagesMediaBody?.dispatchEvent(new Event('input', { bubbles: true }));
}

function updateAttachmentControls() {
  const attach = document.getElementById('message-attachment-button');
  const mic = document.getElementById('message-voice-button');
  const occupied = Boolean(pendingMessageAttachment);
  if (attach) attach.disabled = occupied || Boolean(activeVoiceRecording) || Boolean(messagesMediaBody?.disabled);
  if (mic) mic.disabled = occupied || Boolean(messagesMediaBody?.disabled);
  syncAttachmentSendState();
}

function createPendingPreview() {
  const container = document.getElementById('message-attachment-preview');
  if (!container) return;
  container.replaceChildren();
  container.hidden = !pendingMessageAttachment;
  messagesMediaComposer?.classList.toggle('has-message-attachment', Boolean(pendingMessageAttachment));
  if (!pendingMessageAttachment) {
    updateAttachmentControls();
    return;
  }

  const item = pendingMessageAttachment;
  const card = document.createElement('div');
  card.className = `message-attachment-preview-card ${item.kind}`;

  const visual = document.createElement('div');
  visual.className = 'message-attachment-preview-visual';
  if (item.kind === 'photo' && item.localUrl) {
    const image = document.createElement('img');
    image.src = item.localUrl;
    image.alt = 'Photo ready to send';
    visual.append(image);
  } else if (item.kind === 'voice' && item.localUrl) {
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.preload = 'metadata';
    audio.src = item.localUrl;
    visual.append(audio);
  } else {
    visual.append(svgIcon([
      'M7 3h7l5 5v13H7z',
      'M14 3v6h5',
    ]));
  }

  const copy = document.createElement('div');
  copy.className = 'message-attachment-preview-copy';
  const title = document.createElement('strong');
  title.textContent = item.kind === 'voice' ? 'Voice note' : (item.file?.name || 'Attachment');
  const detail = document.createElement('span');
  const status = item.status === 'uploading'
    ? 'Uploading…'
    : item.status === 'ready'
      ? 'Ready to send'
      : item.error || 'Upload failed';
  const suffix = item.kind === 'voice'
    ? `${formatDuration(item.durationMs)} · ${formatBytes(item.file?.size)}`
    : formatBytes(item.file?.size);
  detail.textContent = `${status}${suffix ? ` · ${suffix}` : ''}`;
  copy.append(title, detail);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'message-attachment-remove';
  remove.setAttribute('aria-label', 'Remove attachment');
  remove.title = 'Remove attachment';
  remove.append(svgIcon(['M6 6l12 12', 'M18 6 6 18']));
  remove.addEventListener('click', () => void clearPendingAttachment({ remote: true }));

  card.append(visual, copy, remove);
  container.append(card);
  updateAttachmentControls();
}

async function removeRemotePendingAttachment(id) {
  if (!id) return;
  try {
    const headers = await messagesAuthorizationHeaders();
    await fetch(`/api/dm-media/${encodeURIComponent(id)}`, { method: 'DELETE', headers });
  } catch {
    // Pending uploads expire server-side even if best-effort cleanup fails.
  }
}

async function clearPendingAttachment({ remote = false } = {}) {
  const id = pendingMessageAttachment?.id || '';
  clearPendingLocalUrl();
  pendingMessageAttachment = null;
  createPendingPreview();
  resetTextComposerState();
  if (remote && id) await removeRemotePendingAttachment(id);
}

async function uploadMessageAttachment(file, kind, durationMs = 0) {
  if (!file || !messagesMediaComposer) return;
  const conversationId = conversationIdFromLocation();
  if (!conversationId) {
    setMessagesMediaMessage('Open a conversation before adding an attachment.');
    return;
  }
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > DM_MEDIA_MAX_BYTES) {
    setMessagesMediaMessage('Message files must be 5 MB or smaller.');
    return;
  }

  const type = normalizedFileType(file, kind);
  if (!type) {
    setMessagesMediaMessage(kind === 'photo'
      ? 'Use a JPEG, PNG or WebP photo.'
      : 'Use PDF, TXT, CSV, RTF, DOC, DOCX, XLS, XLSX, PPT or PPTX files.');
    return;
  }

  if (pendingMessageAttachment) await clearPendingAttachment({ remote: true });
  setMessagesMediaMessage('');
  const localUrl = kind === 'photo' || kind === 'voice' ? trackObjectUrl(file) : '';
  pendingMessageAttachment = {
    id: '',
    kind,
    file,
    durationMs,
    localUrl,
    status: 'uploading',
    error: '',
  };
  createPendingPreview();

  try {
    const auth = await messagesAuthorizationHeaders();
    const headers = new Headers(auth);
    headers.set('Content-Type', type);
    headers.set('X-Sauti-Conversation-ID', conversationId);
    headers.set('X-Sauti-Media-Kind', kind);
    headers.set('X-Sauti-File-Name', encodeURIComponent(file.name || `${kind}-message`));
    headers.set('X-Sauti-Size-Bytes', String(file.size));
    if (kind === 'voice') headers.set('X-Sauti-Duration-Ms', String(Math.min(DM_VOICE_MAX_MS, Math.max(0, Math.round(durationMs)))));

    const response = await fetch('/api/dm-media/upload', {
      method: 'POST',
      headers,
      body: file,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.data?.id) {
      throw new Error(payload?.error?.message || 'The attachment could not be uploaded.');
    }

    if (!pendingMessageAttachment || pendingMessageAttachment.file !== file) {
      await removeRemotePendingAttachment(payload.data.id);
      return;
    }
    pendingMessageAttachment.id = payload.data.id;
    pendingMessageAttachment.remote = payload.data;
    pendingMessageAttachment.status = 'ready';
    createPendingPreview();
  } catch (error) {
    if (!pendingMessageAttachment || pendingMessageAttachment.file !== file) return;
    pendingMessageAttachment.status = 'error';
    pendingMessageAttachment.error = String(error?.message || 'The attachment could not be uploaded.');
    createPendingPreview();
    setMessagesMediaMessage(pendingMessageAttachment.error);
  }
}

function fileInputChanged(input) {
  const file = input.files?.[0] || null;
  input.value = '';
  if (!file) return;
  const extension = extensionOf(file.name);
  const kind = Object.hasOwn(DM_PHOTO_TYPES, extension) ? 'photo' : 'file';
  void uploadMessageAttachment(file, kind);
}

function preferredVoiceMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ];
  return candidates.find((value) => MediaRecorder.isTypeSupported?.(value)) || '';
}

function voiceExtension(type) {
  const base = String(type || '').split(';')[0].toLowerCase();
  if (base === 'audio/ogg') return 'ogg';
  if (base === 'audio/mp4') return 'm4a';
  return 'webm';
}

function renderRecordingState() {
  const node = document.getElementById('message-recording-state');
  const button = document.getElementById('message-voice-button');
  if (!node || !button) return;
  node.hidden = !activeVoiceRecording;
  button.classList.toggle('recording', Boolean(activeVoiceRecording));
  button.setAttribute('aria-label', activeVoiceRecording ? 'Stop voice recording' : 'Record voice note');
  button.title = activeVoiceRecording ? 'Stop recording' : 'Record voice note';
  if (!activeVoiceRecording) {
    node.replaceChildren();
    updateAttachmentControls();
    return;
  }

  const elapsed = Math.min(DM_VOICE_MAX_MS, Date.now() - activeVoiceRecording.startedAt);
  const dot = document.createElement('span');
  dot.className = 'message-recording-dot';
  dot.setAttribute('aria-hidden', 'true');
  const copy = document.createElement('span');
  copy.textContent = `Recording ${formatDuration(elapsed)} / 5:00`;
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => stopVoiceRecording(true));
  node.replaceChildren(dot, copy, cancel);
  updateAttachmentControls();
}

function finishVoiceRecording(recording) {
  if (!recording || recording.cancelled || !recording.chunks.length) return;
  const mimeType = String(recording.recorder.mimeType || recording.mimeType || 'audio/webm').split(';')[0].toLowerCase();
  const durationMs = Math.min(DM_VOICE_MAX_MS, Math.max(0, Date.now() - recording.startedAt));
  const blob = new Blob(recording.chunks, { type: mimeType });
  if (!blob.size) {
    setMessagesMediaMessage('No audio was recorded.');
    return;
  }
  if (blob.size > DM_MEDIA_MAX_BYTES) {
    setMessagesMediaMessage('This voice note is larger than 5 MB. Record a shorter note.');
    return;
  }
  const file = new File([blob], `voice-note-${Date.now()}.${voiceExtension(mimeType)}`, { type: mimeType });
  void uploadMessageAttachment(file, 'voice', durationMs);
}

function stopVoiceRecording(cancelled = false) {
  const recording = activeVoiceRecording;
  if (!recording) return;
  recording.cancelled = Boolean(cancelled);
  window.clearInterval(recording.tickTimer);
  window.clearTimeout(recording.limitTimer);
  recording.stream?.getTracks().forEach((track) => track.stop());
  if (recording.recorder?.state !== 'inactive') recording.recorder.stop();
  activeVoiceRecording = null;
  renderRecordingState();
}

async function startVoiceRecording() {
  if (pendingMessageAttachment || activeVoiceRecording) {
    if (activeVoiceRecording) stopVoiceRecording(false);
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    setMessagesMediaMessage('Voice recording is not supported by this browser.');
    return;
  }

  const mimeType = preferredVoiceMimeType();
  if (!mimeType) {
    setMessagesMediaMessage('This browser does not support a voice-note format SautiLink can store yet.');
    return;
  }

  try {
    setMessagesMediaMessage('');
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 64000 });
    const recording = {
      recorder,
      stream,
      mimeType,
      chunks: [],
      startedAt: Date.now(),
      tickTimer: 0,
      limitTimer: 0,
      cancelled: false,
    };
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data?.size) recording.chunks.push(event.data);
    });
    recorder.addEventListener('stop', () => finishVoiceRecording(recording), { once: true });
    recorder.addEventListener('error', () => {
      setMessagesMediaMessage('Voice recording stopped unexpectedly. Try again.');
      stopVoiceRecording(true);
    }, { once: true });

    activeVoiceRecording = recording;
    recorder.start(1000);
    recording.tickTimer = window.setInterval(renderRecordingState, 250);
    recording.limitTimer = window.setTimeout(() => stopVoiceRecording(false), DM_VOICE_MAX_MS);
    renderRecordingState();
  } catch (error) {
    const denied = String(error?.name || '') === 'NotAllowedError';
    setMessagesMediaMessage(denied
      ? 'Microphone permission is required to record a voice note.'
      : 'SautiLink could not start the microphone on this device.');
  }
}

async function sendPendingAttachment(event) {
  if (!pendingMessageAttachment) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (pendingMessageAttachment.status !== 'ready' || !pendingMessageAttachment.id) {
    setMessagesMediaMessage('Finish uploading the attachment before sending.');
    return;
  }

  const conversationId = conversationIdFromLocation();
  if (!conversationId) {
    setMessagesMediaMessage('Open the conversation again before sending.');
    return;
  }
  const body = messagesMediaBody?.value.trim() || '';
  if (body.length > 4000) {
    setMessagesMediaMessage('Keep messages within 4,000 characters.');
    return;
  }

  messagesMediaSend.disabled = true;
  messagesMediaSend.setAttribute('aria-busy', 'true');
  setMessagesMediaMessage('');
  try {
    const headers = new Headers(await messagesAuthorizationHeaders());
    headers.set('Content-Type', 'application/json');
    const response = await fetch(`/api/dm-media/send/${encodeURIComponent(pendingMessageAttachment.id)}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ conversation_id: conversationId, body }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error?.message || 'The attachment could not be sent.');

    clearPendingLocalUrl();
    pendingMessageAttachment = null;
    createPendingPreview();
    if (messagesMediaBody) messagesMediaBody.value = '';
    resetTextComposerState();
  } catch (error) {
    setMessagesMediaMessage(String(error?.message || 'The attachment could not be sent.'));
    syncAttachmentSendState();
  } finally {
    messagesMediaSend.removeAttribute('aria-busy');
  }
}

async function protectedMediaBlob(attachment) {
  const headers = await messagesAuthorizationHeaders();
  const response = await fetch(attachment.media_url, { headers });
  if (!response.ok) throw new Error('MEDIA_LOAD_FAILED');
  return response.blob();
}

function attachObjectUrlToNode(node, url) {
  node.dataset.dmObjectUrl = url;
}

async function loadPhotoNode(figure, attachment) {
  if (figure.dataset.loaded === 'true' || figure.dataset.loading === 'true') return;
  figure.dataset.loading = 'true';
  try {
    const blob = await protectedMediaBlob(attachment);
    const url = trackObjectUrl(blob);
    const image = document.createElement('img');
    image.src = url;
    image.alt = 'Photo message';
    image.loading = 'lazy';
    image.decoding = 'async';
    attachObjectUrlToNode(image, url);
    figure.replaceChildren(image);
    figure.dataset.loaded = 'true';
  } catch {
    figure.textContent = 'Photo unavailable';
    figure.classList.add('error');
  } finally {
    delete figure.dataset.loading;
  }
}

const photoObserver = typeof IntersectionObserver === 'function'
  ? new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        photoObserver.unobserve(entry.target);
        const attachment = entry.target.__dmAttachment;
        if (attachment) void loadPhotoNode(entry.target, attachment);
      });
    }, { rootMargin: '320px 0px' })
  : null;

function renderPhotoAttachment(attachment) {
  const figure = document.createElement('figure');
  figure.className = 'dm-media-card dm-media-photo';
  figure.textContent = 'Loading photo…';
  figure.__dmAttachment = attachment;
  if (attachment.width && attachment.height) figure.style.aspectRatio = `${attachment.width} / ${attachment.height}`;
  if (photoObserver) photoObserver.observe(figure);
  else void loadPhotoNode(figure, attachment);
  return figure;
}

function renderVoiceAttachment(attachment) {
  const wrapper = document.createElement('div');
  wrapper.className = 'dm-media-card dm-media-voice';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'dm-media-voice-load';
  button.append(svgIcon(['M9 6l9 6-9 6z']));
  const label = document.createElement('span');
  label.textContent = `Voice note · ${formatDuration(attachment.duration_ms)}`;
  button.append(label);
  button.addEventListener('click', async () => {
    button.disabled = true;
    label.textContent = 'Loading voice note…';
    try {
      const blob = await protectedMediaBlob(attachment);
      const url = trackObjectUrl(blob);
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.preload = 'metadata';
      audio.src = url;
      attachObjectUrlToNode(audio, url);
      wrapper.replaceChildren(audio);
      void audio.play().catch(() => {});
    } catch {
      button.disabled = false;
      label.textContent = 'Voice note unavailable';
    }
  });
  wrapper.append(button);
  return wrapper;
}

function renderFileAttachment(attachment) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'dm-media-card dm-media-file';
  button.append(svgIcon(['M7 3h7l5 5v13H7z', 'M14 3v6h5']));
  const copy = document.createElement('span');
  const title = document.createElement('strong');
  title.textContent = attachment.original_name || 'File';
  const detail = document.createElement('small');
  detail.textContent = `${formatBytes(attachment.size_bytes)} · Download`;
  copy.append(title, detail);
  button.append(copy);
  button.addEventListener('click', async () => {
    if (button.dataset.loading === 'true') return;
    button.dataset.loading = 'true';
    detail.textContent = 'Downloading…';
    try {
      const blob = await protectedMediaBlob(attachment);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = attachment.original_name || 'SautiLink-file';
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      detail.textContent = `${formatBytes(attachment.size_bytes)} · Download`;
    } catch {
      detail.textContent = 'File unavailable';
    } finally {
      delete button.dataset.loading;
    }
  });
  return button;
}

function decorateMessageCard(card, attachment) {
  if (!card || card.dataset.dmMediaRendered === 'true') return;
  const body = card.querySelector(':scope > p');
  if (body && !body.textContent.trim()) body.hidden = true;
  const meta = card.querySelector('.dm-message-meta');
  const media = attachment.media_kind === 'photo'
    ? renderPhotoAttachment(attachment)
    : attachment.media_kind === 'voice'
      ? renderVoiceAttachment(attachment)
      : renderFileAttachment(attachment);
  card.insertBefore(media, meta || null);
  card.dataset.dmMediaRendered = 'true';
}

async function hydrateThreadAttachments() {
  if (!messagesMediaFeed || !conversationIdFromLocation()) return;
  const cards = [...messagesMediaFeed.querySelectorAll('.dm-message[data-message-id]:not([data-dm-media-checked])')];
  if (!cards.length) return;
  const ids = cards.map((card) => card.dataset.messageId).filter(Boolean).slice(0, 200);
  if (!ids.length) return;

  try {
    const headers = await messagesAuthorizationHeaders();
    const response = await fetch(`/api/dm-media/messages?ids=${encodeURIComponent(ids.join(','))}`, { headers });
    const payload = await response.json().catch(() => null);
    if (!response.ok) return;
    const attachments = Array.isArray(payload?.data?.attachments) ? payload.data.attachments : [];
    const byMessage = new Map(attachments.map((attachment) => [String(attachment.message_id), attachment]));
    cards.forEach((card) => {
      const attachment = byMessage.get(String(card.dataset.messageId || ''));
      if (attachment) decorateMessageCard(card, attachment);
      card.dataset.dmMediaChecked = 'true';
    });
  } catch {
    // Text messages remain fully usable when attachment hydration is temporarily unavailable.
  }
}

function queueThreadAttachmentHydration() {
  window.clearTimeout(messageMediaHydrateTimer);
  messageMediaHydrateTimer = window.setTimeout(() => void hydrateThreadAttachments(), 80);
}

function initializeMessagesMediaUi() {
  if (!messagesMediaSurface || !messagesMediaComposer || !messagesMediaBody || !messagesMediaSend) return;
  if (messagesMediaComposer.dataset.messagesMediaReady === 'true') return;
  messagesMediaComposer.dataset.messagesMediaReady = 'true';
  ensureMessagesMediaStyles();

  const controls = document.createElement('div');
  controls.className = 'message-media-controls';

  const attach = document.createElement('button');
  attach.type = 'button';
  attach.id = 'message-attachment-button';
  attach.className = 'message-media-control';
  attach.setAttribute('aria-label', 'Attach photo or file');
  attach.title = 'Attach photo or file';
  attach.append(svgIcon([
    'M8.5 12.5 14 7a3 3 0 0 1 4.2 4.2l-7.4 7.4a5 5 0 0 1-7.1-7.1l7.8-7.8',
    'M6.5 13.5 14.5 5.5',
  ]));

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.id = 'message-attachment-input';
  fileInput.hidden = true;
  fileInput.accept = '.jpg,.jpeg,.png,.webp,.pdf,.txt,.csv,.rtf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,image/jpeg,image/png,image/webp,application/pdf,text/plain,text/csv,application/rtf';
  fileInput.addEventListener('change', () => fileInputChanged(fileInput));
  attach.addEventListener('click', () => fileInput.click());

  const mic = document.createElement('button');
  mic.type = 'button';
  mic.id = 'message-voice-button';
  mic.className = 'message-media-control';
  mic.setAttribute('aria-label', 'Record voice note');
  mic.title = 'Record voice note';
  mic.append(svgIcon([
    'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z',
    'M5.5 11.5a6.5 6.5 0 0 0 13 0',
    'M12 18v3',
    'M9 21h6',
  ]));
  mic.addEventListener('click', () => void startVoiceRecording());

  controls.append(attach, mic, fileInput);

  const preview = document.createElement('div');
  preview.id = 'message-attachment-preview';
  preview.className = 'message-attachment-preview';
  preview.hidden = true;

  const recording = document.createElement('div');
  recording.id = 'message-recording-state';
  recording.className = 'message-recording-state';
  recording.setAttribute('role', 'status');
  recording.setAttribute('aria-live', 'polite');
  recording.hidden = true;

  messagesMediaComposer.prepend(controls);
  messagesMediaComposer.prepend(preview);
  messagesMediaComposer.prepend(recording);

  const legacyLabel = messagesMediaComposer.querySelector('.message-composer-actions > span');
  if (legacyLabel) legacyLabel.textContent = 'Media up to 5 MB';

  messagesMediaComposer.addEventListener('submit', (event) => void sendPendingAttachment(event), true);
  messagesMediaBody.addEventListener('input', () => {
    if (pendingMessageAttachment) window.setTimeout(syncAttachmentSendState, 0);
  });

  new MutationObserver(() => {
    if (pendingMessageAttachment) window.queueMicrotask(syncAttachmentSendState);
  }).observe(messagesMediaSend, { attributes: true, attributeFilter: ['disabled'] });

  if (messagesMediaFeed) {
    new MutationObserver((records) => {
      records.forEach((record) => record.removedNodes.forEach(revokeUrlsInside));
      queueThreadAttachmentHydration();
    }).observe(messagesMediaFeed, { childList: true, subtree: false });
  }

  new MutationObserver(() => {
    if ((messagesMediaSurface.hidden || document.getElementById('message-thread')?.hidden) && activeVoiceRecording) {
      stopVoiceRecording(true);
    }
    updateAttachmentControls();
  }).observe(messagesMediaSurface, { attributes: true, subtree: true, attributeFilter: ['hidden'] });

  window.addEventListener('popstate', queueThreadAttachmentHydration);
  window.addEventListener('beforeunload', () => {
    hydratedMediaUrls.forEach((url) => URL.revokeObjectURL(url));
    hydratedMediaUrls.clear();
    if (activeVoiceRecording) stopVoiceRecording(true);
  });

  updateAttachmentControls();
  queueThreadAttachmentHydration();
}

initializeMessagesMediaUi();
