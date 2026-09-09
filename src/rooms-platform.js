const SUPABASE_URL = 'https://rggpyiterdbbugluejcs.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_omJ-5Mem-K4vgm6WLXRzJQ_jeGs65ca';
const AUTH_STORAGE_KEY = 'sb-rggpyiterdbbugluejcs-auth-token';

const ROOM_CATEGORIES = [
  ['general', 'General'],
  ['technology', 'Technology & AI'],
  ['learning', 'Learning & Education'],
  ['business', 'Business & Entrepreneurship'],
  ['marketplace', 'Marketplace & Trading'],
  ['creators', 'Creators & Media'],
  ['fashion', 'Fashion & Style'],
  ['friends-community', 'Friends & Community'],
  ['gaming', 'Gaming'],
  ['sports', 'Sports & Fitness'],
  ['music', 'Music'],
  ['arts-culture', 'Arts & Culture'],
  ['science', 'Science'],
  ['health-wellness', 'Health & Wellness'],
  ['travel', 'Travel'],
  ['local-community', 'Local Community'],
  ['family-parenting', 'Family & Parenting'],
  ['food', 'Food & Cooking'],
  ['hobbies', 'Hobbies & Interests'],
];

const categoryLabel = new Map(ROOM_CATEGORIES);
const coverObjectUrls = new Map();
let currentUserPromise = null;
let pendingCreate = null;
let cardRefreshTimer = 0;
let detailRefreshTimer = 0;
let detailRenderKey = '';
let initialCanonicalRoomPath = '';

function byId(id) {
  return document.getElementById(id);
}

function token() {
  const candidates = [AUTH_STORAGE_KEY, ...Object.keys(localStorage).filter((key) => key.startsWith('sb-') && key.endsWith('-auth-token'))];
  for (const key of candidates) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      const accessToken = value?.access_token || value?.currentSession?.access_token || value?.session?.access_token;
      if (accessToken) return String(accessToken);
    } catch {
      // Ignore malformed unrelated localStorage entries.
    }
  }
  return '';
}

function authHeaders({ json = false, prefer = '' } = {}) {
  const headers = {
    apikey: SUPABASE_PUBLISHABLE_KEY,
    Accept: 'application/json',
  };
  const accessToken = token();
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (json) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;
  return headers;
}

async function currentUser() {
  if (currentUserPromise) return currentUserPromise;
  currentUserPromise = (async () => {
    const accessToken = token();
    if (!accessToken) return null;
    const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${accessToken}` },
    }).catch(() => null);
    if (!response?.ok) return null;
    const user = await response.json().catch(() => null);
    return user?.id ? user : null;
  })();
  return currentUserPromise;
}

function restUrl(table, params = {}) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  });
  return url;
}

async function restSelect(table, params) {
  const response = await fetch(restUrl(table, params), { headers: authHeaders() }).catch(() => null);
  if (!response?.ok) return [];
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function restPatch(table, params, body) {
  const response = await fetch(restUrl(table, params), {
    method: 'PATCH',
    headers: authHeaders({ json: true, prefer: 'return=representation' }),
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!response?.ok) {
    const payload = await response?.json().catch(() => null);
    throw new Error(payload?.message || payload?.details || 'The change could not be saved.');
  }
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function restDelete(table, params) {
  const response = await fetch(restUrl(table, params), {
    method: 'DELETE',
    headers: authHeaders({ prefer: 'return=representation' }),
  }).catch(() => null);
  if (!response?.ok) {
    const payload = await response?.json().catch(() => null);
    throw new Error(payload?.message || payload?.details || 'The member could not be removed.');
  }
  return response.json().catch(() => []);
}

function showRoomToast(message) {
  const node = byId('toast');
  if (!node) return;
  node.textContent = message;
  node.hidden = false;
  window.clearTimeout(showRoomToast.timer);
  showRoomToast.timer = window.setTimeout(() => { node.hidden = true; }, 2600);
}

function setStatus(node, message, ok = false) {
  if (!node) return;
  node.textContent = message;
  node.hidden = !message;
  node.dataset.state = ok ? 'success' : 'error';
}

function roomPathFromLegacy(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/^\/app\/(?:sautify|circles)(?=\/|$)/, '/rooms')
    .replace(/^\/sautify(?=\/|$)/, '/rooms');
}

function legacyPathFromRoom(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/^\/rooms(?=\/|$)/, '/sautify');
}

function installCanonicalRoomRoutes() {
  const nativePush = history.pushState.bind(history);
  const nativeReplace = history.replaceState.bind(history);

  if (/^\/rooms(?:\/|$)/.test(location.pathname)) {
    initialCanonicalRoomPath = `${location.pathname}${location.search}${location.hash}`;
    nativeReplace(history.state, '', `${legacyPathFromRoom(location.pathname)}${location.search}${location.hash}`);
  }

  history.pushState = function roomsPushState(state, title, url) {
    const rewritten = typeof url === 'string' ? roomPathFromLegacy(url) : url;
    return nativePush(state, title, rewritten);
  };
  history.replaceState = function roomsReplaceState(state, title, url) {
    const rewritten = typeof url === 'string' ? roomPathFromLegacy(url) : url;
    return nativeReplace(state, title, rewritten);
  };

  window.addEventListener('popstate', () => {
    if (/^\/rooms(?:\/|$)/.test(location.pathname)) {
      nativeReplace(history.state, '', `${legacyPathFromRoom(location.pathname)}${location.search}${location.hash}`);
      scheduleDetailRefresh();
    }
  }, true);

  window.__sautiRoomsNativeReplace = nativeReplace;
}

function canonicalizeCurrentRoomUrl() {
  const surface = byId('circles-surface');
  if (!surface || surface.hidden) return;
  const nativeReplace = window.__sautiRoomsNativeReplace;
  if (!nativeReplace) return;
  if (/^\/sautify(?:\/|$)/.test(location.pathname)) {
    const next = `${roomPathFromLegacy(location.pathname)}${location.search}${location.hash}`;
    nativeReplace(history.state, '', next);
  } else if (initialCanonicalRoomPath) {
    nativeReplace(history.state, '', initialCanonicalRoomPath);
    initialCanonicalRoomPath = '';
  }
}

function replaceBrand(value) {
  return String(value)
    .replace(/\/app\/sautify\//gi, '/rooms/')
    .replace(/\/sautify\//gi, '/rooms/')
    .replace(/\bSautify\b/g, 'Room')
    .replace(/\bsautify\b/g, 'room');
}

function sanitizeNode(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    const next = replaceBrand(node.nodeValue || '');
    if (next !== node.nodeValue) node.nodeValue = next;
    return;
  }
  if (!(node instanceof Element)) return;
  for (const attr of ['aria-label', 'title', 'placeholder']) {
    const old = node.getAttribute(attr);
    if (!old) continue;
    const next = replaceBrand(old);
    if (next !== old) node.setAttribute(attr, next);
  }
  node.childNodes.forEach(sanitizeNode);
}

function roomIconSvg() {
  return '<rect x="3.5" y="3.5" width="17" height="17" rx="4"></rect><circle cx="9" cy="10" r="2.2"></circle><circle cx="15.5" cy="10.8" r="1.8"></circle><path d="M5.8 17c.4-2.5 1.5-3.7 3.4-3.7s3 1.2 3.4 3.7M13 14.4c2.5-.5 4.1.5 4.5 2.6"></path>';
}

function brandRoomsShell() {
  document.querySelectorAll('[data-member-view="circles"]').forEach((button) => {
    const label = button.querySelector('span:not(.notification-badge):not(.mobile-notification-badge)');
    if (label) label.textContent = 'Rooms';
    button.setAttribute('aria-label', 'Rooms');
    const svg = button.querySelector('svg');
    if (svg) svg.innerHTML = roomIconSvg();
  });

  const surface = byId('circles-surface');
  if (surface) surface.setAttribute('aria-label', 'Rooms');
  const toolbar = surface?.querySelector('.circles-toolbar');
  if (toolbar) {
    const eyebrow = toolbar.querySelector('.section-label');
    const title = toolbar.querySelector('h2');
    const copy = toolbar.querySelector('div > p:last-child');
    if (eyebrow) eyebrow.textContent = 'Groups built around shared interests';
    if (title) title.textContent = 'Rooms';
    if (copy) copy.textContent = 'Find communities by topic, join public Rooms, request access to private Rooms, or create your own.';
  }
  const create = byId('circles-create-toggle');
  if (create) create.textContent = 'Create Room';
  const back = byId('circle-back');
  if (back) back.textContent = '← All Rooms';
  const home = byId('circle-route-home');
  if (home) home.textContent = 'Back to Rooms';
  const setting = byId('settings-notify-sautify');
  if (setting) {
    const row = setting.closest('label');
    const strong = row?.querySelector('strong');
    const small = row?.querySelector('small');
    if (strong) strong.textContent = 'Room activity';
    if (small) small.textContent = 'Membership and community updates from Rooms.';
  }
  canonicalizeCurrentRoomUrl();
}

function option(value, label) {
  const node = document.createElement('option');
  node.value = value;
  node.textContent = label;
  return node;
}

function createSelect(id, name, options, value = '') {
  const select = document.createElement('select');
  select.id = id;
  select.name = name;
  options.forEach(([itemValue, label]) => select.append(option(itemValue, label)));
  if (value) select.value = value;
  return select;
}

function addCreateRoomFields() {
  const form = byId('circle-create-form');
  if (!form || form.dataset.roomsEnhanced === 'true') return;
  form.dataset.roomsEnhanced = 'true';

  const description = byId('circle-description');
  const policy = byId('circle-policy');
  if (!description || !policy) return;

  const categoryLabelNode = document.createElement('label');
  categoryLabelNode.htmlFor = 'room-category';
  categoryLabelNode.textContent = 'Category';
  const category = createSelect('room-category', 'room_category', ROOM_CATEGORIES, 'general');

  const privacyLabelNode = document.createElement('label');
  privacyLabelNode.htmlFor = 'room-privacy';
  privacyLabelNode.textContent = 'Privacy';
  const privacy = createSelect('room-privacy', 'room_privacy', [
    ['public', 'Public — anyone can discover this Room'],
    ['private', 'Private — only members can view this Room'],
  ], 'public');

  const permissionGrid = document.createElement('div');
  permissionGrid.className = 'room-create-permissions';

  const postWrap = document.createElement('label');
  postWrap.textContent = 'Who can post';
  postWrap.append(createSelect('room-post-permission', 'room_post_permission', [
    ['all_members', 'All members'],
    ['staff_only', 'Admins & moderators only'],
  ], 'all_members'));

  const inviteWrap = document.createElement('label');
  inviteWrap.textContent = 'Who can invite';
  inviteWrap.append(createSelect('room-invite-permission', 'room_invite_permission', [
    ['all_members', 'All members'],
    ['staff_only', 'Admins & moderators only'],
  ], 'all_members'));
  permissionGrid.append(postWrap, inviteWrap);

  const coverLabel = document.createElement('label');
  coverLabel.htmlFor = 'room-cover-file';
  coverLabel.textContent = 'Cover photo';
  const cover = document.createElement('input');
  cover.id = 'room-cover-file';
  cover.name = 'room_cover';
  cover.type = 'file';
  cover.accept = 'image/jpeg,image/png,image/webp';
  const coverHint = document.createElement('small');
  coverHint.className = 'field-hint';
  coverHint.textContent = 'JPEG, PNG or WebP. At least 600 × 200 px, up to 10 MB.';

  description.insertAdjacentElement('afterend', coverHint);
  description.insertAdjacentElement('afterend', cover);
  description.insertAdjacentElement('afterend', coverLabel);
  description.insertAdjacentElement('afterend', permissionGrid);
  description.insertAdjacentElement('afterend', privacy);
  description.insertAdjacentElement('afterend', privacyLabelNode);
  description.insertAdjacentElement('afterend', category);
  description.insertAdjacentElement('afterend', categoryLabelNode);

  const slugPrefix = form.querySelector('.circle-slug-field > span');
  if (slugPrefix) slugPrefix.textContent = '/rooms/';
  const slugLabel = form.querySelector('label[for="circle-slug"]');
  if (slugLabel) slugLabel.textContent = 'Room username';

  const policyLabel = form.querySelector('label[for="circle-policy"]');
  if (policyLabel) policyLabel.textContent = 'Membership access';
  const options = policy.querySelectorAll('option');
  if (options[0]) options[0].textContent = 'Open — anyone can join';
  if (options[1]) options[1].textContent = 'Approval — admins review requests';
  if (options[2]) options[2].textContent = 'Invite only';

  privacy.addEventListener('change', () => {
    if (privacy.value === 'private' && policy.value === 'open') policy.value = 'approval';
  });

  form.addEventListener('submit', captureRoomCreate, true);
}

function captureRoomCreate(event) {
  const form = event.currentTarget;
  const slug = String(form.slug?.value || '').trim().toLowerCase();
  const category = String(byId('room-category')?.value || 'general');
  const privacy = String(byId('room-privacy')?.value || 'public');
  const postPermission = String(byId('room-post-permission')?.value || 'all_members');
  const invitePermission = String(byId('room-invite-permission')?.value || 'all_members');
  const coverFile = byId('room-cover-file')?.files?.[0] || null;

  if (!categoryLabel.has(category) || !['public', 'private'].includes(privacy)) {
    event.preventDefault();
    event.stopImmediatePropagation();
    setStatus(byId('circle-create-message'), 'Choose a valid Room category and privacy setting.');
    return;
  }
  if (coverFile && coverFile.size > 10 * 1024 * 1024) {
    event.preventDefault();
    event.stopImmediatePropagation();
    setStatus(byId('circle-create-message'), 'Room cover photos must be 10 MB or smaller.');
    return;
  }
  if (privacy === 'private' && form.join_policy?.value === 'open') form.join_policy.value = 'approval';

  pendingCreate = { slug, category, privacy, postPermission, invitePermission, coverFile };
  window.setTimeout(finalizeCreatedRoom, 300);
}

async function finalizeCreatedRoom(attempt = 0) {
  if (!pendingCreate?.slug || attempt > 16) return;
  const user = await currentUser();
  if (!user) return;
  const rows = await restSelect('social_circles', {
    slug: `eq.${pendingCreate.slug}`,
    owner_id: `eq.${user.id}`,
    select: 'id,slug',
    limit: 1,
  });
  const room = rows[0];
  if (!room) {
    window.setTimeout(() => finalizeCreatedRoom(attempt + 1), 250);
    return;
  }

  const meta = pendingCreate;
  pendingCreate = null;
  try {
    await restPatch('social_circles', { id: `eq.${room.id}` }, {
      category: meta.category,
      privacy: meta.privacy,
      post_permission: meta.postPermission,
      invite_permission: meta.invitePermission,
      updated_at: new Date().toISOString(),
    });
    if (meta.coverFile) await uploadRoomCover(room.id, meta.coverFile);
    showRoomToast('Room created.');
    scheduleCardRefresh();
    scheduleDetailRefresh();
  } catch (error) {
    showRoomToast(error?.message || 'The Room was created, but its advanced settings need another try.');
  }
}

function addDiscoveryControls() {
  const toolbar = document.querySelector('#circles-surface .circles-toolbar');
  if (!toolbar || byId('room-discovery-controls')) return;
  const controls = document.createElement('div');
  controls.id = 'room-discovery-controls';
  controls.className = 'room-discovery-controls';

  const search = document.createElement('input');
  search.id = 'room-search';
  search.type = 'search';
  search.placeholder = 'Search Rooms';
  search.autocomplete = 'off';
  search.setAttribute('aria-label', 'Search Rooms');

  const filter = createSelect('room-category-filter', 'room_category_filter', [['all', 'All categories'], ...ROOM_CATEGORIES], 'all');
  filter.setAttribute('aria-label', 'Filter Rooms by category');
  controls.append(search, filter);
  toolbar.insertAdjacentElement('afterend', controls);
  search.addEventListener('input', filterRoomCards);
  filter.addEventListener('change', filterRoomCards);
}

async function roomRowsForCards() {
  return restSelect('social_circles', {
    select: 'id,slug,name,category,privacy,cover_key,member_count,join_policy,post_permission',
    order: 'created_at.desc',
    limit: 100,
  });
}

async function fetchCoverBlob(slug) {
  const existing = coverObjectUrls.get(slug);
  if (existing) return existing;
  const accessToken = token();
  if (!accessToken) return '';
  const response = await fetch(`/api/room-media/${encodeURIComponent(slug)}/cover`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  }).catch(() => null);
  if (!response?.ok) return '';
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  coverObjectUrls.set(slug, objectUrl);
  return objectUrl;
}

function ensureCardMeta(card, room) {
  card.dataset.roomCategory = room.category || 'general';
  card.dataset.roomName = String(room.name || '').toLowerCase();
  const top = card.querySelector('.circle-card-top');
  if (top) {
    let category = top.querySelector('.room-category-badge');
    if (!category) {
      category = document.createElement('span');
      category.className = 'room-category-badge';
      top.append(category);
    }
    category.textContent = categoryLabel.get(room.category) || 'General';
    let privacy = top.querySelector('.room-privacy-badge');
    if (!privacy) {
      privacy = document.createElement('span');
      privacy.className = 'room-privacy-badge';
      top.append(privacy);
    }
    privacy.textContent = room.privacy === 'private' ? 'Private' : 'Public';
  }

  const meta = card.querySelector('.circle-card-meta');
  if (meta) {
    let members = meta.querySelector('.room-member-count');
    if (!members) {
      members = document.createElement('span');
      members.className = 'room-member-count';
      meta.append(members);
    }
    const count = Number(room.member_count || 0);
    members.textContent = `${count.toLocaleString()} ${count === 1 ? 'member' : 'members'}`;
  }

  let cover = card.querySelector('.room-card-cover');
  if (!cover) {
    cover = document.createElement('span');
    cover.className = 'room-card-cover';
    cover.setAttribute('aria-hidden', 'true');
    card.prepend(cover);
  }
  if (room.cover_key) {
    fetchCoverBlob(room.slug).then((url) => {
      if (url && cover.isConnected) {
        cover.style.backgroundImage = `url("${url}")`;
        cover.classList.add('has-image');
      }
    });
  }
}

async function refreshRoomCards() {
  const cards = [...document.querySelectorAll('.circle-card[data-circle-slug]')];
  if (!cards.length) return;
  const rows = await roomRowsForCards();
  const map = new Map(rows.map((room) => [room.slug, room]));
  cards.forEach((card) => {
    const room = map.get(card.dataset.circleSlug);
    if (room) ensureCardMeta(card, room);
  });
  filterRoomCards();
}

function filterRoomCards() {
  const query = String(byId('room-search')?.value || '').trim().toLowerCase();
  const category = String(byId('room-category-filter')?.value || 'all');
  document.querySelectorAll('.circle-card[data-circle-slug]').forEach((card) => {
    const name = card.dataset.roomName || card.textContent.toLowerCase();
    const matchesText = !query || name.includes(query) || card.textContent.toLowerCase().includes(query);
    const matchesCategory = category === 'all' || card.dataset.roomCategory === category;
    card.hidden = !(matchesText && matchesCategory);
  });
}

function scheduleCardRefresh() {
  window.clearTimeout(cardRefreshTimer);
  cardRefreshTimer = window.setTimeout(refreshRoomCards, 80);
}

function roomSlugFromUi() {
  const pathMatch = location.pathname.match(/^\/(?:rooms|sautify)(?:\/([^/]+))?/);
  if (pathMatch?.[1]) return decodeURIComponent(pathMatch[1]);
  const slug = byId('circle-detail-slug')?.textContent || '';
  return slug.replace(/^\/(?:rooms|sautify)\//, '').trim();
}

async function roomDetail(slug) {
  if (!slug) return null;
  const rows = await restSelect('social_circles', {
    slug: `eq.${slug}`,
    select: 'id,owner_id,slug,name,description,join_policy,category,privacy,cover_key,member_count,post_permission,invite_permission,created_at,updated_at',
    limit: 1,
  });
  return rows[0] || null;
}

async function ownRoomRole(roomId) {
  const user = await currentUser();
  if (!user || !roomId) return '';
  const rows = await restSelect('social_circle_members', {
    circle_id: `eq.${roomId}`,
    member_id: `eq.${user.id}`,
    select: 'member_role',
    limit: 1,
  });
  return String(rows[0]?.member_role || '');
}

function addDetailSummary(room, role) {
  const card = byId('circle-detail')?.querySelector('.circle-detail-card');
  if (!card) return;

  let cover = card.querySelector('.room-detail-cover');
  if (!cover) {
    cover = document.createElement('div');
    cover.className = 'room-detail-cover';
    cover.innerHTML = '<span>Room</span>';
    card.prepend(cover);
  }
  cover.classList.toggle('has-image', Boolean(room.cover_key));
  if (room.cover_key) {
    fetchCoverBlob(room.slug).then((url) => {
      if (url && cover.isConnected) cover.style.backgroundImage = `url("${url}")`;
    });
  } else {
    cover.style.backgroundImage = '';
  }

  const top = card.querySelector('.circle-detail-top');
  let badges = card.querySelector('.room-detail-badges');
  if (!badges) {
    badges = document.createElement('div');
    badges.className = 'room-detail-badges';
    top?.insertAdjacentElement('afterend', badges);
  }
  badges.replaceChildren();
  [
    categoryLabel.get(room.category) || 'General',
    room.privacy === 'private' ? 'Private Room' : 'Public Room',
    `${Number(room.member_count || 0).toLocaleString()} ${Number(room.member_count || 0) === 1 ? 'member' : 'members'}`,
  ].forEach((text) => {
    const chip = document.createElement('span');
    chip.textContent = text;
    badges.append(chip);
  });

  const slugNode = byId('circle-detail-slug');
  if (slugNode) slugNode.textContent = `/rooms/${room.slug}`;
  const membershipNode = byId('circle-detail-membership');
  if (membershipNode && role) membershipNode.textContent = role === 'owner' ? 'Owner' : role === 'admin' ? 'Admin' : role === 'moderator' ? 'Moderator' : 'Member';

  let permissions = card.querySelector('.room-permissions-summary');
  if (!permissions) {
    permissions = document.createElement('div');
    permissions.className = 'room-permissions-summary';
    const description = card.querySelector('.circle-detail-description');
    description?.insertAdjacentElement('afterend', permissions);
  }
  permissions.innerHTML = `<span><strong>Posting</strong>${room.post_permission === 'staff_only' ? 'Admins & moderators' : 'All members'}</span><span><strong>Invites</strong>${room.invite_permission === 'staff_only' ? 'Admins & moderators' : 'All members'}</span>`;

  syncRoomComposerPermission(room, role);
}

function syncRoomComposerPermission(room, role) {
  const composer = byId('circle-sauti-composer');
  if (!composer || composer.hidden) return;
  const staff = ['owner', 'admin', 'moderator'].includes(role);
  const restricted = room.post_permission === 'staff_only' && !staff;
  const textarea = byId('circle-sauti-body');
  const submit = byId('circle-sauti-submit');
  let note = composer.querySelector('.room-posting-restriction');
  if (!note) {
    note = document.createElement('p');
    note.className = 'room-posting-restriction';
    composer.prepend(note);
  }
  note.hidden = !restricted;
  note.textContent = restricted ? 'Only Room admins and moderators can publish posts here.' : '';
  if (textarea) textarea.disabled = restricted;
  if (submit && restricted) submit.disabled = true;
}

function buildAdminPanel(room, role) {
  const detail = byId('circle-detail');
  if (!detail) return;
  const canManageSettings = ['owner', 'admin'].includes(role);
  const canManageMembers = ['owner', 'admin', 'moderator'].includes(role);
  let panel = byId('room-admin-panel');
  if (!canManageSettings && !canManageMembers) {
    panel?.remove();
    return;
  }
  if (!panel) {
    panel = document.createElement('section');
    panel.id = 'room-admin-panel';
    panel.className = 'room-admin-panel';
    const stream = byId('circle-stream');
    detail.insertBefore(panel, stream || detail.firstChild);
  }
  panel.replaceChildren();

  const heading = document.createElement('div');
  heading.className = 'room-admin-heading';
  heading.innerHTML = '<div><p class="section-label">Room management</p><h3>Admin tools</h3></div>';
  const roleBadge = document.createElement('span');
  roleBadge.textContent = role[0].toUpperCase() + role.slice(1);
  heading.append(roleBadge);
  panel.append(heading);

  if (canManageSettings) panel.append(buildRoomSettingsForm(room));
  if (canManageMembers) {
    const management = document.createElement('div');
    management.className = 'room-member-management';
    management.innerHTML = '<div class="room-admin-subheading"><h4>Members & requests</h4><span>Manage access and roles</span></div><div class="room-request-admin-list" data-room-request-list></div><div class="room-admin-member-list" data-room-member-list></div>';
    panel.append(management);
    loadRoomAdminPeople(room, role, management);
  }
}

function field(label, control) {
  const wrapper = document.createElement('label');
  const span = document.createElement('span');
  span.textContent = label;
  wrapper.append(span, control);
  return wrapper;
}

function buildRoomSettingsForm(room) {
  const form = document.createElement('form');
  form.className = 'room-settings-form';
  form.noValidate = true;

  const description = document.createElement('textarea');
  description.name = 'description';
  description.rows = 3;
  description.maxLength = 1000;
  description.value = room.description || '';

  const category = createSelect('room-admin-category', 'category', ROOM_CATEGORIES, room.category);
  const privacy = createSelect('room-admin-privacy', 'privacy', [
    ['public', 'Public'],
    ['private', 'Private'],
  ], room.privacy);
  const membership = createSelect('room-admin-membership', 'join_policy', [
    ['open', 'Open — anyone can join'],
    ['approval', 'Approval required'],
    ['private', 'Invite only'],
  ], room.join_policy);
  const posting = createSelect('room-admin-posting', 'post_permission', [
    ['all_members', 'All members can post'],
    ['staff_only', 'Admins & moderators only'],
  ], room.post_permission);
  const invites = createSelect('room-admin-invites', 'invite_permission', [
    ['all_members', 'All members can invite'],
    ['staff_only', 'Admins & moderators only'],
  ], room.invite_permission);

  const cover = document.createElement('input');
  cover.type = 'file';
  cover.name = 'cover';
  cover.accept = 'image/jpeg,image/png,image/webp';

  const grid = document.createElement('div');
  grid.className = 'room-settings-grid';
  grid.append(
    field('Category', category),
    field('Privacy', privacy),
    field('Membership', membership),
    field('Who can post', posting),
    field('Who can invite', invites),
    field('Cover photo', cover),
  );
  form.append(field('Description', description), grid);

  const message = document.createElement('p');
  message.className = 'room-admin-message';
  message.hidden = true;
  const actions = document.createElement('div');
  actions.className = 'room-settings-actions';
  const removeCover = document.createElement('button');
  removeCover.type = 'button';
  removeCover.className = 'secondary-action';
  removeCover.textContent = 'Remove cover';
  removeCover.hidden = !room.cover_key;
  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'form-submit';
  save.innerHTML = '<span>Save Room settings</span>';
  actions.append(removeCover, save);
  form.append(message, actions);

  privacy.addEventListener('change', () => {
    if (privacy.value === 'private' && membership.value === 'open') membership.value = 'approval';
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    save.disabled = true;
    setStatus(message, '');
    try {
      if (privacy.value === 'private' && membership.value === 'open') membership.value = 'approval';
      await restPatch('social_circles', { id: `eq.${room.id}` }, {
        description: description.value.trim(),
        category: category.value,
        privacy: privacy.value,
        join_policy: membership.value,
        post_permission: posting.value,
        invite_permission: invites.value,
        updated_at: new Date().toISOString(),
      });
      if (cover.files?.[0]) await uploadRoomCover(room.id, cover.files[0]);
      setStatus(message, 'Room settings saved.', true);
      showRoomToast('Room settings saved.');
      detailRenderKey = '';
      scheduleDetailRefresh();
      scheduleCardRefresh();
    } catch (error) {
      setStatus(message, error?.message || 'Room settings could not be saved.');
    } finally {
      save.disabled = false;
    }
  });
  removeCover.addEventListener('click', async () => {
    removeCover.disabled = true;
    try {
      await removeRoomCover(room.id);
      removeCover.hidden = true;
      showRoomToast('Room cover removed.');
      detailRenderKey = '';
      scheduleDetailRefresh();
    } catch (error) {
      setStatus(message, error?.message || 'Room cover could not be removed.');
    } finally {
      removeCover.disabled = false;
    }
  });
  return form;
}

async function uploadRoomCover(roomId, file) {
  const accessToken = token();
  if (!accessToken) throw new Error('Sign in again before changing the Room cover.');
  const form = new FormData();
  form.append('room_id', roomId);
  form.append('file', file);
  const response = await fetch('/api/room-media/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message || 'Room cover upload failed.');
  const slug = payload?.data?.slug;
  if (slug && coverObjectUrls.has(slug)) {
    URL.revokeObjectURL(coverObjectUrls.get(slug));
    coverObjectUrls.delete(slug);
  }
  return payload;
}

async function removeRoomCover(roomId) {
  const accessToken = token();
  if (!accessToken) throw new Error('Sign in again before changing the Room cover.');
  const response = await fetch('/api/room-media/remove', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ room_id: roomId }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message || 'Room cover removal failed.');
  return payload;
}

async function loadRoomAdminPeople(room, viewerRole, root) {
  const [members, requests] = await Promise.all([
    restSelect('social_circle_members', {
      circle_id: `eq.${room.id}`,
      select: 'member_id,member_role,joined_at',
      order: 'joined_at.asc',
    }),
    restSelect('social_circle_join_requests', {
      circle_id: `eq.${room.id}`,
      status: 'eq.pending',
      select: 'requester_id,status,created_at',
      order: 'created_at.asc',
    }),
  ]);

  const ids = [...new Set([...members.map((row) => row.member_id), ...requests.map((row) => row.requester_id)])];
  let profiles = [];
  if (ids.length) {
    profiles = await restSelect('social_profiles', {
      id: `in.(${ids.join(',')})`,
      select: 'id,username,display_name,is_verified,verification_badge_type',
    });
  }
  const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
  renderJoinRequests(room, viewerRole, root.querySelector('[data-room-request-list]'), requests, profileMap);
  renderAdminMembers(room, viewerRole, root.querySelector('[data-room-member-list]'), members, profileMap);
}

function personName(profile) {
  return profile?.display_name || profile?.username || 'SautiLink member';
}

function personHandle(profile) {
  return profile?.username ? `@${profile.username}` : 'Member';
}

function renderJoinRequests(room, viewerRole, root, requests, profileMap) {
  if (!root) return;
  root.replaceChildren();
  if (!requests.length) return;
  const heading = document.createElement('p');
  heading.className = 'room-admin-list-label';
  heading.textContent = `Pending requests · ${requests.length}`;
  root.append(heading);

  requests.forEach((request) => {
    const profile = profileMap.get(request.requester_id);
    const row = document.createElement('div');
    row.className = 'room-admin-person-row';
    row.innerHTML = `<span><strong>${escapeHtml(personName(profile))}</strong><small>${escapeHtml(personHandle(profile))}</small></span>`;
    const actions = document.createElement('div');
    const approve = document.createElement('button');
    approve.type = 'button';
    approve.textContent = 'Approve';
    const decline = document.createElement('button');
    decline.type = 'button';
    decline.textContent = 'Decline';
    actions.append(approve, decline);
    row.append(actions);
    root.append(row);

    const decide = async (status) => {
      approve.disabled = true;
      decline.disabled = true;
      try {
        await restPatch('social_circle_join_requests', {
          circle_id: `eq.${room.id}`,
          requester_id: `eq.${request.requester_id}`,
          status: 'eq.pending',
        }, { status, decided_at: new Date().toISOString() });
        row.remove();
        showRoomToast(status === 'approved' ? 'Member approved.' : 'Request declined.');
        detailRenderKey = '';
        scheduleDetailRefresh();
      } catch (error) {
        approve.disabled = false;
        decline.disabled = false;
        showRoomToast(error?.message || 'The request could not be updated.');
      }
    };
    approve.addEventListener('click', () => decide('approved'));
    decline.addEventListener('click', () => decide('declined'));
  });
}

function canEditRole(viewerRole, targetRole) {
  if (targetRole === 'owner') return false;
  if (viewerRole === 'owner') return true;
  if (viewerRole === 'admin') return !['owner', 'admin'].includes(targetRole);
  return false;
}

function canRemoveRole(viewerRole, targetRole) {
  if (targetRole === 'owner') return false;
  if (viewerRole === 'owner') return true;
  if (viewerRole === 'admin') return ['member', 'moderator'].includes(targetRole);
  if (viewerRole === 'moderator') return targetRole === 'member';
  return false;
}

function renderAdminMembers(room, viewerRole, root, members, profileMap) {
  if (!root) return;
  root.replaceChildren();
  const heading = document.createElement('p');
  heading.className = 'room-admin-list-label';
  heading.textContent = `Members · ${members.length}`;
  root.append(heading);

  members.forEach((membership) => {
    const profile = profileMap.get(membership.member_id);
    const row = document.createElement('div');
    row.className = 'room-admin-person-row';
    const person = document.createElement('span');
    person.innerHTML = `<strong>${escapeHtml(personName(profile))}</strong><small>${escapeHtml(personHandle(profile))}</small>`;
    const controls = document.createElement('div');

    if (canEditRole(viewerRole, membership.member_role)) {
      const role = createSelect('', '', [
        ['member', 'Member'],
        ['moderator', 'Moderator'],
        ...(viewerRole === 'owner' ? [['admin', 'Admin']] : []),
      ], membership.member_role);
      role.setAttribute('aria-label', `Role for ${personName(profile)}`);
      role.addEventListener('change', async () => {
        role.disabled = true;
        try {
          await restPatch('social_circle_members', {
            circle_id: `eq.${room.id}`,
            member_id: `eq.${membership.member_id}`,
          }, { member_role: role.value });
          showRoomToast('Member role updated.');
        } catch (error) {
          role.value = membership.member_role;
          showRoomToast(error?.message || 'The member role could not be changed.');
        } finally {
          role.disabled = false;
        }
      });
      controls.append(role);
    } else {
      const role = document.createElement('span');
      role.className = `room-role-badge ${membership.member_role}`;
      role.textContent = membership.member_role[0].toUpperCase() + membership.member_role.slice(1);
      controls.append(role);
    }

    if (canRemoveRole(viewerRole, membership.member_role)) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'room-member-remove-action';
      remove.textContent = 'Remove';
      remove.addEventListener('click', async () => {
        if (!window.confirm(`Remove ${personName(profile)} from this Room?`)) return;
        remove.disabled = true;
        try {
          await restDelete('social_circle_members', {
            circle_id: `eq.${room.id}`,
            member_id: `eq.${membership.member_id}`,
          });
          row.remove();
          showRoomToast('Member removed from the Room.');
          scheduleCardRefresh();
        } catch (error) {
          remove.disabled = false;
          showRoomToast(error?.message || 'The member could not be removed.');
        }
      });
      controls.append(remove);
    }

    row.append(person, controls);
    root.append(row);
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function refreshRoomDetail() {
  const detail = byId('circle-detail');
  if (!detail || detail.hidden) return;
  const slug = roomSlugFromUi();
  if (!slug) return;
  const room = await roomDetail(slug);
  if (!room) return;
  const role = await ownRoomRole(room.id);
  const renderKey = [room.id, room.updated_at, room.member_count, room.cover_key, role].join(':');
  if (renderKey === detailRenderKey && byId('room-admin-panel')) {
    addDetailSummary(room, role);
    return;
  }
  detailRenderKey = renderKey;
  addDetailSummary(room, role);
  buildAdminPanel(room, role);
  canonicalizeCurrentRoomUrl();
}

function scheduleDetailRefresh() {
  window.clearTimeout(detailRefreshTimer);
  detailRefreshTimer = window.setTimeout(refreshRoomDetail, 120);
}

function installRoomObserver() {
  const observer = new MutationObserver((mutations) => {
    let cardsChanged = false;
    let detailChanged = false;
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        sanitizeNode(node);
        if (node instanceof Element) {
          if (node.matches?.('.circle-card') || node.querySelector?.('.circle-card')) cardsChanged = true;
          if (node.matches?.('#circle-detail, .circle-detail-card') || node.querySelector?.('#circle-detail')) detailChanged = true;
        }
      });
      if (mutation.target instanceof Element) {
        if (mutation.target.closest?.('#circles-list')) cardsChanged = true;
        if (mutation.target.closest?.('#circle-detail')) detailChanged = true;
      }
    }
    brandRoomsShell();
    addCreateRoomFields();
    addDiscoveryControls();
    if (cardsChanged) scheduleCardRefresh();
    if (detailChanged) scheduleDetailRefresh();
    canonicalizeCurrentRoomUrl();
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden'] });
}

function initRooms() {
  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = '/app/assets/rooms.css?v=20260909-rooms1';
  document.head.append(css);

  sanitizeNode(document.body);
  brandRoomsShell();
  addCreateRoomFields();
  addDiscoveryControls();
  installRoomObserver();
  scheduleCardRefresh();
  scheduleDetailRefresh();
}

installCanonicalRoomRoutes();
initRooms();
