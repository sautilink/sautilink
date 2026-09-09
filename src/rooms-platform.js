const ROOMS_SUPABASE_URL = 'https://rggpyiterdbbugluejcs.supabase.co';
const ROOMS_SUPABASE_KEY = 'sb_publishable_omJ-5Mem-K4vgm6WLXRzJQ_jeGs65ca';
const ROOMS_AUTH_KEY = 'sautilink.auth.session';

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

const ROOM_CATEGORY_LABELS = new Map(ROOM_CATEGORIES);
const roomCoverCache = new Map();
let roomCurrentUserPromise = null;
let pendingRoomCreate = null;
let roomUiTimer = 0;
let roomDetailKey = '';
let roomInitialCanonicalPath = '';

function roomById(id) {
  return document.getElementById(id);
}

function roomAccessToken() {
  const keys = [ROOMS_AUTH_KEY, ...Object.keys(localStorage).filter((key) => key.startsWith('sb-') && key.endsWith('-auth-token'))];
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

function roomHeaders({ json = false, prefer = '' } = {}) {
  const headers = { apikey: ROOMS_SUPABASE_KEY, Accept: 'application/json' };
  const accessToken = roomAccessToken();
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (json) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;
  return headers;
}

function roomRestUrl(table, params = {}) {
  const url = new URL(`${ROOMS_SUPABASE_URL}/rest/v1/${table}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  });
  return url;
}

async function roomSelect(table, params) {
  const response = await fetch(roomRestUrl(table, params), { headers: roomHeaders() }).catch(() => null);
  if (!response?.ok) return [];
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function roomPatch(table, params, body) {
  const response = await fetch(roomRestUrl(table, params), {
    method: 'PATCH',
    headers: roomHeaders({ json: true, prefer: 'return=representation' }),
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!response?.ok) {
    const payload = await response?.json().catch(() => null);
    throw new Error(payload?.message || payload?.details || 'The Room change could not be saved.');
  }
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function roomDelete(table, params) {
  const response = await fetch(roomRestUrl(table, params), {
    method: 'DELETE',
    headers: roomHeaders({ prefer: 'return=representation' }),
  }).catch(() => null);
  if (!response?.ok) {
    const payload = await response?.json().catch(() => null);
    throw new Error(payload?.message || payload?.details || 'The member could not be removed.');
  }
  return response.json().catch(() => []);
}

async function roomCurrentUser() {
  if (roomCurrentUserPromise) return roomCurrentUserPromise;
  roomCurrentUserPromise = (async () => {
    const accessToken = roomAccessToken();
    if (!accessToken) return null;
    const response = await fetch(`${ROOMS_SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: ROOMS_SUPABASE_KEY, Authorization: `Bearer ${accessToken}` },
    }).catch(() => null);
    if (!response?.ok) return null;
    const user = await response.json().catch(() => null);
    return user?.id ? user : null;
  })();
  return roomCurrentUserPromise;
}

function roomToast(message) {
  const node = roomById('toast');
  if (!node) return;
  node.textContent = message;
  node.hidden = false;
  window.clearTimeout(roomToast.timer);
  roomToast.timer = window.setTimeout(() => { node.hidden = true; }, 2600);
}

function roomStatus(node, message, success = false) {
  if (!node) return;
  node.textContent = message;
  node.hidden = !message;
  node.dataset.state = success ? 'success' : 'error';
}

function roomCanonicalPath(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/^\/app\/(?:sautify|circles)(?=\/|$)/, '/rooms')
    .replace(/^\/sautify(?=\/|$)/, '/rooms');
}

function roomLegacyPath(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/^\/rooms(?=\/|$)/, '/sautify');
}

function installRoomRouteBridge() {
  const nativePush = history.pushState.bind(history);
  const nativeReplace = history.replaceState.bind(history);

  if (/^\/rooms(?:\/|$)/.test(location.pathname)) {
    roomInitialCanonicalPath = `${location.pathname}${location.search}${location.hash}`;
    nativeReplace(history.state, '', `${roomLegacyPath(location.pathname)}${location.search}${location.hash}`);
  }

  history.pushState = (state, title, url) => nativePush(state, title, typeof url === 'string' ? roomCanonicalPath(url) : url);
  history.replaceState = (state, title, url) => nativeReplace(state, title, typeof url === 'string' ? roomCanonicalPath(url) : url);
  window.__sautiRoomsNativeReplace = nativeReplace;
}

function canonicalizeRoomUrl() {
  const surface = roomById('circles-surface');
  if (!surface || surface.hidden) return;
  const nativeReplace = window.__sautiRoomsNativeReplace;
  if (!nativeReplace) return;
  if (/^\/sautify(?:\/|$)/.test(location.pathname)) {
    nativeReplace(history.state, '', `${roomCanonicalPath(location.pathname)}${location.search}${location.hash}`);
  } else if (roomInitialCanonicalPath) {
    nativeReplace(history.state, '', roomInitialCanonicalPath);
    roomInitialCanonicalPath = '';
  }
}

function roomBrandText(value) {
  return String(value)
    .replace(/\/app\/sautify\//gi, '/rooms/')
    .replace(/\/sautify\//gi, '/rooms/')
    .replace(/\bSautify\b/g, 'Room')
    .replace(/\bsautify\b/g, 'room');
}

function sanitizeRoomBrand(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    const next = roomBrandText(node.nodeValue || '');
    if (next !== node.nodeValue) node.nodeValue = next;
    return;
  }
  if (!(node instanceof Element)) return;
  ['aria-label', 'title', 'placeholder'].forEach((attribute) => {
    const old = node.getAttribute(attribute);
    if (!old) return;
    const next = roomBrandText(old);
    if (old !== next) node.setAttribute(attribute, next);
  });
  node.childNodes.forEach(sanitizeRoomBrand);
}

function roomIconMarkup() {
  return '<rect x="3.5" y="3.5" width="17" height="17" rx="4"></rect><circle cx="9" cy="10" r="2.2"></circle><circle cx="15.5" cy="10.8" r="1.8"></circle><path d="M5.8 17c.4-2.5 1.5-3.7 3.4-3.7s3 1.2 3.4 3.7M13 14.4c2.5-.5 4.1.5 4.5 2.6"></path>';
}

function brandRoomsShell() {
  document.querySelectorAll('[data-member-view="circles"]').forEach((button) => {
    button.setAttribute('aria-label', 'Rooms');
    const label = button.querySelector('span:not(.notification-badge):not(.mobile-notification-badge)');
    if (label) label.textContent = 'Rooms';
    const icon = button.querySelector('svg');
    if (icon && icon.dataset.roomIcon !== 'true') {
      icon.innerHTML = roomIconMarkup();
      icon.dataset.roomIcon = 'true';
    }
  });

  const surface = roomById('circles-surface');
  if (!surface) return;
  surface.setAttribute('aria-label', 'Rooms');
  if (!surface.hidden) {
    const title = roomById('view-title');
    if (title) title.textContent = 'Rooms';
  }
  const toolbar = surface.querySelector('.circles-toolbar');
  const eyebrow = toolbar?.querySelector('.section-label');
  const heading = toolbar?.querySelector('h2');
  const copy = toolbar?.querySelector('div > p:last-child');
  if (eyebrow) eyebrow.textContent = 'Groups built around shared interests';
  if (heading) heading.textContent = 'Rooms';
  if (copy) copy.textContent = 'Find communities by topic, join public Rooms, request access to private Rooms, or create your own.';
  if (roomById('circles-create-toggle')) roomById('circles-create-toggle').textContent = 'Create Room';
  if (roomById('circle-back')) roomById('circle-back').textContent = '← All Rooms';
  if (roomById('circle-route-home')) roomById('circle-route-home').textContent = 'Back to Rooms';

  const notificationSetting = roomById('settings-notify-sautify');
  if (notificationSetting) {
    const row = notificationSetting.closest('label');
    const strong = row?.querySelector('strong');
    const small = row?.querySelector('small');
    if (strong) strong.textContent = 'Room activity';
    if (small) small.textContent = 'Membership and community updates from Rooms.';
  }
  canonicalizeRoomUrl();
}

function roomOption(value, label) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  return option;
}

function roomSelectControl(id, name, options, value) {
  const select = document.createElement('select');
  select.id = id;
  select.name = name;
  options.forEach(([optionValue, label]) => select.append(roomOption(optionValue, label)));
  if (value) select.value = value;
  return select;
}

function enhanceRoomCreateForm() {
  const form = roomById('circle-create-form');
  if (!form || form.dataset.roomsEnhanced === 'true') return;
  const description = roomById('circle-description');
  const policy = roomById('circle-policy');
  if (!description || !policy) return;
  form.dataset.roomsEnhanced = 'true';

  const categoryLabel = document.createElement('label');
  categoryLabel.htmlFor = 'room-category';
  categoryLabel.textContent = 'Category';
  const category = roomSelectControl('room-category', 'room_category', ROOM_CATEGORIES, 'general');

  const privacyLabel = document.createElement('label');
  privacyLabel.htmlFor = 'room-privacy';
  privacyLabel.textContent = 'Privacy';
  const privacy = roomSelectControl('room-privacy', 'room_privacy', [
    ['public', 'Public — anyone can discover and join based on access settings'],
    ['private', 'Private — discoverable, but posts are members only'],
  ], 'public');

  const permissions = document.createElement('div');
  permissions.className = 'room-create-permissions';
  const postingWrap = document.createElement('label');
  postingWrap.textContent = 'Who can post';
  postingWrap.append(roomSelectControl('room-post-permission', 'room_post_permission', [
    ['all_members', 'All members'],
    ['staff_only', 'Admins & moderators only'],
  ], 'all_members'));
  const inviteWrap = document.createElement('label');
  inviteWrap.textContent = 'Who can invite';
  inviteWrap.append(roomSelectControl('room-invite-permission', 'room_invite_permission', [
    ['all_members', 'All members'],
    ['staff_only', 'Admins & moderators only'],
  ], 'all_members'));
  permissions.append(postingWrap, inviteWrap);

  const coverLabel = document.createElement('label');
  coverLabel.htmlFor = 'room-cover-file';
  coverLabel.textContent = 'Cover photo';
  const cover = document.createElement('input');
  cover.id = 'room-cover-file';
  cover.type = 'file';
  cover.accept = 'image/jpeg,image/png,image/webp';
  const coverHint = document.createElement('small');
  coverHint.className = 'field-hint';
  coverHint.textContent = 'JPEG, PNG or WebP · minimum 600 × 200 px · up to 10 MB.';

  [coverHint, cover, coverLabel, permissions, privacy, privacyLabel, category, categoryLabel]
    .forEach((node) => description.insertAdjacentElement('afterend', node));

  const slugPrefix = form.querySelector('.circle-slug-field > span');
  if (slugPrefix) slugPrefix.textContent = '/rooms/';
  const slugLabel = form.querySelector('label[for="circle-slug"]');
  if (slugLabel) slugLabel.textContent = 'Room username';
  const policyLabel = form.querySelector('label[for="circle-policy"]');
  if (policyLabel) policyLabel.textContent = 'Membership access';
  const policyOptions = policy.querySelectorAll('option');
  if (policyOptions[0]) policyOptions[0].textContent = 'Open — anyone can join';
  if (policyOptions[1]) policyOptions[1].textContent = 'Approval — admins review requests';
  if (policyOptions[2]) policyOptions[2].textContent = 'Invite only';

  privacy.addEventListener('change', () => {
    if (privacy.value === 'private' && policy.value === 'open') policy.value = 'approval';
  });
  form.addEventListener('submit', captureRoomCreate, true);
}

function captureRoomCreate(event) {
  const form = event.currentTarget;
  const category = String(roomById('room-category')?.value || 'general');
  const privacy = String(roomById('room-privacy')?.value || 'public');
  const cover = roomById('room-cover-file')?.files?.[0] || null;
  if (!ROOM_CATEGORY_LABELS.has(category) || !['public', 'private'].includes(privacy)) {
    event.preventDefault();
    event.stopImmediatePropagation();
    roomStatus(roomById('circle-create-message'), 'Choose a valid Room category and privacy setting.');
    return;
  }
  if (cover && cover.size > 10 * 1024 * 1024) {
    event.preventDefault();
    event.stopImmediatePropagation();
    roomStatus(roomById('circle-create-message'), 'Room cover photos must be 10 MB or smaller.');
    return;
  }
  if (privacy === 'private' && form.join_policy?.value === 'open') form.join_policy.value = 'approval';
  pendingRoomCreate = {
    slug: String(form.slug?.value || '').trim().toLowerCase(),
    category,
    privacy,
    postPermission: String(roomById('room-post-permission')?.value || 'all_members'),
    invitePermission: String(roomById('room-invite-permission')?.value || 'all_members'),
    cover,
  };
  window.setTimeout(() => finalizeRoomCreate(0), 250);
}

async function finalizeRoomCreate(attempt) {
  if (!pendingRoomCreate?.slug || attempt > 20) return;
  const user = await roomCurrentUser();
  if (!user) return;
  const rows = await roomSelect('social_circles', {
    slug: `eq.${pendingRoomCreate.slug}`,
    owner_id: `eq.${user.id}`,
    select: 'id,slug',
    limit: 1,
  });
  const room = rows[0];
  if (!room) {
    window.setTimeout(() => finalizeRoomCreate(attempt + 1), 220);
    return;
  }
  const setup = pendingRoomCreate;
  pendingRoomCreate = null;
  try {
    await roomPatch('social_circles', { id: `eq.${room.id}` }, {
      category: setup.category,
      privacy: setup.privacy,
      post_permission: setup.postPermission,
      invite_permission: setup.invitePermission,
      updated_at: new Date().toISOString(),
    });
    if (setup.cover) await uploadRoomCover(room.id, setup.cover);
    roomToast('Room created.');
    scheduleRoomsUi();
  } catch (error) {
    roomToast(error?.message || 'The Room was created, but some advanced settings need another try.');
  }
}

function ensureRoomDiscoveryControls() {
  const toolbar = document.querySelector('#circles-surface .circles-toolbar');
  if (!toolbar || roomById('room-discovery-controls')) return;
  const controls = document.createElement('div');
  controls.id = 'room-discovery-controls';
  controls.className = 'room-discovery-controls';
  const search = document.createElement('input');
  search.id = 'room-search';
  search.type = 'search';
  search.placeholder = 'Search Rooms';
  search.setAttribute('aria-label', 'Search Rooms');
  const filter = roomSelectControl('room-category-filter', 'room_category_filter', [['all', 'All categories'], ...ROOM_CATEGORIES], 'all');
  filter.setAttribute('aria-label', 'Filter Rooms by category');
  controls.append(search, filter);
  toolbar.insertAdjacentElement('afterend', controls);
  search.addEventListener('input', filterRoomCards);
  filter.addEventListener('change', filterRoomCards);
}

async function roomCoverUrl(slug) {
  if (!slug) return '';
  if (roomCoverCache.has(slug)) return roomCoverCache.get(slug);
  const accessToken = roomAccessToken();
  if (!accessToken) return '';
  const response = await fetch(`/api/room-media/${encodeURIComponent(slug)}/cover`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  }).catch(() => null);
  if (!response?.ok) return '';
  const objectUrl = URL.createObjectURL(await response.blob());
  roomCoverCache.set(slug, objectUrl);
  return objectUrl;
}

async function attachRoomCover(container, slug) {
  if (!container || !slug || container.dataset.roomCover === slug) return;
  const url = await roomCoverUrl(slug);
  if (!url || !container.isConnected) return;
  let image = container.querySelector('img.room-cover-image');
  if (!image) {
    image = document.createElement('img');
    image.className = 'room-cover-image';
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    container.replaceChildren(image);
  }
  image.src = url;
  container.dataset.roomCover = slug;
  container.classList.add('has-image');
}

async function enhanceRoomCards() {
  const cards = [...document.querySelectorAll('.circle-card[data-circle-slug]')];
  if (!cards.length) return;
  const rows = await roomSelect('social_circles', {
    select: 'id,slug,name,category,privacy,cover_key,member_count,join_policy',
    order: 'created_at.desc',
    limit: 100,
  });
  const rooms = new Map(rows.map((room) => [room.slug, room]));
  cards.forEach((card) => {
    const room = rooms.get(card.dataset.circleSlug);
    if (!room) return;
    card.dataset.roomCategory = room.category || 'general';
    card.dataset.roomSearch = `${room.name || ''} ${ROOM_CATEGORY_LABELS.get(room.category) || ''}`.toLowerCase();

    const top = card.querySelector('.circle-card-top');
    let category = top?.querySelector('.room-category-badge');
    if (top && !category) {
      category = document.createElement('span');
      category.className = 'room-category-badge';
      top.append(category);
    }
    if (category) category.textContent = ROOM_CATEGORY_LABELS.get(room.category) || 'General';
    let privacy = top?.querySelector('.room-privacy-badge');
    if (top && !privacy) {
      privacy = document.createElement('span');
      privacy.className = 'room-privacy-badge';
      top.append(privacy);
    }
    if (privacy) privacy.textContent = room.privacy === 'private' ? 'Private' : 'Public';

    const meta = card.querySelector('.circle-card-meta');
    let count = meta?.querySelector('.room-member-count');
    if (meta && !count) {
      count = document.createElement('span');
      count.className = 'room-member-count';
      meta.append(count);
    }
    if (count) {
      const total = Number(room.member_count || 0);
      count.textContent = `${total.toLocaleString()} ${total === 1 ? 'member' : 'members'}`;
    }

    let cover = card.querySelector('.room-card-cover');
    if (!cover) {
      cover = document.createElement('span');
      cover.className = 'room-card-cover';
      cover.setAttribute('aria-hidden', 'true');
      card.prepend(cover);
    }
    if (room.cover_key) attachRoomCover(cover, room.slug);
  });
  filterRoomCards();
}

function filterRoomCards() {
  const query = String(roomById('room-search')?.value || '').trim().toLowerCase();
  const category = String(roomById('room-category-filter')?.value || 'all');
  document.querySelectorAll('.circle-card[data-circle-slug]').forEach((card) => {
    const matchesQuery = !query || String(card.dataset.roomSearch || card.textContent).toLowerCase().includes(query);
    const matchesCategory = category === 'all' || card.dataset.roomCategory === category;
    card.hidden = !(matchesQuery && matchesCategory);
  });
}

function activeRoomSlug() {
  const route = location.pathname.match(/^\/rooms\/([^/]+)\/?$/);
  if (route?.[1]) return decodeURIComponent(route[1]);
  return String(roomById('circle-detail-slug')?.textContent || '').replace(/^\/(?:rooms|sautify)\//, '').trim();
}

async function activeRoom() {
  const slug = activeRoomSlug();
  if (!slug) return null;
  const rows = await roomSelect('social_circles', {
    slug: `eq.${slug}`,
    select: 'id,owner_id,slug,name,description,join_policy,category,privacy,cover_key,member_count,post_permission,invite_permission,updated_at',
    limit: 1,
  });
  return rows[0] || null;
}

async function ownRoomRole(roomId) {
  const user = await roomCurrentUser();
  if (!user || !roomId) return '';
  const rows = await roomSelect('social_circle_members', {
    circle_id: `eq.${roomId}`,
    member_id: `eq.${user.id}`,
    select: 'member_role',
    limit: 1,
  });
  return String(rows[0]?.member_role || '');
}

function enhanceRoomDetail(room, role) {
  const card = roomById('circle-detail')?.querySelector('.circle-detail-card');
  if (!card) return;
  let cover = card.querySelector('.room-detail-cover');
  if (!cover) {
    cover = document.createElement('div');
    cover.className = 'room-detail-cover';
    const fallback = document.createElement('span');
    fallback.textContent = 'Room';
    cover.append(fallback);
    card.prepend(cover);
  }
  if (room.cover_key) attachRoomCover(cover, room.slug);

  let badges = card.querySelector('.room-detail-badges');
  if (!badges) {
    badges = document.createElement('div');
    badges.className = 'room-detail-badges';
    card.querySelector('.circle-detail-top')?.insertAdjacentElement('afterend', badges);
  }
  badges.replaceChildren();
  const total = Number(room.member_count || 0);
  [
    ROOM_CATEGORY_LABELS.get(room.category) || 'General',
    room.privacy === 'private' ? 'Private Room' : 'Public Room',
    `${total.toLocaleString()} ${total === 1 ? 'member' : 'members'}`,
  ].forEach((text) => {
    const chip = document.createElement('span');
    chip.textContent = text;
    badges.append(chip);
  });

  if (roomById('circle-detail-slug')) roomById('circle-detail-slug').textContent = `/rooms/${room.slug}`;
  if (role && roomById('circle-detail-membership')) {
    roomById('circle-detail-membership').textContent = role === 'owner' ? 'Owner' : role === 'admin' ? 'Admin' : role === 'moderator' ? 'Moderator' : 'Member';
  }

  let permissions = card.querySelector('.room-permissions-summary');
  if (!permissions) {
    permissions = document.createElement('div');
    permissions.className = 'room-permissions-summary';
    card.querySelector('.circle-detail-description')?.insertAdjacentElement('afterend', permissions);
  }
  permissions.replaceChildren();
  [['Posting', room.post_permission === 'staff_only' ? 'Admins & moderators' : 'All members'], ['Invites', room.invite_permission === 'staff_only' ? 'Admins & moderators' : 'All members']]
    .forEach(([label, value]) => {
      const cell = document.createElement('span');
      const strong = document.createElement('strong');
      strong.textContent = label;
      cell.append(strong, document.createTextNode(value));
      permissions.append(cell);
    });

  const composer = roomById('circle-sauti-composer');
  const staff = ['owner', 'admin', 'moderator'].includes(role);
  const restricted = room.post_permission === 'staff_only' && !staff;
  if (composer && !composer.hidden) {
    let notice = composer.querySelector('.room-posting-restriction');
    if (!notice) {
      notice = document.createElement('p');
      notice.className = 'room-posting-restriction';
      composer.prepend(notice);
    }
    notice.hidden = !restricted;
    notice.textContent = restricted ? 'Only Room admins and moderators can publish posts here.' : '';
    if (roomById('circle-sauti-body')) roomById('circle-sauti-body').disabled = restricted;
    if (restricted && roomById('circle-sauti-submit')) roomById('circle-sauti-submit').disabled = true;
  }
}

function settingsField(label, control) {
  const wrapper = document.createElement('label');
  const span = document.createElement('span');
  span.textContent = label;
  wrapper.append(span, control);
  return wrapper;
}

function buildRoomAdminPanel(room, role) {
  const detail = roomById('circle-detail');
  if (!detail) return;
  const canSettings = ['owner', 'admin'].includes(role);
  const canPeople = ['owner', 'admin', 'moderator'].includes(role);
  let panel = roomById('room-admin-panel');
  if (!canSettings && !canPeople) {
    panel?.remove();
    return;
  }
  if (!panel) {
    panel = document.createElement('section');
    panel.id = 'room-admin-panel';
    panel.className = 'room-admin-panel';
    detail.insertBefore(panel, roomById('circle-stream') || detail.lastChild);
  }
  panel.replaceChildren();

  const heading = document.createElement('div');
  heading.className = 'room-admin-heading';
  const headingCopy = document.createElement('div');
  const eyebrow = document.createElement('p');
  eyebrow.className = 'section-label';
  eyebrow.textContent = 'Room management';
  const title = document.createElement('h3');
  title.textContent = 'Admin tools';
  headingCopy.append(eyebrow, title);
  const roleBadge = document.createElement('span');
  roleBadge.textContent = role[0].toUpperCase() + role.slice(1);
  heading.append(headingCopy, roleBadge);
  panel.append(heading);

  if (canSettings) panel.append(buildRoomSettings(room));
  if (canPeople) {
    const people = document.createElement('div');
    people.className = 'room-member-management';
    const sub = document.createElement('div');
    sub.className = 'room-admin-subheading';
    const subTitle = document.createElement('h4');
    subTitle.textContent = 'Members & requests';
    const subCopy = document.createElement('span');
    subCopy.textContent = 'Manage access and roles';
    sub.append(subTitle, subCopy);
    const requests = document.createElement('div');
    requests.dataset.roomRequestList = 'true';
    const members = document.createElement('div');
    members.dataset.roomMemberList = 'true';
    people.append(sub, requests, members);
    panel.append(people);
    loadRoomPeople(room, role, people);
  }
}

function normalizeRoomSlug(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
}

function buildRoomSettings(room) {
  const form = document.createElement('form');
  form.className = 'room-settings-form';
  form.noValidate = true;

  const name = document.createElement('input');
  name.name = 'name';
  name.maxLength = 80;
  name.value = room.name || '';
  const slug = document.createElement('input');
  slug.name = 'slug';
  slug.maxLength = 50;
  slug.value = room.slug || '';
  slug.addEventListener('input', () => { slug.value = normalizeRoomSlug(slug.value); });
  const description = document.createElement('textarea');
  description.name = 'description';
  description.rows = 3;
  description.maxLength = 1000;
  description.value = room.description || '';
  const category = roomSelectControl('room-admin-category', 'category', ROOM_CATEGORIES, room.category);
  const privacy = roomSelectControl('room-admin-privacy', 'privacy', [['public', 'Public'], ['private', 'Private — posts are members only']], room.privacy);
  const membership = roomSelectControl('room-admin-membership', 'join_policy', [['open', 'Open — anyone can join'], ['approval', 'Approval required'], ['private', 'Invite only']], room.join_policy);
  const posting = roomSelectControl('room-admin-posting', 'post_permission', [['all_members', 'All members can post'], ['staff_only', 'Admins & moderators only']], room.post_permission);
  const invites = roomSelectControl('room-admin-invites', 'invite_permission', [['all_members', 'All members can invite'], ['staff_only', 'Admins & moderators only']], room.invite_permission);
  const cover = document.createElement('input');
  cover.type = 'file';
  cover.accept = 'image/jpeg,image/png,image/webp';

  form.append(settingsField('Room name', name), settingsField('Description', description));
  const grid = document.createElement('div');
  grid.className = 'room-settings-grid';
  const slugWrap = document.createElement('div');
  slugWrap.className = 'room-username-input';
  const prefix = document.createElement('span');
  prefix.textContent = '/rooms/';
  slugWrap.append(prefix, slug);
  grid.append(
    settingsField('Room username', slugWrap),
    settingsField('Category', category),
    settingsField('Privacy', privacy),
    settingsField('Membership', membership),
    settingsField('Who can post', posting),
    settingsField('Who can invite', invites),
    settingsField('Cover photo', cover),
  );
  form.append(grid);

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
  save.textContent = 'Save Room settings';
  actions.append(removeCover, save);
  form.append(message, actions);

  privacy.addEventListener('change', () => {
    if (privacy.value === 'private' && membership.value === 'open') membership.value = 'approval';
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const nextName = name.value.trim();
    const nextSlug = normalizeRoomSlug(slug.value);
    if (!nextName) return roomStatus(message, 'Room name is required.');
    if (!/^[a-z0-9][a-z0-9-]{2,49}$/.test(nextSlug)) return roomStatus(message, 'Room usernames use 3–50 lowercase letters, numbers or hyphens.');
    if (privacy.value === 'private' && membership.value === 'open') membership.value = 'approval';
    save.disabled = true;
    try {
      await roomPatch('social_circles', { id: `eq.${room.id}` }, {
        name: nextName,
        slug: nextSlug,
        description: description.value.trim(),
        category: category.value,
        privacy: privacy.value,
        join_policy: membership.value,
        post_permission: posting.value,
        invite_permission: invites.value,
        updated_at: new Date().toISOString(),
      });
      if (cover.files?.[0]) await uploadRoomCover(room.id, cover.files[0]);
      roomStatus(message, 'Room settings saved.', true);
      roomToast('Room settings saved.');
      roomDetailKey = '';
      if (nextSlug !== room.slug) location.assign(`/rooms/${encodeURIComponent(nextSlug)}`);
      else scheduleRoomsUi();
    } catch (error) {
      const text = String(error?.message || 'Room settings could not be saved.');
      roomStatus(message, /duplicate|unique/i.test(text) ? 'That Room username is already taken.' : text);
    } finally {
      save.disabled = false;
    }
  });
  removeCover.addEventListener('click', async () => {
    removeCover.disabled = true;
    try {
      await removeRoomCover(room.id, room.slug);
      removeCover.hidden = true;
      roomToast('Room cover removed.');
      roomDetailKey = '';
      scheduleRoomsUi();
    } catch (error) {
      roomStatus(message, error?.message || 'Room cover could not be removed.');
    } finally {
      removeCover.disabled = false;
    }
  });
  return form;
}

async function uploadRoomCover(roomId, file) {
  const accessToken = roomAccessToken();
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
  if (slug && roomCoverCache.has(slug)) {
    URL.revokeObjectURL(roomCoverCache.get(slug));
    roomCoverCache.delete(slug);
  }
}

async function removeRoomCover(roomId, slug) {
  const accessToken = roomAccessToken();
  const response = await fetch('/api/room-media/remove', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ room_id: roomId }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message || 'Room cover removal failed.');
  if (roomCoverCache.has(slug)) {
    URL.revokeObjectURL(roomCoverCache.get(slug));
    roomCoverCache.delete(slug);
  }
}

async function loadRoomPeople(room, viewerRole, root) {
  const [members, requests] = await Promise.all([
    roomSelect('social_circle_members', { circle_id: `eq.${room.id}`, select: 'member_id,member_role,joined_at', order: 'joined_at.asc' }),
    roomSelect('social_circle_join_requests', { circle_id: `eq.${room.id}`, status: 'eq.pending', select: 'requester_id,status,created_at', order: 'created_at.asc' }),
  ]);
  const ids = [...new Set([...members.map((row) => row.member_id), ...requests.map((row) => row.requester_id)])];
  const profiles = ids.length ? await roomSelect('social_profiles', { id: `in.(${ids.join(',')})`, select: 'id,username,display_name' }) : [];
  const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
  renderRoomRequests(room, root.querySelector('[data-room-request-list]'), requests, profileMap);
  renderRoomMembers(room, viewerRole, root.querySelector('[data-room-member-list]'), members, profileMap);
}

function profileLabel(profile) {
  return profile?.display_name || profile?.username || 'SautiLink member';
}

function appendPersonIdentity(row, profile) {
  const identity = document.createElement('span');
  const name = document.createElement('strong');
  name.textContent = profileLabel(profile);
  const handle = document.createElement('small');
  handle.textContent = profile?.username ? `@${profile.username}` : 'Member';
  identity.append(name, handle);
  row.append(identity);
}

function renderRoomRequests(room, root, requests, profiles) {
  if (!root) return;
  root.replaceChildren();
  if (!requests.length) return;
  const label = document.createElement('p');
  label.className = 'room-admin-list-label';
  label.textContent = `Pending requests · ${requests.length}`;
  root.append(label);
  requests.forEach((request) => {
    const row = document.createElement('div');
    row.className = 'room-admin-person-row';
    appendPersonIdentity(row, profiles.get(request.requester_id));
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
        await roomPatch('social_circle_join_requests', {
          circle_id: `eq.${room.id}`,
          requester_id: `eq.${request.requester_id}`,
          status: 'eq.pending',
        }, { status });
        row.remove();
        roomToast(status === 'approved' ? 'Member approved.' : 'Request declined.');
        roomDetailKey = '';
        scheduleRoomsUi();
      } catch (error) {
        approve.disabled = false;
        decline.disabled = false;
        roomToast(error?.message || 'The request could not be updated.');
      }
    };
    approve.addEventListener('click', () => decide('approved'));
    decline.addEventListener('click', () => decide('declined'));
  });
}

function canChangeMemberRole(viewerRole, targetRole) {
  if (targetRole === 'owner') return false;
  if (viewerRole === 'owner') return true;
  return viewerRole === 'admin' && !['owner', 'admin'].includes(targetRole);
}

function canRemoveMember(viewerRole, targetRole) {
  if (targetRole === 'owner') return false;
  if (viewerRole === 'owner') return true;
  if (viewerRole === 'admin') return ['member', 'moderator'].includes(targetRole);
  return viewerRole === 'moderator' && targetRole === 'member';
}

function renderRoomMembers(room, viewerRole, root, members, profiles) {
  if (!root) return;
  root.replaceChildren();
  const label = document.createElement('p');
  label.className = 'room-admin-list-label';
  label.textContent = `Members · ${members.length}`;
  root.append(label);
  members.forEach((membership) => {
    const row = document.createElement('div');
    row.className = 'room-admin-person-row';
    const profile = profiles.get(membership.member_id);
    appendPersonIdentity(row, profile);
    const controls = document.createElement('div');
    if (canChangeMemberRole(viewerRole, membership.member_role)) {
      const options = [['member', 'Member'], ['moderator', 'Moderator']];
      if (viewerRole === 'owner') options.push(['admin', 'Admin']);
      const role = roomSelectControl('', '', options, membership.member_role);
      role.setAttribute('aria-label', `Role for ${profileLabel(profile)}`);
      role.addEventListener('change', async () => {
        const oldRole = membership.member_role;
        role.disabled = true;
        try {
          await roomPatch('social_circle_members', { circle_id: `eq.${room.id}`, member_id: `eq.${membership.member_id}` }, { member_role: role.value });
          membership.member_role = role.value;
          roomToast('Member role updated.');
        } catch (error) {
          role.value = oldRole;
          roomToast(error?.message || 'The member role could not be changed.');
        } finally {
          role.disabled = false;
        }
      });
      controls.append(role);
    } else {
      const badge = document.createElement('span');
      badge.className = `room-role-badge ${membership.member_role}`;
      badge.textContent = membership.member_role[0].toUpperCase() + membership.member_role.slice(1);
      controls.append(badge);
    }
    if (canRemoveMember(viewerRole, membership.member_role)) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'room-member-remove-action';
      remove.textContent = 'Remove';
      remove.addEventListener('click', async () => {
        if (!window.confirm(`Remove ${profileLabel(profile)} from this Room?`)) return;
        remove.disabled = true;
        try {
          await roomDelete('social_circle_members', { circle_id: `eq.${room.id}`, member_id: `eq.${membership.member_id}` });
          row.remove();
          roomToast('Member removed from the Room.');
          roomDetailKey = '';
          scheduleRoomsUi();
        } catch (error) {
          remove.disabled = false;
          roomToast(error?.message || 'The member could not be removed.');
        }
      });
      controls.append(remove);
    }
    row.append(controls);
    root.append(row);
  });
}

async function enhanceActiveRoom() {
  const detail = roomById('circle-detail');
  if (!detail || detail.hidden) return;
  const room = await activeRoom();
  if (!room) return;
  const role = await ownRoomRole(room.id);
  enhanceRoomDetail(room, role);
  const key = `${room.id}:${room.updated_at}:${room.member_count}:${room.cover_key}:${role}`;
  if (key !== roomDetailKey || !roomById('room-admin-panel')) {
    roomDetailKey = key;
    buildRoomAdminPanel(room, role);
  }
}

function scheduleRoomsUi() {
  window.clearTimeout(roomUiTimer);
  roomUiTimer = window.setTimeout(() => {
    brandRoomsShell();
    enhanceRoomCreateForm();
    ensureRoomDiscoveryControls();
    enhanceRoomCards();
    enhanceActiveRoom();
  }, 80);
}

function initRoomsPlatform() {
  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = '/app/assets/rooms.css?v=20260909-rooms1';
  document.head.append(css);
  sanitizeRoomBrand(document.body);
  brandRoomsShell();
  enhanceRoomCreateForm();
  ensureRoomDiscoveryControls();

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => mutation.addedNodes.forEach(sanitizeRoomBrand));
    scheduleRoomsUi();
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden'] });
  window.addEventListener('popstate', scheduleRoomsUi);
  window.addEventListener('beforeunload', () => {
    roomCoverCache.forEach((url) => URL.revokeObjectURL(url));
    roomCoverCache.clear();
  });
  scheduleRoomsUi();
}

installRoomRouteBridge();
initRoomsPlatform();
