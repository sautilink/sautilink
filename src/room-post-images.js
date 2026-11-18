import { roomPublishRequestId, confirmRoomPublishRequest, roomPublishOutcome } from './room-publish-outcome.js';
import { POST_BODY_LIMIT } from './post-text-formatting.js';
import { POST_VIDEO_LIMIT } from './post-media-policy.js';
import { uploadPostMedia } from './post-media-upload.js';
const ROOM_POST_IMAGE_LIMIT = 5;
const ROOM_POST_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const ROOM_POST_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'video/mp4']);
const ROOM_POST_SUPABASE_URL = 'https://rggpyiterdbbugluejcs.supabase.co';
const ROOM_POST_SUPABASE_KEY = 'sb_publishable_omJ-5Mem-K4vgm6WLXRzJQ_jeGs65ca';
const ROOM_POST_AUTH_KEY = 'sautilink.auth.session';

let roomPostImages = [];
let roomPostImageRoomSlug = '';
let roomPostImageSubmitting = false;

function roomPostNode(id) {
  return document.getElementById(id);
}

function roomPostAccessToken() {
  const keys = [
    ROOM_POST_AUTH_KEY,
    ...Object.keys(localStorage).filter((key) => key.startsWith('sb-') && key.endsWith('-auth-token')),
  ];
  for (const key of keys) {
    try {
      const stored = JSON.parse(localStorage.getItem(key) || 'null');
      const value = stored?.access_token || stored?.currentSession?.access_token || stored?.session?.access_token;
      if (value) return String(value);
    } catch {
      // Ignore malformed unrelated browser state.
    }
  }
  return '';
}

function roomPostSlug() {
  return location.pathname.match(/^\/(?:app\/)?(?:rooms|sautify|circles)\/([a-z0-9][a-z0-9-]{2,49})\/?$/i)?.[1] || '';
}

function roomPostMessage(text, success = false) {
  const node = roomPostNode('circle-sauti-message');
  if (!node) return;
  node.textContent = text || '';
  node.className = `form-message${success ? ' success' : ''}`;
  node.hidden = !text;
}

function ensureRoomPostImageStyles() {
  if (document.querySelector('link[data-room-post-images]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/app/assets/room-post-images.css?v=20260910-roompost1';
  link.dataset.roomPostImages = 'true';
  document.head.append(link);
}

function roomPostImageStatus(item) {
  if (item.status === 'uploading') return 'Uploading…';
  if (item.status === 'finalizing') return 'Finishing…';
  if (item.status === 'ready') return 'Ready';
  if (item.status === 'error') return item.error || 'Upload failed';
  return 'Preparing…';
}

function renderRoomPostImages() {
  const root = roomPostNode('room-post-image-preview');
  const count = roomPostNode('room-post-image-count');
  const add = roomPostNode('room-post-image-add');
  if (!root || !count || !add) return;

  const form = roomPostNode('circle-sauti-composer');
  form.dataset.roomAttachments = String(roomPostImages.length);
  form.dataset.roomAttachmentsReady = String(roomPostImages.every((item) => item.status === 'ready' && item.id));
  form.dispatchEvent(new Event('sautilink:room-attachments'));
  count.textContent = `${roomPostImages.length} / ${ROOM_POST_IMAGE_LIMIT}`;
  add.disabled = roomPostImages.length >= ROOM_POST_IMAGE_LIMIT || roomPostImageSubmitting;
  root.hidden = roomPostImages.length === 0;
  root.replaceChildren();

  roomPostImages.forEach((item) => {
    const tile = document.createElement('div');
    tile.className = 'room-post-image-tile';
    tile.dataset.roomPostImageId = item.localId;

    const image = document.createElement(item.type === 'video/mp4' ? 'video' : 'img');
    image.src = item.localUrl;
    if (image.tagName === 'VIDEO') {
      image.preload = 'metadata';
      image.muted = true;
      image.playsInline = true;
      image.setAttribute('aria-label', item.name);
    } else image.alt = '';

    const status = document.createElement('span');
    status.className = `room-post-image-status ${item.status}`;
    status.textContent = roomPostImageStatus(item);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'room-post-image-remove';
    remove.setAttribute('aria-label', `Remove ${item.name || 'image'}`);
    remove.setAttribute('title', 'Remove image');
    remove.textContent = '×';
    remove.disabled = roomPostImageSubmitting;
    remove.addEventListener('click', () => void removeRoomPostImage(item.localId));

    tile.append(image, status, remove);

    if (item.status === 'error') {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'room-post-image-retry';
      retry.textContent = 'Retry';
      retry.addEventListener('click', () => void uploadRoomPostImage(item.localId));
      tile.append(retry);
    }

    root.append(tile);
  });
}

async function removeRemoteRoomPostImage(id) {
  const token = roomPostAccessToken();
  if (!id || !token) return;
  await fetch(`/api/sauti-media/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => null);
}

async function removeRoomPostImage(localId, { remote = true } = {}) {
  const item = roomPostImages.find((entry) => entry.localId === localId);
  if (!item) return;
  roomPostImages = roomPostImages.filter((entry) => entry.localId !== localId);
  if (item.localUrl) URL.revokeObjectURL(item.localUrl);
  renderRoomPostImages();
  roomPostNode('circle-sauti-body')?.dispatchEvent(new Event('input', { bubbles: true }));
  if (remote && item.id) await removeRemoteRoomPostImage(item.id);
  if (!roomPostImages.length) roomPostImageRoomSlug = '';
}

async function uploadRoomPostImage(localId) {
  const item = roomPostImages.find((entry) => entry.localId === localId);
  if (!item?.file || roomPostImageSubmitting) return;
  const token = roomPostAccessToken();
  if (!token) {
    item.status = 'error';
    item.error = 'Sign in again before uploading attachments.';
    renderRoomPostImages();
    return;
  }

  item.status = 'uploading';
  item.error = '';
  renderRoomPostImages();

  try {
    if (item.id) await removeRemoteRoomPostImage(item.id);
    item.id = '';

    const begin = await fetch('/api/sauti-media/begin', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content_type: item.type, size_bytes: item.size }),
    });
    const beginPayload = await begin.json().catch(() => null);
    if (!begin.ok || !beginPayload?.data?.id) {
      throw new Error(beginPayload?.error?.message || 'Attachment upload could not start.');
    }

    item.id = beginPayload.data.id;
    const active = () => roomPostImages.includes(item) && roomPostSlug() === roomPostImageRoomSlug;
    if (!active()) {
      await removeRemoteRoomPostImage(item.id);
      return;
    }
    await uploadPostMedia(beginPayload.data, item.file, () => {
      const access = roomPostAccessToken();
      return access && `Bearer ${access}`;
    }, () => {}, async (path, bytes, authorization) => {
      if (!/^\/api\/sauti-media\/upload\/[a-f0-9-]{36}(?:\?(?:part=[0-9]+|complete=1))?$/i.test(path)) {
        throw new Error('The attachment upload session is invalid.');
      }
      const response = await fetch(path, { method: 'PUT', headers: { Authorization: authorization, 'Content-Type': item.type }, body: bytes });
      const result = await response.json().catch(() => null);
      if (!response.ok || result?.ok === false) throw new Error(result?.error?.message || 'Attachment upload failed.');
      return result;
    }, active);
    if (!active()) return;

    item.status = 'finalizing';
    renderRoomPostImages();

    const finalize = await fetch(`/api/sauti-media/finalize/${encodeURIComponent(item.id)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${roomPostAccessToken()}` },
    });
    const finalizePayload = await finalize.json().catch(() => null);
    if (!finalize.ok || finalizePayload?.ok === false) {
      throw new Error(finalizePayload?.error?.message || 'Attachment could not be finalized.');
    }

    item.status = 'ready';
    renderRoomPostImages();
  } catch (error) {
    item.status = 'error';
    if (!roomPostImages.includes(item)) return;
    item.error = error?.message || 'Attachment upload failed.';
    renderRoomPostImages();
  }
}

function addRoomPostImages(files) {
  const selected = Array.from(files || []);
  if (!selected.length) return;

  const slug = roomPostSlug();
  if (roomPostImageRoomSlug && slug && slug !== roomPostImageRoomSlug) {
    void clearRoomPostImages({ remote: true });
  }
  if (!roomPostImageRoomSlug) roomPostImageRoomSlug = slug;

  const openSlots = Math.max(0, ROOM_POST_IMAGE_LIMIT - roomPostImages.length);
  if (!openSlots) {
    roomPostMessage('A message can include up to five attachments.');
    return;
  }

  selected.slice(0, openSlots).forEach((file) => {
    const type = String(file.type || '').toLowerCase();
    if (!ROOM_POST_IMAGE_TYPES.has(type)) {
      roomPostMessage('Choose a JPEG, PNG, WebP or MP4 file.');
      return;
    }
    const maxBytes = type === 'video/mp4' ? POST_VIDEO_LIMIT : ROOM_POST_IMAGE_MAX_BYTES;
    if (file.size < 1 || file.size > maxBytes) {
      roomPostMessage(type === 'video/mp4' ? 'Each video must be 250 MiB or smaller.' : 'Each photo must be 5 MiB or smaller.');
      return;
    }

    const item = {
      localId: crypto.randomUUID(),
      id: '',
      file,
      name: file.name || 'Image',
      type,
      size: file.size,
      localUrl: URL.createObjectURL(file),
      status: 'preparing',
      error: '',
    };
    roomPostImages.push(item);
    void uploadRoomPostImage(item.localId);
  });

  renderRoomPostImages();
  if (selected.length > openSlots) roomPostMessage('Only the first five attachments were added.');
}

async function clearRoomPostImages({ remote = false } = {}) {
  const items = roomPostImages;
  roomPostImages = [];
  roomPostImageRoomSlug = '';
  items.forEach((item) => { if (item.localUrl) URL.revokeObjectURL(item.localUrl); });
  renderRoomPostImages();
  if (remote) await Promise.all(items.filter((item) => item.id).map((item) => removeRemoteRoomPostImage(item.id)));
}

async function lookupRoomForPost() {
  const slug = roomPostSlug();
  const token = roomPostAccessToken();
  if (!slug || !token) return null;
  const params = new URLSearchParams({ slug: `eq.${slug}`, select: 'id,slug', limit: '1' });
  const response = await fetch(`${ROOM_POST_SUPABASE_URL}/rest/v1/social_circles?${params}`, {
    headers: {
      apikey: ROOM_POST_SUPABASE_KEY,
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  }).catch(() => null);
  if (!response?.ok) return null;
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function publishRoomPostWithImages(event) {
  if (!roomPostImages.length) return;
  event.preventDefault();
  event.stopImmediatePropagation();

  const textarea = roomPostNode('circle-sauti-body');
  const submit = roomPostNode('circle-sauti-submit');
  if (!textarea || !submit || roomPostImageSubmitting) return;

  const slug = roomPostSlug();
  if (roomPostImageRoomSlug && slug && slug !== roomPostImageRoomSlug) {
    roomPostMessage('These attachments belong to another Room. Add them again here.');
    return;
  }
  if (!navigator.onLine) return roomPostMessage('Connect to send attachments.');
  if (textarea.disabled) return roomPostMessage('You do not have permission to publish in this Room.');
  if (textarea.value.length > POST_BODY_LIMIT) return roomPostMessage(`Messages can contain up to ${POST_BODY_LIMIT} characters.`);
  if (!roomPostImages.every((item) => item.status === 'ready' && item.id)) {
    return roomPostMessage('Wait for attachments to finish uploading.');
  }

  const token = roomPostAccessToken();
  if (!token) return roomPostMessage('Sign in again before sending.');
  const draft = { body: textarea.value.trim(), reply_access: 'everyone',
    ...(textarea.dataset.roomReplyTo ? { room_reply_to_id: textarea.dataset.roomReplyTo } : {}),
    media: roomPostImages.map((item) => ({ id: item.id, alt_text: '' })) };
  roomPostImageSubmitting = true;
  submit.disabled = true;
  submit.setAttribute('aria-busy', 'true');
  renderRoomPostImages();
  roomPostMessage('');

  try {
    const room = await lookupRoomForPost();
    if (roomPostAccessToken() !== token || roomPostSlug() !== slug) return;
    if (!room?.id) throw new Error('This Room could not be confirmed. Try again.');
    const snapshot = { ...draft, circle_id: room.id };
    const response = await fetch('/api/sauti', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...snapshot, client_request_id: roomPublishRequestId(snapshot) }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok === false) {
      throw new Error(payload?.error?.message || 'The Room post could not be published.');
    }

    if (roomPostAccessToken() !== token || roomPostSlug() !== slug) return;
    const outcome = roomPublishOutcome(response, payload);
    confirmRoomPublishRequest(snapshot);
    await clearRoomPostImages({ remote: false });
    textarea.value = '';
    if (snapshot.room_reply_to_id) roomPostNode('room-reply-clear')?.click();
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    roomPostMessage(outcome.pending ? 'Submitted to Room admins for approval.' : '', true);
    if (!outcome.pending) roomPostNode('circle-stream-retry')?.click();
  } catch (error) {
    if (roomPostSlug() === slug) roomPostMessage(error?.message || 'The message could not be sent.');
  } finally {
    roomPostImageSubmitting = false;
    submit.removeAttribute('aria-busy');
    renderRoomPostImages();
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function installRoomPostImages() {
  const form = roomPostNode('circle-sauti-composer');
  const actions = form?.querySelector('.circle-sauti-actions');
  const textarea = roomPostNode('circle-sauti-body');
  if (!form || !actions || !textarea || form.dataset.roomPostImages === 'true') return;

  form.dataset.roomPostImages = 'true';
  ensureRoomPostImageStyles();

  const input = document.createElement('input');
  input.id = 'room-post-image-file';
  input.type = 'file';
  input.accept = 'image/jpeg,image/png,image/webp';
  input.multiple = true;
  input.hidden = true;

  const preview = document.createElement('div');
  preview.id = 'room-post-image-preview';
  preview.className = 'room-post-image-preview';
  preview.setAttribute('aria-label', 'Selected message attachments');
  preview.hidden = true;

  const tools = document.createElement('div');
  tools.className = 'room-post-image-tools';
  const add = document.createElement('button');
  add.id = 'room-post-image-add';
  add.type = 'button';
  add.className = 'room-post-image-add';
  add.setAttribute('aria-label', 'Add attachments');
  add.setAttribute('aria-expanded', 'false');
  add.setAttribute('aria-controls', 'room-attachment-tray');
  add.setAttribute('title', 'Add attachments');
  add.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 13 6-6a2.8 2.8 0 0 1 4 4l-8 8a4.6 4.6 0 0 1-6.5-6.5L13 4"></path></svg>';
  const tray = document.createElement('div');
  tray.id = 'room-attachment-tray';
  tray.className = 'room-attachment-tray';
  tray.hidden = true;
  const setTrayOpen = (open) => {
    tray.hidden = !open;
    add.setAttribute('aria-expanded', String(open));
  };
  const images = 'image/jpeg,image/png,image/webp';
  const options = [
    ['Photos', images, '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m4 17 5-5 4 4 3-3 4 4M8 8h.01"/>'],
    ['Videos', 'video/mp4', '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m10 9 5 3-5 3z"/>'],
    ['Files', `${images},video/mp4`, '<path d="M5 3h9l5 5v13H5zM14 3v5h5M8 13h8m-8 4h8"/>'],
  ];
  for (const [label, formats, glyph] of options) {
    const choice = document.createElement('button');
    choice.type = 'button';
    choice.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${glyph}</svg><span>${label}</span>`;
    choice.addEventListener('click', () => {
      input.accept = formats;
      setTrayOpen(false);
      input.click();
    });
    tray.append(choice);
  }
  const count = document.createElement('span');
  count.id = 'room-post-image-count';
  count.className = 'room-post-image-count';
  count.textContent = `0 / ${ROOM_POST_IMAGE_LIMIT}`;
  tools.append(add, count);

  actions.parentNode.insertBefore(input, actions);
  actions.parentNode.insertBefore(preview, actions);
  actions.parentNode.insertBefore(tray, actions);
  const textLabel = actions.querySelector(':scope > span');
  if (textLabel) textLabel.replaceWith(tools);
  else actions.prepend(tools);

  add.addEventListener('click', () => {
    if (!textarea.disabled) setTrayOpen(tray.hidden);
  });
  form.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !tray.hidden) {
      event.preventDefault();
      setTrayOpen(false);
      add.focus();
    }
  });
  const syncAttachmentRoute = () => {
    if (roomPostImageRoomSlug && roomPostImageRoomSlug !== roomPostSlug()) {
      void clearRoomPostImages({ remote: !roomPostImageSubmitting });
    }
    if (!tray.hidden) setTrayOpen(false);
  };
  window.addEventListener('sautilink:routechange', syncAttachmentRoute);
  window.addEventListener('popstate', syncAttachmentRoute);
  input.addEventListener('change', () => {
    addRoomPostImages(input.files);
    input.value = '';
  });
  form.addEventListener('submit', publishRoomPostWithImages, true);
  window.addEventListener('beforeunload', () => {
    roomPostImages.forEach((item) => { if (item.localUrl) URL.revokeObjectURL(item.localUrl); });
  });

  renderRoomPostImages();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installRoomPostImages, { once: true });
} else {
  installRoomPostImages();
}
