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
  if (!/^(?:\/u\/[a-z0-9][a-z0-9._]{2,29}|\/post\/[a-z0-9-]+|\/home|\/discover|\/saved|\/messages|\/sautify|\/settings)(?:\/|$)/i.test(pathname)) {
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

function installGuestEntryGate() {
  installAuthReturnMonitor();
  installGuestProfileGate();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installGuestEntryGate, { once: true });
} else {
  queueMicrotask(installGuestEntryGate);
}
