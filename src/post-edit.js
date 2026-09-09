const POST_EDIT_SUPABASE_URL = 'https://rggpyiterdbbugluejcs.supabase.co';
const POST_EDIT_SUPABASE_KEY = 'sb_publishable_omJ-5Mem-K4vgm6WLXRzJQ_jeGs65ca';
const POST_EDIT_AUTH_KEY = 'sautilink.auth.session';
const POST_EDIT_STYLESHEET = '/app/assets/post-edit.css?v=20260909-edit1';
const POST_EDIT_LIMIT = 500;

let postEditUserPromise = null;
let postEditUserToken = '';
let postEditScanTimer = 0;
let postEditActive = null;
const postEditMeta = new Map();
const postEditPending = new Set();

function postEditToken() {
  const keys = [POST_EDIT_AUTH_KEY, ...Object.keys(localStorage).filter((key) => key.startsWith('sb-') && key.endsWith('-auth-token'))];
  for (const key of keys) {
    try {
      const stored = JSON.parse(localStorage.getItem(key) || 'null');
      const token = stored?.access_token || stored?.currentSession?.access_token || stored?.session?.access_token;
      if (token) return String(token);
    } catch {
      // Ignore unrelated or malformed browser state.
    }
  }
  return '';
}

function postEditHeaders(json = false) {
  const headers = {
    apikey: POST_EDIT_SUPABASE_KEY,
    Accept: 'application/json',
  };
  const token = postEditToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

async function postEditCurrentUserId() {
  const token = postEditToken();
  if (!token) {
    postEditUserPromise = null;
    postEditUserToken = '';
    return '';
  }
  if (postEditUserPromise && postEditUserToken === token) return postEditUserPromise;
  postEditUserToken = token;
  postEditUserPromise = (async () => {
    const response = await fetch(`${POST_EDIT_SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: POST_EDIT_SUPABASE_KEY,
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
    }).catch(() => null);
    if (!response?.ok) return '';
    const user = await response.json().catch(() => null);
    return String(user?.id || '');
  })();
  return postEditUserPromise;
}

function ensurePostEditStyles() {
  if (document.querySelector('link[href^="/app/assets/post-edit.css"]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = POST_EDIT_STYLESHEET;
  document.head.append(link);
}

function postEditPreview(value, limit = 180) {
  const text = String(value || '').trim();
  if (text.length <= limit) return { text, truncated: false };
  const candidate = text.slice(0, limit + 1);
  const wordBreak = candidate.lastIndexOf(' ');
  const cutoff = wordBreak >= Math.floor(limit * .65) ? wordBreak : limit;
  return { text: `${text.slice(0, cutoff).trimEnd()}…`, truncated: true };
}

function postEditDialog() {
  let dialog = document.getElementById('post-edit-dialog');
  if (dialog) return dialog;

  dialog = document.createElement('dialog');
  dialog.id = 'post-edit-dialog';
  dialog.className = 'post-edit-dialog';
  dialog.innerHTML = `
    <form class="post-edit-form" id="post-edit-form" method="dialog">
      <header class="post-edit-header">
        <h2>Edit post</h2>
        <button class="post-edit-close" type="button" aria-label="Close">×</button>
      </header>
      <div class="post-edit-content">
        <textarea id="post-edit-body" maxlength="${POST_EDIT_LIMIT}" aria-label="Post text"></textarea>
        <div class="post-edit-meta">
          <p class="post-edit-note">You can edit this post once. Attached media stays unchanged.</p>
          <span class="post-edit-counter"><b id="post-edit-count">0</b> / ${POST_EDIT_LIMIT}</span>
        </div>
        <p class="post-edit-message" id="post-edit-message" role="alert" hidden></p>
      </div>
      <footer class="post-edit-actions">
        <button class="post-edit-cancel" type="button">Cancel</button>
        <button class="post-edit-save" type="submit">Save changes</button>
      </footer>
    </form>
  `;
  document.body.append(dialog);

  const textarea = dialog.querySelector('#post-edit-body');
  const count = dialog.querySelector('#post-edit-count');
  textarea.addEventListener('input', () => {
    count.textContent = String(textarea.value.length);
    dialog.querySelector('.post-edit-save').disabled = textarea.value.length > POST_EDIT_LIMIT;
    const message = dialog.querySelector('#post-edit-message');
    message.hidden = true;
    message.textContent = '';
  });

  const close = () => {
    postEditActive = null;
    if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    else dialog.removeAttribute('open');
  };
  dialog.querySelector('.post-edit-close').addEventListener('click', close);
  dialog.querySelector('.post-edit-cancel').addEventListener('click', close);
  dialog.addEventListener('cancel', () => { postEditActive = null; });
  dialog.querySelector('#post-edit-form').addEventListener('submit', submitPostEdit);
  return dialog;
}

function postEditCards(postId) {
  return [...document.querySelectorAll(`.sauti-card[data-post-id="${CSS.escape(postId)}"], .profile-activity-card[data-post-id="${CSS.escape(postId)}"]`)]);
}

function postEditBodyFromCard(card) {
  const caption = card.querySelector('.sauti-caption-text');
  if (caption?.dataset.fullCaption != null) return caption.dataset.fullCaption;
  const body = card.querySelector('.sauti-card-body, .profile-activity-body');
  return String(body?.textContent || '').trim();
}

function openPostEdit(postId, sourceCard) {
  const metadata = postEditMeta.get(postId);
  if (!metadata || Number(metadata.edit_count || 0) >= 1) return;
  const dialog = postEditDialog();
  const body = String(metadata.body ?? postEditBodyFromCard(sourceCard));
  postEditActive = { postId, sourceCard };
  const textarea = dialog.querySelector('#post-edit-body');
  textarea.value = body;
  dialog.querySelector('#post-edit-count').textContent = String(body.length);
  dialog.querySelector('#post-edit-message').hidden = true;
  dialog.querySelector('#post-edit-message').textContent = '';
  dialog.querySelector('.post-edit-save').disabled = false;
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  window.setTimeout(() => {
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }, 0);
}

function updatePostEditCaption(card, body) {
  let bodyNode = card.querySelector('.sauti-card-body');
  const media = card.querySelector('.sauti-media-gallery');
  if (body) {
    if (!bodyNode && media) {
      bodyNode = document.createElement('p');
      bodyNode.className = 'sauti-card-body';
      media.insertAdjacentElement('beforebegin', bodyNode);
    }
    if (bodyNode) bodyNode.textContent = body;
  } else if (bodyNode) {
    bodyNode.textContent = '';
  }

  let caption = card.querySelector('.sauti-caption');
  if (!body) {
    caption?.remove();
    return;
  }

  const preview = postEditPreview(body);
  if (!caption) {
    caption = document.createElement('p');
    caption.className = 'sauti-caption';
    const author = document.createElement('a');
    author.className = 'sauti-caption-author';
    const username = String(card.dataset.authorUsername || 'member');
    author.href = `/u/${encodeURIComponent(username)}`;
    author.textContent = username;
    const text = document.createElement('span');
    text.className = 'sauti-caption-text';
    caption.append(author, document.createTextNode(' '), text);
    const meta = card.querySelector('.sauti-card-meta');
    if (meta) meta.insertAdjacentElement('beforebegin', caption);
    else card.querySelector('.sauti-card-main')?.append(caption);
  }

  const text = caption.querySelector('.sauti-caption-text');
  if (!text) return;
  text.dataset.fullCaption = body;
  text.dataset.previewCaption = preview.text;
  text.textContent = preview.text;
  caption.querySelector('.sauti-caption-toggle')?.remove();
  if (preview.truncated) {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'sauti-caption-toggle';
    toggle.dataset.captionToggle = '';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Show full caption');
    toggle.textContent = 'more';
    caption.append(document.createTextNode(' '), toggle);
  }
}

function updateProfileActivityCaption(card, body) {
  const node = card.querySelector('.profile-activity-body');
  if (!node) return;
  node.textContent = body;
}

function markPostEdited(card) {
  card.querySelectorAll('[data-post-edit]').forEach((button) => button.remove());
  if (card.querySelector('.sauti-edited-label')) return;
  const time = card.querySelector('.sauti-card-head time, .profile-activity-card-head time');
  if (!time) return;
  const label = document.createElement('span');
  label.className = 'sauti-edited-label';
  label.textContent = 'Edited';
  label.title = 'This post was edited once.';
  time.insertAdjacentElement('afterend', label);
}

function applyPostEdit(post) {
  const postId = String(post?.id || '');
  if (!postId) return;
  const body = String(post.body || '');
  postEditMeta.set(postId, { ...post, edit_count: 1 });
  postEditCards(postId).forEach((card) => {
    if (card.classList.contains('profile-activity-card')) updateProfileActivityCaption(card, body);
    else updatePostEditCaption(card, body);
    markPostEdited(card);
  });
}

async function submitPostEdit(event) {
  event.preventDefault();
  if (!postEditActive?.postId) return;
  const dialog = postEditDialog();
  const textarea = dialog.querySelector('#post-edit-body');
  const save = dialog.querySelector('.post-edit-save');
  const message = dialog.querySelector('#post-edit-message');
  const body = textarea.value.trim();
  if (body.length > POST_EDIT_LIMIT) return;

  save.disabled = true;
  save.textContent = 'Saving…';
  message.hidden = true;
  message.textContent = '';

  try {
    const token = postEditToken();
    if (!token) throw new Error('Sign in again before editing this post.');
    const response = await fetch(`/api/sauti/${encodeURIComponent(postEditActive.postId)}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ body }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.data?.post) {
      const error = new Error(payload?.error?.message || 'This post could not be edited.');
      error.code = payload?.error?.code || '';
      throw error;
    }

    applyPostEdit(payload.data.post);
    postEditActive = null;
    if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    else dialog.removeAttribute('open');
    const toast = document.getElementById('toast');
    if (toast) {
      toast.textContent = 'Post updated.';
      toast.hidden = false;
      window.setTimeout(() => { toast.hidden = true; }, 2600);
    }
  } catch (error) {
    message.textContent = error?.message || 'This post could not be edited.';
    message.hidden = false;
    if (error?.code === 'POST_ALREADY_EDITED' && postEditActive?.postId) {
      const meta = postEditMeta.get(postEditActive.postId) || {};
      postEditMeta.set(postEditActive.postId, { ...meta, edit_count: 1 });
      postEditCards(postEditActive.postId).forEach(markPostEdited);
    }
  } finally {
    save.disabled = false;
    save.textContent = 'Save changes';
  }
}

function createPostEditMenuButton(postId) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'sauti-head-menu-item';
  button.dataset.postEdit = postId;
  button.setAttribute('role', 'menuitem');
  const text = document.createElement('span');
  text.textContent = 'Edit post';
  button.append(text);
  return button;
}

function createPostEditInlineButton(postId) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'sauti-edit';
  button.dataset.postEdit = postId;
  button.textContent = 'Edit';
  return button;
}

function decorateEditableCard(card, metadata, userId) {
  const postId = String(card.dataset.postId || '');
  if (!postId || metadata?.author_id !== userId) return;
  if (Number(metadata.edit_count || 0) >= 1) {
    markPostEdited(card);
    return;
  }
  if (card.querySelector('[data-post-edit]')) return;

  if (card.classList.contains('profile-activity-card')) {
    card.querySelector('.profile-activity-card-head')?.append(createPostEditInlineButton(postId));
    return;
  }

  const menu = card.querySelector('[data-home-post-menu-panel]');
  if (menu) {
    const copyLink = menu.querySelector('[data-home-post-action="copy-link"]');
    const edit = createPostEditMenuButton(postId);
    if (copyLink) menu.insertBefore(edit, copyLink);
    else menu.append(edit);
    return;
  }

  const meta = card.querySelector('.sauti-card-meta');
  if (meta) meta.prepend(createPostEditInlineButton(postId));
}

async function fetchPostEditMetadata(ids, userId) {
  if (!ids.length) return;
  ids.forEach((id) => postEditPending.add(id));
  try {
    const params = new URLSearchParams({
      select: 'id,author_id,body,edit_count,edited_at',
      id: `in.(${ids.join(',')})`,
    });
    const response = await fetch(`${POST_EDIT_SUPABASE_URL}/rest/v1/social_posts?${params}`, {
      headers: postEditHeaders(),
    });
    if (!response.ok) return;
    const rows = await response.json().catch(() => []);
    const rowMap = new Map((Array.isArray(rows) ? rows : []).map((row) => [String(row.id), row]));
    ids.forEach((id) => {
      const row = rowMap.get(id);
      if (row) postEditMeta.set(id, row);
      else postEditMeta.set(id, null);
    });
  } finally {
    ids.forEach((id) => postEditPending.delete(id));
  }

  document.querySelectorAll('.sauti-card[data-post-id], .profile-activity-card[data-post-id]').forEach((card) => {
    const postId = String(card.dataset.postId || '');
    const metadata = postEditMeta.get(postId);
    if (metadata) decorateEditableCard(card, metadata, userId);
  });
}

async function scanPostEditCards() {
  const cards = [...document.querySelectorAll('.sauti-card[data-post-id], .profile-activity-card[data-post-id]')];
  if (!cards.length) return;
  const userId = await postEditCurrentUserId();
  if (!userId) return;
  const unknown = new Set();
  cards.forEach((card) => {
    const postId = String(card.dataset.postId || '');
    if (!postId) return;
    if (postEditMeta.has(postId)) {
      const metadata = postEditMeta.get(postId);
      if (metadata) decorateEditableCard(card, metadata, userId);
      return;
    }
    if (!postEditPending.has(postId)) unknown.add(postId);
  });
  const ids = [...unknown].slice(0, 50);
  if (ids.length) await fetchPostEditMetadata(ids, userId);
}

function schedulePostEditScan() {
  window.clearTimeout(postEditScanTimer);
  postEditScanTimer = window.setTimeout(() => { void scanPostEditCards(); }, 100);
}

function handlePostEditClick(event) {
  const button = event.target.closest?.('[data-post-edit]');
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  const card = button.closest('.sauti-card, .profile-activity-card');
  const postId = String(button.dataset.postEdit || card?.dataset.postId || '');
  if (!postId || !card) return;
  const menu = button.closest('[data-home-post-menu-panel]');
  if (menu) {
    menu.hidden = true;
    menu.closest('[data-home-post-menu]')?.querySelector('[data-home-post-menu-toggle]')?.setAttribute('aria-expanded', 'false');
  }
  openPostEdit(postId, card);
}

ensurePostEditStyles();
document.addEventListener('click', handlePostEditClick, true);
new MutationObserver(schedulePostEditScan).observe(document.body, { childList: true, subtree: true });
window.addEventListener('popstate', schedulePostEditScan);
schedulePostEditScan();
