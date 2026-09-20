const PROFILE_MEDIA_UPLOAD_BUTTONS = Object.freeze([
  {
    id: 'profile-avatar-upload-button',
    label: 'Upload profile photo',
  },
  {
    id: 'profile-header-upload-button',
    label: 'Upload header image',
  },
]);

const PROFILE_MEDIA_EDITOR_STYLESHEET_ID = 'sautilink-profile-media-editor';
const PROFILE_MEDIA_EDITOR_STYLESHEET = '/app/assets/profile-media-editor.css?v=20260920-mediaeditor1';
const PROFILE_MEDIA_EDITOR_CONFIG = Object.freeze({
  'profile-avatar-file': Object.freeze({
    slot: 'avatar',
    title: 'Adjust profile photo',
    cropLabel: 'Square crop',
    previewWidth: 640,
    previewHeight: 640,
    outputWidth: 1024,
    outputHeight: 1024,
    maxBytes: 5 * 1024 * 1024,
  }),
  'profile-header-file': Object.freeze({
    slot: 'header',
    title: 'Adjust header image',
    cropLabel: 'Wide crop',
    previewWidth: 960,
    previewHeight: 320,
    outputWidth: 1500,
    outputHeight: 500,
    maxBytes: 8 * 1024 * 1024,
  }),
});

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
let profileMediaEditorSession = null;
let profileMediaEditorOpenRequest = 0;

function profileMediaUploadIcon() {
  const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.9');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.dataset.profileMediaUploadIcon = 'true';

  const arrow = document.createElementNS(SVG_NAMESPACE, 'path');
  arrow.setAttribute('d', 'M12 15V4m0 0L7.8 8.2M12 4l4.2 4.2');
  const tray = document.createElementNS(SVG_NAMESPACE, 'path');
  tray.setAttribute('d', 'M5 14.5v3.1A2.4 2.4 0 0 0 7.4 20h9.2a2.4 2.4 0 0 0 2.4-2.4v-3.1');
  svg.append(arrow, tray);
  return svg;
}

function hasUploadIcon(button) {
  return button.children.length === 1
    && button.firstElementChild?.matches('svg[data-profile-media-upload-icon="true"]');
}

function iconifyProfileMediaUploadButton(button, label) {
  if (!button || hasUploadIcon(button)) return;

  const currentText = String(button.textContent || '').trim();
  if (!button.dataset.defaultLabel && currentText) {
    button.dataset.defaultLabel = currentText;
  }

  const busy = /^uploading\b/i.test(currentText);
  button.replaceChildren(profileMediaUploadIcon());
  button.dataset.profileMediaIconified = 'true';
  button.setAttribute('aria-label', busy && currentText ? currentText : label);
  button.title = label;
  if (busy) button.setAttribute('aria-busy', 'true');
  else button.removeAttribute('aria-busy');
}

function watchProfileMediaUploadButton({ id, label }) {
  const button = document.getElementById(id);
  if (!button) return;

  iconifyProfileMediaUploadButton(button, label);
  const observer = new MutationObserver(() => {
    if (hasUploadIcon(button)) return;
    iconifyProfileMediaUploadButton(button, label);
  });
  observer.observe(button, { childList: true, characterData: true, subtree: true });
}

function ensureProfileMediaEditorStylesheet() {
  if (document.getElementById(PROFILE_MEDIA_EDITOR_STYLESHEET_ID)) return;
  const link = document.createElement('link');
  link.id = PROFILE_MEDIA_EDITOR_STYLESHEET_ID;
  link.rel = 'stylesheet';
  link.href = PROFILE_MEDIA_EDITOR_STYLESHEET;
  document.head.append(link);
}

function hideProfileMediaReadinessPill() {
  const state = document.getElementById('profile-media-state');
  if (!state) return;
  if (!state.hidden) state.hidden = true;
  if (state.getAttribute('aria-hidden') !== 'true') state.setAttribute('aria-hidden', 'true');
}

function profileMediaEditorDialog() {
  let dialog = document.getElementById('profile-media-editor-dialog');
  if (dialog) return dialog;

  dialog = document.createElement('dialog');
  dialog.id = 'profile-media-editor-dialog';
  dialog.className = 'profile-media-editor-dialog';
  dialog.setAttribute('aria-labelledby', 'profile-media-editor-title');
  dialog.innerHTML = `
    <div class="profile-media-editor-shell">
      <header class="profile-media-editor-header">
        <div>
          <strong id="profile-media-editor-title">Adjust photo</strong>
          <small id="profile-media-editor-subtitle">Drag to crop, then rotate or resize before saving.</small>
        </div>
        <button class="profile-media-editor-close" id="profile-media-editor-close" type="button" aria-label="Close image editor" title="Close">×</button>
      </header>
      <div class="profile-media-editor-stage" id="profile-media-editor-stage" aria-busy="false">
        <canvas id="profile-media-editor-canvas" aria-label="Image crop preview"></canvas>
        <div class="profile-media-editor-loading" id="profile-media-editor-loading" hidden>Preparing image…</div>
      </div>
      <p class="profile-media-editor-help" id="profile-media-editor-help">Drag the photo to choose the crop area.</p>
      <div class="profile-media-editor-controls">
        <div class="profile-media-editor-control-group" aria-label="Rotate image">
          <button type="button" id="profile-media-editor-rotate-left">Rotate left</button>
          <button type="button" id="profile-media-editor-rotate-right">Rotate right</button>
        </div>
        <label class="profile-media-editor-zoom" for="profile-media-editor-zoom">
          <span>Resize / zoom</span>
          <input id="profile-media-editor-zoom" type="range" min="100" max="300" step="1" value="100">
          <output id="profile-media-editor-zoom-value" for="profile-media-editor-zoom">100%</output>
        </label>
        <button class="profile-media-editor-reset" type="button" id="profile-media-editor-reset">Reset</button>
      </div>
      <div class="profile-media-editor-message" id="profile-media-editor-message" role="alert" hidden></div>
      <footer class="profile-media-editor-actions">
        <button type="button" class="profile-media-editor-cancel" id="profile-media-editor-cancel">Cancel</button>
        <button type="button" class="profile-media-editor-apply" id="profile-media-editor-apply" disabled>Use photo</button>
      </footer>
    </div>`;
  document.body.append(dialog);

  const canvas = dialog.querySelector('#profile-media-editor-canvas');
  const zoom = dialog.querySelector('#profile-media-editor-zoom');

  dialog.querySelector('#profile-media-editor-close')?.addEventListener('click', () => closeProfileMediaEditor({ clearInput: true }));
  dialog.querySelector('#profile-media-editor-cancel')?.addEventListener('click', () => closeProfileMediaEditor({ clearInput: true }));
  dialog.querySelector('#profile-media-editor-reset')?.addEventListener('click', resetProfileMediaEditor);
  dialog.querySelector('#profile-media-editor-rotate-left')?.addEventListener('click', () => rotateProfileMediaEditor(-90));
  dialog.querySelector('#profile-media-editor-rotate-right')?.addEventListener('click', () => rotateProfileMediaEditor(90));
  dialog.querySelector('#profile-media-editor-apply')?.addEventListener('click', applyProfileMediaEditor);
  zoom?.addEventListener('input', () => {
    if (!profileMediaEditorSession) return;
    profileMediaEditorSession.zoom = Math.max(1, Number(zoom.value || 100) / 100);
    dialog.querySelector('#profile-media-editor-zoom-value').textContent = `${Math.round(profileMediaEditorSession.zoom * 100)}%`;
    clampProfileMediaEditorOffsets();
    drawProfileMediaEditor();
  });

  canvas?.addEventListener('pointerdown', (event) => {
    const session = profileMediaEditorSession;
    if (!session?.source) return;
    const rect = canvas.getBoundingClientRect();
    session.drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: session.offsetX,
      offsetY: session.offsetY,
      scaleX: canvas.width / Math.max(1, rect.width),
      scaleY: canvas.height / Math.max(1, rect.height),
    };
    canvas.setPointerCapture?.(event.pointerId);
    canvas.classList.add('dragging');
    event.preventDefault();
  });

  canvas?.addEventListener('pointermove', (event) => {
    const session = profileMediaEditorSession;
    const drag = session?.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    session.offsetX = drag.offsetX + (event.clientX - drag.startX) * drag.scaleX;
    session.offsetY = drag.offsetY + (event.clientY - drag.startY) * drag.scaleY;
    clampProfileMediaEditorOffsets();
    drawProfileMediaEditor();
    event.preventDefault();
  });

  const stopDragging = (event) => {
    const session = profileMediaEditorSession;
    if (!session?.drag || session.drag.pointerId !== event.pointerId) return;
    session.drag = null;
    canvas?.classList.remove('dragging');
    canvas?.releasePointerCapture?.(event.pointerId);
  };
  canvas?.addEventListener('pointerup', stopDragging);
  canvas?.addEventListener('pointercancel', stopDragging);

  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeProfileMediaEditor({ clearInput: true });
  });

  return dialog;
}

function editorMessage(message = '') {
  const node = document.getElementById('profile-media-editor-message');
  if (!node) return;
  node.textContent = message;
  node.hidden = !message;
}

function setEditorLoading(loading) {
  const stage = document.getElementById('profile-media-editor-stage');
  const loadingNode = document.getElementById('profile-media-editor-loading');
  const apply = document.getElementById('profile-media-editor-apply');
  stage?.setAttribute('aria-busy', String(Boolean(loading)));
  if (loadingNode) loadingNode.hidden = !loading;
  if (apply) apply.disabled = loading || !profileMediaEditorSession?.source;
}

function normalizedRotation(value) {
  return ((Number(value || 0) % 360) + 360) % 360;
}

function rotatedImageDimensions(session) {
  const quarterTurn = normalizedRotation(session.rotation) % 180 !== 0;
  return quarterTurn
    ? { width: session.sourceHeight, height: session.sourceWidth }
    : { width: session.sourceWidth, height: session.sourceHeight };
}

function profileMediaEditorScale(session, width, height) {
  const dimensions = rotatedImageDimensions(session);
  const coverScale = Math.max(width / dimensions.width, height / dimensions.height);
  return coverScale * session.zoom;
}

function clampProfileMediaEditorOffsets() {
  const session = profileMediaEditorSession;
  const canvas = document.getElementById('profile-media-editor-canvas');
  if (!session?.source || !canvas?.width || !canvas?.height) return;
  const dimensions = rotatedImageDimensions(session);
  const scale = profileMediaEditorScale(session, canvas.width, canvas.height);
  const maxX = Math.max(0, (dimensions.width * scale - canvas.width) / 2);
  const maxY = Math.max(0, (dimensions.height * scale - canvas.height) / 2);
  session.offsetX = Math.min(maxX, Math.max(-maxX, session.offsetX));
  session.offsetY = Math.min(maxY, Math.max(-maxY, session.offsetY));
}

function drawProfileMediaEditor(targetCanvas = document.getElementById('profile-media-editor-canvas'), { output = false } = {}) {
  const session = profileMediaEditorSession;
  if (!session?.source || !targetCanvas) return;
  const context = targetCanvas.getContext('2d', { alpha: true });
  if (!context) return;

  const offsetScaleX = output ? targetCanvas.width / session.config.previewWidth : 1;
  const offsetScaleY = output ? targetCanvas.height / session.config.previewHeight : 1;
  const offsetX = session.offsetX * offsetScaleX;
  const offsetY = session.offsetY * offsetScaleY;
  const scale = profileMediaEditorScale(session, targetCanvas.width, targetCanvas.height);

  context.save();
  context.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.translate(targetCanvas.width / 2 + offsetX, targetCanvas.height / 2 + offsetY);
  context.rotate(normalizedRotation(session.rotation) * Math.PI / 180);
  context.scale(scale, scale);
  context.drawImage(
    session.source,
    -session.sourceWidth / 2,
    -session.sourceHeight / 2,
    session.sourceWidth,
    session.sourceHeight,
  );
  context.restore();
}

function releaseProfileMediaEditorSource() {
  const source = profileMediaEditorSession?.source;
  if (source && typeof source.close === 'function') {
    try { source.close(); } catch { /* ImageBitmap cleanup is best effort. */ }
  }
}

function closeProfileMediaEditor({ clearInput = false } = {}) {
  const dialog = document.getElementById('profile-media-editor-dialog');
  const input = profileMediaEditorSession?.input;
  releaseProfileMediaEditorSource();
  profileMediaEditorSession = null;
  if (clearInput && input) input.value = '';
  if (dialog?.open && typeof dialog.close === 'function') dialog.close();
  else dialog?.removeAttribute('open');
  editorMessage('');
}

async function loadProfileMediaEditorImage(file) {
  if ('createImageBitmap' in window) {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bitmap, width: bitmap.width, height: bitmap.height };
    } catch {
      try {
        const bitmap = await createImageBitmap(file);
        return { source: bitmap, width: bitmap.width, height: bitmap.height };
      } catch {
        // Fall back to an HTML image below.
      }
    }
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = objectUrl;
    if (typeof image.decode === 'function') await image.decode();
    else await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('The selected image could not be opened.'));
    });
    return { source: image, width: image.naturalWidth, height: image.naturalHeight };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function resetProfileMediaEditor() {
  const session = profileMediaEditorSession;
  if (!session?.source) return;
  session.rotation = 0;
  session.zoom = 1;
  session.offsetX = 0;
  session.offsetY = 0;
  session.drag = null;
  const zoom = document.getElementById('profile-media-editor-zoom');
  const zoomValue = document.getElementById('profile-media-editor-zoom-value');
  if (zoom) zoom.value = '100';
  if (zoomValue) zoomValue.textContent = '100%';
  clampProfileMediaEditorOffsets();
  drawProfileMediaEditor();
}

function rotateProfileMediaEditor(delta) {
  const session = profileMediaEditorSession;
  if (!session?.source) return;
  session.rotation = normalizedRotation(session.rotation + delta);
  session.offsetX = 0;
  session.offsetY = 0;
  clampProfileMediaEditorOffsets();
  drawProfileMediaEditor();
}

function preferredEditedMimeType(file) {
  const type = String(file?.type || '').toLowerCase();
  if (type === 'image/png' || type === 'image/webp' || type === 'image/jpeg') return type;
  return 'image/jpeg';
}

function editedFileName(fileName, mimeType) {
  const base = String(fileName || 'profile-image').replace(/\.[^.]+$/, '') || 'profile-image';
  const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  return `${base}-edited.${extension}`;
}

function canvasBlob(canvas, type, quality = 0.92) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('The edited image could not be prepared.'));
    }, type, quality);
  });
}

async function applyProfileMediaEditor() {
  const session = profileMediaEditorSession;
  if (!session?.source || !session.input) return;
  const apply = document.getElementById('profile-media-editor-apply');
  if (apply) {
    apply.disabled = true;
    apply.setAttribute('aria-busy', 'true');
    apply.textContent = 'Preparing…';
  }
  editorMessage('');

  try {
    const output = document.createElement('canvas');
    output.width = session.config.outputWidth;
    output.height = session.config.outputHeight;
    drawProfileMediaEditor(output, { output: true });

    const mimeType = preferredEditedMimeType(session.file);
    const blob = await canvasBlob(output, mimeType);
    const editedFile = new File([blob], editedFileName(session.file.name, mimeType), {
      type: mimeType,
      lastModified: Date.now(),
    });

    if (editedFile.size > session.config.maxBytes) {
      throw new Error(`The edited image is still too large. Keep it under ${Math.round(session.config.maxBytes / 1024 / 1024)} MB.`);
    }

    const transfer = new DataTransfer();
    transfer.items.add(editedFile);
    session.input.dataset.profileMediaEditorBypass = 'true';
    session.input.files = transfer.files;
    const input = session.input;
    closeProfileMediaEditor({ clearInput: false });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  } catch (error) {
    editorMessage(error?.message || 'The edited image could not be prepared.');
    if (apply) {
      apply.disabled = false;
      apply.removeAttribute('aria-busy');
      apply.textContent = 'Use photo';
    }
  }
}

async function openProfileMediaEditor(input, file, config) {
  const dialog = profileMediaEditorDialog();
  const requestId = ++profileMediaEditorOpenRequest;
  closeProfileMediaEditor({ clearInput: false });

  profileMediaEditorSession = {
    input,
    file,
    config,
    source: null,
    sourceWidth: 0,
    sourceHeight: 0,
    rotation: 0,
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    drag: null,
  };

  const canvas = dialog.querySelector('#profile-media-editor-canvas');
  const stage = dialog.querySelector('#profile-media-editor-stage');
  canvas.width = config.previewWidth;
  canvas.height = config.previewHeight;
  stage.dataset.slot = config.slot;
  dialog.querySelector('#profile-media-editor-title').textContent = config.title;
  dialog.querySelector('#profile-media-editor-subtitle').textContent = `${config.cropLabel} · drag to crop, rotate, or resize before updating.`;
  dialog.querySelector('#profile-media-editor-help').textContent = 'Drag the photo to reposition the crop. Use the slider to resize it.';
  dialog.querySelector('#profile-media-editor-zoom').value = '100';
  dialog.querySelector('#profile-media-editor-zoom-value').textContent = '100%';
  dialog.querySelector('#profile-media-editor-apply').textContent = 'Use photo';
  dialog.querySelector('#profile-media-editor-apply').removeAttribute('aria-busy');
  editorMessage('');
  setEditorLoading(true);

  if (!dialog.open) {
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  try {
    const decoded = await loadProfileMediaEditorImage(file);
    if (requestId !== profileMediaEditorOpenRequest || !profileMediaEditorSession) {
      if (typeof decoded.source?.close === 'function') decoded.source.close();
      return;
    }
    if (!decoded.width || !decoded.height) throw new Error('The selected image has invalid dimensions.');
    profileMediaEditorSession.source = decoded.source;
    profileMediaEditorSession.sourceWidth = decoded.width;
    profileMediaEditorSession.sourceHeight = decoded.height;
    clampProfileMediaEditorOffsets();
    drawProfileMediaEditor();
    setEditorLoading(false);
  } catch (error) {
    if (requestId !== profileMediaEditorOpenRequest) return;
    setEditorLoading(false);
    editorMessage(error?.message || 'The selected image could not be opened.');
  }
}

function interceptProfileMediaFileSelection(event) {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || input.type !== 'file') return;
  const config = PROFILE_MEDIA_EDITOR_CONFIG[input.id];
  if (!config) return;

  if (input.dataset.profileMediaEditorBypass === 'true') {
    delete input.dataset.profileMediaEditorBypass;
    return;
  }

  const file = input.files?.[0];
  if (!file) return;
  event.stopPropagation();
  event.preventDefault();
  input.value = '';

  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    const message = document.getElementById('profile-media-message');
    if (message) {
      message.textContent = 'Choose a JPEG, PNG or WebP image.';
      message.hidden = false;
    }
    return;
  }
  if (file.size > config.maxBytes) {
    const message = document.getElementById('profile-media-message');
    if (message) {
      message.textContent = `Choose an image under ${Math.round(config.maxBytes / 1024 / 1024)} MB.`;
      message.hidden = false;
    }
    return;
  }

  void openProfileMediaEditor(input, file, config);
}

function installProfileMediaEditor() {
  ensureProfileMediaEditorStylesheet();
  hideProfileMediaReadinessPill();
  document.addEventListener('change', interceptProfileMediaFileSelection, true);
}

function installProfileMediaUploadIcons() {
  for (const config of PROFILE_MEDIA_UPLOAD_BUTTONS) {
    watchProfileMediaUploadButton(config);
  }
  installProfileMediaEditor();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installProfileMediaUploadIcons, { once: true });
} else {
  installProfileMediaUploadIcons();
}
