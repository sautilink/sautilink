const ROOM_POST_IMAGE_LIMIT = 5;
const ROOM_POST_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const ROOM_POST_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
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
  const route = location.pathname.match(/^\/(?:rooms|sautify|app\/(?:sautify|circles))\/([^/]+)\/?$/);
  if (route?.[1]) return decodeURIComponent(route[1]);
  return String(roomPostNode('circle-detail-slug')?.textContent || '')
    .replace(/^\/(?:rooms|sautify)\//, '')
    .trim();
}

function roomPostMessage(text, success = false) {
  const node = roomPostNode('circle-sauti-message');
  if (!node) return;
  node.textContent = text || '';
  node.className = `form-message${success ? ' success' : ''}`;
  node.hidden = !text;
}

function roomPostToast(text) {
  const toast = roomPostNode('toast');
  if (!toast) return;
  toast.textContent = text;
  toast.hidden = false;
  window.clearTimeout(roomPostToast.timer);
  roomPostToast.timer = window.setTimeout(() => { toast.hidden = true; }, 3000);
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

  count.textContent = `${roomPostImages.length} / ${ROOM_POST_IMAGE_LIMIT}`;
  add.disabled = roomPostImages.length >= ROOM_POST_IMAGE_LIMIT || roomPostImageSubmitting;
  root.hidden = roomPostImages.length === 0;
  root.replaceChildren();

  roomPostImages.forEach((item) => {
    const tile = document.createElement('div');
    tile.className = 'room-post-image-tile';
    tile.dataset.roomPostImageId = item.localId;

    const image = document.createElement('img');
    image.src = item.localUrl;
    image.alt = '';

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

function roomPostMentionReady() {
  const textarea = roomPostNode('circle-sauti-body');
  const replies = roomPostNode('circle-sauti-reply-access');
  if (!textarea || !replies || replies.value !== 'mentioned') return true;
  return /(^|\s)@[a-z0-9._-]{1,30}\b/i.test(textarea.value);
}

function syncRoomPostImageComposer() {
  if (!roomPostImages.length) return;
  const textarea = roomPostNode('circle-sauti-body');
  const submit = roomPostNode('circle-sauti-submit');
  const loading = roomPostNode('circle-stream-loading');
  if (!textarea || !submit) return;

  const currentSlug = roomPostSlug();
  const sameRoom = !roomPostImageRoomSlug || !currentSlug || currentSlug === roomPostImageRoomSlug;
  const hasContent = Boolean(textarea.value.trim()) || roomPostImages.length > 0;
  const allReady = roomPostImages.every((item) => item.status === 'ready' && item.id);
  const streamBusy = loading ? !loading.hidden : false;

  submit.disabled =
    textarea.disabled ||
    !navigator.onLine ||
    !sameRoom ||
    !hasContent ||
    textarea.value.length > 500 ||
    !roomPostMentionReady() ||
    !allReady ||
    streamBusy ||
    roomPostImageSubmitting;
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
  queueMicrotask(syncRoomPostImageComposer);
  if (remote && item.id) await removeRemoteRoomPostImage(item.id);
  if (!roomPostImages.length) roomPostImageRoomSlug = '';
}

async function uploadRoomPostImage(localId) {
  const item = roomPostImages.find((entry) => entry.localId === localId);
  if (!item?.file || roomPostImageSubmitting) return;
  const token = roomPostAccessToken();
  if (!token) {
    item.status = 'error';
    item.error = 'Sign in again before uploading images.';
    renderRoomPostImages();
    syncRoomPostImageComposer();
    return;
  }

  item.status = 'uploading';
  item.error = '';
  renderRoomPostImages();
  syncRoomPostImageComposer();

  try {
    if (item.id) await removeRemoteRoomPostImage(item.id);
    item.id = '';

    const begin = await fetch('/api/sauti-media/begin', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content_type: item.type, size_bytes: item.size }),
    });
    const beginPayload = await begin.json().catch(() => null);
    if (!begin.ok || beginPayload?.ok === false) {
      throw new Error(beginPayload?.error?.message || 'Image upload could not start.');
    }

    item.id = beginPayload.data.id;
    const upload = await fetch(beginPayload.data.upload_url, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': item.type },
      body: item.file,
    });
    const uploadPayload = await upload.json().catch(() => null);
    if (!upload.ok || uploadPayload?.ok === false) {
      throw new Error(uploadPayload?.error?.message || 'Image upload failed.');
    }

    item.status = 'finalizing';
    renderRoomPostImages();

    const finalize = await fetch(beginPayload.data.finalize_url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const finalizePayload = await finalize.json().catch(() => null);
    if (!finalize.ok || finalizePayload?.ok === false) {
      throw new Error(finalizePayload?.error?.message || 'Image upload could not be finalized.');
    }

    item.status = 'ready';
    renderRoomPostImages();
    syncRoomPostImageComposer();
  } catch (error) {
    item.status = 'error';
    item.error = error?.message || 'Image upload failed.';
    renderRoomPostImages();
    syncRoomPostImageComposer();
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
    roomPostToast('A Room post can include up to five images.');
    return;
  }

  selected.slice(0, openSlots).forEach((file) => {
    const type = String(file.type || '').toLowerCase();
    if (!ROOM_POST_IMAGE_TYPES.has(type)) {
      roomPostToast('Use JPEG, PNG or WebP images.');
      return;
    }
    if (file.size < 1 || file.size > ROOM_POST_IMAGE_MAX_BYTES) {
      roomPostToast('Each image must be 8 MB or smaller.');
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
  queueMicrotask(syncRoomPostImageComposer);
  if (selected.length > openSlots) roomPostToast('Only the first five Room images were added.');
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
  const replies = roomPostNode('circle-sauti-reply-access');
  const submit = roomPostNode('circle-sauti-submit');
  if (!textarea || !replies || !submit || roomPostImageSubmitting) return;

  const slug = roomPostSlug();
  if (roomPostImageRoomSlug && slug && slug !== roomPostImageRoomSlug) {
    roomPostMessage('These images were selected for another Room. Add them again here.');
    return;
  }
  if (!navigator.onLine) return roomPostMessage('Connect to the internet before posting images.');
  if (textarea.disabled) return roomPostMessage('You do not have permission to publish in this Room.');
  if (textarea.value.length > 500) return roomPostMessage('Post text must be 500 characters or fewer.');
  if (!roomPostMentionReady()) return roomPostMessage('Mention at least one @username or change who can reply.');
  if (!roomPostImages.every((item) => item.status === 'ready' && item.id)) {
    return roomPostMessage('Wait for all images to finish uploading before posting.');
  }

  const token = roomPostAccessToken();
  if (!token) return roomPostMessage('Sign in again before posting.');
  const room = await lookupRoomForPost();
  if (!room?.id) return roomPostMessage('This Room could not be confirmed. Try again.');

  roomPostImageSubmitting = true;
  submit.disabled = true;
  renderRoomPostImages();
  roomPostMessage('');

  try {
    const response = await fetch('/api/sauti', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        body: textarea.value.trim(),
        circle_id: room.id,
        reply_access: replies.value || 'everyone',
        media: roomPostImages.map((item) => ({ id: item.id, alt_text: '' })),
      }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok === false) {
      throw new Error(payload?.error?.message || 'The Room post could not be published.');
    }

    await clearRoomPostImages({ remote: false });
    textarea.value = '';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    roomPostMessage('Post published in this Room.', true);
    roomPostToast('Posted in Room.');
    roomPostNode('circle-stream-retry')?.click();
  } catch (error) {
    roomPostMessage(error?.message || 'The Room post could not be published.');
  } finally {
    roomPostImageSubmitting = false;
    renderRoomPostImages();
    queueMicrotask(syncRoomPostImageComposer);
  }
}

function installRoomPostImages() {
  const form = roomPostNode('circle-sauti-composer');
  const actions = form?.querySelector('.circle-sauti-actions');
  const textarea = roomPostNode('circle-sauti-body');
  const replies = roomPostNode('circle-sauti-reply-access');
  if (!form || !actions || !textarea || !replies || form.dataset.roomPostImages === 'true') return;

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
  preview.setAttribute('aria-label', 'Selected Room post images');
  preview.hidden = true;

  const tools = document.createElement('div');
  tools.className = 'room-post-image-tools';
  const add = document.createElement('button');
  add.id = 'room-post-image-add';
  add.type = 'button';
  add.className = 'room-post-image-add';
  add.setAttribute('aria-label', 'Add photos to Room post');
  add.setAttribute('title', 'Add photos');
  add.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"></rect><circle cx="9" cy="10" r="2"></circle><path d="m5.5 17 4.2-4 3 2.6 2.5-2.1 3.3 3.5"></path></svg><span>Photo</span>';
  const count = document.createElement('span');
  count.id = 'room-post-image-count';
  count.className = 'room-post-image-count';
  count.textContent = `0 / ${ROOM_POST_IMAGE_LIMIT}`;
  tools.append(add, count);

  actions.parentNode.insertBefore(input, actions);
  actions.parentNode.insertBefore(preview, actions);
  const textLabel = actions.querySelector(':scope > span');
  if (textLabel) textLabel.replaceWith(tools);
  else actions.prepend(tools);

  add.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    addRoomPostImages(input.files);
    input.value = '';
  });
  textarea.addEventListener('input', () => queueMicrotask(syncRoomPostImageComposer));
  replies.addEventListener('change', () => queueMicrotask(syncRoomPostImageComposer));
  form.addEventListener('submit', publishRoomPostWithImages, true);
  window.addEventListener('online', () => queueMicrotask(syncRoomPostImageComposer));
  window.addEventListener('offline', () => queueMicrotask(syncRoomPostImageComposer));
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
