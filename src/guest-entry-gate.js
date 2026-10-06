const GUEST_GATE_SUPABASE_URL = 'https://rggpyiterdbbugluejcs.supabase.co';
const GUEST_GATE_PUBLISHABLE_KEY = 'sb_publishable_omJ-5Mem-K4vgm6WLXRzJQ_jeGs65ca';
const AUTH_STORAGE_KEY = 'sautilink.auth.session';
const RETURN_STORAGE_KEY = 'sautilink.auth.return-target';
const GUEST_GATE_STYLESHEET = '/app/assets/guest-entry-gate.css';

function parseStoredSession() {
  try {
    const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (value?.access_token && value?.user?.id) return value;
    if (value?.currentSession?.access_token && value?.currentSession?.user?.id) return value.currentSession;
    return null;
  } catch {
    return null;
  }
}

export function safeAuthReturnTarget(value) {
  const candidate = String(value || '').trim();
  if (!candidate.startsWith('/') || candidate.startsWith('//')) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(candidate)) return '';
  const pathname = candidate.split(/[?#]/, 1)[0];
  if (!/^(?:\/u\/[a-z0-9][a-z0-9._]{2,29}|\/post\/[a-z0-9-]+|\/videos(?:\/[a-z0-9-]+)?|\/home|\/discover|\/saved|\/messages|\/sautify|\/settings)(?:\/|$)/i.test(pathname)) {
    return '';
  }
  return candidate.slice(0, 300);
}

function saveAuthReturnTarget(value) {
  const target = safeAuthReturnTarget(value);
  if (!target) return '';
  try {
    window.sessionStorage.setItem(RETURN_STORAGE_KEY, target);
  } catch {
    // Session storage is a convenience only; the query-string target remains authoritative.
  }
  return target;
}

export function consumeGuestReturnTarget() {
  let target = '';
  try {
    target = safeAuthReturnTarget(window.sessionStorage.getItem(RETURN_STORAGE_KEY));
    if (target) window.sessionStorage.removeItem(RETURN_STORAGE_KEY);
  } catch {
    target = '';
  }
  return target;
}

function currentAuthReturnTarget() {
  const url = new URL(window.location.href);
  const queryTarget = safeAuthReturnTarget(url.searchParams.get('next'));
  if (queryTarget) return saveAuthReturnTarget(queryTarget);
  try {
    return safeAuthReturnTarget(window.sessionStorage.getItem(RETURN_STORAGE_KEY));
  } catch {
    return '';
  }
}

function installAuthReturnMonitor() {
  if (!/^\/(?:login|signup)\/?$/.test(window.location.pathname)) return;
  const target = currentAuthReturnTarget();
  if (!target) return;

  const redirectIfReady = () => {
    if (!parseStoredSession()) return false;
    const destination = consumeGuestReturnTarget() || target;
    window.location.replace(destination);
    return true;
  };

  if (redirectIfReady()) return;

  const startedAt = Date.now();
  const timer = window.setInterval(() => {
    if (redirectIfReady() || Date.now() - startedAt > 120000) {
      window.clearInterval(timer);
    }
  }, 40);
}

function profileRoute() {
  const match = window.location.pathname.match(/^(?:\/app)?\/u\/([a-z0-9][a-z0-9._]{2,29})\/?$/i);
  if (!match) return null;
  return {
    username: match[1].toLowerCase(),
    destination: `/u/${match[1].toLowerCase()}`,
  };
}

function postRoute() {
  const match = window.location.pathname.match(/^\/post\/([0-9a-f-]{36})\/?$/i);
  if (!match) return null;
  return {
    postId: match[1].toLowerCase(),
    destination: `/post/${match[1].toLowerCase()}`,
  };
}

function ensureGateStyles() {
  if (document.querySelector('link[data-sautilink-guest-gate]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = GUEST_GATE_STYLESHEET;
  link.dataset.sautilinkGuestGate = 'true';
  document.head.append(link);
}

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function initials(value) {
  const parts = String(value || '').trim().split(/\s+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((part) => part[0] || '').join('').toUpperCase();
  return letters || 'S';
}

function badgeAsset(type) {
  const normalized = String(type || '').toLowerCase();
  if (normalized.includes('team') || normalized.includes('staff')) {
    return '/app/assets/verification/verified-team.png';
  }
  if (normalized.includes('secondary')) {
    return '/app/assets/verification/verified-user-secondary.png';
  }
  return '/app/assets/verification/verified-user-primary.png';
}

function makeAuthLink(label, route, destination, className) {
  const link = node('a', className, label);
  link.href = `${route}?next=${encodeURIComponent(destination)}`;
  link.addEventListener('click', () => saveAuthReturnTarget(destination));
  return link;
}

function lockUnderlyingApp() {
  document.documentElement.classList.add('sautilink-guest-profile-locked');
  for (const id of ['auth-view', 'member-view']) {
    const surface = document.getElementById(id);
    if (!surface) continue;
    surface.setAttribute('aria-hidden', 'true');
    surface.inert = true;
  }
}

function createGateShell(route) {
  ensureGateStyles();
  lockUnderlyingApp();

  const existing = document.getElementById('sautilink-guest-profile-gate');
  if (existing) return existing;

  const gate = node('main', 'guest-profile-gate');
  gate.id = 'sautilink-guest-profile-gate';
  gate.dataset.username = route.username;
  gate.setAttribute('aria-label', 'SautiLink profile preview');

  const brand = node('a', 'guest-profile-brand');
  brand.href = '/';
  brand.setAttribute('aria-label', 'SautiLink home');
  const brandLogo = document.createElement('img');
  brandLogo.src = '/logo.png';
  brandLogo.alt = 'SautiLink';
  brand.append(brandLogo);

  const card = node('section', 'guest-profile-card');
  card.setAttribute('aria-live', 'polite');

  const loading = node('p', 'guest-profile-loading', 'Loading profile…');
  loading.id = 'guest-profile-loading';
  card.append(loading);

  gate.append(brand, card);
  document.body.append(gate);
  return gate;
}

async function readGuestProfile(username) {
  const params = new URLSearchParams({
    select: 'username,display_name,is_verified,verification_badge_type,followers_count',
    username: `eq.${username}`,
    is_discoverable: 'eq.true',
    limit: '1',
  });
  const response = await fetch(`${GUEST_GATE_SUPABASE_URL}/rest/v1/social_profiles?${params}`, {
    headers: {
      apikey: GUEST_GATE_PUBLISHABLE_KEY,
      Accept: 'application/json',
    },
  });
  if (!response.ok) return null;
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows[0] || null : null;
}

function renderUnavailable(card) {
  card.replaceChildren();
  card.append(
    node('h1', 'guest-profile-title', 'This profile is not available'),
    node('p', 'guest-profile-copy', 'Log in or create an account to continue on SautiLink.'),
  );
  const actions = node('div', 'guest-profile-actions');
  actions.append(
    makeAuthLink('Log in', '/login', '/home', 'guest-profile-primary'),
    makeAuthLink('Create account', '/signup', '/home', 'guest-profile-secondary'),
  );
  card.append(actions);
}

function renderProfileTeaser(card, profile, route) {
  card.replaceChildren();

  const avatarWrap = node('div', 'guest-profile-avatar-wrap');
  const avatarFallback = node('span', 'guest-profile-avatar-fallback', initials(profile.display_name || profile.username));
  const avatar = document.createElement('img');
  avatar.className = 'guest-profile-avatar';
  avatar.alt = '';
  avatar.src = `/api/profile-media/${encodeURIComponent(profile.username)}/avatar`;
  avatar.addEventListener('load', () => {
    avatarFallback.hidden = true;
    avatar.hidden = false;
  }, { once: true });
  avatar.addEventListener('error', () => {
    avatar.hidden = true;
    avatarFallback.hidden = false;
  }, { once: true });
  avatar.hidden = true;
  avatarWrap.append(avatarFallback, avatar);

  const identity = node('div', 'guest-profile-identity');
  const nameLine = node('div', 'guest-profile-name-line');
  nameLine.append(node('h1', 'guest-profile-name', profile.display_name || profile.username));
  if (profile.is_verified) {
    const badge = document.createElement('img');
    badge.className = 'guest-profile-badge';
    badge.src = badgeAsset(profile.verification_badge_type);
    badge.alt = 'Verified account';
    badge.title = `This profile was verified that belongs to ${profile.display_name || profile.username}.`;
    nameLine.append(badge);
  }
  identity.append(nameLine, node('p', 'guest-profile-username', `@${profile.username}`));

  const followerCount = Number(profile.followers_count || 0);
  const stats = node('div', 'guest-profile-stats');
  stats.append(
    node('strong', 'guest-profile-stat-number', new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(followerCount)),
    node('span', 'guest-profile-stat-label', followerCount === 1 ? 'Follower' : 'Followers'),
  );

  const divider = node('div', 'guest-profile-divider');
  divider.setAttribute('aria-hidden', 'true');

  const message = node('div', 'guest-profile-message');
  message.append(
    node('h2', 'guest-profile-title', 'Join SautiLink to see the full profile'),
    node('p', 'guest-profile-copy', 'Log in or create an account to see this profile’s bio, posts and full content.'),
  );

  const actions = node('div', 'guest-profile-actions');
  actions.append(
    makeAuthLink('Log in', '/login', route.destination, 'guest-profile-primary'),
    makeAuthLink('Create account', '/signup', route.destination, 'guest-profile-secondary'),
  );

  card.append(avatarWrap, identity, stats, divider, message, actions);
}

async function installGuestProfileGate() {
  const route = profileRoute();
  if (!route || parseStoredSession()) return;

  const gate = createGateShell(route);
  const card = gate.querySelector('.guest-profile-card');
  if (!card) return;

  const profile = await readGuestProfile(route.username).catch(() => null);
  if (!profile) {
    renderUnavailable(card);
    return;
  }
  renderProfileTeaser(card, profile, route);
}


function formatGuestCount(value) {
  const count = Math.max(0, Number(value || 0));
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(count);
}

function createPostGateShell(route) {
  ensureGateStyles();
  lockUnderlyingApp();

  const existing = document.getElementById('sautilink-guest-post-gate');
  if (existing) return existing;

  const gate = node('main', 'guest-profile-gate guest-post-gate');
  gate.id = 'sautilink-guest-post-gate';
  gate.dataset.postId = route.postId;
  gate.setAttribute('aria-label', 'Public SautiLink post');

  const brand = node('a', 'guest-profile-brand guest-post-brand');
  brand.href = '/';
  brand.setAttribute('aria-label', 'SautiLink home');
  const brandLogo = document.createElement('img');
  brandLogo.src = '/logo.png';
  brandLogo.alt = 'SautiLink';
  brand.append(brandLogo);

  const card = node('article', 'guest-profile-card guest-post-card');
  card.setAttribute('aria-live', 'polite');
  card.append(node('p', 'guest-profile-loading', 'Loading post…'));

  gate.append(brand, card);
  document.body.append(gate);
  return gate;
}

async function readGuestPost(postId) {
  const response = await fetch(`/api/public-post/${encodeURIComponent(postId)}`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null);
  return payload?.data?.post || null;
}

function guestActionDialog(route) {
  let dialog = document.getElementById('sautilink-guest-action-dialog');
  if (dialog) return dialog;

  dialog = document.createElement('dialog');
  dialog.id = 'sautilink-guest-action-dialog';
  dialog.className = 'guest-action-dialog';
  dialog.innerHTML = `
    <form method="dialog" class="guest-action-panel">
      <button class="guest-action-close" type="submit" value="close" aria-label="Close">×</button>
      <img class="guest-action-logo" src="/logo.png" alt="" width="66">
      <h2 data-guest-action-title>Join SautiLink to continue</h2>
      <p data-guest-action-copy>Log in or create an account to interact with this post.</p>
      <div class="guest-profile-actions">
        <a class="guest-profile-primary" data-guest-login>Log in</a>
        <a class="guest-profile-secondary" data-guest-signup>Create account</a>
      </div>
    </form>`;
  document.body.append(dialog);

  const login = dialog.querySelector('[data-guest-login]');
  const signup = dialog.querySelector('[data-guest-signup]');
  for (const [link, base] of [[login, '/login'], [signup, '/signup']]) {
    link?.addEventListener('click', () => saveAuthReturnTarget(route.destination));
    if (link) link.href = `${base}?next=${encodeURIComponent(route.destination)}`;
  }
  return dialog;
}

function showGuestAction(route, title, copy) {
  const dialog = guestActionDialog(route);
  const titleNode = dialog.querySelector('[data-guest-action-title]');
  const copyNode = dialog.querySelector('[data-guest-action-copy]');
  if (titleNode) titleNode.textContent = title;
  if (copyNode) copyNode.textContent = copy;
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function guestActionButton(label, route, title, copy, className = '') {
  const button = node('button', `guest-post-action ${className}`.trim(), label);
  button.type = 'button';
  button.addEventListener('click', () => showGuestAction(route, title, copy));
  return button;
}

function guestMedia(post, route) {
  const media = Array.isArray(post.media) ? post.media : [];
  if (!media.length) return null;

  const grid = node('div', `guest-post-media guest-post-media-count-${Math.min(media.length, 5)}`);
  for (const item of media) {
    const frame = node('div', `guest-post-media-frame ${item.kind === 'video' ? 'is-video' : 'is-image'}`);
    const image = document.createElement('img');
    image.src = String(item.preview_url || '');
    image.alt = String(item.alt_text || (item.kind === 'video' ? 'Video preview' : 'Post image'));
    image.loading = 'eager';
    image.decoding = 'async';
    if (item.width) image.width = Number(item.width);
    if (item.height) image.height = Number(item.height);
    frame.append(image);

    if (item.kind === 'video') {
      const play = node('button', 'guest-post-play', '▶');
      play.type = 'button';
      play.setAttribute('aria-label', 'Play video');
      play.addEventListener('click', () => showGuestAction(
        route,
        'Join or sign up to view this content',
        'Create a SautiLink account or log in to play this video.',
      ));
      frame.append(play);
    }
    grid.append(frame);
  }
  return grid;
}

async function shareGuestPost(button) {
  const url = window.location.href;
  try {
    if (navigator.share) {
      await navigator.share({ title: document.title || 'SautiLink post', text: 'View this post on SautiLink', url });
      return;
    }
    await navigator.clipboard?.writeText(url);
    const original = button.textContent;
    button.textContent = 'Link copied';
    window.setTimeout(() => { button.textContent = original; }, 1600);
  } catch {
    // Cancellation or clipboard denial should not block the public post view.
  }
}

function renderPostUnavailable(card) {
  card.replaceChildren();
  card.append(
    node('h1', 'guest-profile-title', 'This post is not available'),
    node('p', 'guest-profile-copy', 'The post may be private, removed, restricted, or the link may no longer be valid.'),
  );
}

function renderGuestPost(card, post, route) {
  card.replaceChildren();

  const header = node('header', 'guest-post-author');
  const avatarWrap = node('div', 'guest-post-avatar-wrap');
  const fallback = node('span', 'guest-post-avatar-fallback', initials(post.author?.display_name || post.author?.username));
  const avatar = document.createElement('img');
  avatar.className = 'guest-post-avatar';
  avatar.src = String(post.author?.avatar_url || '/logo.png');
  avatar.alt = '';
  avatar.addEventListener('load', () => { fallback.hidden = true; avatar.hidden = false; }, { once: true });
  avatar.addEventListener('error', () => { avatar.hidden = true; fallback.hidden = false; }, { once: true });
  avatar.hidden = true;
  avatarWrap.append(fallback, avatar);

  const identity = node('div', 'guest-post-author-copy');
  const nameLine = node('div', 'guest-post-author-name-line');
  nameLine.append(node('strong', 'guest-post-author-name', post.author?.display_name || post.author?.username || 'SautiLink member'));
  if (post.author?.is_verified) {
    const badge = document.createElement('img');
    badge.className = 'guest-profile-badge guest-post-badge';
    badge.src = badgeAsset(post.author.verification_badge_type);
    badge.alt = 'Verified account';
    nameLine.append(badge);
  }
  identity.append(nameLine, node('span', 'guest-post-author-handle', `@${post.author?.username || 'member'}`));
  header.append(avatarWrap, identity);

  const body = String(post.body || '').trim();
  if (body) {
    const caption = node('p', 'guest-post-body', body);
    card.append(header, caption);
  } else {
    card.append(header);
  }

  const media = guestMedia(post, route);
  if (media) card.append(media);

  const counts = node('div', 'guest-post-counts');
  counts.append(
    node('span', '', `${formatGuestCount(post.counts?.likes)} Like${Number(post.counts?.likes || 0) === 1 ? '' : 's'}`),
    node('span', '', `${formatGuestCount(post.counts?.comments)} Comment${Number(post.counts?.comments || 0) === 1 ? '' : 's'}`),
    node('span', '', `${formatGuestCount(post.counts?.reposts)} Repost${Number(post.counts?.reposts || 0) === 1 ? '' : 's'}`),
  );
  card.append(counts);

  const actions = node('div', 'guest-post-actions');
  actions.append(
    guestActionButton('Like', route, 'Join SautiLink to like this post', 'Log in or create an account to react to public posts.'),
    guestActionButton('Comment', route, 'Join SautiLink to comment', 'Log in or create an account to join the conversation.'),
    guestActionButton('Repost', route, 'Join SautiLink to repost', 'Log in or create an account to repost this content on SautiLink.'),
  );
  const share = node('button', 'guest-post-action', 'Share');
  share.type = 'button';
  share.addEventListener('click', () => shareGuestPost(share));
  actions.append(share);
  card.append(actions);

  const join = node('section', 'guest-post-join');
  join.append(
    node('h2', 'guest-profile-title', 'Join the conversation on SautiLink'),
    node('p', 'guest-profile-copy', 'Public posts are open to read. Create an account or log in to interact, follow people and join Rooms.'),
  );
  const authActions = node('div', 'guest-profile-actions guest-post-auth-actions');
  authActions.append(
    makeAuthLink('Log in', '/login', route.destination, 'guest-profile-primary'),
    makeAuthLink('Create account', '/signup', route.destination, 'guest-profile-secondary'),
  );
  join.append(authActions);
  card.append(join);
}

async function installGuestPostGate() {
  const route = postRoute();
  if (!route || parseStoredSession()) return;

  const gate = createPostGateShell(route);
  const card = gate.querySelector('.guest-post-card');
  if (!card) return;

  const post = await readGuestPost(route.postId).catch(() => null);
  if (!post) {
    renderPostUnavailable(card);
    return;
  }
  renderGuestPost(card, post, route);
}

function installGuestEntryGate() {
  installAuthReturnMonitor();
  installGuestProfileGate();
  installGuestPostGate();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installGuestEntryGate, { once: true });
} else {
  queueMicrotask(installGuestEntryGate);
}
