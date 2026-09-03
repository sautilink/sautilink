import { createClient } from '@supabase/supabase-js';
import {
  displayNameError,
  emailError,
  friendlyAuthError,
  normalizeEmail,
  normalizeUsername,
  passwordError,
  usernameError,
} from './auth-validation.js';
import {
  EMAIL_OTP_LENGTH,
  EMAIL_OTP_MAX_LENGTH,
  EMAIL_OTP_MIN_LENGTH,
  isValidEmailOtp,
  normalizeEmailOtp,
} from './auth-email-contract.js';
import {
  AUTH_RESULT_COPY,
  TOKEN_HASH_EMAIL_TYPES,
  actionFromRedirect,
  cleanedAuthReturnUrl,
  parseAuthReturnUrl,
} from './auth-action-state.js';

const SUPABASE_URL = 'https://rggpyiterdbbugluejcs.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_omJ-5Mem-K4vgm6WLXRzJQ_jeGs65ca';
const USERNAME_API = `${SUPABASE_URL}/functions/v1/sautilink-waitlist`;
const APP_HOME_URL = 'https://sautilink.com/home';
const INITIAL_AUTH_RETURN = parseAuthReturnUrl(window.location.href);

function authRedirectUrl(action) {
  const url = new URL(APP_HOME_URL);
  url.searchParams.set('auth_action', action);
  return url.href;
}

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'sautilink.auth.session',
  },
});

const byId = (id) => document.getElementById(id);
const loadingView = byId('loading-view');
const authView = byId('auth-view');
const memberView = byId('member-view');
const streamSurface = byId('stream-surface');
const profileSurface = byId('profile-surface');
const settingsSurface = byId('settings-surface');
const notificationsSurface = byId('notifications-surface');
const circlesSurface = byId('circles-surface');
const messagesSurface = byId('messages-surface');
const discoverSurface = byId('discover-surface');
const savedSurface = byId('saved-surface');
const appealsSurface = byId('appeals-surface');
const moderationSurface = byId('moderation-surface');
const conversationSurface = byId('conversation-surface');
const viewTitle = byId('view-title');
const authTabs = byId('auth-tabs');
const railAccount = byId('rail-account');
const mobileSignoutButton = byId('mobile-signout-button');
const toast = byId('toast');

const panels = {
  login: byId('login-panel'),
  signup: byId('signup-panel'),
  verify: byId('verify-panel'),
  passwordless: byId('passwordless-panel'),
  recovery: byId('recovery-panel'),
  password: byId('password-panel'),
  onboarding: byId('onboarding-panel'),
};

const PENDING_SIGNUP_STORAGE_KEY = 'sautilink.auth.pending_signup';

function restorePendingSignup() {
  try {
    const value = JSON.parse(sessionStorage.getItem(PENDING_SIGNUP_STORAGE_KEY) || 'null');
    if (!value?.email) return null;
    return {
      email: normalizeEmail(value.email),
      username: normalizeUsername(value.username),
      displayName: String(value.displayName || '').trim().slice(0, 80),
    };
  } catch {
    return null;
  }
}

let pendingSignup = restorePendingSignup();

function setPendingSignup(value) {
  pendingSignup = value;
  try {
    if (value) sessionStorage.setItem(PENDING_SIGNUP_STORAGE_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(PENDING_SIGNUP_STORAGE_KEY);
  } catch {
    // Session persistence is best effort; the in-memory verification flow still works.
  }
}
let usernameTimer = 0;
let usernameRequest = 0;
let availableUsername = '';
let recoverySession = false;
let toastTimer = 0;
let currentMember = null;
let currentMemberId = '';
let currentAccountEmail = '';
let pendingPasswordlessEmail = sessionStorage.getItem('sautilink.auth.passwordless_email') || '';
let reauthCodeRequested = false;
let authResultKey = '';
let resolvingAuthTokenHash = false;
let profileRouteRequest = 0;
let profileMediaReady = false;
let profileMediaRenderRequest = 0;
let renderedProfileOwner = false;
let renderedProfileUsername = '';
let renderedProfileId = '';
let reportTarget = null;
let currentDeletionRequest = null;
let currentSettingsPreferences = null;
let currentExportRequest = null;
let settingsRequest = 0;
let currentModerationRole = '';
let moderationReports = [];
let moderationAppeals = [];
let moderationActions = [];
let selectedModerationReportId = '';
let appealsRequest = 0;
let moderationRequestId = 0;
const profileMediaPresence = { avatar: false, header: false };
const profileMediaObjectUrls = { avatar: '', header: '' };
const STREAM_PAGE_SIZE = 20;
const COMPOSER_DRAFT_LIMIT = 5;
const COMPOSER_DRAFTS_PREFIX = 'sautilink.composer.drafts.v1:';
const COMPOSER_CURRENT_PREFIX = 'sautilink.composer.current.v1:';
let composerDrafts = [];
let activeComposerQuote = null;
let composerMedia = [];
let restoringComposerState = false;
let streamCursor = null;
let streamHasMore = false;
let streamLoading = false;
let streamRequest = 0;
let notificationsRequest = 0;
let notificationUnreadCount = 0;
let messagesRequest = 0;
let messageUnreadCount = 0;
let activeConversation = null;
let dmInboxRealtimeChannel = null;
let dmConversationRealtimeChannel = null;
let dmConversationRealtimeId = '';
let dmTypingStopTimer = 0;
let dmTypingSent = false;
let dmRealtimeSyncTimer = 0;
let discoverRequest = 0;
let savedRequest = 0;
let sautiConversationRequest = 0;
let activeSautiConversation = null;
let threadReplyRequestId = '';
const THREAD_DRAFT_PREFIX = 'sautilink.thread.draft.v1:';
const THREAD_POST_SELECT = 'id, author_id, circle_id, visibility, reply_access, quote_post_id, parent_post_id, root_post_id, thread_depth, audience_owner_id, body, created_at, like_count, comment_count, repost_count, author:social_profiles!social_posts_author_id_fkey(username, display_name, is_discoverable, is_verified, verification_badge_type)';
const THREAD_RENDER_DEPTH = 4;
let circlesRequest = 0;
let activeCircle = null;
let circleStreamRequest = 0;
let circleStreamLoading = false;

function motionBehavior() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = window.setTimeout(() => { toast.hidden = true; }, 3600);
}

function setMessage(node, message, type = 'error') {
  node.textContent = message || '';
  node.className = `form-message${type === 'success' ? ' success' : ''}`;
  node.hidden = !message;
}

const VERIFICATION_BADGE_ASSETS = Object.freeze({
  team: '/app/assets/verification/verified-team.png',
  standardPrimary: '/app/assets/verification/verified-user-primary.png',
  standardSecondary: '/app/assets/verification/verified-user-secondary.png',
});

function normalizeVerificationBadgeType(value) {
  return String(value || '').toLowerCase() === 'team' ? 'team' : 'standard';
}

function verificationBadgeAsset(badgeType = 'standard') {
  if (normalizeVerificationBadgeType(badgeType) === 'team') return VERIFICATION_BADGE_ASSETS.team;
  return document.documentElement.dataset.theme === 'light'
    ? VERIFICATION_BADGE_ASSETS.standardSecondary
    : VERIFICATION_BADGE_ASSETS.standardPrimary;
}

function applyVerificationBadgeAsset(badge, badgeType = 'standard') {
  if (!badge) return;
  const normalizedType = normalizeVerificationBadgeType(badgeType);
  badge.dataset.verificationBadgeType = normalizedType;
  const image = badge.matches?.('[data-verification-badge-image]')
    ? badge
    : badge.querySelector?.('[data-verification-badge-image]');
  if (image) image.src = verificationBadgeAsset(normalizedType);
}

function syncVerificationBadgeAssets() {
  document.querySelectorAll('.verification-badge[data-verification-badge-type]')
    .forEach((badge) => applyVerificationBadgeAsset(badge, badge.dataset.verificationBadgeType));
}

function createVerificationBadge(label = 'Verified account', badgeType = 'standard') {
  const badge = document.createElement('span');
  badge.className = 'verification-badge';
  badge.setAttribute('role', 'img');
  badge.setAttribute('aria-label', label);
  badge.title = label;

  const image = document.createElement('img');
  image.alt = '';
  image.width = 64;
  image.height = 64;
  image.decoding = 'async';
  image.dataset.verificationBadgeImage = '';
  badge.append(image);
  applyVerificationBadgeAsset(badge, badgeType);
  return badge;
}

function verifiedNameNode(displayName, isVerified, badgeType = 'standard') {
  const wrap = document.createElement('span');
  wrap.className = 'verified-name';

  const name = document.createElement('strong');
  name.textContent = displayName;
  wrap.append(name);

  if (isVerified) {
    const normalizedType = normalizeVerificationBadgeType(badgeType);
    const label = normalizedType === 'team' ? 'Verified SautiLink Team account' : 'Verified account';
    wrap.append(createVerificationBadge(label, normalizedType));
  }
  return wrap;
}

function configureProfileVerificationBadge(profile, { owner = false } = {}) {
  const badge = byId('profile-verified-badge');
  const displayName = String(profile?.display_name || profile?.full_name || profile?.username || 'SautiLink member');
  const isVerified = Boolean(profile?.is_verified);
  badge.hidden = !isVerified;
  if (!isVerified) return;

  const badgeType = normalizeVerificationBadgeType(profile?.verification_badge_type);
  badge.dataset.profileName = displayName;
  badge.dataset.profileOwner = owner ? 'true' : 'false';
  applyVerificationBadgeAsset(badge, badgeType);
  badge.title = badgeType === 'team' ? 'Verified SautiLink Team profile' : 'Verified profile';
  badge.setAttribute('aria-label', `About ${displayName}'s verified profile`);
}

function openVerificationInfoDialog() {
  const source = byId('profile-verified-badge');
  if (!source || source.hidden) return;

  const dialog = byId('verification-info-dialog');
  const displayName = String(source.dataset.profileName || 'this account');
  const badgeType = normalizeVerificationBadgeType(source.dataset.verificationBadgeType);
  const owner = source.dataset.profileOwner === 'true';
  const team = badgeType === 'team';

  byId('verification-info-badge-image').src = verificationBadgeAsset(badgeType);
  byId('verification-info-label').textContent = team ? 'SautiLink Team' : 'Verification';
  byId('verification-info-title').textContent = team ? 'Official team profile' : 'Verified profile';
  byId('verification-team-wordmark').hidden = !team;

  if (owner) {
    byId('verification-info-message').textContent = team
      ? 'This profile is verified as a SautiLink Team profile. Verification may be removed at any time if you no longer meet SautiLink Team requirements or violate SautiLink rules or policies.'
      : 'This profile is verified. Verification may be removed at any time if you violate SautiLink rules or policies.';
  } else {
    byId('verification-info-message').textContent = team
      ? `This profile was verified as belonging to ${displayName}, a member of the SautiLink Team.`
      : `This profile was verified as belonging to ${displayName}.`;
  }

  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function closeVerificationInfoDialog() {
  const dialog = byId('verification-info-dialog');
  if (typeof dialog?.close === 'function' && dialog.open) dialog.close();
  else dialog?.removeAttribute('open');
}

new MutationObserver(syncVerificationBadgeAssets).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['data-theme'],
});

function setBusy(button, busy, label) {
  if (!button) return;
  const text = button.querySelector('span');
  if (!button.dataset.defaultLabel) button.dataset.defaultLabel = text?.textContent || button.textContent.trim();
  if (text) text.textContent = busy ? label : button.dataset.defaultLabel;
  button.disabled = busy;
  button.setAttribute('aria-busy', String(busy));
}

function showAuthResult(action, { error = '' } = {}) {
  const surface = byId('auth-result');
  const label = byId('auth-result-label');
  const title = byId('auth-result-title');
  const message = byId('auth-result-message');
  const key = error ? `error:${error}` : `success:${action}`;

  if (key === authResultKey && !surface.hidden) return;
  authResultKey = key;

  surface.classList.toggle('error', Boolean(error));
  if (error) {
    label.textContent = 'Account security';
    title.textContent = 'Verification could not be completed';
    message.textContent = error;
  } else {
    const copy = AUTH_RESULT_COPY[action];
    if (!copy) return;
    label.textContent = copy.label;
    title.textContent = copy.title;
    message.textContent = copy.message;
  }
  surface.hidden = false;
}

function showEmailChangeResult(user) {
  if (!user) {
    showAuthResult('email_change');
    return;
  }
  const pending = normalizeEmail(user.new_email || '');
  showAuthResult(pending ? 'email_change' : 'email_change_complete');
}

function cleanAuthReturnLocation() {
  const url = cleanedAuthReturnUrl(window.location.href);
  if (/^\/app\/auth\/confirm\/?$/.test(url.pathname)) url.pathname = '/home';
  const next = `${url.pathname}${url.search}${url.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next !== current) window.history.replaceState({}, document.title, next);
}

function syncAccountSecurityEmail() {
  const node = byId('account-email-current');
  node.textContent = currentAccountEmail || 'Account email unavailable';
  node.title = currentAccountEmail || '';
}

function emailOtpError(error) {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  if (
    code.includes('otp') ||
    message.includes('token has expired') ||
    message.includes('token is invalid') ||
    message.includes('invalid token') ||
    message.includes('otp')
  ) {
    return 'That verification code is incorrect or has expired. Check the latest email and try again.';
  }
  return friendlyAuthError(error);
}

function configureEmailOtpInputs() {
  document.querySelectorAll('[data-email-otp]').forEach((input) => {
    input.minLength = EMAIL_OTP_MIN_LENGTH;
    input.maxLength = EMAIL_OTP_MAX_LENGTH;
    input.setAttribute('pattern', `[0-9]{${EMAIL_OTP_MIN_LENGTH},${EMAIL_OTP_MAX_LENGTH}}`);
    input.addEventListener('input', () => {
      input.value = normalizeEmailOtp(input.value);
    });
  });
  byId('verify-code-hint').textContent = `Enter the ${EMAIL_OTP_LENGTH}-digit code from your SautiLink email.`;
  byId('passwordless-code-hint').textContent = `Enter the ${EMAIL_OTP_LENGTH}-digit code from your SautiLink email.`;
  byId('reauth-code-hint').textContent = `Enter the ${EMAIL_OTP_LENGTH}-digit code sent to your account email.`;
}

async function resolveTokenHashReturn() {
  if (!INITIAL_AUTH_RETURN.tokenHash) return false;
  if (!TOKEN_HASH_EMAIL_TYPES.has(INITIAL_AUTH_RETURN.type)) {
    showAuthResult('', { error: 'This SautiLink verification link is not valid for a supported account action.' });
    cleanAuthReturnLocation();
    showSignedOut('login');
    return true;
  }

  resolvingAuthTokenHash = true;
  try {
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: INITIAL_AUTH_RETURN.tokenHash,
      type: INITIAL_AUTH_RETURN.type,
    });
    if (error) {
      showAuthResult('', { error: 'This verification link is invalid or has expired. Request a fresh SautiLink email and try again.' });
      cleanAuthReturnLocation();
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) await loadMember(session.user);
      else showSignedOut('login');
      return true;
    }

    const action = INITIAL_AUTH_RETURN.action || actionFromRedirect('', INITIAL_AUTH_RETURN.type);
    if (action === 'recovery') {
      recoverySession = true;
      showAuthResult('recovery');
      cleanAuthReturnLocation();
      showAuthPanel('password');
      return true;
    }

    if (action === 'email_change') showEmailChangeResult(data.user);
    else if (action) showAuthResult(action);
    cleanAuthReturnLocation();
    if (data.user) await loadMember(data.user);
    else await applyLocationRoute();
    return true;
  } finally {
    resolvingAuthTokenHash = false;
  }
}

function showAuthPanel(name) {
  document.body.classList.add('auth-entry');
  document.body.dataset.authMode = name;
  loadingView.hidden = true;
  memberView.hidden = true;
  authView.hidden = false;
  authTabs.hidden = !['login', 'signup'].includes(name);

  Object.entries(panels).forEach(([panelName, panel]) => {
    panel.hidden = panelName !== name;
  });

  document.querySelectorAll('[data-auth-mode]').forEach((button) => {
    if (button.getAttribute('role') !== 'tab') return;
    button.setAttribute('aria-selected', String(button.dataset.authMode === name));
  });
}

function showSignedOut(mode = 'login') {
  void stopDmRealtime();
  currentMember = null;
  currentMemberId = '';
  currentAccountEmail = '';
  currentDeletionRequest = null;
  currentSettingsPreferences = null;
  currentExportRequest = null;
  settingsRequest += 1;
  currentModerationRole = '';
  byId('moderation-nav-button').hidden = true;
  syncDeletionRequestUI(null);
  syncAccountSecurityEmail();
  railAccount.hidden = true;
  mobileSignoutButton.hidden = true;
  document.querySelector('.share-sauti-button').disabled = true;
  byId('sauti-body').disabled = true;
  byId('sauti-body').value = '';
  activeComposerQuote = null;
  composerMedia.forEach((item) => { if (item.localUrl) URL.revokeObjectURL(item.localUrl); });
  composerMedia = [];
  composerDrafts = [];
  renderComposerQuote();
  renderComposerMedia();
  byId('composer-drafts').hidden = true;
  byId('sauti-drafts-toggle').setAttribute('aria-expanded', 'false');
  renderComposerDrafts();
  updateComposerState({ persist: false });
  resetStreamState();
  notificationsRequest += 1;
  syncNotificationBadges(0);
  byId('notifications-list').replaceChildren();
  messagesRequest += 1;
  activeConversation = null;
  syncMessageBadges(0);
  byId('messages-inbox-list').replaceChildren();
  byId('message-thread-feed').replaceChildren();
  byId('message-thread').hidden = true;
  byId('messages-inbox').hidden = false;
  circlesRequest += 1;
  activeCircle = null;
  resetCircleStreamView({ hide: true });
  byId('circles-list').replaceChildren();
  byId('circle-detail').hidden = true;
  byId('circle-members').hidden = true;
  byId('circle-route-state').hidden = true;
  showAuthPanel(mode);
}

function avatarLetter(value) {
  return String(value || 'S').trim().charAt(0).toUpperCase() || 'S';
}

function formatSautiTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = Date.now();
  const age = Math.max(0, now - date.getTime());
  const minutes = Math.floor(age / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

async function currentAuthorizationHeader() {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session?.access_token) return {};
  return { Authorization: `Bearer ${session.access_token}` };
}


function composerMediaStatusLabel(item) {
  if (item.status === 'ready') return 'Ready';
  if (item.status === 'uploading') return `Uploading ${Math.round(item.progress || 0)}%`;
  if (item.status === 'finalizing') return 'Finalizing…';
  if (item.status === 'waiting') return 'Waiting for connection';
  if (item.status === 'error') return item.error || 'Upload blocked';
  return 'Preparing…';
}

async function fetchSautiMediaBlobUrl(id) {
  const headers = await currentAuthorizationHeader();
  const response = await fetch(`/api/sauti-media/${encodeURIComponent(id)}`, { headers });
  if (!response.ok) throw new Error('MEDIA_PREVIEW_FAILED');
  return URL.createObjectURL(await response.blob());
}

const COMPOSER_MEDIA_CACHE = 'sautilink-composer-media-v1';

function composerMediaCacheRequest(localId) {
  const member = encodeURIComponent(currentMemberId || 'signed-out');
  const item = encodeURIComponent(String(localId || 'media'));
  return new Request(`${window.location.origin}/__sautilink-local-media/${member}/${item}`);
}

async function cacheComposerMediaFile(item) {
  if (!item?.file || !item.localId || !('caches' in window)) return false;
  try {
    const cache = await window.caches.open(COMPOSER_MEDIA_CACHE);
    await cache.put(composerMediaCacheRequest(item.localId), new Response(item.file, {
      headers: { 'Content-Type': item.contentType || item.file.type || 'application/octet-stream' },
    }));
    item.cacheReady = true;
    persistComposerCurrent();
    return true;
  } catch {
    item.cacheReady = false;
    return false;
  }
}

async function readCachedComposerMediaFile(localId) {
  if (!localId || !('caches' in window)) return null;
  try {
    const cache = await window.caches.open(COMPOSER_MEDIA_CACHE);
    const response = await cache.match(composerMediaCacheRequest(localId));
    return response ? response.blob() : null;
  } catch {
    return null;
  }
}

async function removeCachedComposerMediaFile(localId) {
  if (!localId || !('caches' in window)) return;
  try {
    const cache = await window.caches.open(COMPOSER_MEDIA_CACHE);
    await cache.delete(composerMediaCacheRequest(localId));
  } catch {
    // Browser-managed draft storage is best effort.
  }
}

function serializeComposerMedia() {
  return composerMedia
    .slice(0, 4)
    .map((item) => ({
      localId: item.localId,
      id: item.id || '',
      name: item.name || 'Media',
      mediaKind: item.mediaKind,
      contentType: item.contentType,
      size: item.size,
      width: item.width || null,
      height: item.height || null,
      durationMs: item.durationMs ?? null,
      altText: String(item.altText || '').slice(0, 1000),
      status: item.status === 'ready' && item.id ? 'ready' : 'waiting',
      cacheReady: Boolean(item.cacheReady),
    }));
}

async function hydrateCachedComposerMedia(item) {
  if (!item || item.status === 'ready' || item.file) return;
  const blob = await readCachedComposerMediaFile(item.localId);
  if (!blob) {
    item.status = 'error';
    item.error = 'Offline draft media expired. Add this file again.';
    item.cacheReady = false;
    renderComposerMedia();
    updateComposerState();
    return;
  }

  item.file = blob;
  item.contentType = item.contentType || blob.type;
  item.size = item.size || blob.size;
  item.cacheReady = true;
  if (item.localUrl) URL.revokeObjectURL(item.localUrl);
  item.localUrl = URL.createObjectURL(blob);
  item.status = 'waiting';
  item.error = '';
  renderComposerMedia();
  updateComposerState();
  if (navigator.onLine) void uploadComposerMedia(item.localId);
}

function restoreComposerMedia(items) {
  composerMedia.forEach((item) => {
    if (item.localUrl) URL.revokeObjectURL(item.localUrl);
  });
  composerMedia = Array.isArray(items)
    ? items.slice(0, 4).filter((item) => item?.id || item?.localId).map((item) => {
        const ready = item.status === 'ready' && Boolean(item.id);
        return {
          localId: String(item.localId || crypto.randomUUID()),
          id: String(item.id || ''),
          name: String(item.name || 'Media'),
          mediaKind: item.mediaKind === 'video' ? 'video' : 'image',
          contentType: String(item.contentType || ''),
          size: Number(item.size || 0),
          width: Number(item.width || 0) || null,
          height: Number(item.height || 0) || null,
          durationMs: item.durationMs == null ? null : Number(item.durationMs),
          altText: String(item.altText || '').slice(0, 1000),
          status: ready ? 'ready' : 'waiting',
          progress: ready ? 100 : 0,
          localUrl: '',
          file: null,
          cacheReady: Boolean(item.cacheReady),
          restored: true,
          error: '',
        };
      })
    : [];
  renderComposerMedia();
  composerMedia
    .filter((item) => item.status !== 'ready')
    .forEach((item) => void hydrateCachedComposerMedia(item));
}

async function ensureComposerMediaPreview(item, host) {
  if (!item || !host || item.localUrl || !item.id) return;
  try {
    const url = await fetchSautiMediaBlobUrl(item.id);
    if (!composerMedia.some((current) => current.localId === item.localId)) {
      URL.revokeObjectURL(url);
      return;
    }
    item.localUrl = url;
    const visual = item.mediaKind === 'video' ? document.createElement('video') : document.createElement('img');
    visual.src = url;
    if (visual instanceof HTMLVideoElement) {
      visual.muted = true;
      visual.playsInline = true;
      visual.preload = 'metadata';
    } else {
      visual.alt = item.altText || '';
    }
    host.replaceChildren(visual);
  } catch {
    host.textContent = 'Preview unavailable';
  }
}

function renderComposerMedia() {
  const panel = byId('sauti-media-queue');
  const list = byId('sauti-media-list');
  const count = byId('sauti-media-count');
  if (!panel || !list || !count) return;

  panel.hidden = composerMedia.length === 0;
  count.textContent = `${composerMedia.length} / 4`;
  list.replaceChildren();

  composerMedia.forEach((item) => {
    const row = document.createElement('article');
    row.className = `composer-media-item ${item.status}`;
    row.dataset.mediaLocalId = item.localId;

    const preview = document.createElement('div');
    preview.className = 'composer-media-preview';
    if (item.localUrl) {
      const visual = item.mediaKind === 'video' ? document.createElement('video') : document.createElement('img');
      visual.src = item.localUrl;
      if (visual instanceof HTMLVideoElement) {
        visual.muted = true;
        visual.playsInline = true;
        visual.preload = 'metadata';
      } else {
        visual.alt = item.altText || '';
      }
      preview.append(visual);
    } else if (item.status === 'ready' && item.id) {
      preview.textContent = 'Loading…';
      void ensureComposerMediaPreview(item, preview);
    } else {
      preview.textContent = item.mediaKind === 'video' ? 'Video' : 'Image';
    }

    const copy = document.createElement('div');
    copy.className = 'composer-media-copy';
    const name = document.createElement('strong');
    name.textContent = item.name || 'Media';
    const status = document.createElement('span');
    status.textContent = composerMediaStatusLabel(item);

    const alt = document.createElement('input');
    alt.type = 'text';
    alt.maxLength = 1000;
    alt.value = item.altText || '';
    alt.placeholder = 'Describe this media (alt text)';
    alt.setAttribute('aria-label', `Alternative text for ${item.name || 'media'}`);
    alt.dataset.mediaAlt = item.localId;
    copy.append(name, status, alt);

    if (item.status === 'uploading') {
      const progress = document.createElement('progress');
      progress.max = 100;
      progress.value = Math.max(0, Math.min(100, item.progress || 0));
      progress.setAttribute('aria-label', `Upload progress for ${item.name || 'media'}`);
      copy.append(progress);
    }

    const actions = document.createElement('div');
    actions.className = 'composer-media-actions';
    if (item.status === 'error' || (item.status === 'waiting' && navigator.onLine)) {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'text-action';
      retry.dataset.mediaRetry = item.localId;
      retry.textContent = 'Retry';
      actions.append(retry);
    }
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'text-action';
    remove.dataset.mediaRemove = item.localId;
    remove.textContent = 'Remove';
    actions.append(remove);

    row.append(preview, copy, actions);
    list.append(row);
  });

  const add = byId('sauti-media-add');
  if (add) add.disabled = !currentMember || composerMedia.length >= 4;
}

function uploadWithProgress(url, file, token, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Authorization', token);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.responseType = 'json';
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress((event.loaded / event.total) * 100);
    });
    xhr.addEventListener('load', () => {
      const payload = xhr.response || (() => {
        try { return JSON.parse(xhr.responseText || 'null'); } catch { return null; }
      })();
      if (xhr.status >= 200 && xhr.status < 300 && payload?.ok !== false) resolve(payload);
      else reject(new Error(payload?.error?.message || 'Media upload failed.'));
    });
    xhr.addEventListener('error', () => reject(new Error('Network error while uploading media.')));
    xhr.addEventListener('abort', () => reject(new Error('Media upload was cancelled.')));
    xhr.send(file);
  });
}

async function removeRemoteComposerMedia(id) {
  if (!id) return;
  try {
    const headers = await currentAuthorizationHeader();
    if (!headers.Authorization) return;
    await fetch(`/api/sauti-media/${encodeURIComponent(id)}`, { method: 'DELETE', headers });
  } catch {
    // Stale unattached objects are also bounded by the server cleanup contract.
  }
}

async function removeComposerMedia(localId, { remote = true } = {}) {
  const item = composerMedia.find((entry) => entry.localId === localId);
  if (!item) return;
  composerMedia = composerMedia.filter((entry) => entry.localId !== localId);
  if (item.localUrl) URL.revokeObjectURL(item.localUrl);
  await removeCachedComposerMediaFile(item.localId);
  renderComposerMedia();
  updateComposerState();
  if (remote && item.id) await removeRemoteComposerMedia(item.id);
}

async function uploadComposerMedia(localId) {
  const item = composerMedia.find((entry) => entry.localId === localId);
  if (!item || !item.file) return;
  if (!navigator.onLine) {
    item.status = 'waiting';
    renderComposerMedia();
    updateComposerState();
    return;
  }

  item.status = 'preparing';
  item.error = '';
  item.progress = 0;
  renderComposerMedia();
  updateComposerState();

  try {
    const headers = await currentAuthorizationHeader();
    if (!headers.Authorization) throw new Error('Sign in again before uploading media.');

    if (item.id) await removeRemoteComposerMedia(item.id);
    item.id = '';

    const begin = await fetch('/api/sauti-media/begin', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content_type: item.contentType, size_bytes: item.size }),
    });
    const beginPayload = await begin.json().catch(() => null);
    if (!begin.ok || beginPayload?.ok === false) throw new Error(beginPayload?.error?.message || 'Media upload could not start.');

    item.id = beginPayload.data.id;
    item.status = 'uploading';
    renderComposerMedia();

    await uploadWithProgress(beginPayload.data.upload_url, item.file, headers.Authorization, (value) => {
      item.progress = value;
      const progress = document.querySelector(`[data-media-local-id="${item.localId}"] progress`);
      if (progress) progress.value = value;
      const status = document.querySelector(`[data-media-local-id="${item.localId}"] .composer-media-copy span`);
      if (status) status.textContent = composerMediaStatusLabel(item);
    });

    item.status = 'finalizing';
    item.progress = 100;
    renderComposerMedia();

    const finalize = await fetch(beginPayload.data.finalize_url, { method: 'POST', headers });
    const finalPayload = await finalize.json().catch(() => null);
    if (!finalize.ok || finalPayload?.ok === false) throw new Error(finalPayload?.error?.message || 'Media could not be finalized.');

    item.mediaKind = finalPayload.data.media_kind || item.mediaKind;
    item.width = finalPayload.data.width || null;
    item.height = finalPayload.data.height || null;
    item.durationMs = finalPayload.data.duration_ms ?? null;
    item.status = 'ready';
    item.progress = 100;
    item.file = null;
    item.cacheReady = false;
    await removeCachedComposerMediaFile(item.localId);
    renderComposerMedia();
    updateComposerState();
  } catch (error) {
    item.status = navigator.onLine ? 'error' : 'waiting';
    item.error = error?.message || 'Upload blocked';
    renderComposerMedia();
    updateComposerState();
  }
}

function addComposerFiles(files) {
  const selected = Array.from(files || []);
  if (!selected.length) return;
  const openSlots = Math.max(0, 4 - composerMedia.length);
  if (!openSlots) {
    showToast('A post can include up to four media items.');
    return;
  }

  selected.slice(0, openSlots).forEach((file) => {
    const type = String(file.type || '').toLowerCase();
    const image = ['image/jpeg', 'image/png', 'image/webp'].includes(type);
    const video = type === 'video/mp4';
    const limit = image ? 8 * 1024 * 1024 : 25 * 1024 * 1024;
    if ((!image && !video) || file.size < 1 || file.size > limit) {
      showToast(image ? 'Images must be 8 MB or smaller.' : video ? 'Videos must be 25 MB or smaller.' : 'Use JPEG, PNG, WebP or MP4 media.');
      return;
    }

    const item = {
      localId: crypto.randomUUID(),
      id: '',
      file,
      name: file.name || (video ? 'Video' : 'Image'),
      mediaKind: video ? 'video' : 'image',
      contentType: type,
      size: file.size,
      width: null,
      height: null,
      durationMs: null,
      altText: '',
      status: navigator.onLine ? 'preparing' : 'waiting',
      progress: 0,
      localUrl: URL.createObjectURL(file),
      error: '',
    };
    item.cacheReady = false;
    composerMedia.push(item);
    void (async () => {
      const cached = await cacheComposerMediaFile(item);
      if (!cached && !navigator.onLine) {
        item.status = 'error';
        item.error = 'This browser could not retain the file for offline upload.';
        renderComposerMedia();
        updateComposerState();
        return;
      }
      if (navigator.onLine) void uploadComposerMedia(item.localId);
      else {
        item.status = 'waiting';
        renderComposerMedia();
        updateComposerState();
      }
    })();
  });

  renderComposerMedia();
  updateComposerState();
  if (selected.length > openSlots) showToast('Only the first available media slots were added.');
}

function resumeWaitingComposerMedia() {
  composerMedia
    .filter((item) => item.status === 'waiting' && item.file)
    .forEach((item) => void uploadComposerMedia(item.localId));
}

async function loadSautiMediaRows(postId) {
  const { data, error } = await supabase
    .from('social_post_media')
    .select('id,media_kind,content_type,width,height,duration_ms,alt_text,position')
    .eq('post_id', postId)
    .eq('upload_status', 'attached')
    .order('position', { ascending: true });
  if (error) return [];
  return Array.isArray(data) ? data.slice(0, 4) : [];
}

async function hydrateSautiMediaGallery(postId, gallery) {
  const rows = await loadSautiMediaRows(postId);
  if (!rows.length || !gallery.isConnected) {
    gallery.remove();
    return;
  }
  gallery.className = `sauti-media-gallery media-count-${rows.length}`;
  gallery.replaceChildren();

  for (const media of rows) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sauti-media-tile';
    button.dataset.openMediaId = media.id;
    button.dataset.mediaKind = media.media_kind;
    button.dataset.mediaAlt = media.alt_text || '';
    button.setAttribute('aria-label', media.alt_text ? `Open media: ${media.alt_text}` : 'Open post media');

    try {
      const url = await fetchSautiMediaBlobUrl(media.id);
      button.dataset.mediaObjectUrl = url;
      const visual = media.media_kind === 'video' ? document.createElement('video') : document.createElement('img');
      visual.src = url;
      if (visual instanceof HTMLVideoElement) {
        visual.muted = true;
        visual.playsInline = true;
        visual.preload = 'metadata';
      } else {
        visual.alt = media.alt_text || '';
        visual.loading = 'lazy';
      }
      button.append(visual);
    } catch {
      const unavailable = document.createElement('span');
      unavailable.textContent = 'Media unavailable';
      button.append(unavailable);
      button.disabled = true;
    }
    gallery.append(button);
  }
}

function openSautiMediaViewer(button) {
  const dialog = byId('sauti-media-viewer');
  const content = byId('sauti-media-viewer-content');
  const url = button.dataset.mediaObjectUrl;
  if (!dialog || !content || !url) return;

  const visual = button.dataset.mediaKind === 'video' ? document.createElement('video') : document.createElement('img');
  visual.src = url;
  if (visual instanceof HTMLVideoElement) {
    visual.controls = true;
    visual.autoplay = false;
    visual.playsInline = true;
  } else {
    visual.alt = button.dataset.mediaAlt || '';
  }
  content.replaceChildren(visual);
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function closeSautiMediaViewer() {
  const dialog = byId('sauti-media-viewer');
  byId('sauti-media-viewer-content')?.replaceChildren();
  if (typeof dialog?.close === 'function' && dialog.open) dialog.close();
  else dialog?.removeAttribute('open');
}

async function socialMutation(path, { method = 'POST', body } = {}) {
  const headers = await currentAuthorizationHeader();
  if (!headers.Authorization) throw new Error('Sign in again before using social interactions.');
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error?.message || 'This social action could not be completed.');
  }
  return payload?.data || {};
}

async function safetyRequest(path, { method = 'GET', body } = {}) {
  const headers = await currentAuthorizationHeader();
  if (!headers.Authorization) throw new Error('Sign in again before using account safety controls.');
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error?.message || 'This account safety action could not be completed.');
  }
  return payload?.data || {};
}

async function moderationRequest(path, { method = 'GET', body } = {}) {
  const headers = await currentAuthorizationHeader();
  if (!headers.Authorization) throw new Error('Sign in again before using moderation controls.');
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error?.message || 'This moderation action could not be completed.');
  }
  return payload?.data || {};
}

async function settingsApiRequest(path, { method = 'GET', body } = {}) {
  const headers = await currentAuthorizationHeader();
  if (!headers.Authorization) {
    const error = new Error('Sign in again before using account controls.');
    error.code = 'AUTH_REQUIRED';
    throw error;
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok === false) {
    const error = new Error(payload?.error?.message || 'This account control could not be completed.');
    error.code = String(payload?.error?.code || '');
    error.status = response.status;
    throw error;
  }
  return payload?.data || {};
}

function settingsMessage(message, type = 'success') {
  setMessage(byId('settings-message'), message, type);
}

function settingsPanel(section) {
  const allowed = new Set(['account', 'privacy', 'notifications', 'safety', 'data']);
  const target = allowed.has(section) ? section : 'account';
  document.querySelectorAll('[data-settings-section]').forEach((button) => {
    const active = button.dataset.settingsSection === target;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  document.querySelectorAll('[data-settings-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.settingsPanel !== target;
  });
}

function messageBadgesEnabled() {
  return currentSettingsPreferences?.notify_messages !== false;
}

function activityStatusEnabled() {
  return currentSettingsPreferences?.activity_status === true;
}

function resetDmActivityUI() {
  const activity = byId('message-thread-activity');
  const typing = byId('message-typing-status');
  if (activity) {
    activity.hidden = true;
    activity.textContent = 'Online';
  }
  if (typing) {
    typing.hidden = true;
    typing.textContent = 'Typing…';
  }
}

async function stopDmConversationRealtime() {
  window.clearTimeout(dmTypingStopTimer);
  dmTypingStopTimer = 0;

  const channel = dmConversationRealtimeChannel;
  if (channel && dmTypingSent) {
    try {
      await channel.send({
        type: 'broadcast',
        event: 'typing',
        payload: { member_id: currentMemberId, typing: false },
      });
    } catch {
      // Transient typing state expires naturally when the channel closes.
    }
  }

  dmTypingSent = false;
  dmConversationRealtimeChannel = null;
  dmConversationRealtimeId = '';
  resetDmActivityUI();

  if (channel) {
    try {
      await supabase.removeChannel(channel);
    } catch {
      // Realtime cleanup is best effort; the client also tears channels down on disconnect.
    }
  }
}

async function stopDmRealtime() {
  window.clearTimeout(dmRealtimeSyncTimer);
  dmRealtimeSyncTimer = 0;
  await stopDmConversationRealtime();

  const inboxChannel = dmInboxRealtimeChannel;
  dmInboxRealtimeChannel = null;
  if (inboxChannel) {
    try {
      await supabase.removeChannel(inboxChannel);
    } catch {
      // Signed-out cleanup is best effort.
    }
  }
}

async function fetchActiveConversationMessages(conversationId) {
  const { data, error } = await supabase
    .from('dm_messages')
    .select('id, conversation_id, sender_id, body, sent_at, deleted_at')
    .eq('conversation_id', conversationId)
    .order('sent_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(200);
  if (error) throw error;
  return data || [];
}

async function syncActiveMessageThreadRealtime({ markRead = true } = {}) {
  const conversationId = activeConversation?.id;
  if (!conversationId || !currentMemberId) return;

  const feed = byId('message-thread-feed');
  const empty = byId('message-thread-empty');
  const nearBottom = (feed.scrollHeight - feed.scrollTop - feed.clientHeight) < 140;
  const messages = await fetchActiveConversationMessages(conversationId).catch(() => null);
  if (!messages || activeConversation?.id !== conversationId) return;

  feed.replaceChildren();
  messages.forEach((message) => feed.append(renderDirectMessage(message)));
  empty.hidden = messages.length > 0;

  const canMarkRead = markRead
    && document.visibilityState !== 'hidden'
    && !messagesSurface.hidden
    && !byId('message-thread').hidden;
  if (canMarkRead) await markActiveConversationRead();
  await renderPeerReadReceipt(conversationId, messages);

  if (nearBottom) {
    window.setTimeout(() => {
      if (activeConversation?.id === conversationId) feed.scrollTop = feed.scrollHeight;
    }, 0);
  }
}

function queueDmRealtimeSync(conversationId, event = 'message_changed') {
  if (!currentMemberId || !conversationId) return;
  window.clearTimeout(dmRealtimeSyncTimer);
  dmRealtimeSyncTimer = window.setTimeout(async () => {
    dmRealtimeSyncTimer = 0;
    void refreshMessageBadge();

    if (activeConversation?.id === conversationId && !byId('message-thread').hidden) {
      await syncActiveMessageThreadRealtime({ markRead: event === 'message_changed' });
      return;
    }

    if (!messagesSurface.hidden && byId('messages-inbox').hidden === false) {
      await loadMessagesInbox();
    }
  }, 90);
}

async function ensureDmInboxRealtime() {
  if (!currentMemberId || dmInboxRealtimeChannel) return;
  try {
    await supabase.realtime.setAuth();
    if (!currentMemberId || dmInboxRealtimeChannel) return;

    const memberId = currentMemberId;
    const channel = supabase
      .channel(`dm-user:${memberId}`, { config: { private: true } })
      .on('broadcast', { event: 'message_changed' }, ({ payload }) => {
        if (currentMemberId !== memberId) return;
        queueDmRealtimeSync(String(payload?.conversation_id || ''), 'message_changed');
      })
      .on('broadcast', { event: 'conversation_state_changed' }, ({ payload }) => {
        if (currentMemberId !== memberId) return;
        queueDmRealtimeSync(String(payload?.conversation_id || ''), 'conversation_state_changed');
      })
      .on('broadcast', { event: 'read_state_changed' }, ({ payload }) => {
        if (currentMemberId !== memberId) return;
        queueDmRealtimeSync(String(payload?.conversation_id || ''), 'read_state_changed');
      })
      .subscribe((status) => {
        if (currentMemberId !== memberId) return;
        if (status === 'SUBSCRIBED') {
          void refreshMessageBadge();
          if (activeConversation?.id) {
            void syncActiveMessageThreadRealtime({ markRead: false });
          }
        }
      });

    dmInboxRealtimeChannel = channel;
  } catch {
    // Initial reads remain canonical when Realtime is temporarily unavailable.
  }
}

function syncDmPresenceState(channel = dmConversationRealtimeChannel) {
  const activity = byId('message-thread-activity');
  if (!activity || !channel || !activityStatusEnabled() || !activeConversation?.peerId) {
    resetDmActivityUI();
    return;
  }

  const peerId = activeConversation.peerId;
  const state = channel.presenceState?.() || {};
  const peerOnline = Object.values(state)
    .flatMap((entries) => Array.isArray(entries) ? entries : [])
    .some((entry) => String(entry?.member_id || '') === peerId);

  activity.textContent = 'Online';
  activity.hidden = !peerOnline;
}

async function broadcastDmTyping(typing = true) {
  const channel = dmConversationRealtimeChannel;
  if (!channel || !activeConversation?.id || !activityStatusEnabled() || activeConversation.blockedByYou) return;

  const next = Boolean(typing);
  if (next === dmTypingSent) {
    if (next) {
      window.clearTimeout(dmTypingStopTimer);
      dmTypingStopTimer = window.setTimeout(() => void broadcastDmTyping(false), 1400);
    }
    return;
  }

  dmTypingSent = next;
  try {
    await channel.send({
      type: 'broadcast',
      event: 'typing',
      payload: {
        member_id: currentMemberId,
        typing: next,
      },
    });
  } catch {
    dmTypingSent = false;
  }

  window.clearTimeout(dmTypingStopTimer);
  dmTypingStopTimer = next
    ? window.setTimeout(() => void broadcastDmTyping(false), 1400)
    : 0;
}

async function startDmConversationRealtime(conversationId) {
  if (!conversationId || !currentMemberId || activeConversation?.id !== conversationId) return;

  if (!currentSettingsPreferences) {
    try {
      currentSettingsPreferences = await ensureSettingsPreferences();
    } catch {
      resetDmActivityUI();
      return;
    }
  }

  if (!activityStatusEnabled() || activeConversation?.blockedByYou) {
    await stopDmConversationRealtime();
    return;
  }

  if (dmConversationRealtimeChannel && dmConversationRealtimeId === conversationId) return;
  await stopDmConversationRealtime();
  if (!activeConversation || activeConversation.id !== conversationId || !activityStatusEnabled()) return;

  try {
    await supabase.realtime.setAuth();
    if (!activeConversation || activeConversation.id !== conversationId || !activityStatusEnabled()) return;

    const memberId = currentMemberId;
    const channel = supabase
      .channel(`dm:${conversationId}`, {
        config: {
          private: true,
          broadcast: { self: false },
          presence: { key: memberId },
        },
      })
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (activeConversation?.id !== conversationId || !activityStatusEnabled()) return;
        if (String(payload?.member_id || '') !== String(activeConversation.peerId || '')) return;
        const typing = byId('message-typing-status');
        if (!typing) return;
        typing.textContent = 'Typing…';
        typing.hidden = payload?.typing !== true;
      })
      .on('presence', { event: 'sync' }, () => syncDmPresenceState(channel))
      .on('presence', { event: 'join' }, () => syncDmPresenceState(channel))
      .on('presence', { event: 'leave' }, () => syncDmPresenceState(channel))
      .subscribe(async (status) => {
        if (activeConversation?.id !== conversationId || currentMemberId !== memberId) return;
        if (status === 'SUBSCRIBED') {
          try {
            await channel.track({
              member_id: memberId,
              online_at: new Date().toISOString(),
            });
          } catch {
            // Presence is optional and does not affect durable message delivery.
          }
          syncDmPresenceState(channel);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          resetDmActivityUI();
        }
      });

    dmConversationRealtimeChannel = channel;
    dmConversationRealtimeId = conversationId;
  } catch {
    resetDmActivityUI();
  }
}

function renderSettingsSafetyRows(kind, rows, profiles) {
  const list = byId(kind === 'block' ? 'settings-blocked-list' : 'settings-muted-list');
  const empty = byId(kind === 'block' ? 'settings-blocked-empty' : 'settings-muted-empty');
  list.replaceChildren();
  const profileMap = new Map((profiles || []).map((profile) => [profile.id, profile]));

  (rows || []).forEach((row) => {
    const targetId = kind === 'block' ? row.blocked_id : row.muted_id;
    const profile = profileMap.get(targetId);
    const display = profile?.display_name || profile?.username || 'Unavailable account';
    const username = profile?.username ? `@${profile.username}` : `ID ${String(targetId || '').slice(0, 8)}…`;

    const item = document.createElement('article');
    item.className = 'settings-account-row';

    const avatar = document.createElement('span');
    avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = avatarLetter(display);

    const copy = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = display;
    const small = document.createElement('small');
    small.textContent = username;
    copy.append(strong, small);

    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.settingsSafetyAction = kind === 'block' ? 'unblock' : 'unmute';
    button.dataset.targetId = targetId;
    button.textContent = kind === 'block' ? 'Unblock' : 'Unmute';

    item.append(avatar, copy, button);
    list.append(item);
  });

  empty.hidden = list.childElementCount > 0;
}

function renderSettingsExport(request) {
  currentExportRequest = request || null;
  const copy = byId('settings-export-copy');
  const requestButton = byId('settings-export-request');
  const cancelButton = byId('settings-export-cancel');
  const active = request && ['pending', 'processing', 'ready'].includes(request.status);

  requestButton.hidden = Boolean(active);
  cancelButton.hidden = !active;

  if (!request) {
    copy.textContent = 'Request a private export of your SautiLink information.';
  } else if (request.status === 'pending') {
    copy.textContent = `Export requested ${formatSautiTime(request.requested_at)} ago. It is waiting for private processing.`;
  } else if (request.status === 'processing') {
    copy.textContent = 'Your private export is being prepared.';
  } else if (request.status === 'ready') {
    copy.textContent = request.expires_at
      ? `Your export is ready until ${new Date(request.expires_at).toLocaleString()}.`
      : 'Your export is ready. Secure download delivery will appear when the export processor is enabled.';
  } else if (request.status === 'cancelled') {
    copy.textContent = 'Your previous export request was cancelled.';
  } else {
    copy.textContent = 'Your previous export is no longer active.';
  }
}

function renderSettingsDeletion(request) {
  currentDeletionRequest = request || null;
  const copy = byId('settings-deletion-copy');
  const start = byId('settings-deletion-start');
  const cancel = byId('settings-deletion-cancel');
  const pending = request?.status === 'pending';

  start.hidden = pending || request?.status === 'completed';
  cancel.hidden = !pending;

  if (pending) {
    const deadline = request.scheduled_for ? new Date(request.scheduled_for).toLocaleString() : 'the end of the recovery window';
    copy.textContent = `Deletion requested. Your profile is hidden now; you can cancel until ${deadline} before final privileged processing.`;
  } else if (request?.status === 'cancelled') {
    copy.textContent = 'Your previous deletion request was cancelled. Your prior discoverability preference was restored.';
  } else if (request?.status === 'completed') {
    copy.textContent = 'This account deletion has completed.';
  } else {
    copy.textContent = 'A deletion request hides your profile immediately and enters a 14-day recovery window before final privileged processing.';
  }
}

async function ensureSettingsPreferences() {
  let { data, error } = await supabase
    .from('social_member_preferences')
    .select('user_id,read_receipts,activity_status,notify_post_activity,notify_messages,notify_followers,notify_sautify,email_digest,updated_at')
    .eq('user_id', currentMemberId)
    .maybeSingle();

  if (!error && data) return data;
  if (error && String(error.code || '') !== 'PGRST116') throw error;

  const inserted = await supabase
    .from('social_member_preferences')
    .insert({ user_id: currentMemberId })
    .select('user_id,read_receipts,activity_status,notify_post_activity,notify_messages,notify_followers,notify_sautify,email_digest,updated_at')
    .single();
  if (inserted.error) throw inserted.error;
  return inserted.data;
}

async function loadSettings() {
  if (!currentMemberId) return;
  const requestId = ++settingsRequest;
  settingsMessage('', '');
  byId('settings-username').textContent = `@${currentMember?.username || 'username'}`;
  byId('settings-email').textContent = currentAccountEmail || 'Unavailable';
  byId('settings-email-verified').hidden = !currentAccountEmail;

  try {
    const [
      profileResult,
      preferences,
      blockResult,
      muteResult,
      exportResult,
      deletionResult,
      authResult,
    ] = await Promise.all([
      supabase
        .from('social_profiles')
        .select('id,username,is_discoverable,allow_external_indexing,dm_access')
        .eq('id', currentMemberId)
        .single(),
      ensureSettingsPreferences(),
      supabase.from('social_blocks').select('blocked_id,created_at').eq('blocker_id', currentMemberId).order('created_at', { ascending: false }),
      supabase.from('social_mutes').select('muted_id,created_at').eq('muter_id', currentMemberId).order('created_at', { ascending: false }),
      settingsApiRequest('/api/account/export'),
      settingsApiRequest('/api/safety/deletion-request'),
      supabase.auth.getUser(),
    ]);

    if (requestId !== settingsRequest) return;
    if (profileResult.error) throw profileResult.error;
    if (blockResult.error) throw blockResult.error;
    if (muteResult.error) throw muteResult.error;

    currentSettingsPreferences = preferences;

    byId('settings-discoverable').checked = Boolean(profileResult.data.is_discoverable);
    byId('settings-external-indexing').checked = Boolean(profileResult.data.allow_external_indexing);
    byId('settings-external-indexing').disabled = !profileResult.data.is_discoverable;
    byId('settings-read-receipts').checked = Boolean(preferences.read_receipts);
    byId('settings-activity-status').checked = Boolean(preferences.activity_status);
    byId('settings-dm-access').value = profileResult.data.dm_access || 'following';
    byId('settings-notify-post').checked = Boolean(preferences.notify_post_activity);
    byId('settings-notify-messages').checked = Boolean(preferences.notify_messages);
    byId('settings-notify-followers').checked = Boolean(preferences.notify_followers);
    byId('settings-notify-sautify').checked = Boolean(preferences.notify_sautify);
    byId('settings-email-digest').value = preferences.email_digest || 'off';

    const user = authResult?.data?.user || null;
    byId('settings-current-session').textContent = user?.last_sign_in_at
      ? `Current sign-in: ${new Date(user.last_sign_in_at).toLocaleString()}.`
      : 'Current session active.';

    const blockedRows = blockResult.data || [];
    const mutedRows = muteResult.data || [];
    const targetIds = [...new Set([
      ...blockedRows.map((row) => row.blocked_id),
      ...mutedRows.map((row) => row.muted_id),
    ].filter(Boolean))];

    let profiles = [];
    if (targetIds.length) {
      const profileLookup = await supabase
        .from('social_profiles')
        .select('id,username,display_name')
        .in('id', targetIds);
      if (!profileLookup.error) profiles = profileLookup.data || [];
    }

    if (requestId !== settingsRequest) return;
    renderSettingsSafetyRows('block', blockedRows, profiles);
    renderSettingsSafetyRows('mute', mutedRows, profiles);
    renderSettingsExport(exportResult.request || null);
    renderSettingsDeletion(deletionResult.request || null);
    syncMessageBadges(messageBadgesEnabled() ? messageUnreadCount : 0);
  } catch (error) {
    if (requestId !== settingsRequest) return;
    settingsMessage(error?.message || 'Settings could not be loaded.', 'error');
  }
}

async function saveProfileSetting(column, value) {
  const allowed = new Set(['is_discoverable', 'allow_external_indexing', 'dm_access']);
  if (!allowed.has(column) || !currentMemberId) return false;

  const { data, error } = await supabase
    .from('social_profiles')
    .update({ [column]: value })
    .eq('id', currentMemberId)
    .select('id,is_discoverable,allow_external_indexing,dm_access')
    .single();
  if (error) throw error;

  if (currentMember && column === 'is_discoverable') currentMember.is_discoverable = Boolean(value);
  return data;
}

async function savePreferenceSetting(column, value) {
  const allowed = new Set([
    'read_receipts',
    'activity_status',
    'notify_post_activity',
    'notify_messages',
    'notify_followers',
    'notify_sautify',
    'email_digest',
  ]);
  if (!allowed.has(column) || !currentMemberId) return null;

  const { data, error } = await supabase
    .from('social_member_preferences')
    .update({ [column]: value })
    .eq('user_id', currentMemberId)
    .select('user_id,read_receipts,activity_status,notify_post_activity,notify_messages,notify_followers,notify_sautify,email_digest,updated_at')
    .single();
  if (error) throw error;
  currentSettingsPreferences = data;
  return data;
}

async function removeSettingsSafetyTarget(action, targetId, button) {
  if (!targetId || !currentMemberId) return;
  button.disabled = true;
  try {
    const table = action === 'unblock' ? 'social_blocks' : 'social_mutes';
    const ownerColumn = action === 'unblock' ? 'blocker_id' : 'muter_id';
    const targetColumn = action === 'unblock' ? 'blocked_id' : 'muted_id';
    const { error } = await supabase
      .from(table)
      .delete()
      .eq(ownerColumn, currentMemberId)
      .eq(targetColumn, targetId);
    if (error) throw error;
    showToast(action === 'unblock' ? 'Account unblocked.' : 'Account unmuted.');
    await loadSettings();
  } catch {
    button.disabled = false;
    showToast(action === 'unblock' ? 'This account could not be unblocked.' : 'This account could not be unmuted.');
  }
}

function closeSettingsDeleteDialog() {
  const dialog = byId('settings-delete-dialog');
  byId('settings-delete-form').reset();
  byId('settings-delete-confirm').disabled = true;
  setMessage(byId('settings-delete-message'), '', '');
  if (typeof dialog.close === 'function' && dialog.open) dialog.close();
  else dialog.removeAttribute('open');
}

function openSettingsDeleteDialog() {
  const dialog = byId('settings-delete-dialog');
  byId('settings-delete-confirmation').value = '';
  byId('settings-delete-confirm').disabled = true;
  setMessage(byId('settings-delete-message'), '', '');
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  byId('settings-delete-confirmation').focus();
}

function moderationRoleLabel(role = currentModerationRole) {
  if (role === 'senior_reviewer') return 'Senior reviewer';
  if (role === 'reviewer') return 'Reviewer';
  if (role === 'auditor') return 'Auditor';
  return 'No staff access';
}

async function syncModerationAccess() {
  const nav = byId('moderation-nav-button');
  currentModerationRole = '';
  nav.hidden = true;
  if (!currentMemberId) return '';

  try {
    const data = await moderationRequest('/api/moderation/session');
    currentModerationRole = data.role || '';
    nav.hidden = !currentModerationRole;
    byId('moderation-role').textContent = moderationRoleLabel();
    return currentModerationRole;
  } catch {
    byId('moderation-role').textContent = 'Access unavailable';
    return '';
  }
}

function moderationActionLabel(action) {
  const labels = {
    visibility_limited: 'Visibility limited',
    content_removed: 'Content removed',
    dismissed: 'Report dismissed',
    escalated: 'Escalated',
    appeal_upheld: 'Appeal upheld',
    appeal_reversed: 'Decision reversed',
  };
  return labels[action] || String(action || 'Moderation decision').replaceAll('_', ' ');
}

function appealStatusLabel(status) {
  const labels = {
    open: 'Awaiting review',
    reviewing: 'Under review',
    upheld: 'Upheld',
    reversed: 'Reversed',
  };
  return labels[status] || status || 'Unknown';
}

function openAppealDialog(action) {
  const dialog = byId('appeal-dialog');
  byId('appeal-action-id').value = String(action.id);
  byId('appeal-dialog-context').textContent =
    `${moderationActionLabel(action.action_type)} · ${action.target_type} · policy ${action.policy_version || 'safety-v1'}`;
  byId('appeal-reason').value = '';
  setMessage(byId('appeal-message'), '', '');
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  byId('appeal-reason').focus();
}

function closeAppealDialog() {
  const dialog = byId('appeal-dialog');
  byId('appeal-form').reset();
  setMessage(byId('appeal-message'), '', '');
  if (typeof dialog.close === 'function' && dialog.open) dialog.close();
  else dialog.removeAttribute('open');
}

function renderMemberAppeals(actions, appeals) {
  const list = byId('appeals-list');
  const empty = byId('appeals-empty');
  list.replaceChildren();
  const appealMap = new Map((appeals || []).map((appeal) => [String(appeal.action_id), appeal]));

  (actions || []).forEach((action) => {
    const appeal = appealMap.get(String(action.id));
    const card = document.createElement('article');
    card.className = 'appeal-card-live';

    const head = document.createElement('div');
    head.className = 'appeal-card-live-head';
    const title = document.createElement('div');
    const label = document.createElement('strong');
    label.textContent = moderationActionLabel(action.action_type);
    const meta = document.createElement('small');
    meta.textContent = `${action.target_type} · ${formatSautiTime(action.created_at)}`;
    title.append(label, meta);
    const state = document.createElement('span');
    state.className = `appeal-state ${appeal?.appeal_status || 'available'}`;
    state.textContent = appeal ? appealStatusLabel(appeal.appeal_status) : 'Appealable';
    head.append(title, state);

    const reason = document.createElement('p');
    reason.textContent = action.reason || 'SautiLink moderation decision.';

    const policy = document.createElement('small');
    policy.className = 'appeal-policy';
    policy.textContent = `Policy: ${action.policy_version || 'safety-v1'}`;

    card.append(head, reason, policy);

    if (appeal) {
      const appealCopy = document.createElement('div');
      appealCopy.className = 'appeal-existing';
      const ownReason = document.createElement('p');
      ownReason.textContent = `Your appeal: ${appeal.reason}`;
      appealCopy.append(ownReason);
      if (appeal.decision_reason) {
        const decision = document.createElement('p');
        decision.textContent = `Review decision: ${appeal.decision_reason}`;
        appealCopy.append(decision);
      }
      card.append(appealCopy);
    } else {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary-action';
      button.dataset.appealActionId = String(action.id);
      button.textContent = 'Appeal decision';
      card.append(button);
    }

    list.append(card);
  });

  empty.hidden = list.childElementCount > 0;
}

async function loadAppeals() {
  if (!currentMemberId) return;
  const requestId = ++appealsRequest;
  const loading = byId('appeals-loading');
  const errorState = byId('appeals-error');
  loading.hidden = false;
  errorState.hidden = true;
  byId('appeals-empty').hidden = true;
  byId('appeals-list').replaceChildren();

  try {
    const data = await moderationRequest('/api/appeals');
    if (requestId !== appealsRequest) return;
    renderMemberAppeals(data.actions || [], data.appeals || []);
  } catch {
    if (requestId !== appealsRequest) return;
    errorState.hidden = false;
  } finally {
    if (requestId === appealsRequest) loading.hidden = true;
  }
}

function moderationSnapshotText(snapshot = {}) {
  if (!snapshot || typeof snapshot !== 'object') return 'No captured context.';
  const main = snapshot.body || snapshot.bio || snapshot.display_name || snapshot.username || '';
  return String(main || 'Captured context is available for this target.');
}

function renderModerationReportDetail(report) {
  const detail = byId('moderation-report-detail');
  detail.replaceChildren();
  if (!report) {
    const label = document.createElement('p');
    label.className = 'section-label';
    label.textContent = 'Select a report';
    const title = document.createElement('h3');
    title.textContent = 'No case selected';
    detail.append(label, title);
    return;
  }

  const label = document.createElement('p');
  label.className = 'section-label';
  label.textContent = `Case #${report.id} · ${report.priority} priority`;
  const title = document.createElement('h3');
  title.textContent = `${report.reason} · ${report.target_type}`;
  const state = document.createElement('span');
  state.className = `moderation-case-state ${report.report_status}`;
  state.textContent = report.report_status;
  const context = document.createElement('p');
  context.className = 'moderation-context';
  context.textContent = moderationSnapshotText(report.context_snapshot);
  const details = document.createElement('p');
  details.className = 'moderation-reporter-context';
  details.textContent = report.details ? `Reporter context: ${report.details}` : 'No additional reporter context.';
  const meta = document.createElement('small');
  meta.textContent = `Opened ${formatSautiTime(report.created_at)} · policy ${report.policy_version || 'safety-v1'}`;

  detail.append(label, title, state, context, details, meta);

  if (!['reviewer', 'senior_reviewer'].includes(currentModerationRole) || ['resolved', 'dismissed'].includes(report.report_status)) return;

  const actions = document.createElement('div');
  actions.className = 'moderation-detail-actions';
  const claim = document.createElement('button');
  claim.type = 'button';
  claim.className = 'secondary-action';
  claim.dataset.claimReport = String(report.id);
  claim.textContent = report.assigned_to === currentMemberId ? 'Claimed by you' : 'Claim case';
  claim.disabled = report.assigned_to === currentMemberId;
  actions.append(claim);

  const reason = document.createElement('textarea');
  reason.className = 'moderation-decision-reason';
  reason.maxLength = 2000;
  reason.rows = 4;
  reason.placeholder = 'Decision reason required…';
  reason.dataset.reportDecisionReason = String(report.id);
  detail.append(actions, reason);

  const decisions = document.createElement('div');
  decisions.className = 'moderation-decision-buttons';
  const options = [
    ['dismissed', 'Dismiss'],
    ['visibility_limited', 'Limit visibility'],
    ['escalated', 'Escalate'],
  ];
  if (currentModerationRole === 'senior_reviewer') options.push(['content_removed', 'Remove content']);
  options.forEach(([action, copy]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = action === 'content_removed' ? 'secondary-action danger' : 'secondary-action';
    button.dataset.moderationDecision = action;
    button.dataset.reportId = String(report.id);
    button.textContent = copy;
    decisions.append(button);
  });
  detail.append(decisions);
}

function renderModerationReports() {
  const list = byId('moderation-report-list');
  list.replaceChildren();

  moderationReports.forEach((report) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `moderation-case-row${String(report.id) === String(selectedModerationReportId) ? ' selected' : ''}`;
    button.dataset.moderationReportId = String(report.id);
    const copy = document.createElement('span');
    const strong = document.createElement('strong');
    strong.textContent = `${report.reason} · ${report.target_type}`;
    const small = document.createElement('small');
    small.textContent = `#${report.id} · ${report.priority} · ${formatSautiTime(report.created_at)}`;
    copy.append(strong, small);
    const status = document.createElement('span');
    status.className = `moderation-case-state ${report.report_status}`;
    status.textContent = report.report_status;
    button.append(copy, status);
    list.append(button);
  });

  if (!moderationReports.length) {
    const empty = document.createElement('p');
    empty.className = 'moderation-list-empty';
    empty.textContent = 'No reports in this queue.';
    list.append(empty);
  }

  const selected = moderationReports.find((row) => String(row.id) === String(selectedModerationReportId)) || moderationReports[0] || null;
  selectedModerationReportId = selected ? String(selected.id) : '';
  renderModerationReportDetail(selected);
}

async function loadModerationReports() {
  if (!currentModerationRole) return;
  const status = byId('moderation-report-status').value || 'open';
  const data = await moderationRequest(`/api/moderation/reports?status=${encodeURIComponent(status)}&limit=50`);
  moderationReports = data.reports || [];
  renderModerationReports();
}

function renderModerationAppeals() {
  const list = byId('moderation-appeal-list');
  list.replaceChildren();
  const actionMap = new Map(moderationActions.map((action) => [String(action.id), action]));

  moderationAppeals.forEach((appeal) => {
    const action = actionMap.get(String(appeal.action_id));
    const card = document.createElement('article');
    card.className = 'moderation-appeal-row';
    const head = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = `Appeal #${appeal.id} · ${moderationActionLabel(action?.action_type)}`;
    const state = document.createElement('span');
    state.className = `appeal-state ${appeal.appeal_status}`;
    state.textContent = appealStatusLabel(appeal.appeal_status);
    head.append(title, state);
    const reason = document.createElement('p');
    reason.textContent = appeal.reason;
    const meta = document.createElement('small');
    meta.textContent = `Member ${String(appeal.appellant_id).slice(0, 8)}… · ${formatSautiTime(appeal.created_at)}`;
    card.append(head, reason, meta);

    if (['reviewer', 'senior_reviewer'].includes(currentModerationRole) && ['open', 'reviewing'].includes(appeal.appeal_status)) {
      const actions = document.createElement('div');
      actions.className = 'moderation-appeal-actions';
      const claim = document.createElement('button');
      claim.type = 'button';
      claim.className = 'secondary-action';
      claim.dataset.claimAppeal = String(appeal.id);
      claim.textContent = appeal.assigned_to === currentMemberId ? 'Claimed by you' : 'Claim';
      claim.disabled = appeal.assigned_to === currentMemberId;
      actions.append(claim);

      if (currentModerationRole === 'senior_reviewer') {
        for (const [value, label] of [['appeal_upheld', 'Uphold'], ['appeal_reversed', 'Reverse']]) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'secondary-action';
          button.dataset.appealDecision = value;
          button.dataset.appealId = String(appeal.id);
          button.textContent = label;
          actions.append(button);
        }
      }
      card.append(actions);
    }
    list.append(card);
  });

  if (!moderationAppeals.length) {
    const empty = document.createElement('p');
    empty.className = 'moderation-list-empty';
    empty.textContent = 'No appeals in this queue.';
    list.append(empty);
  }
}

async function loadModerationAppeals() {
  if (!currentModerationRole) return;
  const status = byId('moderation-appeal-status').value || 'open';
  const data = await moderationRequest(`/api/moderation/appeals?status=${encodeURIComponent(status)}&limit=50`);
  moderationAppeals = data.appeals || [];
  moderationActions = data.actions || [];
  renderModerationAppeals();
}

async function loadModerationAudit() {
  const list = byId('moderation-audit-list');
  list.replaceChildren();
  if (!['senior_reviewer', 'auditor'].includes(currentModerationRole)) {
    const note = document.createElement('p');
    note.className = 'moderation-list-empty';
    note.textContent = 'Audit history requires Senior Reviewer or Auditor access.';
    list.append(note);
    return;
  }

  const data = await moderationRequest('/api/moderation/audit?limit=75');
  (data.audit || []).forEach((entry) => {
    const row = document.createElement('article');
    row.className = 'moderation-audit-row';
    const strong = document.createElement('strong');
    strong.textContent = String(entry.event_type || 'Moderation event').replaceAll('_', ' ');
    const meta = document.createElement('small');
    meta.textContent = `${entry.actor_role || 'system'} · ${formatSautiTime(entry.created_at)}`;
    const ref = document.createElement('span');
    ref.textContent = entry.report_id ? `Report #${entry.report_id}` : entry.appeal_id ? `Appeal #${entry.appeal_id}` : 'Moderation';
    row.append(strong, ref, meta);
    list.append(row);
  });
  if (!list.childElementCount) {
    const empty = document.createElement('p');
    empty.className = 'moderation-list-empty';
    empty.textContent = 'No audit events yet.';
    list.append(empty);
  }
}


function renderModerationIdentityRequests(rows) {
  const list = byId('moderation-identity-list');
  const empty = byId('moderation-identity-empty');
  list.replaceChildren();

  (rows || []).forEach((request) => {
    const card = document.createElement('article');
    card.className = 'moderation-identity-row';
    card.dataset.identityRequestId = request.id;

    const head = document.createElement('header');
    const title = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = `@${request.username || 'member'}`;
    const meta = document.createElement('small');
    meta.textContent = `${request.status} · requested ${formatSautiTime(request.requested_at)}`;
    title.append(strong, meta);

    const state = document.createElement('span');
    state.className = `moderation-case-state ${request.status}`;
    state.textContent = request.status;
    head.append(title, state);

    const change = document.createElement('p');
    change.className = 'moderation-identity-change';
    change.textContent = `${request.current_name} → ${request.requested_name}`;
    card.append(head, change);

    if (request.review_note) {
      const note = document.createElement('p');
      note.textContent = `Review note: ${request.review_note}`;
      card.append(note);
    }

    if (request.status === 'pending' && ['reviewer', 'senior_reviewer'].includes(currentModerationRole)) {
      const actions = document.createElement('div');
      actions.className = 'moderation-identity-actions';

      const approve = document.createElement('button');
      approve.type = 'button';
      approve.className = 'secondary-action';
      approve.dataset.identityDecision = 'approved';
      approve.dataset.identityRequestId = request.id;
      approve.textContent = 'Approve';

      const decline = document.createElement('button');
      decline.type = 'button';
      decline.className = 'secondary-action';
      decline.dataset.identityDecision = 'declined';
      decline.dataset.identityRequestId = request.id;
      decline.textContent = 'Decline';

      actions.append(approve, decline);
      card.append(actions);
    }

    list.append(card);
  });

  empty.hidden = list.childElementCount > 0;
}

async function loadModerationIdentityRequests() {
  if (!currentModerationRole) return;
  try {
    const data = await moderationRequest('/api/moderation/identity-requests');
    renderModerationIdentityRequests(data.requests || []);
  } catch (error) {
    byId('moderation-identity-list').replaceChildren();
    byId('moderation-identity-empty').hidden = false;
    byId('moderation-identity-empty').textContent = error?.message || 'Name change requests could not be loaded.';
  }
}

async function decideModerationIdentityRequest(requestId, decision) {
  const verb = decision === 'approved' ? 'approve' : 'decline';
  const note = window.prompt(`Optional review note to ${verb} this name change:`) ?? '';
  try {
    await moderationRequest(`/api/moderation/identity-requests/${encodeURIComponent(requestId)}/decision`, {
      method: 'POST',
      body: { decision, note: note.trim() },
    });
    showToast(decision === 'approved' ? 'Name change approved.' : 'Name change declined.');
    await loadModerationIdentityRequests();
  } catch (error) {
    showToast(error?.message || 'This name change request could not be decided.');
  }
}

async function loadModerationWorkspace() {
  if (!currentMemberId) return;
  const requestId = ++moderationRequestId;
  const loading = byId('moderation-loading');
  const errorState = byId('moderation-error');
  loading.hidden = false;
  errorState.hidden = true;

  try {
    if (!currentModerationRole) await syncModerationAccess();
    if (requestId !== moderationRequestId) return;
    if (!currentModerationRole) {
      byId('moderation-error-copy').textContent = 'This account does not have an active SautiLink moderation role.';
      errorState.hidden = false;
      return;
    }
    byId('moderation-role').textContent = moderationRoleLabel();
    const activeTab = byId('moderation-tabs').querySelector('[aria-selected="true"]')?.dataset.moderationTab || 'reports';
    if (activeTab === 'reports') await loadModerationReports();
    if (activeTab === 'appeals') await loadModerationAppeals();
    if (activeTab === 'identity') await loadModerationIdentityRequests();
    if (activeTab === 'audit') await loadModerationAudit();
  } catch (error) {
    if (requestId !== moderationRequestId) return;
    byId('moderation-error-copy').textContent = error?.message || 'Moderation data could not be loaded.';
    errorState.hidden = false;
  } finally {
    if (requestId === moderationRequestId) loading.hidden = true;
  }
}

async function claimModerationReport(reportId) {
  try {
    await moderationRequest(`/api/moderation/reports/${encodeURIComponent(reportId)}/claim`, { method: 'POST' });
    showToast(`Report #${reportId} claimed.`);
    await loadModerationReports();
  } catch (error) {
    showToast(error?.message || 'This report could not be claimed.');
  }
}

async function decideModerationReport(reportId, action) {
  const textarea = byId('moderation-report-detail').querySelector('[data-report-decision-reason]');
  const reason = String(textarea?.value || '').trim();
  if (!reason) return showToast('Add a decision reason first.');

  try {
    await moderationRequest(`/api/moderation/reports/${encodeURIComponent(reportId)}/decision`, {
      method: 'POST',
      body: {
        action,
        reason,
        policy_version: 'safety-v1',
        request_id: crypto.randomUUID(),
      },
    });
    showToast(`${moderationActionLabel(action)} saved.`);
    await Promise.all([loadModerationReports(), loadModerationAudit()]);
  } catch (error) {
    showToast(error?.message || 'This moderation decision could not be saved.');
  }
}

async function claimModerationAppeal(appealId) {
  try {
    await moderationRequest(`/api/moderation/appeals/${encodeURIComponent(appealId)}/claim`, { method: 'POST' });
    showToast(`Appeal #${appealId} claimed.`);
    await loadModerationAppeals();
  } catch (error) {
    showToast(error?.message || 'This appeal could not be claimed.');
  }
}

async function decideModerationAppeal(appealId, action) {
  const reason = window.prompt(action === 'appeal_reversed'
    ? 'Reason for reversing this moderation decision:'
    : 'Reason for upholding this moderation decision:');
  if (!reason?.trim()) return;

  try {
    await moderationRequest(`/api/moderation/appeals/${encodeURIComponent(appealId)}/decision`, {
      method: 'POST',
      body: {
        action,
        reason: reason.trim(),
        policy_version: 'safety-v1',
        request_id: crypto.randomUUID(),
      },
    });
    showToast(action === 'appeal_reversed' ? 'Appeal reversed; content restored where applicable.' : 'Appeal upheld.');
    await Promise.all([loadModerationAppeals(), loadModerationAudit()]);
  } catch (error) {
    showToast(error?.message || 'This appeal decision could not be saved.');
  }
}

function closeReportDialog() {
  const dialog = byId('report-dialog');
  reportTarget = null;
  byId('report-form').reset();
  byId('report-details-count').textContent = '0';
  setMessage(byId('report-message'), '', '');
  if (typeof dialog.close === 'function' && dialog.open) dialog.close();
  else dialog.removeAttribute('open');
}

function openReportDialog(targetType, targetId, label) {
  if (!currentMember || !targetId) return;
  reportTarget = { targetType, targetId };
  const dialog = byId('report-dialog');
  byId('report-target-label').textContent = label || 'Choose why you are reporting this item.';
  byId('report-form').reset();
  byId('report-details-count').textContent = '0';
  setMessage(byId('report-message'), '', '');
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  byId('report-reason').focus();
}

function syncDeletionRequestUI(request = currentDeletionRequest) {
  currentDeletionRequest = request || null;
  const statusNode = byId('account-deletion-status');
  const requestButton = byId('request-account-deletion');
  const cancelButton = byId('cancel-account-deletion');

  statusNode.className = 'deletion-status';

  if (!request) {
    statusNode.textContent = 'No deletion request';
    requestButton.hidden = false;
    requestButton.disabled = false;
    cancelButton.hidden = true;
    return;
  }

  statusNode.classList.add(request.status);
  if (request.status === 'pending') {
    statusNode.textContent = 'Deletion requested · profile hidden';
    requestButton.hidden = true;
    cancelButton.hidden = false;
    cancelButton.disabled = false;
    return;
  }

  if (request.status === 'cancelled') {
    statusNode.textContent = 'Deletion request cancelled';
    requestButton.hidden = false;
    requestButton.disabled = false;
    requestButton.textContent = 'Request account deletion';
    cancelButton.hidden = true;
    return;
  }

  statusNode.textContent = 'Account deletion completed';
  requestButton.hidden = false;
  requestButton.disabled = true;
  requestButton.textContent = 'Deletion completed';
  cancelButton.hidden = true;
}

async function loadDeletionRequestState() {
  if (!currentMember) return;
  try {
    const data = await safetyRequest('/api/safety/deletion-request');
    syncDeletionRequestUI(data.request || null);
  } catch {
    syncDeletionRequestUI(null);
  }
}

async function refreshCurrentSocialCounts() {
  if (!currentMemberId || !currentMember) return;
  const { data, error } = await supabase
    .from('social_profiles')
    .select('followers_count, following_count, is_discoverable')
    .eq('id', currentMemberId)
    .maybeSingle();
  if (!error && data) Object.assign(currentMember, data);
}

function composerStorageKey(prefix) {
  return currentMemberId ? `${prefix}${currentMemberId}` : '';
}

function readComposerStorage(prefix, fallback) {
  const key = composerStorageKey(prefix);
  if (!key) return fallback;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || 'null');
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function writeComposerStorage(prefix, value) {
  const key = composerStorageKey(prefix);
  if (!key) return;
  try {
    if (value == null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Device-local drafts remain optional if storage is unavailable.
  }
}

function composerHasMention(value) {
  return /(^|[^a-z0-9._])@[a-z0-9][a-z0-9._]{2,29}(?=$|[^a-z0-9._])/i.test(String(value || ''));
}

function replyAccessLabel(value) {
  if (value === 'following') return 'People you follow';
  if (value === 'mentioned') return 'Only people mentioned';
  return 'Everyone';
}

function currentComposerSnapshot() {
  const audience = byId('sauti-audience')?.value || 'public';
  const replyAccess = byId('sauti-reply-access')?.value || 'everyone';
  return {
    body: byId('sauti-body')?.value || '',
    audience,
    replyAccess,
    quote: activeComposerQuote ? { ...activeComposerQuote } : null,
    media: serializeComposerMedia(),
  };
}

function renderComposerQuote() {
  const preview = byId('sauti-quote-preview');
  if (!preview) return;
  preview.hidden = !activeComposerQuote;
  if (!activeComposerQuote) {
    byId('sauti-quote-author').textContent = '@member';
    byId('sauti-quote-body').textContent = '';
    return;
  }
  byId('sauti-quote-author').textContent = activeComposerQuote.author || '@member';
  byId('sauti-quote-body').textContent = activeComposerQuote.body || 'Quoted post';
}

function persistComposerCurrent() {
  if (restoringComposerState || !currentMemberId) return;
  const snapshot = currentComposerSnapshot();
  if (!snapshot.body && !snapshot.quote && !snapshot.media?.length) {
    writeComposerStorage(COMPOSER_CURRENT_PREFIX, null);
    return;
  }
  writeComposerStorage(COMPOSER_CURRENT_PREFIX, snapshot);
}

function renderComposerDrafts() {
  const list = byId('sauti-drafts-list');
  const empty = byId('sauti-drafts-empty');
  const count = byId('sauti-draft-count');
  if (!list || !empty || !count) return;

  list.replaceChildren();
  count.textContent = String(composerDrafts.length);
  empty.hidden = composerDrafts.length > 0;

  composerDrafts.forEach((draft) => {
    const row = document.createElement('article');
    row.className = 'composer-draft-row';

    const restore = document.createElement('button');
    restore.type = 'button';
    restore.className = 'composer-draft-restore';
    restore.dataset.restoreDraft = String(draft.id);

    const text = document.createElement('strong');
    text.textContent = String(draft.body || '').trim() || (draft.quote ? 'Quote Post' : draft.media?.length ? 'Media post' : 'Draft post');
    const meta = document.createElement('span');
    const audience = String(draft.audience || 'public').startsWith('circle:')
      ? 'Sautify'
      : draft.audience === 'followers'
        ? 'Followers'
        : 'Public';
    meta.textContent = `${audience} · ${replyAccessLabel(draft.replyAccess)}`;
    restore.append(text, meta);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'composer-draft-delete';
    remove.dataset.deleteDraft = String(draft.id);
    remove.setAttribute('aria-label', 'Delete draft');
    remove.title = 'Delete draft';
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M5 7h14M9 7V4h6v3M8 10v8M12 10v8M16 10v8M7 7l1 14h8l1-14');
    icon.append(path);
    remove.append(icon);

    row.append(restore, remove);
    list.append(row);
  });
}

function loadComposerDraftsFromStorage() {
  const stored = readComposerStorage(COMPOSER_DRAFTS_PREFIX, []);
  composerDrafts = Array.isArray(stored)
    ? stored.filter((draft) => draft && draft.id).slice(0, COMPOSER_DRAFT_LIMIT)
    : [];
  renderComposerDrafts();
}

function clearComposerCurrent({ resetControls = false } = {}) {
  const textarea = byId('sauti-body');
  if (textarea) textarea.value = '';
  activeComposerQuote = null;
  renderComposerQuote();
  restoreComposerMedia([]);
  if (resetControls) {
    if (byId('sauti-audience')) byId('sauti-audience').value = 'public';
    if (byId('sauti-reply-access')) byId('sauti-reply-access').value = 'everyone';
  }
  writeComposerStorage(COMPOSER_CURRENT_PREFIX, null);
  updateComposerState({ persist: false });
}

function saveComposerDraft({ offline = false } = {}) {
  const snapshot = currentComposerSnapshot();
  if (!String(snapshot.body || '').trim() && !snapshot.quote && !snapshot.media?.length) return false;
  if (composerMedia.some((item) => item.status !== 'ready' && !item.cacheReady)) {
    showToast('Media is still being prepared for device storage. Try saving the draft again.');
    return false;
  }

  const id = Date.now();
  composerDrafts = [
    { ...snapshot, id, savedAt: new Date().toISOString() },
    ...composerDrafts,
  ].slice(0, COMPOSER_DRAFT_LIMIT);
  writeComposerStorage(COMPOSER_DRAFTS_PREFIX, composerDrafts);
  renderComposerDrafts();
  clearComposerCurrent();
  byId('composer-drafts').hidden = false;
  byId('sauti-drafts-toggle').setAttribute('aria-expanded', 'true');
  showToast(offline ? 'Offline post saved as a device draft.' : 'Draft saved on this device.');
  return true;
}

function applyComposerSnapshot(snapshot) {
  if (!snapshot) return;
  restoringComposerState = true;
  const textarea = byId('sauti-body');
  const audience = byId('sauti-audience');
  const replies = byId('sauti-reply-access');
  if (textarea) textarea.value = String(snapshot.body || '').slice(0, 500);
  if (audience && [...audience.options].some((option) => option.value === snapshot.audience)) {
    audience.value = snapshot.audience;
  } else if (audience) {
    audience.value = 'public';
  }
  if (replies && ['everyone', 'following', 'mentioned'].includes(snapshot.replyAccess)) {
    replies.value = snapshot.replyAccess;
  } else if (replies) {
    replies.value = 'everyone';
  }
  activeComposerQuote = snapshot.quote?.id ? { ...snapshot.quote } : null;
  renderComposerQuote();
  restoreComposerMedia(snapshot.media || []);
  restoringComposerState = false;
  updateComposerState({ persist: false });
}

function restoreComposerDraft(id) {
  const draft = composerDrafts.find((item) => String(item.id) === String(id));
  if (!draft) return;
  composerDrafts = composerDrafts.filter((item) => String(item.id) !== String(id));
  writeComposerStorage(COMPOSER_DRAFTS_PREFIX, composerDrafts);
  renderComposerDrafts();
  applyComposerSnapshot(draft);
  byId('composer-drafts').hidden = true;
  byId('sauti-drafts-toggle').setAttribute('aria-expanded', 'false');
  persistComposerCurrent();
  byId('sauti-body').focus();
}

function deleteComposerDraft(id) {
  const draft = composerDrafts.find((item) => String(item.id) === String(id));
  composerDrafts = composerDrafts.filter((item) => String(item.id) !== String(id));
  writeComposerStorage(COMPOSER_DRAFTS_PREFIX, composerDrafts);
  renderComposerDrafts();
  (draft?.media || []).forEach((item) => {
    if (item?.localId) void removeCachedComposerMediaFile(item.localId);
    if (item?.id) void removeRemoteComposerMedia(item.id);
  });
}

function setComposerQuote(quote) {
  activeComposerQuote = quote?.id ? { ...quote } : null;
  renderComposerQuote();
  updateComposerState();
}

async function loadComposerAudiences() {
  if (!currentMemberId) return;
  const select = byId('sauti-audience');
  if (!select) return;
  const previous = select.value || 'public';
  select.querySelectorAll('optgroup[data-circle-audiences]').forEach((group) => group.remove());

  const { data: memberships, error: membershipError } = await supabase
    .from('social_circle_members')
    .select('circle_id')
    .eq('member_id', currentMemberId);

  if (membershipError || !memberships?.length) {
    if ([...select.options].some((option) => option.value === previous)) select.value = previous;
    return;
  }

  const circleIds = [...new Set(memberships.map((row) => row.circle_id).filter(Boolean))];
  const { data: circles, error: circleError } = await supabase
    .from('social_circles')
    .select('id, name')
    .in('id', circleIds)
    .order('name');

  if (!circleError && circles?.length) {
    const group = document.createElement('optgroup');
    group.label = 'Sautify';
    group.dataset.circleAudiences = 'true';
    circles.forEach((circle) => {
      const option = document.createElement('option');
      option.value = `circle:${circle.id}`;
      option.textContent = circle.name;
      group.append(option);
    });
    select.append(group);
  }

  if ([...select.options].some((option) => option.value === previous)) select.value = previous;
}

async function prepareComposer() {
  loadComposerDraftsFromStorage();
  await loadComposerAudiences();
  const current = readComposerStorage(COMPOSER_CURRENT_PREFIX, null);
  if (current) applyComposerSnapshot(current);
  else updateComposerState({ persist: false });
}

function syncComposerOnlineState() {
  const offline = byId('composer-offline');
  if (offline) offline.hidden = navigator.onLine;
  updateComposerState();
}

function updateComposerState({ persist = true } = {}) {
  const textarea = byId('sauti-body');
  const submit = byId('sauti-submit');
  const count = byId('sauti-count');
  const saveDraft = byId('sauti-save-draft');
  const audience = byId('sauti-audience');
  const replies = byId('sauti-reply-access');
  const body = textarea.value.trim();
  const hasMedia = composerMedia.length > 0;
  const hasContent = Boolean(body || activeComposerQuote || hasMedia);
  const mediaReady = composerMedia.every((item) => item.status === 'ready');
  const mediaDraftReady = composerMedia.every((item) => item.status === 'ready' || item.cacheReady);
  const mentionedReady = replies.value !== 'mentioned' || composerHasMention(textarea.value);

  count.textContent = `${textarea.value.length} / 500`;
  submit.textContent = navigator.onLine ? 'Post' : 'Save draft';
  submit.disabled = textarea.disabled || !hasContent || textarea.value.length > 500 || !mentionedReady || (hasMedia && !mediaReady);
  saveDraft.disabled = textarea.disabled || !hasContent || (hasMedia && !mediaDraftReady);
  if (byId('sauti-media-add')) byId('sauti-media-add').disabled = textarea.disabled || composerMedia.length >= 4;

  const audienceLabel = audience.selectedOptions[0]?.textContent || 'Public';
  byId('composer-audience-note').textContent =
    `${audienceLabel} · ${replyAccessLabel(replies.value)} can reply`;

  if (persist) persistComposerCurrent();
}

function resetStreamState() {
  streamCursor = null;
  streamHasMore = false;
  streamLoading = false;
  streamRequest += 1;
  byId('stream-feed').replaceChildren();
  byId('stream-loading').hidden = true;
  byId('stream-error').hidden = true;
  byId('stream-empty').hidden = true;
  byId('stream-more').hidden = true;
}

function authorFromPost(post) {
  const value = post?.author;
  if (Array.isArray(value)) return value[0] || null;
  return value || null;
}

function profileValue(value) {
  return Array.isArray(value) ? value[0] || null : value || null;
}

function sautiActionIcon(action) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const paths = {
    comments: ['M21 12a8 8 0 0 1-8 8H7l-4 3v-6.5A8 8 0 1 1 21 12Z'],
    repost: ['M7 7h10l-2.5-2.5', 'M17 17H7l2.5 2.5', 'M17 7v4', 'M7 17v-4'],
    like: ['M20.8 8.2c0 5-8.8 10.3-8.8 10.3S3.2 13.2 3.2 8.2A4.3 4.3 0 0 1 12 6.8a4.3 4.3 0 0 1 8.8 1.4Z'],
    save: ['M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-4-6 4V4.5Z'],
    share: ['M12 4v11', 'm8 8 4-4 4 4', 'M5 13v6h14v-6'],
  };
  (paths[action] || []).forEach((d) => {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.append(path);
  });
  return svg;
}

function interactionButton(action, label, count = null, active = false) {
  const button = document.createElement('button');
  button.className = `sauti-action${active ? ' active' : ''}`;
  button.type = 'button';
  button.dataset.sautiAction = action;
  button.dataset.active = String(active);
  button.title = label;
  button.setAttribute('aria-label', label);

  const text = document.createElement('span');
  text.className = 'sauti-action-label';
  text.textContent = label;

  button.append(sautiActionIcon(action), text);

  if (count !== null && count !== undefined) {
    const number = document.createElement('span');
    number.className = 'sauti-action-count';
    number.dataset.countFor = action;
    number.textContent = String(Number(count) || 0);
    button.append(number);
  }

  return button;
}

function createSautiCard(item) {
  const post = item.post;
  if (!post) return null;

  const author = authorFromPost(post) || {};
  const username = String(author.username || 'member');
  const displayName = String(author.display_name || username || 'SautiLink member');
  const article = document.createElement('article');
  article.className = 'sauti-card';
  article.dataset.postId = post.id;
  article.dataset.circleId = String(post.circle_id || '');
  article.dataset.visibility = String(post.visibility || 'public');
  article.dataset.parentPostId = String(post.parent_post_id || '');
  article.dataset.rootPostId = String(post.root_post_id || '');
  article.dataset.threadDepth = String(post.thread_depth || 0);
  article.dataset.authorUsername = username;
  article.dataset.authorName = displayName;
  article.dataset.eventKey = item.event_key || post.id;

  const avatar = document.createElement('div');
  avatar.className = 'sauti-card-avatar';

  const fallback = document.createElement('span');
  fallback.textContent = avatarLetter(displayName);
  avatar.append(fallback);

  if (username && username !== 'member') {
    const image = document.createElement('img');
    image.alt = '';
    image.hidden = true;
    image.addEventListener('load', () => {
      image.hidden = false;
      fallback.hidden = true;
    }, { once: true });
    image.addEventListener('error', () => image.remove(), { once: true });
    image.src = `/api/profile-media/${encodeURIComponent(username)}/avatar`;
    avatar.append(image);
  }

  const main = document.createElement('div');
  main.className = 'sauti-card-main';

  if (item.event_type === 'repost' && item.actor) {
    const note = document.createElement('div');
    note.className = 'sauti-repost-note';
    const prefix = document.createElement('span');
    prefix.textContent = 'Reposted by';
    const actorLink = document.createElement('a');
    actorLink.href = memberProfilePath(item.actor.username);
    actorLink.textContent = `@${item.actor.username}`;
    const eventTime = document.createElement('span');
    eventTime.textContent = `· ${formatSautiTime(item.event_at)}`;
    note.append(prefix, actorLink, eventTime);
    main.append(note);
  }

  const head = document.createElement('div');
  head.className = 'sauti-card-head';

  const name = verifiedNameNode(displayName, Boolean(author.is_verified), author.verification_badge_type);

  const profileLink = document.createElement('a');
  profileLink.href = memberProfilePath(username);
  profileLink.textContent = `@${username}`;

  const time = document.createElement('time');
  time.dateTime = String(post.created_at || '');
  time.textContent = formatSautiTime(post.created_at);
  time.title = post.created_at ? new Date(post.created_at).toLocaleString() : '';

  head.append(name, profileLink, time);

  const body = document.createElement('p');
  body.className = 'sauti-card-body';
  body.textContent = String(post.body || '');

  const context = document.createElement('div');
  context.className = 'sauti-card-context';
  const audienceLabel = post.visibility === 'followers'
    ? 'Followers'
    : post.visibility === 'circle'
      ? 'Sautify members'
      : 'Public';
  context.textContent = `${audienceLabel} · Replies: ${replyAccessLabel(post.reply_access)}`;

  let quoteCard = null;
  if (post.quote_post_id) {
    quoteCard = document.createElement('button');
    quoteCard.type = 'button';
    quoteCard.className = 'sauti-quote-card';

    if (item.quotedPost) {
      quoteCard.dataset.openSauti = item.quotedPost.id;
      const quotedAuthor = authorFromPost(item.quotedPost) || {};
      const quotedHead = document.createElement('span');
      quotedHead.className = 'sauti-quote-head';
      const quotedName = verifiedNameNode(
        String(quotedAuthor.display_name || quotedAuthor.username || 'SautiLink member'),
        Boolean(quotedAuthor.is_verified),
        quotedAuthor.verification_badge_type,
      );
      const quotedHandle = document.createElement('span');
      quotedHandle.textContent = quotedAuthor.username ? `@${quotedAuthor.username}` : '@member';
      quotedHead.append(quotedName, quotedHandle);

      const quotedBody = document.createElement('span');
      quotedBody.className = 'sauti-quote-body';
      quotedBody.textContent = String(item.quotedPost.body || 'Quoted post');
      quoteCard.append(quotedHead, quotedBody);
      quoteCard.setAttribute('aria-label', `Open quoted post by ${quotedHandle.textContent}`);
    } else {
      quoteCard.classList.add('unavailable');
      quoteCard.disabled = true;
      const unavailable = document.createElement('span');
      unavailable.className = 'sauti-quote-body';
      unavailable.textContent = 'Quoted post unavailable.';
      quoteCard.append(unavailable);
    }
  }

  const footer = document.createElement('div');
  footer.className = 'sauti-card-footer';

  const actions = document.createElement('div');
  actions.className = 'sauti-actions';
  actions.append(
    interactionButton('comments', 'Comment', post.comment_count, false),
    interactionButton('repost', 'Repost', post.repost_count, item.reposted),
    interactionButton('like', 'Like', post.like_count, item.liked),
    interactionButton('save', item.saved ? 'Saved' : 'Save', null, item.saved),
    interactionButton('share', 'Share'),
  );
  footer.append(actions);

  const repostMenu = document.createElement('div');
  repostMenu.className = 'sauti-repost-menu';
  repostMenu.hidden = true;

  const repostToggle = document.createElement('button');
  repostToggle.type = 'button';
  repostToggle.dataset.repostToggle = post.id;
  repostToggle.append(sautiActionIcon('repost'), document.createTextNode(item.reposted ? 'Undo repost' : 'Repost'));

  const quoteAction = document.createElement('button');
  quoteAction.type = 'button';
  quoteAction.dataset.quoteSauti = post.id;
  quoteAction.append(sautiActionIcon('comments'), document.createTextNode('Quote Post'));
  if (post.visibility !== 'public') {
    quoteAction.disabled = true;
    quoteAction.title = 'Only public posts can be quoted.';
  }

  repostMenu.append(repostToggle, quoteAction);

  if (post.author_id === currentMemberId) {
    const remove = document.createElement('button');
    remove.className = 'sauti-delete';
    remove.type = 'button';
    remove.dataset.deleteSauti = post.id;
    remove.textContent = 'Delete';
    footer.append(remove);
  } else {
    const report = document.createElement('button');
    report.className = 'sauti-report';
    report.type = 'button';
    report.dataset.reportPost = post.id;
    report.dataset.reportLabel = `Report post by @${username}`;
    report.textContent = 'Report';
    footer.append(report);
  }

  const comments = document.createElement('section');
  comments.className = 'sauti-comments';
  comments.hidden = true;
  comments.dataset.commentsFor = post.id;

  const list = document.createElement('div');
  list.className = 'sauti-comment-list';
  list.dataset.commentList = post.id;

  const form = document.createElement('form');
  form.className = 'sauti-comment-form';
  form.dataset.commentForm = post.id;

  const textarea = document.createElement('textarea');
  textarea.name = 'body';
  textarea.maxLength = 500;
  textarea.rows = 2;
  textarea.required = true;
  textarea.placeholder = 'Write a comment…';
  textarea.setAttribute('aria-label', 'Comment text');

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.textContent = 'Comment';

  form.append(textarea, submit);
  comments.append(list, form);

  main.append(head);
  if (body.textContent) main.append(body);
  const mediaGallery = document.createElement('div');
  mediaGallery.className = 'sauti-media-gallery loading';
  mediaGallery.setAttribute('aria-label', 'Post media');
  main.append(mediaGallery);
  void hydrateSautiMediaGallery(post.id, mediaGallery);
  main.append(context);
  if (quoteCard) main.append(quoteCard);
  main.append(footer, repostMenu, comments);
  article.append(avatar, main);
  return article;
}

function renderStreamRows(rows, { reset = false } = {}) {
  const feed = byId('stream-feed');
  if (reset) feed.replaceChildren();
  rows.forEach((item) => {
    const card = createSautiCard(item);
    if (card) feed.append(card);
  });

  const hasRows = feed.childElementCount > 0;
  byId('stream-empty').hidden = hasRows;
  byId('stream-welcome').hidden = hasRows;
  byId('stream-more').hidden = !streamHasMore;
}

async function loadQuotedPostMap(posts) {
  const quoteIds = [...new Set(
    (posts || []).map((post) => post.quote_post_id).filter(Boolean)
  )];
  if (!quoteIds.length) return new Map();

  const { data, error } = await supabase
    .from('social_posts')
    .select('id, author_id, circle_id, visibility, reply_access, quote_post_id, parent_post_id, root_post_id, thread_depth, audience_owner_id, body, created_at, like_count, comment_count, repost_count, author:social_profiles!social_posts_author_id_fkey(username, display_name, is_discoverable, is_verified, verification_badge_type)')
    .in('id', quoteIds);

  if (error) throw error;
  return new Map((data || []).map((post) => [post.id, post]));
}

async function hydrateStreamEvents(events) {
  if (!events.length) return [];

  const postIds = [...new Set(events.map((event) => event.post_id).filter(Boolean))];
  const actorIds = [...new Set(events.map((event) => event.actor_id).filter(Boolean))];

  const postQuery = supabase
    .from('social_posts')
    .select('id, author_id, circle_id, visibility, reply_access, quote_post_id, parent_post_id, root_post_id, thread_depth, audience_owner_id, body, created_at, like_count, comment_count, repost_count, author:social_profiles!social_posts_author_id_fkey(username, display_name, is_discoverable, is_verified, verification_badge_type)')
    .in('id', postIds);

  const actorQuery = supabase
    .from('social_profiles')
    .select('id, username, display_name, is_discoverable, is_verified, verification_badge_type')
    .in('id', actorIds);

  const likeQuery = supabase
    .from('social_post_reactions')
    .select('post_id')
    .eq('user_id', currentMemberId)
    .in('post_id', postIds);

  const repostQuery = supabase
    .from('social_reposts')
    .select('post_id')
    .eq('user_id', currentMemberId)
    .in('post_id', postIds);

  const savedQuery = supabase
    .from('social_saved_posts')
    .select('post_id')
    .eq('user_id', currentMemberId)
    .in('post_id', postIds);

  const [
    { data: posts, error: postsError },
    { data: actors, error: actorsError },
    { data: likes, error: likesError },
    { data: reposts, error: repostsError },
    { data: saves, error: savesError },
  ] = await Promise.all([postQuery, actorQuery, likeQuery, repostQuery, savedQuery]);

  if (postsError || actorsError || likesError || repostsError || savesError) {
    throw postsError || actorsError || likesError || repostsError || savesError;
  }

  const quoteMap = await loadQuotedPostMap(posts || []);
  const postMap = new Map((posts || []).map((post) => [post.id, post]));
  const actorMap = new Map((actors || []).map((profile) => [profile.id, profile]));
  const liked = new Set((likes || []).map((row) => row.post_id));
  const reposted = new Set((reposts || []).map((row) => row.post_id));
  const saved = new Set((saves || []).map((row) => row.post_id));

  return events
    .map((event) => ({
      ...event,
      post: postMap.get(event.post_id) || null,
      actor: actorMap.get(event.actor_id) || null,
      liked: liked.has(event.post_id),
      reposted: reposted.has(event.post_id),
      saved: saved.has(event.post_id),
      quotedPost: quoteMap.get(postMap.get(event.post_id)?.quote_post_id) || null,
    }))
    .filter((event) => event.post && (event.event_type !== 'repost' || event.actor));
}

async function hydrateDirectPosts(posts) {
  const rows = Array.isArray(posts) ? posts : [];
  if (!rows.length) return [];

  const postIds = rows.map((post) => post.id).filter(Boolean);
  const [likeResult, repostResult, savedResult] = await Promise.all([
    supabase
      .from('social_post_reactions')
      .select('post_id')
      .eq('user_id', currentMemberId)
      .in('post_id', postIds),
    supabase
      .from('social_reposts')
      .select('post_id')
      .eq('user_id', currentMemberId)
      .in('post_id', postIds),
    supabase
      .from('social_saved_posts')
      .select('post_id')
      .eq('user_id', currentMemberId)
      .in('post_id', postIds),
  ]);

  if (likeResult.error || repostResult.error || savedResult.error) {
    throw likeResult.error || repostResult.error || savedResult.error;
  }

  const liked = new Set((likeResult.data || []).map((row) => row.post_id));
  const reposted = new Set((repostResult.data || []).map((row) => row.post_id));
  const saved = new Set((savedResult.data || []).map((row) => row.post_id));
  const quoteMap = await loadQuotedPostMap(rows);

  return rows.map((post) => ({
    event_type: 'post',
    event_key: post.id,
    event_at: post.created_at,
    post,
    liked: liked.has(post.id),
    reposted: reposted.has(post.id),
    saved: saved.has(post.id),
    quotedPost: quoteMap.get(post.quote_post_id) || null,
  }));
}

async function loadStream({ reset = false } = {}) {
  if (!currentMember || streamLoading) return;
  streamLoading = true;
  const requestId = ++streamRequest;
  const loading = byId('stream-loading');
  const error = byId('stream-error');
  const loadMore = byId('stream-load-more');

  if (reset) {
    streamCursor = null;
    byId('stream-feed').replaceChildren();
    byId('stream-empty').hidden = true;
    byId('stream-welcome').hidden = false;
  }

  error.hidden = true;
  loading.hidden = !reset;
  loadMore.disabled = true;

  try {
    let query = supabase
      .from('social_stream_events')
      .select('event_type, post_id, actor_id, event_at, event_key')
      .order('event_at', { ascending: false })
      .order('event_key', { ascending: false })
      .limit(STREAM_PAGE_SIZE + 1);

    if (streamCursor) {
      query = query.or(
        `event_at.lt.${streamCursor.createdAt},and(event_at.eq.${streamCursor.createdAt},event_key.lt.${streamCursor.id})`
      );
    }

    const { data, error: queryError } = await query;
    if (queryError) throw queryError;
    if (requestId !== streamRequest) return;

    const rows = Array.isArray(data) ? data : [];
    streamHasMore = rows.length > STREAM_PAGE_SIZE;
    const page = rows.slice(0, STREAM_PAGE_SIZE);
    const last = page[page.length - 1];
    if (last) streamCursor = { createdAt: last.event_at, id: last.event_key };

    const hydrated = await hydrateStreamEvents(page);
    if (requestId !== streamRequest) return;
    renderStreamRows(hydrated, { reset });
  } catch {
    if (requestId !== streamRequest) return;
    if (reset) byId('stream-feed').replaceChildren();
    error.hidden = false;
    byId('stream-more').hidden = true;
  } finally {
    if (requestId === streamRequest) {
      streamLoading = false;
      loading.hidden = true;
      loadMore.disabled = false;
    }
  }
}

async function refreshPostInteractionControls(postId) {
  const [
    { data: post, error: postError },
    { data: likeRows, error: likeError },
    { data: repostRows, error: repostError },
    { data: savedRows, error: savedError },
  ] = await Promise.all([
    supabase
      .from('social_posts')
      .select('like_count, comment_count, repost_count')
      .eq('id', postId)
      .maybeSingle(),
    supabase
      .from('social_post_reactions')
      .select('post_id')
      .eq('post_id', postId)
      .eq('user_id', currentMemberId),
    supabase
      .from('social_reposts')
      .select('post_id')
      .eq('post_id', postId)
      .eq('user_id', currentMemberId),
    supabase
      .from('social_saved_posts')
      .select('post_id')
      .eq('post_id', postId)
      .eq('user_id', currentMemberId),
  ]);

  if (postError || likeError || repostError || savedError || !post) return;
  const liked = Boolean(likeRows?.length);
  const reposted = Boolean(repostRows?.length);
  const saved = Boolean(savedRows?.length);

  document.querySelectorAll('.sauti-card').forEach((card) => {
    if (card.dataset.postId !== postId) return;

    const values = {
      like: post.like_count,
      comments: post.comment_count,
      repost: post.repost_count,
    };
    Object.entries(values).forEach(([action, count]) => {
      const button = card.querySelector(`[data-sauti-action="${action}"]`);
      const countNode = button?.querySelector('[data-count-for]');
      if (countNode) countNode.textContent = String(Number(count) || 0);
    });

    const likeButton = card.querySelector('[data-sauti-action="like"]');
    if (likeButton) {
      likeButton.dataset.active = String(liked);
      likeButton.classList.toggle('active', liked);
    }

    const repostButton = card.querySelector('[data-sauti-action="repost"]');
    if (repostButton) {
      repostButton.dataset.active = String(reposted);
      repostButton.classList.toggle('active', reposted);
    }
    const repostMenuButton = card.querySelector('[data-repost-toggle]');
    if (repostMenuButton) {
      repostMenuButton.replaceChildren(
        sautiActionIcon('repost'),
        document.createTextNode(reposted ? 'Undo repost' : 'Repost'),
      );
    }

    const saveButton = card.querySelector('[data-sauti-action="save"]');
    if (saveButton) {
      saveButton.dataset.active = String(saved);
      saveButton.classList.toggle('active', saved);
      saveButton.setAttribute('aria-label', saved ? 'Remove from Saved' : 'Save');
      saveButton.title = saved ? 'Remove from Saved' : 'Save';
      const label = saveButton.querySelector('.sauti-action-label');
      if (label) label.textContent = saved ? 'Saved' : 'Save';
    }
  });
}

function createCommentNode(comment) {
  const author = profileValue(comment.author) || {};
  const username = String(author.username || 'member');
  const displayName = String(author.display_name || username || 'SautiLink member');

  const row = document.createElement('article');
  row.className = 'sauti-comment';
  row.dataset.commentId = comment.id;

  const avatar = document.createElement('span');
  avatar.className = 'sauti-comment-avatar';
  avatar.textContent = avatarLetter(displayName);

  const main = document.createElement('div');
  main.className = 'sauti-comment-main';

  const head = document.createElement('div');
  head.className = 'sauti-comment-head';
  const name = verifiedNameNode(displayName, Boolean(author.is_verified), author.verification_badge_type);
  const link = document.createElement('a');
  link.href = memberProfilePath(username);
  link.textContent = `@${username}`;
  const time = document.createElement('time');
  time.dateTime = String(comment.created_at || '');
  time.textContent = formatSautiTime(comment.created_at);
  head.append(name, link, time);

  const body = document.createElement('p');
  body.className = 'sauti-comment-body';
  body.textContent = String(comment.body || '');

  if (comment.author_id === currentMemberId) {
    const remove = document.createElement('button');
    remove.className = 'sauti-comment-delete';
    remove.type = 'button';
    remove.dataset.deleteComment = comment.id;
    remove.dataset.postId = comment.post_id;
    remove.textContent = 'Delete';
    head.append(remove);
  } else {
    const report = document.createElement('button');
    report.className = 'sauti-comment-report';
    report.type = 'button';
    report.dataset.reportComment = comment.id;
    report.dataset.reportLabel = `Report comment by @${username}`;
    report.textContent = 'Report';
    head.append(report);
  }

  main.append(head, body);
  row.append(avatar, main);
  return row;
}

async function loadComments(postId, panel) {
  const list = panel.querySelector('[data-comment-list]');
  list.replaceChildren();
  const loading = document.createElement('p');
  loading.className = 'sauti-comment-empty';
  loading.textContent = 'Loading comments…';
  list.append(loading);

  const { data, error } = await supabase
    .from('social_post_comments')
    .select('id, post_id, author_id, body, created_at, author:social_profiles!social_post_comments_author_id_fkey(username, display_name, is_discoverable, is_verified, verification_badge_type)')
    .eq('post_id', postId)
    .order('created_at', { ascending: true })
    .limit(50);

  list.replaceChildren();
  if (error) {
    const state = document.createElement('p');
    state.className = 'sauti-comment-empty';
    state.textContent = 'Comments could not load.';
    list.append(state);
    return;
  }

  if (!data?.length) {
    const state = document.createElement('p');
    state.className = 'sauti-comment-empty';
    state.textContent = 'No comments yet.';
    list.append(state);
    return;
  }

  data.forEach((comment) => list.append(createCommentNode(comment)));
}

async function toggleComments(card) {
  const panel = card.querySelector('.sauti-comments');
  panel.hidden = !panel.hidden;
  if (!panel.hidden) await loadComments(card.dataset.postId, panel);
}

async function toggleLike(card, button) {
  const postId = card.dataset.postId;
  const active = button.dataset.active === 'true';
  button.disabled = true;
  try {
    await socialMutation(`/api/social/posts/${postId}/like`, {
      method: active ? 'DELETE' : 'POST',
    });
    await refreshPostInteractionControls(postId);
  } catch (error) {
    showToast(error?.message || 'Like could not be updated.');
  } finally {
    button.disabled = false;
  }
}

async function toggleRepost(card, button) {
  const postId = card.dataset.postId;
  const active = button.dataset.active === 'true';
  button.disabled = true;
  try {
    await socialMutation(`/api/social/posts/${postId}/repost`, {
      method: active ? 'DELETE' : 'POST',
    });
    const inHomeStream = Boolean(card.closest('#stream-feed')) && !readSharedSautiTarget();
    if (inHomeStream) await loadStream({ reset: true });
    else await refreshPostInteractionControls(postId);
    button.disabled = false;
    showToast(active ? 'Repost removed.' : 'Post reposted.');
  } catch (error) {
    showToast(error?.message || 'Repost could not be updated.');
    button.disabled = false;
  }
}

async function toggleSave(card, button) {
  const postId = card.dataset.postId;
  if (!postId || !currentMemberId) return;

  const active = button.dataset.active === 'true';
  button.disabled = true;
  try {
    let error = null;
    if (active) {
      ({ error } = await supabase
        .from('social_saved_posts')
        .delete()
        .eq('user_id', currentMemberId)
        .eq('post_id', postId));
    } else {
      ({ error } = await supabase
        .from('social_saved_posts')
        .insert({ user_id: currentMemberId, post_id: postId }));
    }

    if (error && !(error.code === '23505' && !active)) throw error;
    await refreshPostInteractionControls(postId);
    if (!savedSurface.hidden) await loadSavedSauti();
    showToast(active ? 'Removed from Saved.' : 'Post saved.');
  } catch {
    showToast('Saved state could not be updated.');
  } finally {
    button.disabled = false;
  }
}

function conversationPath(postId) {
  return postId
    ? `/post/${encodeURIComponent(postId)}`
    : '/home';
}

function sautiShareUrl(postId) {
  return new URL(conversationPath(postId), window.location.origin).href;
}

async function copyShareText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const helper = document.createElement('textarea');
  helper.value = value;
  helper.setAttribute('readonly', '');
  helper.style.position = 'fixed';
  helper.style.opacity = '0';
  document.body.append(helper);
  helper.select();
  const copied = document.execCommand('copy');
  helper.remove();
  if (!copied) throw new Error('COPY_FAILED');
}

async function shareSautiLink(card, button) {
  const postId = card.dataset.postId;
  if (!postId) return;

  const url = sautiShareUrl(postId);
  button.disabled = true;
  try {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'SautiLink',
          text: 'View this post on SautiLink',
          url,
        });
        return;
      } catch (error) {
        if (error?.name === 'AbortError') return;
      }
    }

    await copyShareText(url);
    showToast('Post link copied.');
  } catch {
    showToast('This post link could not be shared.');
  } finally {
    button.disabled = false;
  }
}

function closeRepostMenus(except = null) {
  document.querySelectorAll('.sauti-repost-menu').forEach((menu) => {
    if (menu !== except) menu.hidden = true;
  });
}

function toggleRepostMenu(card) {
  const menu = card.querySelector('.sauti-repost-menu');
  if (!menu) return;
  const willOpen = menu.hidden;
  closeRepostMenus(menu);
  menu.hidden = !willOpen;
}

function openSautiTarget(postId) {
  if (!postId) return;
  window.history.pushState({}, '', conversationPath(postId));
  void applyLocationRoute();
}

function startQuoteSauti(card) {
  if (!card || card.dataset.visibility !== 'public') {
    showToast('Only public posts can be quoted.');
    return;
  }

  const postId = card.dataset.postId;
  if (!postId) return;

  const author = card.dataset.authorUsername
    ? `@${card.dataset.authorUsername}`
    : card.dataset.authorName || '@member';
  const body = card.querySelector('.sauti-card-body')?.textContent?.trim()
    || card.querySelector('.sauti-quote-body')?.textContent?.trim()
    || 'Quoted post';

  showMemberSurface('stream');
  if (window.location.pathname !== '/home' || window.location.search) {
    window.history.pushState({}, '', '/home');
  }
  setComposerQuote({ id: postId, author, body });
  closeRepostMenus();
  const composer = byId('sauti-composer');
  composer.hidden = false;
  composer.scrollIntoView({ behavior: motionBehavior(), block: 'start' });
  window.setTimeout(() => byId('sauti-body').focus(), 160);
}

async function submitComment(form) {
  const postId = form.dataset.commentForm;
  const textarea = form.elements.body;
  const submit = form.querySelector('[type="submit"]');
  const body = textarea.value.trim();
  if (!body) return;
  if (body.length > 500) return showToast('Comments must be 500 characters or fewer.');

  submit.disabled = true;
  try {
    await socialMutation(`/api/social/posts/${postId}/comments`, {
      method: 'POST',
      body: { body },
    });
    textarea.value = '';
    const panel = form.closest('.sauti-comments');
    await loadComments(postId, panel);
    await refreshPostInteractionControls(postId);
  } catch (error) {
    showToast(error?.message || 'Comment could not be shared.');
  } finally {
    submit.disabled = false;
  }
}

async function deleteComment(commentId, postId, button) {
  button.disabled = true;
  try {
    await socialMutation(`/api/social/comments/${commentId}`, { method: 'DELETE' });
    const panel = button.closest('.sauti-comments');
    await loadComments(postId, panel);
    await refreshPostInteractionControls(postId);
  } catch (error) {
    showToast(error?.message || 'Comment could not be deleted.');
    button.disabled = false;
  }
}

async function shareSauti() {
  if (!currentMember) return;
  const textarea = byId('sauti-body');
  const submit = byId('sauti-submit');
  const message = byId('sauti-message');
  const audienceValue = byId('sauti-audience').value || 'public';
  const replyAccess = byId('sauti-reply-access').value || 'everyone';
  const body = textarea.value.trim();
  const quotePostId = activeComposerQuote?.id || '';
  const circleId = audienceValue.startsWith('circle:') ? audienceValue.slice(7) : '';
  const visibility = circleId ? 'circle' : audienceValue === 'followers' ? 'followers' : 'public';
  setMessage(message, '', '');

  if (!body && !quotePostId && !composerMedia.length) return setMessage(message, 'Write something or add media before sharing.');
  if (composerMedia.length > 4) return setMessage(message, 'A post can include up to four media items.');
  if (composerMedia.some((item) => item.status !== 'ready' || !item.id)) {
    return setMessage(message, navigator.onLine ? 'Wait for media uploads to finish or retry the failed item.' : 'Media is waiting for connection.');
  }
  if (textarea.value.length > 500) return setMessage(message, 'Post text must be 500 characters or fewer.');
  if (replyAccess === 'mentioned' && !composerHasMention(textarea.value)) {
    return setMessage(message, 'Mention at least one SautiLink username or change who can reply.');
  }

  if (!navigator.onLine) {
    if (saveComposerDraft({ offline: true })) {
      setMessage(message, 'Saved as a device draft until you are online.', 'success');
    }
    return;
  }

  submit.disabled = true;
  submit.setAttribute('aria-busy', 'true');
  const previous = submit.textContent;
  submit.textContent = 'Posting…';

  try {
    const headers = await currentAuthorizationHeader();
    if (!headers.Authorization) throw new Error('Sign in again before publishing a post.');

    const response = await fetch('/api/sauti', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        body,
        visibility,
        circle_id: circleId || null,
        reply_access: replyAccess,
        quote_post_id: quotePostId || null,
        media: composerMedia.map((item) => ({
          id: item.id,
          alt_text: String(item.altText || '').trim(),
        })),
      }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok === false) {
      throw new Error(payload?.error?.message || 'Your post could not be published.');
    }

    const audienceLabel = byId('sauti-audience').selectedOptions[0]?.textContent || 'SautiLink';
    clearComposerCurrent({ resetControls: true });
    setMessage(message, circleId ? `Post published in ${audienceLabel}.` : 'Post published.', 'success');
    await loadStream({ reset: true });
    showToast(circleId ? `Shared in ${audienceLabel}.` : visibility === 'followers' ? 'Followers-only post is live.' : 'Your post is live.');
  } catch (error) {
    setMessage(message, error?.message || 'Your post could not be published. Try again.');
  } finally {
    submit.textContent = previous;
    submit.removeAttribute('aria-busy');
    updateComposerState();
  }
}

async function deleteSauti(postId, button) {
  if (!currentMember || !postId) return;
  if (!window.confirm('Delete this post? This cannot be undone.')) return;

  const circleId = button.closest('.sauti-card')?.dataset.circleId || '';
  const previous = button.textContent;
  button.disabled = true;
  button.textContent = 'Deleting…';

  try {
    const headers = await currentAuthorizationHeader();
    if (!headers.Authorization) throw new Error('Sign in again before deleting a post.');

    const response = await fetch(`/api/sauti/${encodeURIComponent(postId)}`, {
      method: 'DELETE',
      headers,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok === false) {
      throw new Error(payload?.error?.message || 'This post could not be deleted.');
    }

    if (!conversationSurface.hidden && activeSautiConversation) {
      const rootId = activeSautiConversation.rootId;
      if (postId === rootId) {
        activeSautiConversation = null;
        showMemberSurface('stream');
      } else {
        window.history.replaceState({}, '', conversationPath(rootId));
        await loadConversation(rootId);
      }
    } else if (circleId && activeCircle?.circle?.id === circleId) {
      await loadCircleStream(circleId);
    } else if (!savedSurface.hidden) {
      await loadSavedSauti();
    } else if (!discoverSurface.hidden) {
      await loadDiscover();
    } else if (readSharedSautiTarget() === postId) {
      window.history.replaceState({}, '', conversationPath(postId));
      await loadConversation(postId);
    } else {
      await loadStream({ reset: true });
    }
    showToast('Post deleted.');
  } catch (error) {
    showToast(error?.message || 'This post could not be deleted.');
    button.disabled = false;
    button.textContent = previous;
  }
}

function safeWebsite(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (raw.length > 2048) throw new Error('Website must be 2,048 characters or fewer.');
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Enter a complete website beginning with http:// or https://.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Enter a safe http:// or https:// website without embedded credentials.');
  }
  return url.href;
}

function profileValues(form) {
  const bio = form.bio.value.trim();
  const location = form.location.value.trim();
  if (bio.length > 500) throw new Error('Bio must be 500 characters or fewer.');
  if (location.length > 100) throw new Error('Location must be 100 characters or fewer.');
  return {
    bio,
    location: location || null,
    website_url: safeWebsite(form.website.value),
    is_discoverable: form.discoverable.checked,
  };
}

function clearProfileMediaUrl(slot) {
  const value = profileMediaObjectUrls[slot];
  if (value) URL.revokeObjectURL(value);
  profileMediaObjectUrls[slot] = '';
}

function updateProfileMediaControls() {
  const ownerActive = Boolean(
    renderedProfileOwner &&
    currentMember &&
    renderedProfileUsername === currentMember.username
  );

  const ready = profileMediaReady && ownerActive;
  byId('profile-avatar-upload-button').disabled = !ready;
  byId('profile-header-upload-button').disabled = !ready;
  byId('profile-avatar-remove-button').disabled = !ready || !profileMediaPresence.avatar;
  byId('profile-header-remove-button').disabled = !ready || !profileMediaPresence.header;

  const state = byId('profile-media-state');
  const status = byId('profile-media-status');
  state.textContent = profileMediaReady ? 'Ready' : 'Waiting';
  state.classList.toggle('ready', profileMediaReady);
  status.textContent = profileMediaReady
    ? 'Secure owner-only upload service is ready.'
    : 'Cloudflare R2 must be enabled before profile uploads can start.';
}

function resetProfileMediaVisuals(displayName) {
  profileMediaRenderRequest += 1;
  const letter = avatarLetter(displayName);
  for (const slot of ['avatar', 'header']) {
    clearProfileMediaUrl(slot);
    profileMediaPresence[slot] = false;
  }

  const avatarImage = byId('profile-avatar-image');
  avatarImage.hidden = true;
  avatarImage.removeAttribute('src');
  byId('profile-avatar').textContent = letter;

  const headerImage = byId('profile-header-image');
  headerImage.hidden = true;
  headerImage.removeAttribute('src');

  const avatarPreview = byId('profile-media-avatar-preview');
  avatarPreview.textContent = letter;
  avatarPreview.style.backgroundImage = '';

  const headerPreview = byId('profile-media-header-preview');
  headerPreview.style.backgroundImage = '';

  updateProfileMediaControls();
}

async function profileMediaHeaders() {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) throw error;
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}

async function loadProfileMedia(username, displayName) {
  const requestId = ++profileMediaRenderRequest;
  const letter = avatarLetter(displayName);

  for (const slot of ['avatar', 'header']) {
    clearProfileMediaUrl(slot);
    profileMediaPresence[slot] = false;
  }

  byId('profile-avatar-image').hidden = true;
  byId('profile-avatar-image').removeAttribute('src');
  byId('profile-header-image').hidden = true;
  byId('profile-header-image').removeAttribute('src');
  byId('profile-avatar').textContent = letter;
  byId('profile-media-avatar-preview').textContent = letter;
  byId('profile-media-avatar-preview').style.backgroundImage = '';
  byId('profile-media-header-preview').style.backgroundImage = '';
  updateProfileMediaControls();

  if (!profileMediaReady) return;

  let headers = {};
  try {
    headers = await profileMediaHeaders();
  } catch {
    headers = {};
  }

  await Promise.all(['avatar', 'header'].map(async (slot) => {
    try {
      const response = await fetch(`/api/profile-media/${encodeURIComponent(username)}/${slot}`, {
        headers,
        cache: 'no-store',
      });
      if (requestId !== profileMediaRenderRequest || response.status === 404) return;
      if (!response.ok) return;

      const blob = await response.blob();
      if (!blob.type.startsWith('image/')) return;
      const objectUrl = URL.createObjectURL(blob);

      if (requestId !== profileMediaRenderRequest) {
        URL.revokeObjectURL(objectUrl);
        return;
      }

      clearProfileMediaUrl(slot);
      profileMediaObjectUrls[slot] = objectUrl;
      profileMediaPresence[slot] = true;

      if (slot === 'avatar') {
        const image = byId('profile-avatar-image');
        image.src = objectUrl;
        image.hidden = false;
        const preview = byId('profile-media-avatar-preview');
        preview.textContent = '';
        preview.style.backgroundImage = `url("${objectUrl}")`;
      } else {
        const image = byId('profile-header-image');
        image.src = objectUrl;
        image.hidden = false;
        byId('profile-media-header-preview').style.backgroundImage = `url("${objectUrl}")`;
      }
      updateProfileMediaControls();
    } catch {
      // Initials and the existing header treatment are safe fallbacks.
    }
  }));
}

async function refreshProfileMediaCapability() {
  try {
    const response = await fetch('/api/profile-media/status', { cache: 'no-store' });
    const payload = await response.json().catch(() => null);
    profileMediaReady = Boolean(response.ok && payload?.data?.ready);
  } catch {
    profileMediaReady = false;
  }

  updateProfileMediaControls();
  if (profileMediaReady && renderedProfileUsername) {
    const displayName = byId('profile-display-name').textContent || renderedProfileUsername;
    await loadProfileMedia(renderedProfileUsername, displayName);
  }
}

function setProfileMediaBusy(slot, busy, label = '') {
  const button = byId(`profile-${slot}-upload-button`);
  const remove = byId(`profile-${slot}-remove-button`);
  if (!button.dataset.defaultLabel) button.dataset.defaultLabel = button.textContent;
  button.textContent = busy ? label : button.dataset.defaultLabel;
  button.disabled = busy || !profileMediaReady;
  remove.disabled = busy || !profileMediaReady || !profileMediaPresence[slot];
}

function validateProfileMediaFile(slot, file) {
  const allowed = new Set(['image/jpeg', 'image/png', 'image/webp']);
  const limit = slot === 'avatar' ? 5 * 1024 * 1024 : 8 * 1024 * 1024;
  if (!file || !allowed.has(file.type)) return 'Use a JPEG, PNG or WebP image.';
  if (file.size < 1 || file.size > limit) {
    return slot === 'avatar' ? 'Profile photos must be 5 MB or smaller.' : 'Header images must be 8 MB or smaller.';
  }
  return '';
}

async function uploadProfileMedia(slot, file) {
  const message = byId('profile-media-message');
  setMessage(message, '', '');

  if (!profileMediaReady) return setMessage(message, 'Profile media is waiting for Cloudflare R2 to be enabled.');
  if (!renderedProfileOwner || !currentMember || renderedProfileUsername !== currentMember.username) {
    return setMessage(message, 'Only the profile owner can change profile media.');
  }

  const issue = validateProfileMediaFile(slot, file);
  if (issue) return setMessage(message, issue);

  setProfileMediaBusy(slot, true, 'Uploading…');
  try {
    const headers = await profileMediaHeaders();
    if (!headers.Authorization) throw new Error('AUTH_REQUIRED');

    const body = new FormData();
    body.append('slot', slot);
    body.append('file', file);

    const response = await fetch('/api/profile-media/upload', {
      method: 'POST',
      headers,
      body,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok === false) {
      throw new Error(payload?.error?.message || 'The image could not be uploaded.');
    }

    setMessage(message, slot === 'avatar' ? 'Profile photo updated.' : 'Header image updated.', 'success');
    await loadProfileMedia(currentMember.username, currentMember.display_name || currentMember.full_name || currentMember.username);
  } catch (error) {
    setMessage(message, error?.message === 'AUTH_REQUIRED'
      ? 'Sign in again before changing profile media.'
      : (error?.message || 'The image could not be uploaded. Try again.'));
  } finally {
    setProfileMediaBusy(slot, false);
  }
}

async function removeProfileMedia(slot) {
  const message = byId('profile-media-message');
  setMessage(message, '', '');

  if (!profileMediaReady || !renderedProfileOwner || !currentMember) return;

  const button = byId(`profile-${slot}-remove-button`);
  button.disabled = true;
  const previous = button.textContent;
  button.textContent = 'Removing…';

  try {
    const headers = await profileMediaHeaders();
    if (!headers.Authorization) throw new Error('AUTH_REQUIRED');

    const response = await fetch('/api/profile-media/remove', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ slot }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok === false) {
      throw new Error(payload?.error?.message || 'The image could not be removed.');
    }

    setMessage(message, slot === 'avatar' ? 'Profile photo removed.' : 'Header image removed.', 'success');
    await loadProfileMedia(currentMember.username, currentMember.display_name || currentMember.full_name || currentMember.username);
  } catch (error) {
    setMessage(message, error?.message === 'AUTH_REQUIRED'
      ? 'Sign in again before changing profile media.'
      : (error?.message || 'The image could not be removed. Try again.'));
  } finally {
    button.textContent = previous;
    updateProfileMediaControls();
  }
}

async function loadProfileSafetyState(profile, owner) {
  const reportButton = byId('profile-report-button');
  const muteButton = byId('profile-mute-button');
  const blockButton = byId('profile-block-button');
  const messageButton = byId('profile-message-button');

  const hidden = owner || !currentMember || !profile?.id;
  reportButton.hidden = hidden;
  muteButton.hidden = hidden;
  blockButton.hidden = hidden;
  messageButton.hidden = hidden;
  messageButton.disabled = false;
  messageButton.dataset.peerId = profile?.id || '';
  messageButton.dataset.username = profile?.username || '';
  reportButton.disabled = false;
  muteButton.disabled = false;
  blockButton.disabled = false;
  muteButton.classList.remove('muted');
  muteButton.dataset.muted = 'false';
  muteButton.dataset.username = profile?.username || '';
  muteButton.textContent = 'Mute';
  blockButton.classList.remove('blocked');
  blockButton.dataset.blocked = 'false';
  blockButton.dataset.username = profile?.username || '';
  blockButton.textContent = 'Block';

  if (hidden) return;

  reportButton.dataset.targetId = profile.id;
  reportButton.dataset.username = profile.username || '';

  const [blockResult, muteResult] = await Promise.allSettled([
    safetyRequest(`/api/safety/block/${encodeURIComponent(profile.username)}`),
    safetyRequest(`/api/safety/mute/${encodeURIComponent(profile.username)}`),
  ]);

  if (blockResult.status === 'fulfilled') {
    const blocked = Boolean(blockResult.value.blocked_by_you);
    blockButton.dataset.blocked = String(blocked);
    blockButton.classList.toggle('blocked', blocked);
    blockButton.textContent = blocked ? 'Unblock' : 'Block';

    if (blocked) {
      const followButton = byId('profile-follow-button');
      followButton.hidden = true;
      followButton.disabled = true;
      messageButton.hidden = true;
      messageButton.disabled = true;
      muteButton.hidden = true;
      muteButton.disabled = true;
    }
  } else {
    blockButton.hidden = true;
  }

  if (muteResult.status === 'fulfilled' && !muteButton.hidden) {
    const muted = Boolean(muteResult.value.muted_by_you);
    muteButton.dataset.muted = String(muted);
    muteButton.classList.toggle('muted', muted);
    muteButton.textContent = muted ? 'Unmute' : 'Mute';
  } else if (muteResult.status === 'rejected') {
    muteButton.hidden = true;
  }
}

async function toggleProfileMute() {
  const button = byId('profile-mute-button');
  const username = button.dataset.username;
  if (!username || button.hidden) return;

  const muted = button.dataset.muted === 'true';
  if (!muted && !window.confirm(`Mute @${username}? Their posts, reposts and notifications will be hidden from you. Following and direct messages stay available.`)) {
    return;
  }

  button.disabled = true;
  try {
    await safetyRequest(`/api/safety/mute/${encodeURIComponent(username)}`, {
      method: muted ? 'DELETE' : 'POST',
    });
    await Promise.all([
      loadStream({ reset: true }),
      loadDiscover(),
      loadNotifications(),
      refreshMessageBadge(),
    ]);
    await loadDiscoverableProfile(username);
    showToast(muted ? `@${username} unmuted.` : `@${username} muted.`);
  } catch (error) {
    showToast(error?.message || 'Mute state could not be changed.');
    button.disabled = false;
  }
}

async function toggleProfileBlock() {
  const button = byId('profile-block-button');
  const username = button.dataset.username;
  if (!username || button.hidden) return;

  const blocked = button.dataset.blocked === 'true';
  if (!blocked && !window.confirm(`Block @${username}? You will no longer see each other's posts or interactions, new direct messages will stop, and existing follows between you will be removed.`)) {
    return;
  }

  button.disabled = true;
  try {
    await safetyRequest(`/api/safety/block/${encodeURIComponent(username)}`, {
      method: blocked ? 'DELETE' : 'POST',
    });
    await refreshCurrentSocialCounts();
    await Promise.all([
      loadStream({ reset: true }),
      loadDiscover(),
      loadNotifications(),
      refreshMessageBadge(),
    ]);
    await loadDiscoverableProfile(username);
    showToast(blocked ? `@${username} unblocked.` : `@${username} blocked.`);
  } catch (error) {
    showToast(error?.message || 'Block state could not be changed.');
    button.disabled = false;
  }
}

async function loadProfileFollowState(profile, owner) {
  const button = byId('profile-follow-button');
  button.hidden = owner || !currentMember || !profile?.id;
  button.disabled = false;
  button.classList.remove('following');
  button.dataset.following = 'false';
  button.dataset.username = profile?.username || '';
  button.textContent = 'Follow';

  if (button.hidden) return;

  const { data, error } = await supabase
    .from('social_follows')
    .select('follower_id')
    .eq('follower_id', currentMemberId)
    .eq('followed_id', profile.id)
    .maybeSingle();

  if (error) {
    button.hidden = true;
    return;
  }

  const following = Boolean(data);
  button.dataset.following = String(following);
  button.classList.toggle('following', following);
  button.textContent = following ? 'Following' : 'Follow';
}

async function toggleProfileFollow() {
  const button = byId('profile-follow-button');
  const username = button.dataset.username;
  if (!username || button.hidden) return;
  const following = button.dataset.following === 'true';
  button.disabled = true;

  try {
    await socialMutation(`/api/social/follow/${encodeURIComponent(username)}`, {
      method: following ? 'DELETE' : 'POST',
    });

    if (currentMember) {
      currentMember.following_count = Math.max(
        0,
        Number(currentMember.following_count || 0) + (following ? -1 : 1),
      );
    }

    await loadDiscoverableProfile(username);
    showToast(following ? 'Unfollowed.' : 'Following.');
  } catch (error) {
    showToast(error?.message || 'Follow state could not be changed.');
    button.disabled = false;
  }
}

function renderProfile(profile, { owner = true } = {}) {
  const displayName = profile.display_name || profile.full_name || profile.username;
  const username = profile.username;
  const bio = String(profile.bio || '').trim();
  const location = String(profile.location || '').trim();
  const website = String(profile.website_url || '').trim();

  renderedProfileOwner = owner;
  renderedProfileUsername = username;
  renderedProfileId = profile.id || '';
  byId('profile-card').hidden = false;
  byId('profile-route-state').hidden = true;
  byId('profile-edit-button').hidden = !owner;
  byId('profile-settings-button').hidden = !owner;
  byId('profile-avatar').textContent = avatarLetter(displayName);
  byId('profile-display-name').textContent = displayName;
  byId('profile-username').textContent = `@${username}`;
  configureProfileVerificationBadge(profile, { owner });
  byId('profile-followers-count').textContent = String(Number(profile.followers_count || 0));
  byId('profile-following-count').textContent = String(Number(profile.following_count || 0));
  byId('profile-visibility').textContent = owner
    ? (profile.is_discoverable ? 'Discoverable' : 'Visible only by direct access')
    : 'Public profile';
  byId('profile-visibility').classList.toggle('private', owner && !profile.is_discoverable);
  byId('profile-bio').textContent = bio || (owner
    ? 'Add a short bio so people understand what your voice is about.'
    : 'This member has not added a bio yet.');
  byId('profile-bio').classList.toggle('empty', !bio);

  const locationNode = byId('profile-location');
  locationNode.hidden = !location;
  locationNode.querySelector('b').textContent = location;

  const websiteNode = byId('profile-website');
  let normalizedWebsite = '';
  if (website) {
    try {
      normalizedWebsite = safeWebsite(website);
    } catch {
      normalizedWebsite = '';
    }
  }
  websiteNode.hidden = !normalizedWebsite;
  websiteNode.href = normalizedWebsite || '#';
  websiteNode.querySelector('b').textContent = normalizedWebsite ? new URL(normalizedWebsite).hostname : '';

  void loadProfileMedia(username, displayName);
  void loadProfileFollowState(profile, owner)
    .then(() => loadProfileSafetyState(profile, owner))
    .catch(() => {
      byId('profile-follow-button').hidden = true;
      byId('profile-mute-button').hidden = true;
      byId('profile-block-button').hidden = true;
    });
}

function syncNotificationBadges(count = 0) {
  notificationUnreadCount = Math.max(0, Number(count) || 0);
  document.querySelectorAll('[data-notification-badge]').forEach((badge) => {
    badge.textContent = notificationUnreadCount > 99 ? '99+' : String(notificationUnreadCount);
    badge.hidden = notificationUnreadCount < 1;
  });
}

async function refreshNotificationBadge() {
  if (!currentMemberId) {
    syncNotificationBadges(0);
    return;
  }

  const { count, error } = await supabase
    .from('social_notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null);

  if (!error) syncNotificationBadges(count || 0);
}

function notificationCopy(notification, actorName, circleName = '') {
  const actor = actorName || 'Someone';
  const circleLabel = circleName ? ` in ${circleName}` : ' in a Sautify';

  if (notification.notification_type === 'circle') {
    const circleCopy = {
      join_request: [actor, circleName ? ` requested to join ${circleName}.` : ' requested to join your Sautify.'],
      request_approved: [actor, circleName ? ` approved your request to join ${circleName}.` : ' approved your Sautify join request.'],
      request_declined: [actor, circleName ? ` declined your request to join ${circleName}.` : ' declined your Sautify join request.'],
      member_removed: [actor, circleName ? ` removed you from ${circleName}.` : ' removed you from a Sautify.'],
    };
    return circleCopy[notification.circle_event] || [actorName ? actor : 'SautiLink', ' sent you a Sautify update.'];
  }

  const copy = {
    follow: [actor, ' followed you.'],
    like: [actor, notification.circle_id ? ` liked your post${circleLabel}.` : ' liked your post.'],
    reply: [actor, notification.circle_id ? ` replied to your post${circleLabel}.` : ' replied to your post.'],
    reshare: [actor, notification.circle_id ? ` reposted your post${circleLabel}.` : ' reposted your post.'],
    safety: ['SautiLink', ' updated a moderation decision affecting your content.'],
  };
  return copy[notification.notification_type] || [actorName ? actor : 'SautiLink', ' sent you an update.'];
}

function renderNotificationItem(notification, actor, circle, post) {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = `notification-item${notification.read_at ? '' : ' unread'}`;
  item.dataset.notificationId = String(notification.id);
  if (post?.id) item.dataset.sautiId = post.id;
  if (circle?.slug) item.dataset.circleSlug = circle.slug;

  const avatar = document.createElement('span');
  avatar.className = 'notification-avatar';
  avatar.setAttribute('aria-hidden', 'true');
  avatar.textContent = avatarLetter(actor?.display_name || actor?.username || 'S');

  const copy = document.createElement('span');
  copy.className = 'notification-copy';

  const message = document.createElement('p');
  const [actorText, actionText] = notificationCopy(
    notification,
    actor ? `@${actor.username}` : '',
    circle?.name || ''
  );
  if (actor) {
    message.append(
      verifiedNameNode(actorText, Boolean(actor.is_verified), actor.verification_badge_type),
      document.createTextNode(actionText),
    );
  } else {
    const strong = document.createElement('strong');
    strong.textContent = actorText;
    message.append(strong, document.createTextNode(actionText));
  }

  const meta = document.createElement('span');
  meta.className = 'notification-meta';
  if (!notification.read_at) {
    const dot = document.createElement('i');
    dot.className = 'notification-unread-dot';
    dot.setAttribute('aria-hidden', 'true');
    meta.append(dot);
  }
  const time = document.createElement('time');
  time.dateTime = notification.created_at || '';
  time.textContent = formatSautiTime(notification.created_at);
  meta.append(time);

  copy.append(message, meta);
  item.append(avatar, copy);
  return item;
}

async function loadNotifications() {
  if (!currentMemberId) return;
  const requestId = ++notificationsRequest;
  const list = byId('notifications-list');
  const loading = byId('notifications-loading');
  const errorState = byId('notifications-error');
  const empty = byId('notifications-empty');
  const markAll = byId('notifications-mark-all');

  loading.hidden = false;
  errorState.hidden = true;
  empty.hidden = true;
  list.replaceChildren();
  markAll.disabled = true;

  const { data, error } = await supabase
    .from('social_notifications')
    .select('id, actor_id, post_id, circle_id, circle_event, notification_type, read_at, created_at')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(50);

  if (requestId !== notificationsRequest) return;
  loading.hidden = true;

  if (error) {
    errorState.hidden = false;
    return;
  }

  const notifications = data || [];
  if (!notifications.length) {
    syncNotificationBadges(0);
    empty.hidden = false;
    return;
  }

  const actorIds = [...new Set(notifications.map((row) => row.actor_id).filter(Boolean))];
  const circleIds = [...new Set(notifications.map((row) => row.circle_id).filter(Boolean))];
  const postIds = [...new Set(notifications.map((row) => row.post_id).filter(Boolean))];
  let actors = [];
  let circles = [];
  let posts = [];

  const [profileResult, circleResult, postResult] = await Promise.all([
    actorIds.length
      ? supabase.from('social_profiles').select('id, username, display_name, is_verified, verification_badge_type').in('id', actorIds)
      : Promise.resolve({ data: [] }),
    circleIds.length
      ? supabase.from('social_circles').select('id, slug, name').in('id', circleIds)
      : Promise.resolve({ data: [] }),
    postIds.length
      ? supabase.from('social_posts').select('id, root_post_id, parent_post_id').in('id', postIds)
      : Promise.resolve({ data: [] }),
  ]);
  actors = profileResult.data || [];
  circles = circleResult.data || [];
  posts = postResult.data || [];

  if (requestId !== notificationsRequest) return;
  const actorMap = new Map(actors.map((actor) => [actor.id, actor]));
  const circleMap = new Map(circles.map((circle) => [circle.id, circle]));
  const postMap = new Map(posts.map((post) => [post.id, post]));
  notifications.forEach((notification) => {
    list.append(renderNotificationItem(
      notification,
      actorMap.get(notification.actor_id),
      circleMap.get(notification.circle_id),
      postMap.get(notification.post_id),
    ));
  });

  const unread = notifications.reduce((total, row) => total + (row.read_at ? 0 : 1), 0);
  syncNotificationBadges(unread);
  markAll.disabled = unread < 1;
}

async function markNotificationRead(id, item) {
  if (!id || item?.classList.contains('unread') === false) return;
  const readAt = new Date().toISOString();
  const { error } = await supabase
    .from('social_notifications')
    .update({ read_at: readAt })
    .eq('id', id)
    .is('read_at', null);

  if (error) {
    showToast('Notification could not be marked as read.');
    return;
  }

  if (item) {
    item.classList.remove('unread');
    item.querySelector('.notification-unread-dot')?.remove();
  }
  syncNotificationBadges(Math.max(0, notificationUnreadCount - 1));
  byId('notifications-mark-all').disabled = notificationUnreadCount < 1;
}

async function markAllNotificationsRead() {
  const button = byId('notifications-mark-all');
  if (notificationUnreadCount < 1) return;
  button.disabled = true;
  const { error } = await supabase
    .from('social_notifications')
    .update({ read_at: new Date().toISOString() })
    .is('read_at', null);

  if (error) {
    button.disabled = false;
    showToast('Notifications could not be marked as read.');
    return;
  }

  syncNotificationBadges(0);
  byId('notifications-list').querySelectorAll('.notification-item.unread').forEach((item) => {
    item.classList.remove('unread');
    item.querySelector('.notification-unread-dot')?.remove();
  });
}



function normalizeDiscoverQuery(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[%_]/g, '')
    .slice(0, 80);
}

function renderDiscoverProfile(profile) {
  const row = document.createElement('article');
  row.className = 'discover-profile-row';

  const displayName = profile.display_name || profile.username || 'SautiLink member';
  const avatar = document.createElement('span');
  avatar.className = 'avatar discover-profile-avatar';
  avatar.setAttribute('aria-hidden', 'true');
  avatar.textContent = avatarLetter(displayName);

  const copy = document.createElement('div');
  copy.className = 'discover-profile-copy';

  const heading = document.createElement('div');
  heading.className = 'discover-profile-heading';
  const name = verifiedNameNode(displayName, Boolean(profile.is_verified), profile.verification_badge_type);
  const handle = document.createElement('span');
  handle.textContent = `@${profile.username}`;
  heading.append(name, handle);

  const bio = document.createElement('p');
  bio.textContent = String(profile.bio || '').trim() || 'Public SautiLink profile.';

  const meta = document.createElement('small');
  const followers = Number(profile.followers_count || 0);
  meta.textContent = profile.muted_by_you
    ? `Muted · ${followers} follower${followers === 1 ? '' : 's'}`
    : `${followers} follower${followers === 1 ? '' : 's'}`;

  copy.append(heading, bio, meta);

  const open = document.createElement('a');
  open.className = 'secondary-action discover-profile-open';
  open.href = memberProfilePath(profile.username);
  open.textContent = 'View profile';

  row.append(avatar, copy, open);
  return row;
}

async function loadDiscover(queryValue = byId('discover-query').value) {
  if (!currentMemberId) return;
  const requestId = ++discoverRequest;
  const query = normalizeDiscoverQuery(queryValue);
  const loading = byId('discover-loading');
  const errorState = byId('discover-error');
  const profileList = byId('discover-profile-list');
  const profileEmpty = byId('discover-profile-empty');
  const postFeed = byId('discover-sauti-feed');
  const postEmpty = byId('discover-sauti-empty');

  byId('discover-query').value = query;
  loading.hidden = false;
  errorState.hidden = true;
  profileEmpty.hidden = true;
  postEmpty.hidden = true;
  profileList.replaceChildren();
  postFeed.replaceChildren();

  try {
    const blockedPromise = supabase
      .from('social_blocks')
      .select('blocked_id')
      .eq('blocker_id', currentMemberId);

    const mutedPromise = supabase
      .from('social_mutes')
      .select('muted_id')
      .eq('muter_id', currentMemberId);

    const profileSelect = 'id, username, display_name, bio, is_verified, verification_badge_type, followers_count, following_count';
    let profilePromise;

    if (query) {
      profilePromise = Promise.all([
        supabase
          .from('social_profiles')
          .select(profileSelect)
          .eq('is_discoverable', true)
          .neq('id', currentMemberId)
          .ilike('username', `%${query}%`)
          .order('followers_count', { ascending: false })
          .limit(12),
        supabase
          .from('social_profiles')
          .select(profileSelect)
          .eq('is_discoverable', true)
          .neq('id', currentMemberId)
          .ilike('display_name', `%${query}%`)
          .order('followers_count', { ascending: false })
          .limit(12),
      ]);
    } else {
      profilePromise = Promise.all([
        supabase
          .from('social_profiles')
          .select(profileSelect)
          .eq('is_discoverable', true)
          .neq('id', currentMemberId)
          .order('followers_count', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(12),
      ]);
    }

    let postQuery = supabase
      .from('social_posts')
      .select('id, author_id, circle_id, visibility, reply_access, quote_post_id, parent_post_id, root_post_id, thread_depth, audience_owner_id, body, created_at, like_count, comment_count, repost_count, author:social_profiles!social_posts_author_id_fkey(username, display_name, is_discoverable, is_verified, verification_badge_type)')
      .eq('visibility', 'public')
      .is('circle_id', null)
      .is('reply_to_post_id', null)
      .order('created_at', { ascending: false })
      .limit(30);

    if (query) postQuery = postQuery.ilike('body', `%${query}%`);

    const [blockedResult, mutedResult, profileResults, postResult] = await Promise.all([
      blockedPromise,
      mutedPromise,
      profilePromise,
      postQuery,
    ]);

    if (requestId !== discoverRequest) return;
    if (blockedResult.error || mutedResult.error || postResult.error || profileResults.some((result) => result.error)) {
      throw blockedResult.error || mutedResult.error || postResult.error || profileResults.find((result) => result.error)?.error;
    }

    const blockedIds = new Set((blockedResult.data || []).map((row) => row.blocked_id));
    const mutedIds = new Set((mutedResult.data || []).map((row) => row.muted_id));
    const profileMap = new Map();
    profileResults.forEach((result) => {
      (result.data || []).forEach((profile) => {
        if (blockedIds.has(profile.id) || profileMap.has(profile.id)) return;
        if (!query && mutedIds.has(profile.id)) return;
        profileMap.set(profile.id, { ...profile, muted_by_you: mutedIds.has(profile.id) });
      });
    });

    [...profileMap.values()].slice(0, 12).forEach((profile) => {
      profileList.append(renderDiscoverProfile(profile));
    });
    profileEmpty.hidden = profileList.childElementCount > 0;

    const hydrated = await hydrateDirectPosts(postResult.data || []);
    if (requestId !== discoverRequest) return;
    hydrated.forEach((item) => {
      const card = createSautiCard(item);
      if (card) postFeed.append(card);
    });
    postEmpty.hidden = postFeed.childElementCount > 0;

    const next = new URL(window.location.href);
    if (/^\/app\/discover\/?$/.test(next.pathname)) {
      if (query) next.searchParams.set('q', query);
      else next.searchParams.delete('q');
      window.history.replaceState({}, '', `${next.pathname}${next.search}`);
    }
  } catch {
    if (requestId !== discoverRequest) return;
    errorState.hidden = false;
    profileList.replaceChildren();
    postFeed.replaceChildren();
  } finally {
    if (requestId === discoverRequest) loading.hidden = true;
  }
}

async function loadSavedSauti() {
  if (!currentMemberId) return;
  const requestId = ++savedRequest;
  const loading = byId('saved-loading');
  const errorState = byId('saved-error');
  const empty = byId('saved-empty');
  const feed = byId('saved-sauti-feed');

  loading.hidden = false;
  errorState.hidden = true;
  empty.hidden = true;
  feed.replaceChildren();

  try {
    const { data: saves, error: saveError } = await supabase
      .from('social_saved_posts')
      .select('post_id, saved_at')
      .eq('user_id', currentMemberId)
      .order('saved_at', { ascending: false })
      .limit(100);

    if (saveError) throw saveError;
    if (requestId !== savedRequest) return;

    const saveRows = saves || [];
    const postIds = saveRows.map((row) => row.post_id);
    if (!postIds.length) {
      empty.hidden = false;
      return;
    }

    const { data: posts, error: postError } = await supabase
      .from('social_posts')
      .select('id, author_id, circle_id, visibility, reply_access, quote_post_id, parent_post_id, root_post_id, thread_depth, audience_owner_id, body, created_at, like_count, comment_count, repost_count, author:social_profiles!social_posts_author_id_fkey(username, display_name, is_discoverable, is_verified, verification_badge_type)')
      .in('id', postIds);

    if (postError) throw postError;
    if (requestId !== savedRequest) return;

    const postMap = new Map((posts || []).map((post) => [post.id, post]));
    const orderedPosts = saveRows
      .map((save) => postMap.get(save.post_id))
      .filter(Boolean);
    const hydrated = await hydrateDirectPosts(orderedPosts);

    if (requestId !== savedRequest) return;
    hydrated.forEach((item) => {
      const card = createSautiCard(item);
      if (card) feed.append(card);
    });
    empty.hidden = feed.childElementCount > 0;
  } catch {
    if (requestId !== savedRequest) return;
    errorState.hidden = false;
    feed.replaceChildren();
  } finally {
    if (requestId === savedRequest) loading.hidden = true;
  }
}

function readSharedSautiTarget(url = window.location.href) {
  try {
    const value = new URL(url).searchParams.get('sauti') || '';
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
      ? value.toLowerCase()
      : '';
  } catch {
    return '';
  }
}

async function loadSharedSautiTarget(postId) {
  if (!currentMemberId || !postId) return;
  const requestId = ++streamRequest;
  streamLoading = true;
  streamHasMore = false;
  streamCursor = null;

  const feed = byId('stream-feed');
  const loading = byId('stream-loading');
  const errorState = byId('stream-error');
  const errorCopy = byId('stream-error-copy');

  byId('sauti-composer').hidden = true;
  byId('stream-welcome').hidden = true;
  byId('stream-empty').hidden = true;
  byId('stream-more').hidden = true;
  errorState.hidden = true;
  feed.replaceChildren();
  loading.hidden = false;

  try {
    const { data: post, error } = await supabase
      .from('social_posts')
      .select('id, author_id, circle_id, visibility, reply_access, quote_post_id, parent_post_id, root_post_id, thread_depth, audience_owner_id, body, created_at, like_count, comment_count, repost_count, author:social_profiles!social_posts_author_id_fkey(username, display_name, is_discoverable, is_verified, verification_badge_type)')
      .eq('id', postId)
      .maybeSingle();

    if (error) throw error;
    if (requestId !== streamRequest) return;

    if (!post) {
      errorCopy.textContent = 'This post is unavailable, private, deleted, or outside your access.';
      errorState.hidden = false;
      return;
    }

    const [item] = await hydrateDirectPosts([post]);
    if (requestId !== streamRequest) return;
    const card = createSautiCard(item);
    if (card) feed.append(card);
  } catch {
    if (requestId !== streamRequest) return;
    errorCopy.textContent = 'This shared post could not be opened.';
    errorState.hidden = false;
  } finally {
    if (requestId === streamRequest) {
      streamLoading = false;
      loading.hidden = true;
    }
  }
}

function readConversationRoute(pathname = window.location.pathname) {
  const match = pathname.match(/^(?:\/post|\/app\/sauti)\/([^/]+)\/?$/);
  if (!match) return null;

  try {
    const postId = decodeURIComponent(match[1]).toLowerCase();
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(postId)
      ? { invalid: false, postId }
      : { invalid: true, postId: '' };
  } catch {
    return { invalid: true, postId: '' };
  }
}

function threadDraftKey(rootId = activeSautiConversation?.rootId || '') {
  return currentMemberId && rootId
    ? `${THREAD_DRAFT_PREFIX}${currentMemberId}:${rootId}`
    : '';
}

function readThreadDraft(rootId) {
  const key = threadDraftKey(rootId);
  if (!key) return null;
  try {
    const value = JSON.parse(window.localStorage.getItem(key) || 'null');
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

function writeThreadDraft(value, rootId = activeSautiConversation?.rootId || '') {
  const key = threadDraftKey(rootId);
  if (!key) return;
  try {
    if (!value) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Thread drafts are optional when device storage is unavailable.
  }
}

function conversationPostById(postId) {
  return activeSautiConversation?.postMap?.get(postId)?.post || null;
}

function conversationAuthorLabel(post) {
  const author = authorFromPost(post) || {};
  return author.username ? `@${author.username}` : author.display_name || '@member';
}

function setConversationReplyTarget(post) {
  if (!activeSautiConversation || !post?.id) return;
  activeSautiConversation.replyTargetId = post.id;
  byId('conversation-reply-target').textContent = conversationAuthorLabel(post);
  byId('conversation-reply-root').hidden = post.id === activeSautiConversation.rootId;
  updateConversationReplyState();
  persistThreadReplyDraft();
}

function ensureThreadReplyRequestId() {
  if (!threadReplyRequestId) threadReplyRequestId = crypto.randomUUID();
  return threadReplyRequestId;
}

function persistThreadReplyDraft() {
  if (!activeSautiConversation?.rootId) return;
  const body = byId('conversation-reply-body').value;
  if (!body.trim()) {
    writeThreadDraft(null);
    return;
  }
  writeThreadDraft({
    body,
    targetId: activeSautiConversation.replyTargetId || activeSautiConversation.rootId,
    clientRequestId: ensureThreadReplyRequestId(),
    savedAt: new Date().toISOString(),
  });
}

function restoreThreadReplyDraft() {
  if (!activeSautiConversation?.rootId) return;
  const draft = readThreadDraft(activeSautiConversation.rootId);
  if (!draft?.body) {
    threadReplyRequestId = '';
    updateConversationReplyState();
    return;
  }

  byId('conversation-reply-body').value = String(draft.body || '').slice(0, 500);
  threadReplyRequestId = /^[0-9a-f-]{36}$/i.test(String(draft.clientRequestId || ''))
    ? String(draft.clientRequestId).toLowerCase()
    : crypto.randomUUID();

  const target = conversationPostById(draft.targetId)
    || conversationPostById(activeSautiConversation.focusId)
    || conversationPostById(activeSautiConversation.rootId);
  if (target) setConversationReplyTarget(target);
  updateConversationReplyState();
}

function updateConversationReplyState() {
  const body = byId('conversation-reply-body');
  const submit = byId('conversation-reply-submit');
  const count = byId('conversation-reply-count');
  const note = byId('conversation-reply-note');
  if (!body || !submit || !count || !note) return;

  const length = body.value.length;
  const hasBody = Boolean(body.value.trim());
  count.textContent = String(length);
  submit.textContent = navigator.onLine ? 'Reply' : 'Save draft';
  submit.disabled = !currentMemberId || !activeSautiConversation?.replyTargetId || !hasBody || length > 500;
  note.textContent = navigator.onLine
    ? 'Your reply follows this conversation\'s audience and privacy.'
    : 'Offline — this reply stays on this device until you send it.';
}

function threadRelevantScore(post) {
  const likes = Number(post.like_count || 0);
  const replies = Number(post.comment_count || 0);
  const ageHours = Math.max(0, (Date.now() - Date.parse(post.created_at || 0)) / 3600000);
  const recency = Math.max(0, 1 - ageHours / 72);
  return (likes * 2) + (replies * 3) + recency;
}

function threadSiblingSort(a, b) {
  const mode = byId('conversation-sort').value || 'relevant';
  if (mode === 'newest') {
    return Date.parse(b.post.created_at || 0) - Date.parse(a.post.created_at || 0);
  }
  const score = threadRelevantScore(b.post) - threadRelevantScore(a.post);
  if (score !== 0) return score;
  return Date.parse(b.post.created_at || 0) - Date.parse(a.post.created_at || 0);
}

function renderThreadContinuation(parentItem, childCount) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'thread-continue';
  button.dataset.openThreadBranch = parentItem.post.id;
  button.textContent = `${childCount} deeper ${childCount === 1 ? 'reply' : 'replies'} · Continue thread`;
  return button;
}

function renderConversationThread() {
  const feed = byId('conversation-thread');
  const empty = byId('conversation-empty');
  const total = byId('conversation-reply-total');
  const heading = byId('conversation-reply-heading');
  feed.replaceChildren();

  if (!activeSautiConversation) {
    empty.hidden = false;
    total.textContent = '0 replies';
    return;
  }

  const { rootId, focusId, replyItems, postMap } = activeSautiConversation;
  total.textContent = `${replyItems.length} ${replyItems.length === 1 ? 'reply' : 'replies'}`;
  heading.textContent = focusId !== rootId ? 'Focused branch' : 'Conversation replies';

  if (!replyItems.length) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  const children = new Map();
  replyItems.forEach((item) => {
    const parentId = item.post.parent_post_id || rootId;
    if (!children.has(parentId)) children.set(parentId, []);
    children.get(parentId).push(item);
  });
  children.forEach((items) => items.sort(threadSiblingSort));

  const appendItem = (item, visualDepth = 0, { orphan = false } = {}) => {
    const card = createSautiCard(item);
    if (!card) return;
    card.classList.add('thread-sauti');
    if (orphan) card.classList.add('thread-orphan');
    if (item.post.id === focusId) card.classList.add('thread-focused');
    card.style.setProperty('--thread-depth', String(Math.min(visualDepth, THREAD_RENDER_DEPTH)));
    card.dataset.threadDepth = String(item.post.thread_depth || 0);
    feed.append(card);

    const childItems = children.get(item.post.id) || [];
    if (!childItems.length) return;
    if (visualDepth >= THREAD_RENDER_DEPTH) {
      feed.append(renderThreadContinuation(item, childItems.length));
      return;
    }
    childItems.forEach((child) => appendItem(child, visualDepth + 1));
  };

  if (focusId !== rootId) {
    const focused = postMap.get(focusId);
    if (focused) appendItem(focused, 0);
  } else {
    (children.get(rootId) || []).forEach((item) => appendItem(item, 0));

    const visibleIds = new Set(replyItems.map((item) => item.post.id));
    replyItems
      .filter((item) => item.post.parent_post_id !== rootId && !visibleIds.has(item.post.parent_post_id))
      .sort(threadSiblingSort)
      .forEach((item) => appendItem(item, 0, { orphan: true }));
  }
}

async function loadConversation(postId) {
  if (!currentMemberId || !postId) return;
  const requestId = ++sautiConversationRequest;
  const loading = byId('conversation-loading');
  const errorState = byId('conversation-error');
  const errorCopy = byId('conversation-error-copy');
  const rootSlot = byId('conversation-root');
  const thread = byId('conversation-thread');

  loading.hidden = false;
  errorState.hidden = true;
  byId('conversation-empty').hidden = true;
  rootSlot.replaceChildren();
  thread.replaceChildren();
  setMessage(byId('conversation-reply-message'), '', '');

  try {
    const { data: target, error: targetError } = await supabase
      .from('social_posts')
      .select(THREAD_POST_SELECT)
      .eq('id', postId)
      .maybeSingle();

    if (targetError) throw targetError;
    if (requestId !== sautiConversationRequest) return;
    if (!target) {
      errorCopy.textContent = 'This post is unavailable, private, deleted, or outside your access.';
      errorState.hidden = false;
      return;
    }

    const rootId = target.root_post_id || target.id;
    let root = target;
    if (target.id !== rootId) {
      const { data: rootRow, error: rootError } = await supabase
        .from('social_posts')
        .select(THREAD_POST_SELECT)
        .eq('id', rootId)
        .maybeSingle();
      if (rootError) throw rootError;
      if (!rootRow) {
        errorCopy.textContent = 'The root post for this conversation is unavailable.';
        errorState.hidden = false;
        return;
      }
      root = rootRow;
    }

    const { data: replies, error: repliesError } = await supabase
      .from('social_posts')
      .select(THREAD_POST_SELECT)
      .eq('root_post_id', rootId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(120);
    if (repliesError) throw repliesError;

    const hydrated = await hydrateDirectPosts([root, ...(replies || [])]);
    if (requestId !== sautiConversationRequest) return;

    const rootItem = hydrated.find((item) => item.post.id === rootId);
    const replyItems = hydrated.filter((item) => item.post.id !== rootId);
    const postMap = new Map(hydrated.map((item) => [item.post.id, item]));

    activeSautiConversation = {
      rootId,
      focusId: target.id,
      replyTargetId: target.id,
      rootItem,
      replyItems,
      postMap,
    };

    const rootCard = createSautiCard(rootItem);
    if (rootCard) {
      rootCard.classList.add('conversation-root-card');
      rootSlot.append(rootCard);
    }

    renderConversationThread();
    const defaultTarget = postMap.get(target.id)?.post || rootItem.post;
    setConversationReplyTarget(defaultTarget);
    restoreThreadReplyDraft();

    window.setTimeout(() => {
      const focused = byId('conversation-thread').querySelector('.thread-focused');
      if (focused && target.id !== rootId) focused.scrollIntoView({ block: 'center' });
    }, 0);
  } catch {
    if (requestId !== sautiConversationRequest) return;
    activeSautiConversation = null;
    errorCopy.textContent = 'This conversation could not be opened.';
    errorState.hidden = false;
  } finally {
    if (requestId === sautiConversationRequest) loading.hidden = true;
  }
}

async function submitThreadReply() {
  if (!activeSautiConversation?.replyTargetId || !currentMemberId) return;
  const textarea = byId('conversation-reply-body');
  const submit = byId('conversation-reply-submit');
  const message = byId('conversation-reply-message');
  const body = textarea.value.trim();
  setMessage(message, '', '');

  if (!body) return;
  if (textarea.value.length > 500) return setMessage(message, 'Replies must be 500 characters or fewer.');

  ensureThreadReplyRequestId();
  persistThreadReplyDraft();

  if (!navigator.onLine) {
    setMessage(message, 'Reply saved on this device. Send it when you are back online.', 'success');
    updateConversationReplyState();
    return;
  }

  submit.disabled = true;
  submit.setAttribute('aria-busy', 'true');
  const previous = submit.textContent;
  submit.textContent = 'Replying…';

  try {
    const payload = await socialMutation(
      `/api/social/posts/${activeSautiConversation.replyTargetId}/replies`,
      {
        method: 'POST',
        body: {
          body,
          client_request_id: threadReplyRequestId,
        },
      },
    );

    const reply = payload?.reply || null;
    textarea.value = '';
    writeThreadDraft(null);
    threadReplyRequestId = '';
    if (reply?.id) {
      window.history.replaceState({}, '', conversationPath(reply.id));
      await loadConversation(reply.id);
    } else {
      await loadConversation(activeSautiConversation.rootId);
    }
    showToast('Reply shared.');
  } catch (error) {
    setMessage(message, error?.message || 'This reply could not be shared.');
  } finally {
    submit.textContent = previous;
    submit.removeAttribute('aria-busy');
    updateConversationReplyState();
  }
}

function messagePath(conversationId = '') {
  return conversationId
    ? `/messages/${encodeURIComponent(conversationId)}`
    : '/messages';
}

function readMessageRoute(pathname = window.location.pathname) {
  const match = pathname.match(/^(?:\/app)?\/messages(?:\/([^/]+))?\/?$/);
  if (!match) return null;
  if (!match[1]) return { invalid: false, conversationId: '' };

  try {
    const conversationId = decodeURIComponent(match[1]).toLowerCase();
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(conversationId)
      ? { invalid: false, conversationId }
      : { invalid: true, conversationId: '' };
  } catch {
    return { invalid: true, conversationId: '' };
  }
}

function syncMessageBadges(count = 0) {
  messageUnreadCount = Math.max(0, Number(count) || 0);
  document.querySelectorAll('[data-message-badge]').forEach((badge) => {
    badge.textContent = messageUnreadCount > 99 ? '99+' : String(messageUnreadCount);
    badge.hidden = messageUnreadCount < 1;
  });
}

async function getDmInboxRows() {
  const [inboxResult, muteResult] = await Promise.all([
    supabase.rpc('dm_inbox_phase23'),
    supabase
      .from('social_mutes')
      .select('muted_id')
      .eq('muter_id', currentMemberId),
  ]);
  if (inboxResult.error) throw inboxResult.error;
  if (muteResult.error) throw muteResult.error;

  const mutedIds = new Set((muteResult.data || []).map((row) => row.muted_id));
  return (Array.isArray(inboxResult.data) ? inboxResult.data : []).map((row) => {
    const muted = mutedIds.has(row.peer_id);
    return {
      ...row,
      muted_by_you: muted,
      effective_unread_count: muted ? 0 : Number(row.unread_count || 0),
    };
  });
}

async function refreshMessageBadge() {
  if (!currentMemberId) {
    syncMessageBadges(0);
    return;
  }

  try {
    const rows = await getDmInboxRows();
    const unread = rows.reduce((sum, row) => sum + Number(row.effective_unread_count || 0), 0);
    syncMessageBadges(messageBadgesEnabled() ? unread : 0);
  } catch {
    // Keep the last known badge if the inbox read model is temporarily unavailable.
  }
}

function filterMessageInbox() {
  const query = String(byId('messages-search').value || '').trim().toLowerCase();
  byId('messages-inbox-list').querySelectorAll('[data-message-search]').forEach((item) => {
    item.hidden = Boolean(query) && !item.dataset.messageSearch.includes(query);
  });
}

function renderMessageInboxItem(row, peer) {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = `message-inbox-item${Number(row.effective_unread_count || 0) > 0 ? ' unread' : ''}${row.muted_by_you ? ' muted' : ''}`;
  item.dataset.conversationId = row.conversation_id;

  const displayName = peer?.display_name || peer?.username || 'SautiLink member';
  const username = peer?.username ? `@${peer.username}` : 'Private conversation';
  item.dataset.messageSearch = `${displayName} ${username}`.toLowerCase();

  const avatar = document.createElement('span');
  avatar.className = 'avatar message-inbox-avatar';
  avatar.setAttribute('aria-hidden', 'true');
  avatar.textContent = avatarLetter(displayName);

  const copy = document.createElement('span');
  copy.className = 'message-inbox-copy';

  const top = document.createElement('span');
  top.className = 'message-inbox-top';
  const name = verifiedNameNode(
    displayName,
    Boolean(peer?.is_verified),
    peer?.verification_badge_type,
  );
  const handle = document.createElement('small');
  handle.textContent = row.muted_by_you ? `${username} · Muted` : username;
  top.append(name, handle);

  const preview = document.createElement('span');
  preview.className = 'message-inbox-preview';
  preview.textContent = row.latest_body || 'New conversation';

  copy.append(top, preview);

  const meta = document.createElement('span');
  meta.className = 'message-inbox-meta';
  const time = document.createElement('time');
  const timeValue = row.latest_sent_at || row.last_message_at;
  time.dateTime = timeValue || '';
  time.textContent = formatSautiTime(timeValue);
  meta.append(time);

  const unread = Number(row.effective_unread_count || 0);
  if (unread > 0) {
    const badge = document.createElement('b');
    badge.textContent = unread > 99 ? '99+' : String(unread);
    meta.append(badge);
  }

  item.append(avatar, copy, meta);
  return item;
}

async function loadMessagesInbox() {
  if (!currentMemberId) return;
  await stopDmConversationRealtime();
  const requestId = ++messagesRequest;
  activeConversation = null;

  const loading = byId('messages-loading');
  const errorState = byId('messages-error');
  const inbox = byId('messages-inbox');
  const list = byId('messages-inbox-list');
  const empty = byId('messages-empty');

  byId('message-thread').hidden = true;
  inbox.hidden = false;
  loading.hidden = false;
  errorState.hidden = true;
  empty.hidden = true;
  list.replaceChildren();
  setMessage(byId('message-new-message'), '', '');

  try {
    const rows = await getDmInboxRows();
    if (requestId !== messagesRequest) return;

    const peerIds = [...new Set(rows.map((row) => row.peer_id).filter(Boolean))];
    let profiles = [];
    if (peerIds.length) {
      const { data } = await supabase
        .from('social_profiles')
        .select('id, username, display_name, is_verified, verification_badge_type')
        .in('id', peerIds);
      profiles = data || [];
    }

    if (requestId !== messagesRequest) return;
    const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
    rows.forEach((row) => list.append(renderMessageInboxItem(row, profileMap.get(row.peer_id))));

    empty.hidden = rows.length > 0;
    const unread = rows.reduce((sum, row) => sum + Number(row.effective_unread_count || 0), 0);
    syncMessageBadges(messageBadgesEnabled() ? unread : 0);
    filterMessageInbox();
  } catch {
    if (requestId !== messagesRequest) return;
    errorState.hidden = false;
  } finally {
    if (requestId === messagesRequest) loading.hidden = true;
  }
}

function renderDirectMessage(message) {
  const own = message.sender_id === currentMemberId;
  const deleted = Boolean(message.deleted_at);
  const row = document.createElement('article');
  row.className = `dm-message ${own ? 'own' : 'incoming'}${deleted ? ' deleted' : ''}`;
  row.dataset.messageId = String(message.id);
  row.dataset.sentAt = String(message.sent_at || '');
  row.dataset.ownMessage = String(own);

  const body = document.createElement('p');
  body.textContent = deleted ? 'Message deleted.' : String(message.body || '');

  const meta = document.createElement('span');
  meta.className = 'dm-message-meta';
  const time = document.createElement('time');
  time.dateTime = message.sent_at || '';
  time.textContent = formatSautiTime(message.sent_at);
  meta.append(time);

  if (!deleted) {
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'dm-message-action';
    if (own) {
      action.dataset.deleteDmMessage = String(message.id);
      action.textContent = 'Delete';
    } else {
      action.dataset.reportDmMessage = String(message.id);
      action.textContent = 'Report';
    }
    meta.append(action);
  }

  row.append(body, meta);
  return row;
}

async function renderPeerReadReceipt(conversationId, messages = []) {
  const lastOwn = [...messages].reverse().find((message) => (
    message.sender_id === currentMemberId && !message.deleted_at
  ));
  if (!lastOwn) return;

  try {
    const { data, error } = await supabase.rpc('dm_peer_read_state_phase30', {
      p_conversation_id: conversationId,
    });
    if (error) return;
    const peerReadAt = Array.isArray(data) ? data[0]?.peer_last_read_at : data?.peer_last_read_at;
    if (!peerReadAt || new Date(peerReadAt).getTime() < new Date(lastOwn.sent_at).getTime()) return;

    const row = byId('message-thread-feed').querySelector(`[data-message-id="${CSS.escape(String(lastOwn.id))}"]`);
    const meta = row?.querySelector('.dm-message-meta');
    if (!meta || meta.querySelector('.dm-read-receipt')) return;
    const seen = document.createElement('span');
    seen.className = 'dm-read-receipt';
    seen.textContent = 'Seen';
    meta.append(seen);
  } catch {
    // Read receipts are privacy-gated and non-critical.
  }
}

function updateMessageComposerState() {
  const textarea = byId('message-body');
  const submit = byId('message-send');
  const count = byId('message-body-count');
  const length = textarea.value.length;
  count.textContent = String(length);

  const unavailable = !activeConversation
    || activeConversation.blockedByYou
    || textarea.disabled
    || !textarea.value.trim()
    || length > 4000;
  submit.disabled = unavailable;
}

async function syncMessageThreadSafety(peer) {
  const muteButton = byId('message-thread-mute');
  const blockButton = byId('message-thread-block');
  const note = byId('message-delivery-note');
  const hasPeer = Boolean(peer?.username);

  for (const button of [muteButton, blockButton]) {
    button.hidden = !hasPeer;
    button.disabled = false;
    button.dataset.username = peer?.username || '';
  }
  muteButton.dataset.muted = 'false';
  muteButton.textContent = 'Mute';
  blockButton.dataset.blocked = 'false';
  blockButton.textContent = 'Block';

  if (!hasPeer) {
    note.textContent = 'Messaging may be unavailable if either account blocks the other.';
    return;
  }

  const [blockResult, muteResult] = await Promise.allSettled([
    safetyRequest(`/api/safety/block/${encodeURIComponent(peer.username)}`),
    safetyRequest(`/api/safety/mute/${encodeURIComponent(peer.username)}`),
  ]);

  const blocked = blockResult.status === 'fulfilled'
    ? Boolean(blockResult.value.blocked_by_you)
    : false;
  const muted = muteResult.status === 'fulfilled'
    ? Boolean(muteResult.value.muted_by_you)
    : false;

  activeConversation.blockedByYou = blocked;
  activeConversation.mutedByYou = muted;

  if (blockResult.status === 'fulfilled') {
    blockButton.dataset.blocked = String(blocked);
    blockButton.textContent = blocked ? 'Unblock' : 'Block';
  } else {
    blockButton.hidden = true;
  }

  if (blocked) {
    muteButton.hidden = true;
  } else if (muteResult.status === 'fulfilled') {
    muteButton.dataset.muted = String(muted);
    muteButton.textContent = muted ? 'Unmute' : 'Mute';
  } else {
    muteButton.hidden = true;
  }

  byId('message-body').disabled = blocked;
  note.textContent = blocked
    ? 'You blocked this account. Existing history remains visible, but new messages are disabled.'
    : muted
      ? 'Muted. Messages still arrive, but this conversation does not add to your unread badge.'
      : 'Only this conversation can read these messages. Blocking either account stops new delivery.';
  updateMessageComposerState();
}

async function markActiveConversationRead() {
  if (!activeConversation?.id || !currentMemberId) return;
  const { error } = await supabase
    .from('dm_conversation_states')
    .update({ last_read_at: new Date().toISOString(), hidden_at: null })
    .eq('conversation_id', activeConversation.id)
    .eq('user_id', currentMemberId);
  if (!error) void refreshMessageBadge();
}

async function loadMessageThread(conversationId) {
  if (!currentMemberId || !conversationId) return;
  if (dmConversationRealtimeId && dmConversationRealtimeId !== conversationId) {
    await stopDmConversationRealtime();
  }
  const requestId = ++messagesRequest;
  const thread = byId('message-thread');
  const inbox = byId('messages-inbox');
  const loading = byId('message-thread-loading');
  const errorState = byId('message-thread-error');
  const feed = byId('message-thread-feed');
  const empty = byId('message-thread-empty');

  inbox.hidden = true;
  thread.hidden = false;
  loading.hidden = false;
  errorState.hidden = true;
  empty.hidden = true;
  feed.replaceChildren();
  byId('message-body').value = '';
  byId('message-body').disabled = true;
  setMessage(byId('message-composer-message'), '', '');
  updateMessageComposerState();

  const { data: conversation, error: conversationError } = await supabase
    .from('dm_conversations')
    .select('id, member_one_id, member_two_id, created_by, created_at, last_message_at')
    .eq('id', conversationId)
    .maybeSingle();

  if (requestId !== messagesRequest) return;
  if (conversationError || !conversation) {
    loading.hidden = true;
    errorState.hidden = false;
    activeConversation = null;
    return;
  }

  const peerId = conversation.member_one_id === currentMemberId
    ? conversation.member_two_id
    : conversation.member_one_id;

  const [profileResult, messageResult] = await Promise.all([
    supabase
      .from('social_profiles')
      .select('id, username, display_name, is_verified, verification_badge_type')
      .eq('id', peerId)
      .maybeSingle(),
    supabase
      .from('dm_messages')
      .select('id, conversation_id, sender_id, body, sent_at, deleted_at')
      .eq('conversation_id', conversation.id)
      .order('sent_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(200),
  ]);

  if (requestId !== messagesRequest) return;
  loading.hidden = true;

  if (messageResult.error) {
    errorState.hidden = false;
    activeConversation = null;
    return;
  }

  const peer = profileResult.data || null;
  const displayName = peer?.display_name || peer?.username || 'SautiLink member';
  activeConversation = {
    id: conversation.id,
    peerId,
    peer,
    blockedByYou: false,
    mutedByYou: false,
  };

  byId('message-thread-avatar').textContent = avatarLetter(displayName);
  const threadName = byId('message-thread-name');
  threadName.replaceChildren(document.createTextNode(displayName));
  threadName.classList.toggle('verified', Boolean(peer?.is_verified));
  if (peer?.is_verified) {
    threadName.append(createVerificationBadge(
      normalizeVerificationBadgeType(peer.verification_badge_type) === 'team'
        ? 'Verified SautiLink Team account'
        : 'Verified account',
      peer.verification_badge_type,
    ));
  }
  byId('message-thread-username').textContent = peer?.username ? `@${peer.username}` : 'Private conversation';

  const messages = messageResult.data || [];
  messages.forEach((message) => feed.append(renderDirectMessage(message)));
  empty.hidden = messages.length > 0;

  byId('message-body').disabled = false;
  updateMessageComposerState();
  await markActiveConversationRead();
  await renderPeerReadReceipt(conversation.id, messages);
  await syncMessageThreadSafety(peer);
  void startDmConversationRealtime(conversation.id);

  window.setTimeout(() => {
    feed.scrollTop = feed.scrollHeight;
  }, 0);
}

async function openDirectConversation(peerId, username = '') {
  if (!currentMemberId || !peerId || peerId === currentMemberId) return;

  try {
    const { data, error } = await supabase.rpc('open_dm_conversation_phase23', {
      p_peer_id: peerId,
    });
    if (error || !data) throw error || new Error('DM_CONVERSATION_UNAVAILABLE');

    const path = messagePath(data);
    if (window.location.pathname !== path) window.history.pushState({}, '', path);
    setMemberNavigation('messages');
    await loadMessageThread(data);
  } catch (error) {
    const provider = String(error?.message || '');
    const message = provider.includes('DM_PEER_UNAVAILABLE')
      ? `@${username || 'member'} is unavailable for a new conversation.`
      : provider.includes('DM_RECIPIENT_RESTRICTED')
        ? 'This member’s message privacy settings do not allow this conversation.'
        : provider.includes('42501') || provider.includes('DM_BLOCKED') || provider.includes('DM_CONVERSATION_UNAVAILABLE')
          ? 'Messaging is unavailable between these accounts.'
          : 'This conversation could not be opened.';
    showToast(message);
  }
}

async function startDirectMessageByUsername(usernameValue) {
  const username = normalizeUsername(usernameValue);
  const message = byId('message-new-message');
  setMessage(message, '', '');

  if (usernameError(username)) {
    setMessage(message, 'Enter a valid SautiLink username.');
    return;
  }
  if (username === currentMember?.username) {
    setMessage(message, 'You cannot start a conversation with yourself.');
    return;
  }

  const { data: peer, error } = await supabase
    .from('social_profiles')
    .select('id, username, display_name')
    .eq('username', username)
    .eq('is_discoverable', true)
    .maybeSingle();

  if (error || !peer) {
    setMessage(message, 'That discoverable SautiLink member could not be found.');
    return;
  }

  await openDirectConversation(peer.id, peer.username);
}

async function sendDirectMessage() {
  if (!activeConversation?.id || !currentMemberId) return;
  const textarea = byId('message-body');
  const submit = byId('message-send');
  const message = byId('message-composer-message');
  const body = textarea.value.trim();
  setMessage(message, '', '');

  if (!body) return;
  if (body.length > 4000) return setMessage(message, 'Keep messages within 4,000 characters.');

  submit.disabled = true;
  submit.setAttribute('aria-busy', 'true');
  const previous = submit.textContent;
  submit.textContent = 'Sending…';

  try {
    const { error } = await supabase
      .from('dm_messages')
      .insert({
        conversation_id: activeConversation.id,
        sender_id: currentMemberId,
        body,
      });

    if (error) throw error;
    textarea.value = '';
    updateMessageComposerState();
    await broadcastDmTyping(false);
    await syncActiveMessageThreadRealtime({ markRead: false });
    showToast('Message sent.');
  } catch (error) {
    const provider = String(error?.message || '');
    const copy = provider.includes('DM_RATE_LIMITED')
      ? 'You are sending messages too quickly. Try again shortly.'
      : provider.includes('DM_RECIPIENT_RESTRICTED')
        ? 'This member’s message privacy settings do not currently allow delivery.'
        : provider.includes('DM_BLOCKED') || String(error?.code || '') === '42501'
          ? 'Messaging is unavailable between these accounts.'
          : 'Your message could not be sent.';
    setMessage(message, copy);
  } finally {
    submit.textContent = previous;
    submit.removeAttribute('aria-busy');
    updateMessageComposerState();
  }
}

async function deleteDirectMessage(messageId, button) {
  if (!activeConversation?.id || !messageId) return;
  if (!window.confirm('Delete this message for both people? This cannot be undone.')) return;

  button.disabled = true;
  const { error } = await supabase
    .from('dm_messages')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', messageId)
    .eq('sender_id', currentMemberId);

  if (error) {
    button.disabled = false;
    showToast('This message could not be deleted.');
    return;
  }

  await syncActiveMessageThreadRealtime({ markRead: false });
  showToast('Message deleted.');
}

async function hideActiveConversation() {
  if (!activeConversation?.id || !currentMemberId) return;
  if (!window.confirm('Delete this conversation from your inbox? This only hides it for you. A new message will make it appear again.')) return;

  const { error } = await supabase
    .from('dm_conversation_states')
    .update({ hidden_at: new Date().toISOString() })
    .eq('conversation_id', activeConversation.id)
    .eq('user_id', currentMemberId);

  if (error) {
    showToast('This conversation could not be removed from your inbox.');
    return;
  }

  activeConversation = null;
  window.history.pushState({}, '', messagePath());
  await loadMessagesInbox();
  showToast('Conversation removed from your inbox.');
}

async function toggleMessageThreadMute() {
  if (!activeConversation?.peer?.username) return;
  const button = byId('message-thread-mute');
  const username = activeConversation.peer.username;
  const muted = button.dataset.muted === 'true';

  if (!muted && !window.confirm(`Mute @${username}? Messages will still arrive, but this conversation will not add to your unread badge and their public activity will be hidden from your feeds.`)) return;

  button.disabled = true;
  try {
    await safetyRequest(`/api/safety/mute/${encodeURIComponent(username)}`, {
      method: muted ? 'DELETE' : 'POST',
    });
    await Promise.all([
      syncMessageThreadSafety(activeConversation.peer),
      refreshMessageBadge(),
      refreshNotificationBadge(),
      loadStream({ reset: true }),
    ]);
    showToast(muted ? `@${username} unmuted.` : `@${username} muted.`);
  } catch (error) {
    button.disabled = false;
    showToast(error?.message || 'Mute state could not be changed.');
  }
}

async function toggleMessageThreadBlock() {
  if (!activeConversation?.peer?.username) return;
  const button = byId('message-thread-block');
  const username = activeConversation.peer.username;
  const blocked = button.dataset.blocked === 'true';

  if (!blocked && !window.confirm(`Block @${username}? Existing message history stays visible, but new messages between you will stop.`)) return;

  button.disabled = true;
  try {
    await safetyRequest(`/api/safety/block/${encodeURIComponent(username)}`, {
      method: blocked ? 'DELETE' : 'POST',
    });
    await Promise.all([
      syncMessageThreadSafety(activeConversation.peer),
      refreshMessageBadge(),
      refreshNotificationBadge(),
      loadStream({ reset: true }),
    ]);
    showToast(blocked ? `@${username} unblocked.` : `@${username} blocked.`);
  } catch (error) {
    button.disabled = false;
    showToast(error?.message || 'Block state could not be changed.');
  }
}


function normalizeCircleSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .slice(0, 50);
}

function circleSlugError(value) {
  const slug = normalizeCircleSlug(value);
  if (slug.length < 3) return 'Use at least 3 characters for the Sautify address.';
  if (!/^[a-z0-9][a-z0-9-]{2,49}$/.test(slug)) return 'Use lowercase letters, numbers and hyphens only.';
  return '';
}

function circlePolicyLabel(policy) {
  return policy === 'approval' ? 'Approval' : policy === 'private' ? 'Private' : 'Open';
}

function circlePath(slug = '') {
  return slug ? `/sautify/${encodeURIComponent(slug)}` : '/sautify';
}

function readCircleRoute(pathname = window.location.pathname) {
  const match = pathname.match(/^(?:\/sautify|\/app\/(?:sautify|circles))(?:\/([^/]+))?\/?$/);
  if (!match) return null;
  if (!match[1]) return { invalid: false, slug: '' };

  try {
    const slug = decodeURIComponent(match[1]).toLowerCase();
    return /^[a-z0-9][a-z0-9-]{2,49}$/.test(slug)
      ? { invalid: false, slug }
      : { invalid: true, slug: '' };
  } catch {
    return { invalid: true, slug: '' };
  }
}

function setCircleCreateOpen(open) {
  const panel = byId('circle-create-panel');
  panel.hidden = !open;
  setMessage(byId('circle-create-message'), '', '');
  if (open) {
    byId('circle-create-form').reset();
    byId('circle-name').focus();
  }
}

function resetCircleRouteViews() {
  byId('circles-loading').hidden = true;
  byId('circles-error').hidden = true;
  byId('circles-list').hidden = true;
  byId('circles-empty').hidden = true;
  byId('circle-detail').hidden = true;
  byId('circle-route-state').hidden = true;
}

function showCircleRouteState(type, slug = '') {
  resetCircleRouteViews();
  const state = byId('circle-route-state');
  state.hidden = false;
  state.dataset.state = type;
  const safeSlug = slug ? `/app/sautify/${slug}` : 'This Sautify';
  const copy = {
    loading: ['Opening Sautify…', `Looking up ${safeSlug}.`],
    unavailable: ['Sautify unavailable', `${safeSlug} does not exist, is private, or is unavailable to your account.`],
    error: ['Sautify could not be opened', 'Something went wrong while loading this Sautify. Try again.'],
  };
  const [title, message] = copy[type] || copy.error;
  byId('circle-route-title').textContent = title;
  byId('circle-route-message').textContent = message;
}

function renderCircleCard(circle, membershipMap, requestMap) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'circle-card';
  button.dataset.circleSlug = circle.slug;

  const main = document.createElement('span');
  main.className = 'circle-card-main';

  const top = document.createElement('span');
  top.className = 'circle-card-top';
  const name = document.createElement('h3');
  name.textContent = circle.name;
  const slug = document.createElement('span');
  slug.className = 'circle-card-slug';
  slug.textContent = `/sautify/${circle.slug}`;
  const policy = document.createElement('span');
  policy.className = `circle-policy-badge ${circle.join_policy}`;
  policy.textContent = circlePolicyLabel(circle.join_policy);
  top.append(name, slug, policy);

  const description = document.createElement('p');
  description.className = 'circle-card-description';
  description.textContent = circle.description || 'No description yet.';

  const meta = document.createElement('span');
  meta.className = 'circle-card-meta';
  const owner = document.createElement('span');
  owner.textContent = circle.owner_id === currentMemberId ? 'You own this Sautify' : 'SautiLink Sautify';
  const created = document.createElement('span');
  created.textContent = circle.created_at ? `Created ${formatSautiTime(circle.created_at)} ago` : '';
  meta.append(owner, created);
  main.append(top, description, meta);

  const state = document.createElement('span');
  state.className = 'circle-card-state';
  const membership = membershipMap.get(circle.id);
  const request = requestMap.get(circle.id);
  if (circle.owner_id === currentMemberId) state.textContent = 'Owner';
  else if (membership) state.textContent = 'Joined';
  else if (request?.status === 'pending') state.textContent = 'Requested';
  else if (request?.status === 'declined') state.textContent = 'Request again';
  else state.textContent = circle.join_policy === 'open' ? 'Open to join' : 'View Sautify';

  button.append(main, state);
  return button;
}

async function loadCircles() {
  if (!currentMemberId) return;
  const requestId = ++circlesRequest;
  activeCircle = null;
  resetCircleStreamView({ hide: true });
  resetCircleRouteViews();
  byId('circles-loading').hidden = false;
  byId('circles-list').replaceChildren();

  const [circleResult, membershipResult, requestResult] = await Promise.all([
    supabase
      .from('social_circles')
      .select('id, owner_id, slug, name, description, join_policy, created_at')
      .order('created_at', { ascending: false })
      .limit(60),
    supabase
      .from('social_circle_members')
      .select('circle_id, member_role')
      .eq('member_id', currentMemberId),
    supabase
      .from('social_circle_join_requests')
      .select('circle_id, status, created_at, decided_at')
      .eq('requester_id', currentMemberId),
  ]);

  if (requestId !== circlesRequest) return;
  byId('circles-loading').hidden = true;

  if (circleResult.error || membershipResult.error || requestResult.error) {
    byId('circles-error').hidden = false;
    return;
  }

  const circles = circleResult.data || [];
  if (!circles.length) {
    byId('circles-empty').hidden = false;
    return;
  }

  const membershipMap = new Map((membershipResult.data || []).map((row) => [row.circle_id, row]));
  const requestMap = new Map((requestResult.data || []).map((row) => [row.circle_id, row]));
  const list = byId('circles-list');
  circles.forEach((circle) => list.append(renderCircleCard(circle, membershipMap, requestMap)));
  list.hidden = false;
}

function syncCirclePrimaryAction(circle, membership, request) {
  const button = byId('circle-primary-action');
  const label = button.querySelector('span');
  button.className = 'form-submit circle-primary-action';
  button.disabled = false;
  button.dataset.action = '';

  if (circle.owner_id === currentMemberId) {
    button.classList.add('owner');
    button.disabled = true;
    label.textContent = 'You own this Sautify';
    return;
  }

  if (membership) {
    button.classList.add('leave');
    button.dataset.action = 'leave';
    label.textContent = 'Leave Sautify';
    return;
  }

  if (circle.join_policy === 'open') {
    button.dataset.action = 'join';
    label.textContent = 'Join Sautify';
    return;
  }

  if (circle.join_policy === 'approval') {
    if (request?.status === 'pending') {
      button.disabled = true;
      label.textContent = 'Request sent';
    } else {
      button.dataset.action = 'request';
      label.textContent = request?.status === 'declined' ? 'Request again' : 'Request to join';
    }
    return;
  }

  button.disabled = true;
  label.textContent = 'Private Sautify';
}

async function loadCircleOwnerName(ownerId) {
  if (!ownerId) return '';
  const { data } = await supabase
    .from('social_profiles')
    .select('username, display_name')
    .eq('id', ownerId)
    .maybeSingle();
  return data?.username ? `@${data.username}` : data?.display_name || '';
}

async function loadCircleRequests(circleId) {
  const section = byId('circle-requests');
  const list = byId('circle-requests-list');
  const empty = byId('circle-requests-empty');
  list.replaceChildren();
  empty.hidden = true;

  const { data, error } = await supabase
    .from('social_circle_join_requests')
    .select('requester_id, status, created_at')
    .eq('circle_id', circleId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  if (error) {
    section.hidden = false;
    empty.textContent = 'Pending requests could not load.';
    empty.hidden = false;
    byId('circle-request-count').textContent = '0';
    return;
  }

  const requests = data || [];
  byId('circle-request-count').textContent = String(requests.length);
  section.hidden = false;
  if (!requests.length) {
    empty.textContent = 'No pending requests.';
    empty.hidden = false;
    return;
  }

  const ids = requests.map((row) => row.requester_id);
  let profiles = [];
  const { data: profileRows } = await supabase
    .from('social_profiles')
    .select('id, username, display_name')
    .in('id', ids);
  profiles = profileRows || [];
  const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));

  requests.forEach((request) => {
    const profile = profileMap.get(request.requester_id);
    const row = document.createElement('div');
    row.className = 'circle-request-row';
    row.dataset.requesterId = request.requester_id;

    const person = document.createElement('span');
    person.className = 'circle-request-person';
    const strong = document.createElement('strong');
    strong.textContent = profile?.display_name || profile?.username || 'SautiLink member';
    const small = document.createElement('small');
    small.textContent = profile?.username ? `@${profile.username}` : `Requested ${formatSautiTime(request.created_at)} ago`;
    person.append(strong, small);

    const actions = document.createElement('span');
    actions.className = 'circle-request-actions';
    const approve = document.createElement('button');
    approve.type = 'button';
    approve.className = 'circle-request-approve';
    approve.dataset.circleRequestAction = 'approved';
    approve.textContent = 'Approve';
    const decline = document.createElement('button');
    decline.type = 'button';
    decline.className = 'circle-request-decline';
    decline.dataset.circleRequestAction = 'declined';
    decline.textContent = 'Decline';
    actions.append(approve, decline);
    row.append(person, actions);
    list.append(row);
  });
}



async function loadCircleMembers(circleId) {
  const section = byId('circle-members');
  const list = byId('circle-members-list');
  const empty = byId('circle-members-empty');
  list.replaceChildren();
  empty.hidden = true;

  if (!activeCircle?.circle || activeCircle.circle.id !== circleId || activeCircle.circle.owner_id !== currentMemberId) {
    section.hidden = true;
    return;
  }

  const { data, error } = await supabase
    .from('social_circle_members')
    .select('circle_id, member_id, member_role, joined_at')
    .eq('circle_id', circleId)
    .order('joined_at', { ascending: true });

  if (error) {
    section.hidden = false;
    byId('circle-member-count').textContent = '0';
    empty.textContent = 'Members could not load.';
    empty.hidden = false;
    return;
  }

  const members = data || [];
  byId('circle-member-count').textContent = String(members.length);
  section.hidden = false;

  if (!members.length) {
    empty.textContent = 'No members to show.';
    empty.hidden = false;
    return;
  }

  const ids = members.map((row) => row.member_id);
  const { data: profileRows } = await supabase
    .from('social_profiles')
    .select('id, username, display_name')
    .in('id', ids);
  const profileMap = new Map((profileRows || []).map((profile) => [profile.id, profile]));

  members.forEach((membership) => {
    const profile = profileMap.get(membership.member_id);
    const row = document.createElement('div');
    row.className = 'circle-member-row';
    row.dataset.memberId = membership.member_id;

    const person = document.createElement('span');
    person.className = 'circle-member-person';
    const strong = document.createElement('strong');
    strong.textContent = profile?.display_name || profile?.username || 'SautiLink member';
    const small = document.createElement('small');
    small.textContent = profile?.username
      ? `@${profile.username}`
      : membership.member_role === 'owner' ? 'Sautify owner' : 'Sautify member';
    person.append(strong, small);

    const role = document.createElement('span');
    role.className = `circle-member-role ${membership.member_role}`;
    role.textContent = membership.member_role === 'owner' ? 'Owner' : 'Member';

    row.append(person, role);

    if (membership.member_role !== 'owner') {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'circle-member-remove';
      remove.dataset.circleMemberRemove = membership.member_id;
      remove.textContent = 'Remove';
      row.append(remove);
    }

    list.append(row);
  });
}

async function removeCircleMember(memberId, row) {
  if (!activeCircle?.circle || activeCircle.circle.owner_id !== currentMemberId || !memberId) return;
  if (!window.confirm('Remove this member from the Sautify?')) return;

  const button = row.querySelector('[data-circle-member-remove]');
  if (button) {
    button.disabled = true;
    button.textContent = 'Removing…';
  }

  const { error } = await supabase
    .from('social_circle_members')
    .delete()
    .eq('circle_id', activeCircle.circle.id)
    .eq('member_id', memberId)
    .neq('member_role', 'owner');

  if (error) {
    if (button) {
      button.disabled = false;
      button.textContent = 'Remove';
    }
    showToast('That member could not be removed.');
    return;
  }

  showToast('Member removed from the Sautify.');
  await loadCircleMembers(activeCircle.circle.id);
}

function circleStreamAllowed(circle, membership) {
  return Boolean(circle && (circle.owner_id === currentMemberId || membership));
}

function resetCircleStreamView({ hide = false } = {}) {
  circleStreamRequest += 1;
  circleStreamLoading = false;
  const section = byId('circle-stream');
  if (!section) return;
  section.hidden = hide;
  byId('circle-stream-loading').hidden = true;
  byId('circle-stream-error').hidden = true;
  byId('circle-stream-empty').hidden = true;
  byId('circle-stream-locked').hidden = true;
  byId('circle-sauti-composer').hidden = true;
  byId('circle-stream-feed').replaceChildren();
  byId('circle-sauti-body').value = '';
  setMessage(byId('circle-sauti-message'), '', '');
  updateCircleComposerState();
}

function updateCircleComposerState() {
  const textarea = byId('circle-sauti-body');
  const submit = byId('circle-sauti-submit');
  const count = byId('circle-sauti-count');
  const replies = byId('circle-sauti-reply-access');
  const note = byId('circle-sauti-reply-note');
  if (!textarea || !submit || !count || !replies || !note) return;
  const length = textarea.value.length;
  const allowed = circleStreamAllowed(activeCircle?.circle, activeCircle?.membership);
  const mentionedReady = replies.value !== 'mentioned' || composerHasMention(textarea.value);
  count.textContent = String(length);
  note.textContent = !navigator.onLine
    ? 'Connect to post. Sautify drafts can be saved from the Stream composer.'
    : `${replyAccessLabel(replies.value)} can reply in this Sautify`;
  submit.disabled = !allowed || !navigator.onLine || !textarea.value.trim() || length > 500 || !mentionedReady || circleStreamLoading;
}

function syncCircleStreamAccess(circle, membership) {
  const section = byId('circle-stream');
  const composer = byId('circle-sauti-composer');
  const locked = byId('circle-stream-locked');
  const lockedTitle = byId('circle-stream-locked-title');
  const lockedMessage = byId('circle-stream-locked-message');
  section.hidden = false;
  byId('circle-stream-error').hidden = true;
  byId('circle-stream-empty').hidden = true;
  byId('circle-stream-feed').replaceChildren();

  const allowed = circleStreamAllowed(circle, membership);
  composer.hidden = !allowed;
  locked.hidden = allowed;

  if (!allowed) {
    circleStreamRequest += 1;
    byId('circle-stream-loading').hidden = true;
    lockedTitle.textContent = circle.join_policy === 'approval' ? 'Membership approval required' : 'Join to open the Sautify Stream';
    lockedMessage.textContent = circle.join_policy === 'approval'
      ? 'Approved members can read and post inside this Sautify.'
      : 'Members can read and post inside this Sautify.';
    updateCircleComposerState();
    return;
  }

  lockedTitle.textContent = '';
  lockedMessage.textContent = '';
  updateCircleComposerState();
  void loadCircleStream(circle.id);
}

async function loadCircleStream(circleId) {
  if (!activeCircle?.circle || activeCircle.circle.id !== circleId) return;
  if (!circleStreamAllowed(activeCircle.circle, activeCircle.membership) || circleStreamLoading) return;

  circleStreamLoading = true;
  const requestId = ++circleStreamRequest;
  const loading = byId('circle-stream-loading');
  const errorState = byId('circle-stream-error');
  const empty = byId('circle-stream-empty');
  const feed = byId('circle-stream-feed');
  loading.hidden = false;
  errorState.hidden = true;
  empty.hidden = true;
  feed.replaceChildren();
  updateCircleComposerState();

  try {
    const { data: posts, error } = await supabase
      .from('social_posts')
      .select('id, author_id, circle_id, visibility, reply_access, quote_post_id, parent_post_id, root_post_id, thread_depth, audience_owner_id, body, created_at, like_count, comment_count, repost_count, author:social_profiles!social_posts_author_id_fkey(username, display_name, is_discoverable, is_verified, verification_badge_type)')
      .eq('circle_id', circleId)
      .eq('visibility', 'circle')
      .is('reply_to_post_id', null)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;
    if (requestId !== circleStreamRequest) return;

    const rows = posts || [];
    const hydrated = await hydrateDirectPosts(rows);

    if (requestId !== circleStreamRequest) return;
    hydrated.forEach((item) => {
      const card = createSautiCard(item);
      if (card) feed.append(card);
    });
    empty.hidden = feed.childElementCount > 0;
  } catch {
    if (requestId !== circleStreamRequest) return;
    feed.replaceChildren();
    errorState.hidden = false;
  } finally {
    if (requestId === circleStreamRequest) {
      circleStreamLoading = false;
      loading.hidden = true;
      updateCircleComposerState();
    }
  }
}

async function shareCircleSauti() {
  if (!activeCircle?.circle || !circleStreamAllowed(activeCircle.circle, activeCircle.membership)) return;
  const circle = activeCircle.circle;
  const textarea = byId('circle-sauti-body');
  const submit = byId('circle-sauti-submit');
  const message = byId('circle-sauti-message');
  const replyAccess = byId('circle-sauti-reply-access').value || 'everyone';
  const body = textarea.value.trim();
  setMessage(message, '', '');

  if (!body) return setMessage(message, 'Write something before sharing.');
  if (body.length > 500) return setMessage(message, 'Post text must be 500 characters or fewer.');
  if (replyAccess === 'mentioned' && !composerHasMention(textarea.value)) {
    return setMessage(message, 'Mention at least one SautiLink username or change who can reply.');
  }
  if (!navigator.onLine) {
    return setMessage(message, 'You are offline. Use the Stream composer to save this Sautify post as a device draft.');
  }

  submit.disabled = true;
  submit.setAttribute('aria-busy', 'true');
  const previous = submit.textContent;
  submit.textContent = 'Posting…';

  try {
    const headers = await currentAuthorizationHeader();
    if (!headers.Authorization) throw new Error('Sign in again before posting in this Sautify.');

    const response = await fetch('/api/sauti', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body, circle_id: circle.id, reply_access: replyAccess }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok === false) {
      throw new Error(payload?.error?.message || 'This Sautify post could not be published.');
    }

    textarea.value = '';
    updateCircleComposerState();
    setMessage(message, 'Post published in this Sautify.', 'success');
    await loadCircleStream(circle.id);
    showToast('Posted in Sautify.');
  } catch (error) {
    setMessage(message, error?.message || 'This Sautify post could not be published.');
  } finally {
    submit.textContent = previous;
    submit.removeAttribute('aria-busy');
    updateCircleComposerState();
  }
}

async function loadCircleDetail(slug) {
  if (!currentMemberId) return;
  const requestId = ++circlesRequest;
  activeCircle = null;
  resetCircleStreamView({ hide: true });
  showCircleRouteState('loading', slug);

  const { data: circle, error } = await supabase
    .from('social_circles')
    .select('id, owner_id, slug, name, description, join_policy, created_at')
    .eq('slug', slug)
    .maybeSingle();

  if (requestId !== circlesRequest) return;
  if (error) return showCircleRouteState('error', slug);
  if (!circle) return showCircleRouteState('unavailable', slug);

  const [membershipResult, requestResult, ownerName] = await Promise.all([
    supabase
      .from('social_circle_members')
      .select('circle_id, member_role, joined_at')
      .eq('circle_id', circle.id)
      .eq('member_id', currentMemberId)
      .maybeSingle(),
    supabase
      .from('social_circle_join_requests')
      .select('circle_id, status, created_at, decided_at')
      .eq('circle_id', circle.id)
      .eq('requester_id', currentMemberId)
      .maybeSingle(),
    loadCircleOwnerName(circle.owner_id),
  ]);

  if (requestId !== circlesRequest) return;
  if (membershipResult.error || requestResult.error) return showCircleRouteState('error', slug);

  const membership = membershipResult.data || null;
  const request = requestResult.data || null;
  activeCircle = { circle, membership, request };

  resetCircleRouteViews();
  byId('circle-detail').hidden = false;
  byId('circle-detail-name').textContent = circle.name;
  byId('circle-detail-slug').textContent = `/sautify/${circle.slug}`;
  byId('circle-detail-description').textContent = circle.description || 'No description yet.';
  const policy = byId('circle-detail-policy');
  policy.textContent = circlePolicyLabel(circle.join_policy);
  policy.className = `circle-policy-badge ${circle.join_policy}`;
  byId('circle-detail-owner').textContent = circle.owner_id === currentMemberId
    ? 'Owned by you'
    : ownerName ? `Owned by ${ownerName}` : 'Owned by a SautiLink member';
  byId('circle-detail-membership').textContent = circle.owner_id === currentMemberId
    ? 'Owner'
    : membership ? 'Joined' : request?.status === 'pending' ? 'Request pending' : 'Not joined';
  syncCirclePrimaryAction(circle, membership, request);
  syncCircleStreamAccess(circle, membership);

  byId('circle-requests').hidden = true;
  byId('circle-members').hidden = true;
  if (circle.owner_id === currentMemberId) {
    await Promise.all([
      loadCircleRequests(circle.id),
      loadCircleMembers(circle.id),
    ]);
  }
}

async function handleCirclePrimaryAction() {
  if (!activeCircle || !currentMemberId) return;
  const { circle, membership, request } = activeCircle;
  const button = byId('circle-primary-action');
  const action = button.dataset.action;
  if (!action) return;

  const label = button.querySelector('span');
  button.disabled = true;
  const oldLabel = label.textContent;
  label.textContent = action === 'leave' ? 'Leaving…' : action === 'request' ? 'Sending…' : 'Joining…';

  try {
    if (action === 'join') {
      const { error } = await supabase
        .from('social_circle_members')
        .insert({ circle_id: circle.id, member_id: currentMemberId, member_role: 'member' });
      if (error) throw error;
      showToast('You joined the Sautify.');
    } else if (action === 'leave' && membership) {
      const { error } = await supabase
        .from('social_circle_members')
        .delete()
        .eq('circle_id', circle.id)
        .eq('member_id', currentMemberId);
      if (error) throw error;
      showToast('You left the Sautify.');
    } else if (action === 'request') {
      if (request) {
        const { error: deleteError } = await supabase
          .from('social_circle_join_requests')
          .delete()
          .eq('circle_id', circle.id)
          .eq('requester_id', currentMemberId);
        if (deleteError) throw deleteError;
      }
      const { error } = await supabase
        .from('social_circle_join_requests')
        .insert({ circle_id: circle.id, requester_id: currentMemberId });
      if (error) throw error;
      showToast('Join request sent.');
    }
    if (action === 'join' || action === 'leave') await loadComposerAudiences();
    await loadCircleDetail(circle.slug);
  } catch {
    button.disabled = false;
    label.textContent = oldLabel;
    showToast('That Sautify action could not be completed.');
  }
}

async function decideCircleRequest(requesterId, status, row) {
  if (!activeCircle?.circle || activeCircle.circle.owner_id !== currentMemberId) return;
  if (!['approved', 'declined'].includes(status)) return;
  const buttons = row.querySelectorAll('button');
  buttons.forEach((button) => { button.disabled = true; });

  const { error } = await supabase
    .from('social_circle_join_requests')
    .update({ status })
    .eq('circle_id', activeCircle.circle.id)
    .eq('requester_id', requesterId)
    .eq('status', 'pending');

  if (error) {
    buttons.forEach((button) => { button.disabled = false; });
    showToast('That membership request could not be updated.');
    return;
  }

  showToast(status === 'approved' ? 'Member approved.' : 'Request declined.');
  await Promise.all([
    loadCircleRequests(activeCircle.circle.id),
    loadCircleMembers(activeCircle.circle.id),
  ]);
}

function closeProfileEditor({ restoreFocus = false } = {}) {
  byId('profile-editor').hidden = true;
  setMessage(byId('profile-form-message'), '', '');
  if (restoreFocus) byId('profile-edit-button').focus();
}


function identityDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function syncMemberIdentityVisuals() {
  if (!currentMember) return;
  const displayName = currentMember.display_name || currentMember.full_name || currentMember.username;
  const username = currentMember.username;
  byId('member-display-name').textContent = displayName;
  byId('member-username').textContent = `@${username}`;
  byId('rail-name').textContent = displayName;
  byId('rail-username').textContent = `@${username}`;
  byId('member-first-name').textContent = displayName.split(/\s+/)[0];
  byId('member-avatar').textContent = avatarLetter(displayName);
  byId('rail-avatar').textContent = avatarLetter(displayName);
  renderProfile(currentMember, { owner: true });
}

async function loadIdentityControls() {
  if (!currentMemberId) return null;
  const stateNode = byId('profile-identity-state');
  const summary = byId('profile-identity-summary');
  const nameHint = byId('profile-name-hint');
  const usernameHint = byId('profile-username-hint');
  const nameSubmit = byId('profile-name-submit');
  const usernameSubmit = byId('profile-username-submit');

  stateNode.textContent = 'Checking';
  nameSubmit.disabled = true;
  usernameSubmit.disabled = true;

  try {
    const data = await settingsApiRequest('/api/account/identity');
    const profile = data.profile || {};
    currentMember = { ...currentMember, ...profile };
    byId('profile-name-input').value = profile.display_name || '';
    byId('profile-username-input').value = profile.username || '';
    configureProfileVerificationBadge(profile, { owner: true });

    if (profile.is_verified) {
      stateNode.textContent = 'Verified';
      summary.textContent = 'Verified accounts use review for display name changes.';
      nameSubmit.textContent = data.display_name?.pending_request ? 'Request pending' : 'Request name change';
      nameSubmit.disabled = Boolean(data.display_name?.pending_request);
      nameHint.textContent = data.display_name?.pending_request
        ? `Requested “${data.display_name.pending_request.requested_name}”. SautiLink review is pending.`
        : 'Your verified status is protected. A display name change must be reviewed before it goes live.';
    } else {
      const remaining = Number(data.display_name?.changes_remaining_14_days ?? 2);
      stateNode.textContent = 'Standard';
      summary.textContent = 'Name and username limits protect account identity from rapid changes.';
      nameSubmit.textContent = 'Save name';
      nameSubmit.disabled = remaining < 1;
      nameHint.textContent = remaining > 0
        ? `You can change your display name ${remaining} more ${remaining === 1 ? 'time' : 'times'} in the current 14-day window.`
        : `Name-change limit reached. Next change available ${identityDate(data.display_name?.next_change_at) || 'after the 14-day window'}.`;
    }

    const usernameRemaining = Number(data.username?.changes_remaining_30_days ?? 1);
    usernameSubmit.disabled = usernameRemaining < 1;
    usernameHint.textContent = usernameRemaining > 0
      ? 'You can change your username once every 30 days.'
      : `Username change available again ${identityDate(data.username?.next_change_at) || 'after 30 days'}.`;

    syncMemberIdentityVisuals();
    return data;
  } catch (error) {
    stateNode.textContent = 'Unavailable';
    summary.textContent = error?.message || 'Identity change status could not be loaded.';
    nameHint.textContent = 'Try reopening the profile editor.';
    usernameHint.textContent = 'Try reopening the profile editor.';
    return null;
  }
}

async function submitIdentityChange(field, value, messageNode, submit) {
  setMessage(messageNode, '', '');
  submit.disabled = true;
  try {
    const data = await settingsApiRequest('/api/account/identity', {
      method: 'POST',
      body: {
        field,
        value,
        request_id: crypto.randomUUID(),
      },
    });

    if (data.status === 'pending') {
      setMessage(messageNode, 'Name change request submitted for review.', 'success');
      showToast('Name change request submitted.');
    } else if (data.status === 'changed') {
      if (field === 'display_name') currentMember.display_name = data.display_name;
      if (field === 'username') currentMember.username = data.username;
      syncMemberIdentityVisuals();
      if (field === 'username' && /^\/(?:app\/)?u\//.test(window.location.pathname)) {
        window.history.replaceState({}, '', memberProfilePath(currentMember.username));
      }
      setMessage(messageNode, field === 'username' ? 'Username changed.' : 'Display name changed.', 'success');
      showToast(field === 'username' ? 'Username changed.' : 'Display name changed.');
    } else {
      setMessage(messageNode, 'No identity change was needed.', 'success');
    }

    await loadIdentityControls();
  } catch (error) {
    setMessage(messageNode, error?.message || 'This identity change could not be completed.');
    await loadIdentityControls();
  } finally {
    submit.disabled = false;
  }
}

function openProfileEditor() {
  if (!currentMember) return;
  const form = byId('profile-form');
  form.bio.value = currentMember.bio || '';
  form.location.value = currentMember.location || '';
  form.website.value = currentMember.website_url || '';
  form.discoverable.checked = Boolean(currentMember.is_discoverable);
  byId('profile-bio-count').textContent = String(form.bio.value.length);
  setMessage(byId('profile-form-message'), '', '');
  setMessage(byId('profile-media-message'), '', '');
  setMessage(byId('profile-name-message'), '', '');
  setMessage(byId('profile-username-message'), '', '');
  updateProfileMediaControls();
  byId('profile-editor').hidden = false;
  void loadIdentityControls();
  byId('profile-name-input').focus();
}

function setMemberNavigation(name) {
  if (name !== 'messages' && dmConversationRealtimeChannel) void stopDmConversationRealtime();
  streamSurface.hidden = name !== 'stream';
  notificationsSurface.hidden = name !== 'notifications';
  circlesSurface.hidden = name !== 'circles';
  messagesSurface.hidden = name !== 'messages';
  discoverSurface.hidden = name !== 'discover';
  savedSurface.hidden = name !== 'saved';
  appealsSurface.hidden = name !== 'appeals';
  moderationSurface.hidden = name !== 'moderation';
  conversationSurface.hidden = name !== 'conversation';
  settingsSurface.hidden = name !== 'settings';
  profileSurface.hidden = name !== 'profile';
  viewTitle.textContent = name === 'settings'
    ? 'Settings'
    : name === 'profile'
      ? 'Profile'
    : name === 'notifications'
      ? 'Notifications'
      : name === 'messages'
        ? 'Messages'
        : name === 'discover'
          ? 'Discover'
          : name === 'saved'
            ? 'Saved'
            : name === 'appeals'
              ? 'Appeals'
              : name === 'moderation'
                ? 'Moderation'
                : name === 'conversation'
              ? 'Conversation'
              : name === 'circles'
                ? 'Sautify'
                : 'Stream';
  document.querySelectorAll('[data-member-view]').forEach((button) => {
    const active = button.dataset.memberView === name;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
}

function memberProfilePath(username) {
  return `/u/${encodeURIComponent(username)}`;
}

function readProfileRoute(pathname = window.location.pathname) {
  const match = pathname.match(/^(?:\/app)?\/u\/([^/]+)\/?$/);
  if (!match) return null;

  try {
    const decoded = decodeURIComponent(match[1]);
    const username = decoded.toLowerCase();
    if (usernameError(username)) return { invalid: true, username: '' };
    return { invalid: false, username };
  } catch {
    return { invalid: true, username: '' };
  }
}

function showMemberSurface(name, { syncUrl = true } = {}) {
  if (!currentMember || !['stream', 'discover', 'saved', 'appeals', 'moderation', 'notifications', 'messages', 'circles', 'settings', 'profile'].includes(name)) return;
  setMemberNavigation(name);

  if (name === 'profile') {
    renderProfile(currentMember, { owner: true });
  } else {
    closeProfileEditor();
    if (name === 'stream') {
      byId('sauti-composer').hidden = false;
      byId('stream-error-copy').textContent = 'Something went wrong while opening the latest posts.';
      if (syncUrl) void loadStream({ reset: true });
    }
    if (name === 'discover') {
      byId('discover-query').value = '';
      void loadDiscover('');
    }
    if (name === 'saved') void loadSavedSauti();
    if (name === 'appeals') void loadAppeals();
    if (name === 'moderation') void loadModerationWorkspace();
    if (name === 'settings') void loadSettings();
    if (name === 'notifications') void loadNotifications();
    if (name === 'messages') void loadMessagesInbox();
    if (name === 'circles') {
      setCircleCreateOpen(false);
      void loadCircles();
    }
  }

  if (!syncUrl) return;
  const nextPath = name === 'profile'
    ? memberProfilePath(currentMember.username)
    : name === 'discover'
      ? '/discover'
      : name === 'saved'
        ? '/saved'
        : name === 'appeals'
          ? '/appeals'
          : name === 'moderation'
            ? '/moderation'
            : name === 'settings'
              ? '/settings'
              : name === 'notifications'
          ? '/notifications'
          : name === 'messages'
            ? messagePath()
            : name === 'circles'
              ? circlePath()
              : '/home';
  if (window.location.pathname !== nextPath || window.location.search) {
    window.history.pushState({}, '', nextPath);
  }
}

function showProfileRouteState(type, username = '') {
  document.body.classList.remove('auth-entry');
  delete document.body.dataset.authMode;
  loadingView.hidden = true;
  authView.hidden = true;
  memberView.hidden = false;
  setMemberNavigation('profile');
  closeProfileEditor();

  byId('profile-card').hidden = true;
  const state = byId('profile-route-state');
  state.hidden = false;
  state.dataset.state = type;

  const safeUsername = username ? `@${username}` : 'This profile';
  const copy = {
    loading: ['Opening profile…', `Looking up ${safeUsername}.`],
    unavailable: ['Profile unavailable', `${safeUsername} does not exist or is not discoverable.`],
    error: ['Profile could not be opened', 'Something went wrong while loading this profile. Try again.'],
  };
  const [title, message] = copy[type] || copy.error;
  byId('profile-route-title').textContent = title;
  byId('profile-route-message').textContent = message;
}

function showDiscoverableProfile(profile) {
  document.body.classList.remove('auth-entry');
  delete document.body.dataset.authMode;
  loadingView.hidden = true;
  authView.hidden = true;
  memberView.hidden = false;
  setMemberNavigation('profile');
  closeProfileEditor();
  renderProfile(profile, { owner: false });

  if (!currentMember) {
    railAccount.hidden = true;
    mobileSignoutButton.hidden = true;
  }
}

async function loadDiscoverableProfile(username) {
  const requestId = ++profileRouteRequest;
  showProfileRouteState('loading', username);

  const { data, error } = await supabase
    .from('social_profiles')
    .select('id, username, display_name, bio, location, website_url, is_discoverable, is_verified, verification_badge_type, followers_count, following_count')
    .eq('username', username)
    .eq('is_discoverable', true)
    .maybeSingle();

  if (requestId !== profileRouteRequest) return;
  if (error) return showProfileRouteState('error', username);
  if (!data) return showProfileRouteState('unavailable', username);
  showDiscoverableProfile(data);
}

async function applyLocationRoute() {
  const authRoute = window.location.pathname.match(/^\/(login|signup)\/?$/);
  if (authRoute) {
    profileRouteRequest += 1;
    if (currentMember) {
      window.history.replaceState({}, '', '/home');
      showMemberSurface('stream', { syncUrl: false });
      return;
    }
    showSignedOut(authRoute[1]);
    return;
  }

  const conversationRoute = readConversationRoute();
  if (conversationRoute) {
    profileRouteRequest += 1;
    if (!currentMember) {
      showSignedOut('login');
      return;
    }
    setMemberNavigation('conversation');
    closeProfileEditor();
    if (conversationRoute.invalid) {
      byId('conversation-loading').hidden = true;
      byId('conversation-error').hidden = false;
      byId('conversation-error-copy').textContent = 'That post conversation address is invalid.';
      return;
    }
    await loadConversation(conversationRoute.postId);
    return;
  }

  const messageRoute = readMessageRoute();
  if (messageRoute) {
    profileRouteRequest += 1;
    if (!currentMember) {
      showSignedOut('login');
      return;
    }
    setMemberNavigation('messages');
    if (messageRoute.invalid) {
      window.history.replaceState({}, '', messagePath());
      await loadMessagesInbox();
      showToast('That conversation address is unavailable.');
      return;
    }
    if (messageRoute.conversationId) {
      await loadMessageThread(messageRoute.conversationId);
    } else {
      await loadMessagesInbox();
    }
    return;
  }

  const circleRoute = readCircleRoute();
  if (circleRoute) {
    profileRouteRequest += 1;
    if (!currentMember) {
      showSignedOut('login');
      return;
    }
    setMemberNavigation('circles');
    setCircleCreateOpen(false);
    if (circleRoute.invalid) {
      showCircleRouteState('unavailable');
      return;
    }
    if (circleRoute.slug) {
      const canonicalPath = circlePath(circleRoute.slug);
      if (window.location.pathname !== canonicalPath) window.history.replaceState({}, '', canonicalPath);
      await loadCircleDetail(circleRoute.slug);
    } else {
      await loadCircles();
    }
    return;
  }

  if (/^(?:\/app)?\/discover\/?$/.test(window.location.pathname)) {
    profileRouteRequest += 1;
    if (!currentMember) {
      showSignedOut('login');
      return;
    }
    setMemberNavigation('discover');
    if (window.location.pathname !== '/discover') window.history.replaceState({}, '', '/discover' + window.location.search);
    closeProfileEditor();
    const query = normalizeDiscoverQuery(new URL(window.location.href).searchParams.get('q') || '');
    byId('discover-query').value = query;
    await loadDiscover(query);
    return;
  }

  if (/^(?:\/app)?\/saved\/?$/.test(window.location.pathname)) {
    profileRouteRequest += 1;
    if (!currentMember) {
      showSignedOut('login');
      return;
    }
    setMemberNavigation('saved');
    if (window.location.pathname !== '/saved') window.history.replaceState({}, '', '/saved');
    closeProfileEditor();
    await loadSavedSauti();
    return;
  }

  if (/^(?:\/app)?\/appeals\/?$/.test(window.location.pathname)) {
    profileRouteRequest += 1;
    if (!currentMember) {
      showSignedOut('login');
      return;
    }
    setMemberNavigation('appeals');
    if (window.location.pathname !== '/appeals') window.history.replaceState({}, '', '/appeals');
    closeProfileEditor();
    await loadAppeals();
    return;
  }

  if (/^(?:\/app)?\/moderation\/?$/.test(window.location.pathname)) {
    profileRouteRequest += 1;
    if (!currentMember) {
      showSignedOut('login');
      return;
    }
    setMemberNavigation('moderation');
    if (window.location.pathname !== '/moderation') window.history.replaceState({}, '', '/moderation');
    closeProfileEditor();
    await loadModerationWorkspace();
    return;
  }

  if (/^(?:\/app)?\/settings\/?$/.test(window.location.pathname)) {
    profileRouteRequest += 1;
    if (!currentMember) {
      showSignedOut('login');
      return;
    }
    setMemberNavigation('settings');
    if (window.location.pathname !== '/settings') window.history.replaceState({}, '', '/settings');
    closeProfileEditor();
    await loadSettings();
    return;
  }

  if (/^(?:\/app)?\/notifications\/?$/.test(window.location.pathname)) {
    profileRouteRequest += 1;
    if (currentMember) {
      if (window.location.pathname !== '/notifications') window.history.replaceState({}, '', '/notifications');
      showMemberSurface('notifications', { syncUrl: false });
    }
    else showSignedOut('login');
    return;
  }

  const route = readProfileRoute();

  if (!route) {
    profileRouteRequest += 1;
    if (currentMember) {
      const sharedSauti = /^(?:\/app\/?|\/home\/?)$/.test(window.location.pathname) ? readSharedSautiTarget() : '';
      if (sharedSauti) {
        window.history.replaceState({}, '', conversationPath(sharedSauti));
        setMemberNavigation('conversation');
        closeProfileEditor();
        await loadConversation(sharedSauti);
      } else {
        if (/^\/app\/?$/.test(window.location.pathname)) window.history.replaceState({}, '', '/home');
        byId('sauti-composer').hidden = false;
        showMemberSurface('stream', { syncUrl: false });
      }
    } else {
      showSignedOut('login');
    }
    return;
  }

  if (route.invalid) {
    profileRouteRequest += 1;
    showProfileRouteState('unavailable');
    return;
  }

  const canonicalPath = memberProfilePath(route.username);
  if (window.location.pathname !== canonicalPath) {
    window.history.replaceState({}, '', canonicalPath);
  }

  if (currentMember?.username === route.username) {
    profileRouteRequest += 1;
    loadingView.hidden = true;
    authView.hidden = true;
    memberView.hidden = false;
    setMemberNavigation('profile');
    renderProfile(currentMember, { owner: true });
    return;
  }

  await loadDiscoverableProfile(route.username);
}

function renderMember(profile, userId = currentMemberId) {
  document.body.classList.remove('auth-entry');
  delete document.body.dataset.authMode;
  const displayName = profile.display_name || profile.full_name || profile.username;
  const username = profile.username;
  const letter = avatarLetter(displayName);

  currentMember = { ...profile };
  currentMemberId = userId || profile.id || currentMemberId;

  byId('member-avatar').textContent = letter;
  byId('rail-avatar').textContent = letter;
  byId('member-display-name').textContent = displayName;
  byId('member-username').textContent = `@${username}`;
  byId('rail-name').textContent = displayName;
  byId('rail-username').textContent = `@${username}`;
  byId('member-first-name').textContent = displayName.split(/\s+/)[0];
  renderProfile(currentMember);

  loadingView.hidden = true;
  authView.hidden = true;
  memberView.hidden = false;
  railAccount.hidden = false;
  mobileSignoutButton.hidden = false;
  document.querySelector('.share-sauti-button').disabled = false;
  byId('sauti-body').disabled = false;
  byId('sauti-media-add').disabled = false;
  void prepareComposer();
  syncComposerOnlineState();
  showMemberSurface('stream', { syncUrl: false });
  void loadStream({ reset: true });
  void ensureDmInboxRealtime();
  void ensureSettingsPreferences()
    .then((preferences) => {
      currentSettingsPreferences = preferences;
      if (!messageBadgesEnabled()) syncMessageBadges(0);
      else void refreshMessageBadge();
      if (activeConversation?.id) void startDmConversationRealtime(activeConversation.id);
    })
    .catch(() => { currentSettingsPreferences = null; });
  void refreshNotificationBadge();
  void refreshMessageBadge();
  void syncModerationAccess();
}

async function loadMember(user) {
  currentAccountEmail = normalizeEmail(user?.email || '');
  syncAccountSecurityEmail();

  const { data: account, error: accountError } = await supabase
    .from('account_profiles')
    .select('username, full_name')
    .eq('id', user.id)
    .maybeSingle();

  if (accountError) {
    showSignedOut('login');
    setMessage(byId('login-message'), 'Your session opened, but your profile could not be loaded. Try again.');
    return;
  }

  if (!account) {
    const suggestedUsername = normalizeUsername(user.user_metadata?.username || '');
    const suggestedName = String(user.user_metadata?.full_name || suggestedUsername).trim();
    byId('onboarding-username').value = suggestedUsername;
    byId('onboarding-name').value = suggestedName;
    setMessage(byId('onboarding-message'), '', '');
    showAuthPanel('onboarding');
    return;
  }

  const { data: social, error: socialError } = await supabase
    .from('social_profiles')
    .select('id, username, display_name, bio, location, website_url, is_discoverable, is_verified, verification_badge_type, followers_count, following_count')
    .eq('id', user.id)
    .maybeSingle();

  if (socialError || !social) {
    showSignedOut('login');
    setMessage(byId('login-message'), 'Your account is secure, but social profile setup is unavailable right now.');
    return;
  }

  renderMember({ ...account, ...social }, user.id);
  void loadDeletionRequestState();
  await applyLocationRoute();
}

async function completeOnboarding(username, displayName) {
  const { data, error } = await supabase.rpc('complete_social_onboarding', {
    p_username: username,
    p_display_name: displayName,
  });
  if (error) throw error;
  renderMember(data, data.id);
  await applyLocationRoute();
}

async function checkUsername(value, stateNode, options = {}) {
  const username = normalizeUsername(value);
  const requestId = ++usernameRequest;
  availableUsername = '';
  const invalid = usernameError(username);

  if (invalid) {
    stateNode.textContent = invalid;
    stateNode.className = 'field-hint bad';
    return false;
  }

  stateNode.textContent = 'Checking availability…';
  stateNode.className = 'field-hint';
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 9000);

  try {
    const response = await fetch(USERNAME_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ action: 'check_username', username }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (requestId !== usernameRequest) return false;
    if (!response.ok || payload?.ok === false) throw new Error(payload?.error?.message || 'Availability check failed.');
    if (payload?.data?.available) {
      availableUsername = username;
      stateNode.textContent = `@${username} is available.`;
      stateNode.className = 'field-hint good';
      return true;
    }
    stateNode.textContent = `@${username} is already taken.`;
    stateNode.className = 'field-hint bad';
    return false;
  } catch (error) {
    if (requestId !== usernameRequest) return false;
    stateNode.textContent = error?.name === 'AbortError' ? 'Availability check timed out.' : 'Unable to check that username right now.';
    stateNode.className = 'field-hint bad';
    if (options.throwOnFailure) throw error;
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

document.querySelectorAll('[data-auth-mode]').forEach((button) => {
  button.addEventListener('click', () => {
    const mode = button.dataset.authMode;
    if (mode === 'login' || mode === 'signup') {
      const nextPath = mode === 'signup' ? '/signup' : '/login';
      if (window.location.pathname !== nextPath) window.history.pushState({}, '', nextPath);
      showAuthPanel(mode);
    }
  });
});

document.querySelectorAll('[data-password-toggle]').forEach((button) => {
  button.addEventListener('click', () => {
    const input = byId(button.dataset.passwordToggle);
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    button.textContent = show ? 'Hide' : 'Show';
    button.setAttribute('aria-pressed', String(show));
  });
});

document.querySelectorAll('[data-preview-nav]').forEach((button) => {
  button.addEventListener('click', () => {
    showToast('This area opens in a later focused slice.');
  });
});

document.querySelectorAll('[data-member-view]').forEach((button) => {
  button.addEventListener('click', () => {
    if (!currentMember) {
      if (button.dataset.memberView === 'stream') window.location.assign('/login');
      return;
    }
    showMemberSurface(button.dataset.memberView);
  });
});

byId('discover-form').addEventListener('submit', (event) => {
  event.preventDefault();
  void loadDiscover(byId('discover-query').value);
});
byId('discover-retry').addEventListener('click', () => void loadDiscover(byId('discover-query').value));
byId('saved-retry').addEventListener('click', () => void loadSavedSauti());

byId('appeals-retry').addEventListener('click', () => void loadAppeals());
byId('appeals-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-appeal-action-id]');
  if (!button) return;
  const actionId = String(button.dataset.appealActionId || '');
  void moderationRequest('/api/appeals')
    .then((data) => {
      const action = (data.actions || []).find((row) => String(row.id) === actionId);
      if (action) openAppealDialog(action);
    })
    .catch(() => showToast('This moderation decision could not be opened.'));
});
byId('appeal-dialog-close').addEventListener('click', closeAppealDialog);
byId('appeal-cancel').addEventListener('click', closeAppealDialog);
byId('appeal-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const actionId = String(byId('appeal-action-id').value || '');
  const reason = String(byId('appeal-reason').value || '').trim();
  const submit = form.querySelector('[type="submit"]');
  setMessage(byId('appeal-message'), '', '');
  if (!actionId || !reason) return setMessage(byId('appeal-message'), 'Explain why this decision should be reviewed again.');
  setBusy(submit, true, 'Submitting…');
  try {
    await moderationRequest('/api/appeals', {
      method: 'POST',
      body: { action_id: actionId, reason },
    });
    closeAppealDialog();
    showToast('Appeal submitted for senior review.');
    await loadAppeals();
  } catch (error) {
    setMessage(byId('appeal-message'), error?.message || 'This appeal could not be submitted.');
  } finally {
    setBusy(submit, false, '');
  }
});

byId('moderation-retry').addEventListener('click', () => void loadModerationWorkspace());
byId('moderation-report-refresh').addEventListener('click', () => void loadModerationReports());
byId('moderation-appeal-refresh').addEventListener('click', () => void loadModerationAppeals());
byId('moderation-audit-refresh').addEventListener('click', () => void loadModerationAudit());
byId('moderation-identity-refresh').addEventListener('click', () => void loadModerationIdentityRequests());
byId('moderation-report-status').addEventListener('change', () => void loadModerationReports());
byId('moderation-appeal-status').addEventListener('change', () => void loadModerationAppeals());

byId('moderation-tabs').addEventListener('click', (event) => {
  const button = event.target.closest('[data-moderation-tab]');
  if (!button) return;
  const tab = button.dataset.moderationTab;
  byId('moderation-tabs').querySelectorAll('[data-moderation-tab]').forEach((item) => {
    item.setAttribute('aria-selected', String(item === button));
  });
  byId('moderation-reports-panel').hidden = tab !== 'reports';
  byId('moderation-appeals-panel').hidden = tab !== 'appeals';
  byId('moderation-identity-panel').hidden = tab !== 'identity';
  byId('moderation-audit-panel').hidden = tab !== 'audit';
  if (tab === 'reports') void loadModerationReports();
  if (tab === 'appeals') void loadModerationAppeals();
  if (tab === 'identity') void loadModerationIdentityRequests();
  if (tab === 'audit') void loadModerationAudit();
});


byId('moderation-identity-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-identity-decision]');
  if (!button) return;
  void decideModerationIdentityRequest(button.dataset.identityRequestId, button.dataset.identityDecision);
});

byId('moderation-report-list').addEventListener('click', (event) => {
  const row = event.target.closest('[data-moderation-report-id]');
  if (!row) return;
  selectedModerationReportId = String(row.dataset.moderationReportId || '');
  renderModerationReports();
});

byId('moderation-report-detail').addEventListener('click', (event) => {
  const claim = event.target.closest('[data-claim-report]');
  if (claim) {
    void claimModerationReport(claim.dataset.claimReport);
    return;
  }
  const decision = event.target.closest('[data-moderation-decision]');
  if (decision) void decideModerationReport(decision.dataset.reportId, decision.dataset.moderationDecision);
});

byId('moderation-appeal-list').addEventListener('click', (event) => {
  const claim = event.target.closest('[data-claim-appeal]');
  if (claim) {
    void claimModerationAppeal(claim.dataset.claimAppeal);
    return;
  }
  const decision = event.target.closest('[data-appeal-decision]');
  if (decision) void decideModerationAppeal(decision.dataset.appealId, decision.dataset.appealDecision);
});

byId('circles-create-toggle').addEventListener('click', () => setCircleCreateOpen(true));
byId('circle-create-close').addEventListener('click', () => setCircleCreateOpen(false));
byId('circle-create-cancel').addEventListener('click', () => setCircleCreateOpen(false));
byId('circle-slug').addEventListener('input', (event) => {
  event.currentTarget.value = normalizeCircleSlug(event.currentTarget.value);
});
byId('circle-create-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!currentMemberId) return;
  const form = event.currentTarget;
  const submit = form.querySelector('[type="submit"]');
  const message = byId('circle-create-message');
  const name = String(form.name.value || '').trim();
  const slug = normalizeCircleSlug(form.slug.value);
  const description = String(form.description.value || '').trim();
  const joinPolicy = form.join_policy.value;
  setMessage(message, '', '');

  if (!name || name.length > 80) return setMessage(message, 'Use a Sautify name between 1 and 80 characters.');
  const invalidSlug = circleSlugError(slug);
  if (invalidSlug) return setMessage(message, invalidSlug);
  if (description.length > 1000) return setMessage(message, 'Keep the Sautify description within 1000 characters.');
  if (!['open', 'approval', 'private'].includes(joinPolicy)) return setMessage(message, 'Choose a valid membership type.');

  setBusy(submit, true, 'Creating…');
  try {
    const { data, error } = await supabase
      .from('social_circles')
      .insert({
        owner_id: currentMemberId,
        slug,
        name,
        description,
        join_policy: joinPolicy,
      })
      .select('id, owner_id, slug, name, description, join_policy, created_at')
      .single();
    if (error) throw error;
    setCircleCreateOpen(false);
    showToast('Sautify created.');
    await loadComposerAudiences();
    window.history.pushState({}, '', circlePath(data.slug));
    await loadCircleDetail(data.slug);
  } catch (error) {
    const duplicate = error?.code === '23505';
    setMessage(message, duplicate ? 'That Sautify address is already in use.' : 'The Sautify could not be created. Check the fields and try again.');
  } finally {
    setBusy(submit, false, '');
  }
});
byId('circles-retry').addEventListener('click', () => loadCircles());
byId('circles-list').addEventListener('click', (event) => {
  const card = event.target.closest('[data-circle-slug]');
  if (!card) return;
  const slug = card.dataset.circleSlug;
  window.history.pushState({}, '', circlePath(slug));
  void loadCircleDetail(slug);
});
byId('circle-back').addEventListener('click', () => showMemberSurface('circles'));
byId('circle-route-home').addEventListener('click', () => showMemberSurface('circles'));
byId('circle-primary-action').addEventListener('click', () => void handleCirclePrimaryAction());
byId('circle-sauti-body').addEventListener('input', updateCircleComposerState);
byId('circle-sauti-reply-access').addEventListener('change', updateCircleComposerState);
byId('circle-sauti-composer').addEventListener('submit', async (event) => {
  event.preventDefault();
  await shareCircleSauti();
});
byId('circle-stream-retry').addEventListener('click', () => {
  if (activeCircle?.circle) void loadCircleStream(activeCircle.circle.id);
});
byId('circle-requests-list').addEventListener('click', (event) => {
  const action = event.target.closest('[data-circle-request-action]');
  if (!action) return;
  const row = action.closest('[data-requester-id]');
  if (!row) return;
  void decideCircleRequest(row.dataset.requesterId, action.dataset.circleRequestAction, row);
});
byId('circle-members-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-circle-member-remove]');
  if (!button) return;
  const row = button.closest('[data-member-id]');
  if (!row) return;
  void removeCircleMember(button.dataset.circleMemberRemove, row);
});

byId('notifications-retry').addEventListener('click', () => loadNotifications());
byId('notifications-mark-all').addEventListener('click', () => markAllNotificationsRead());
byId('notifications-list').addEventListener('click', (event) => {
  const item = event.target.closest('[data-notification-id]');
  if (!item) return;
  void (async () => {
    await markNotificationRead(item.dataset.notificationId, item);
    if (item.dataset.sautiId) {
      window.location.assign(conversationPath(item.dataset.sautiId));
      return;
    }
    if (item.dataset.circleSlug) window.location.assign(circlePath(item.dataset.circleSlug));
  })();
});

byId('message-new-form').addEventListener('submit', (event) => {
  event.preventDefault();
  void startDirectMessageByUsername(byId('message-new-username').value);
});
byId('messages-search').addEventListener('input', filterMessageInbox);
byId('messages-retry').addEventListener('click', () => loadMessagesInbox());
byId('messages-inbox-list').addEventListener('click', (event) => {
  const item = event.target.closest('[data-conversation-id]');
  if (!item) return;
  const conversationId = item.dataset.conversationId;
  window.history.pushState({}, '', messagePath(conversationId));
  void loadMessageThread(conversationId);
});
byId('message-thread-back').addEventListener('click', () => {
  window.history.pushState({}, '', messagePath());
  void loadMessagesInbox();
});
byId('message-thread-retry').addEventListener('click', () => {
  if (activeConversation?.id) void loadMessageThread(activeConversation.id);
  else void applyLocationRoute();
});
byId('message-thread-hide').addEventListener('click', () => void hideActiveConversation());
byId('message-thread-mute').addEventListener('click', () => void toggleMessageThreadMute());
byId('message-thread-block').addEventListener('click', () => void toggleMessageThreadBlock());
byId('message-body').addEventListener('input', () => {
  updateMessageComposerState();
  const hasText = Boolean(byId('message-body').value.trim());
  void broadcastDmTyping(hasText);
});
byId('message-composer').addEventListener('submit', (event) => {
  event.preventDefault();
  void sendDirectMessage();
});
byId('message-thread-feed').addEventListener('click', (event) => {
  const report = event.target.closest('[data-report-dm-message]');
  if (report) {
    openReportDialog('message', report.dataset.reportDmMessage, 'Report this private message to SautiLink.');
    return;
  }
  const remove = event.target.closest('[data-delete-dm-message]');
  if (remove) void deleteDirectMessage(remove.dataset.deleteDmMessage, remove);
});

window.addEventListener('focus', () => {
  if (currentMemberId) {
    void refreshNotificationBadge();
    void refreshMessageBadge();
    void ensureDmInboxRealtime();
    if (activeConversation?.id) void syncActiveMessageThreadRealtime({ markRead: true });
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && currentMemberId) {
    void ensureDmInboxRealtime();
    if (activeConversation?.id) void syncActiveMessageThreadRealtime({ markRead: true });
  }
});

byId('show-recovery').addEventListener('click', () => showAuthPanel('recovery'));
byId('show-passwordless').addEventListener('click', () => showAuthPanel('passwordless'));
byId('auth-result-close').addEventListener('click', () => {
  byId('auth-result').hidden = true;
});
byId('cancel-verification').addEventListener('click', () => {
  setPendingSignup(null);
  showAuthPanel('signup');
});

const signupUsername = byId('signup-username');
signupUsername.addEventListener('input', () => {
  const normalized = normalizeUsername(signupUsername.value);
  if (signupUsername.value !== normalized) signupUsername.value = normalized;
  window.clearTimeout(usernameTimer);
  usernameTimer = window.setTimeout(() => checkUsername(normalized, byId('username-state')), 420);
});
signupUsername.addEventListener('blur', () => {
  window.clearTimeout(usernameTimer);
  checkUsername(signupUsername.value, byId('username-state'));
});

byId('onboarding-username').addEventListener('input', (event) => {
  event.currentTarget.value = normalizeUsername(event.currentTarget.value);
});

byId('passwordless-request-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('[type="submit"]');
  const message = byId('passwordless-request-message');
  const email = normalizeEmail(form.email.value);
  setMessage(message, '', '');

  const invalidEmail = emailError(email);
  if (invalidEmail) return setMessage(message, invalidEmail);

  setBusy(submit, true, 'Sending code…');
  try {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
      },
    });
    if (error) throw error;
    pendingPasswordlessEmail = email;
    sessionStorage.setItem('sautilink.auth.passwordless_email', email);
    byId('passwordless-verify-form').hidden = false;
    setMessage(message, `An ${EMAIL_OTP_LENGTH}-digit sign-in code was sent. Enter it below.`, 'success');
    byId('passwordless-code').focus();
  } catch (error) {
    setMessage(message, friendlyAuthError(error));
  } finally {
    setBusy(submit, false, '');
  }
});

byId('passwordless-verify-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('[type="submit"]');
  const message = byId('passwordless-verify-message');
  const code = normalizeEmailOtp(form.code.value);
  setMessage(message, '', '');

  if (!pendingPasswordlessEmail) return setMessage(message, 'Request a fresh SautiLink sign-in email first.');
  if (!isValidEmailOtp(code)) return setMessage(message, `Enter the ${EMAIL_OTP_LENGTH}-digit verification code from your email.`);

  setBusy(submit, true, 'Verifying…');
  try {
    const { data, error } = await supabase.auth.verifyOtp({
      email: pendingPasswordlessEmail,
      token: code,
      type: 'email',
    });
    if (error) throw error;
    pendingPasswordlessEmail = '';
    sessionStorage.removeItem('sautilink.auth.passwordless_email');
    form.reset();
    showAuthResult('magiclink');
    if (data.user) await loadMember(data.user);
  } catch (error) {
    setMessage(message, emailOtpError(error));
  } finally {
    setBusy(submit, false, '');
  }
});

byId('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('[type="submit"]');
  const message = byId('login-message');
  const email = normalizeEmail(form.email.value);
  const password = form.password.value;
  setMessage(message, '', '');

  const invalidEmail = emailError(email);
  if (invalidEmail) return setMessage(message, invalidEmail);
  if (!password) return setMessage(message, 'Enter your password.');

  setBusy(submit, true, 'Signing in…');
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    await loadMember(data.user);
  } catch (error) {
    setMessage(message, friendlyAuthError(error));
  } finally {
    setBusy(submit, false, '');
  }
});

byId('signup-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('[type="submit"]');
  const message = byId('signup-message');
  const username = normalizeUsername(form.username.value);
  const displayName = form.displayName.value.trim();
  const email = normalizeEmail(form.email.value);
  const password = form.password.value;
  setMessage(message, '', '');

  const invalidUsername = usernameError(username);
  const invalidName = displayNameError(displayName);
  const invalidEmail = emailError(email);
  const invalidPassword = passwordError(password, { username, email });
  if (invalidUsername) return setMessage(message, invalidUsername);
  if (invalidName) return setMessage(message, invalidName);
  if (invalidEmail) return setMessage(message, invalidEmail);
  if (invalidPassword) return setMessage(message, invalidPassword);
  if (form.passwordConfirm.value !== password) return setMessage(message, 'Passwords do not match.');

  setBusy(submit, true, 'Creating account…');
  try {
    if (availableUsername !== username) {
      const available = await checkUsername(username, byId('username-state'), { throwOnFailure: true });
      if (!available) return setMessage(message, 'Choose an available username.');
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { username, full_name: displayName },
      },
    });
    if (error) throw error;
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      throw Object.assign(new Error('already registered'), { code: 'user_already_exists' });
    }

    if (data.session) {
      await completeOnboarding(username, displayName);
      return;
    }

    setPendingSignup({ email, username, displayName });
    byId('verify-email').textContent = email;
    setMessage(byId('verify-message'), '', '');
    showAuthPanel('verify');
    byId('signup-verify-code').focus();
  } catch (error) {
    setMessage(message, friendlyAuthError(error));
  } finally {
    setBusy(submit, false, '');
  }
});

byId('signup-verify-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('[type="submit"]');
  const message = byId('verify-message');
  const code = normalizeEmailOtp(form.code.value);
  setMessage(message, '', '');

  if (!pendingSignup) return showAuthPanel('signup');
  if (!isValidEmailOtp(code)) return setMessage(message, `Enter the ${EMAIL_OTP_LENGTH}-digit verification code from your email.`);

  setBusy(submit, true, 'Verifying…');
  try {
    const { data, error } = await supabase.auth.verifyOtp({
      email: pendingSignup.email,
      token: code,
      type: 'email',
    });
    if (error) throw error;
    if (!data?.user) throw new Error('Verified account not found.');

    setPendingSignup(null);
    form.reset();
    showAuthResult('signup');
    await loadMember(data.user);
  } catch (error) {
    setMessage(message, emailOtpError(error));
    byId('signup-verify-code').focus();
  } finally {
    setBusy(submit, false, '');
  }
});

byId('resend-verification').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  const message = byId('verify-message');
  if (!pendingSignup) return showAuthPanel('signup');
  button.disabled = true;
  setMessage(message, '', '');
  try {
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: pendingSignup.email,
    });
    if (error) throw error;
    setMessage(message, `A new ${EMAIL_OTP_LENGTH}-digit verification code has been sent.`, 'success');
    window.setTimeout(() => { button.disabled = false; }, 60000);
  } catch (error) {
    button.disabled = false;
    setMessage(message, friendlyAuthError(error));
  }
});

byId('recovery-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('[type="submit"]');
  const message = byId('recovery-message');
  const email = normalizeEmail(form.email.value);
  setMessage(message, '', '');
  const invalidEmail = emailError(email);
  if (invalidEmail) return setMessage(message, invalidEmail);

  setBusy(submit, true, 'Sending link…');
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: authRedirectUrl('recovery') });
    if (error) throw error;
    setMessage(message, 'If this email belongs to a SautiLink Account, a recovery link is on its way.', 'success');
  } catch (error) {
    setMessage(message, friendlyAuthError(error));
  } finally {
    setBusy(submit, false, '');
  }
});

byId('password-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('[type="submit"]');
  const message = byId('password-message');
  const password = form.password.value;
  setMessage(message, '', '');
  const invalidPassword = passwordError(password);
  if (invalidPassword) return setMessage(message, invalidPassword);
  if (form.passwordConfirm.value !== password) return setMessage(message, 'Passwords do not match.');
  if (!recoverySession) return setMessage(message, 'Request a fresh recovery link before changing the password.');

  setBusy(submit, true, 'Saving password…');
  try {
    const { data, error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
    recoverySession = false;
    window.history.replaceState({}, document.title, '/app/');
    showAuthResult('password_changed');
    await loadMember(data.user);
    showToast('Your password has been updated.');
  } catch (error) {
    setMessage(message, friendlyAuthError(error));
  } finally {
    setBusy(submit, false, '');
  }
});

byId('onboarding-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('[type="submit"]');
  const message = byId('onboarding-message');
  const username = normalizeUsername(form.username.value);
  const displayName = form.displayName.value.trim();
  setMessage(message, '', '');
  const invalidUsername = usernameError(username);
  const invalidName = displayNameError(displayName);
  if (invalidUsername) return setMessage(message, invalidUsername);
  if (invalidName) return setMessage(message, invalidName);

  setBusy(submit, true, 'Setting up profile…');
  try {
    await completeOnboarding(username, displayName);
  } catch (error) {
    setMessage(message, friendlyAuthError(error));
  } finally {
    setBusy(submit, false, '');
  }
});

byId('change-email-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('[type="submit"]');
  const message = byId('change-email-message');
  const email = normalizeEmail(form.email.value);
  setMessage(message, '', '');

  if (!currentMember) return setMessage(message, 'Sign in again before changing your account email.');
  const invalidEmail = emailError(email);
  if (invalidEmail) return setMessage(message, invalidEmail);
  if (email === currentAccountEmail) return setMessage(message, 'Enter a different email address.');

  submit.disabled = true;
  submit.setAttribute('aria-busy', 'true');
  const previous = submit.textContent;
  submit.textContent = 'Sending…';
  try {
    const { error } = await supabase.auth.updateUser(
      { email },
      { emailRedirectTo: authRedirectUrl('email_change') },
    );
    if (error) throw error;
    form.reset();
    setMessage(
      message,
      'Confirmation email sent. Follow the SautiLink confirmation link to finish changing your email address.',
      'success',
    );
  } catch (error) {
    setMessage(message, friendlyAuthError(error));
  } finally {
    submit.disabled = false;
    submit.removeAttribute('aria-busy');
    submit.textContent = previous;
  }
});

byId('send-reauth-code').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  const form = byId('reauth-password-form');
  const message = byId('reauth-password-message');
  setMessage(message, '', '');
  button.disabled = true;
  const previous = button.textContent;
  button.textContent = 'Sending…';

  try {
    const { error } = await supabase.auth.reauthenticate();
    if (error) throw error;
    reauthCodeRequested = true;
    form.hidden = false;
    setMessage(message, 'A verification code was sent to your account email.', 'success');
    byId('reauth-code').focus();
  } catch (error) {
    setMessage(message, friendlyAuthError(error));
  } finally {
    button.disabled = false;
    button.textContent = previous;
  }
});

byId('reauth-password-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('[type="submit"]');
  const message = byId('reauth-password-message');
  const code = normalizeEmailOtp(form.code.value);
  const password = form.password.value;
  setMessage(message, '', '');

  if (!reauthCodeRequested) return setMessage(message, 'Request a fresh verification code first.');
  if (!isValidEmailOtp(code)) return setMessage(message, `Enter the ${EMAIL_OTP_LENGTH}-digit verification code from your email.`);
  const invalidPassword = passwordError(password, { email: currentAccountEmail });
  if (invalidPassword) return setMessage(message, invalidPassword);
  if (form.passwordConfirm.value !== password) return setMessage(message, 'Passwords do not match.');

  setBusy(submit, true, 'Updating password…');
  try {
    const { error } = await supabase.auth.updateUser({ password, nonce: code });
    if (error) throw error;
    reauthCodeRequested = false;
    form.reset();
    form.hidden = true;
    showAuthResult('password_changed');
    showToast('Your password has been updated securely.');
  } catch (error) {
    setMessage(message, friendlyAuthError(error));
  } finally {
    setBusy(submit, false, '');
  }
});

byId('profile-verified-badge').addEventListener('click', openVerificationInfoDialog);
byId('verification-info-close').addEventListener('click', closeVerificationInfoDialog);
byId('verification-info-dialog').addEventListener('cancel', (event) => {
  event.preventDefault();
  closeVerificationInfoDialog();
});
byId('verification-info-dialog').addEventListener('click', (event) => {
  if (event.target === event.currentTarget) closeVerificationInfoDialog();
});

byId('sauti-media-viewer-close').addEventListener('click', closeSautiMediaViewer);
byId('sauti-media-viewer').addEventListener('click', (event) => {
  if (event.target === event.currentTarget) closeSautiMediaViewer();
});

byId('report-dialog-close').addEventListener('click', closeReportDialog);
byId('report-cancel').addEventListener('click', closeReportDialog);
byId('report-dialog').addEventListener('cancel', (event) => {
  event.preventDefault();
  closeReportDialog();
});
byId('report-details').addEventListener('input', (event) => {
  byId('report-details-count').textContent = String(event.currentTarget.value.length);
});
byId('report-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('[type="submit"]');
  const message = byId('report-message');
  const reason = form.reason.value;
  const details = form.details.value.trim();
  setMessage(message, '', '');

  if (!reportTarget) return setMessage(message, 'Choose an item to report.');
  if (!reason) return setMessage(message, 'Choose a reason for this report.');
  if (details.length > 2000) return setMessage(message, 'Report details must be 2,000 characters or fewer.');

  setBusy(submit, true, 'Submitting…');
  try {
    await safetyRequest('/api/safety/report', {
      method: 'POST',
      body: {
        target_type: reportTarget.targetType,
        target_id: reportTarget.targetId,
        reason,
        details,
      },
    });
    closeReportDialog();
    showToast('Report submitted to SautiLink.');
  } catch (error) {
    setMessage(message, error?.message || 'This report could not be submitted.');
  } finally {
    setBusy(submit, false, '');
  }
});

byId('request-account-deletion').addEventListener('click', () => {
  if (!currentMember) return;
  openSettingsDeleteDialog();
});

byId('cancel-account-deletion').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  const message = byId('account-deletion-message');
  setMessage(message, '', '');
  button.disabled = true;
  const previous = button.textContent;
  button.textContent = 'Cancelling…';

  try {
    const data = await safetyRequest('/api/safety/deletion-request', { method: 'DELETE' });
    syncDeletionRequestUI(data.request || null);
    if (currentMember && data.request?.status === 'cancelled') {
      currentMember.is_discoverable = Boolean(data.request.restore_discoverable);
      if (renderedProfileOwner) renderProfile(currentMember, { owner: true });
    }
    setMessage(message, 'Deletion request cancelled.', 'success');
    showToast('Account deletion request cancelled.');
  } catch (error) {
    setMessage(message, error?.message || 'Deletion request could not be cancelled.');
    button.disabled = false;
    button.textContent = previous;
  }
});

document.querySelector('.settings-tabs').addEventListener('click', (event) => {
  const button = event.target.closest('[data-settings-section]');
  if (button) settingsPanel(button.dataset.settingsSection);
});

byId('profile-settings-button').addEventListener('click', () => showMemberSurface('settings'));

for (const [id, column] of [
  ['settings-discoverable', 'is_discoverable'],
  ['settings-external-indexing', 'allow_external_indexing'],
]) {
  byId(id).addEventListener('change', async (event) => {
    const input = event.currentTarget;
    input.disabled = true;
    try {
      const profile = await saveProfileSetting(column, input.checked);
      if (column === 'is_discoverable') {
        byId('settings-external-indexing').disabled = !profile.is_discoverable;
        if (renderedProfileOwner && currentMember) renderProfile(currentMember, { owner: true });
      }
      settingsMessage('Privacy setting saved.');
    } catch {
      settingsMessage('This privacy setting could not be saved.', 'error');
      await loadSettings();
    } finally {
      if (column !== 'allow_external_indexing' || byId('settings-discoverable').checked) input.disabled = false;
    }
  });
}

byId('settings-dm-access').addEventListener('change', async (event) => {
  const select = event.currentTarget;
  select.disabled = true;
  try {
    await saveProfileSetting('dm_access', select.value);
    settingsMessage('Message privacy saved.');
  } catch {
    settingsMessage('Message privacy could not be saved.', 'error');
    await loadSettings();
  } finally {
    select.disabled = false;
  }
});

for (const [id, column] of [
  ['settings-read-receipts', 'read_receipts'],
  ['settings-activity-status', 'activity_status'],
  ['settings-notify-post', 'notify_post_activity'],
  ['settings-notify-messages', 'notify_messages'],
  ['settings-notify-followers', 'notify_followers'],
  ['settings-notify-sautify', 'notify_sautify'],
]) {
  byId(id).addEventListener('change', async (event) => {
    const input = event.currentTarget;
    input.disabled = true;
    try {
      await savePreferenceSetting(column, input.checked);
      if (column === 'notify_messages') {
        if (input.checked) void refreshMessageBadge();
        else syncMessageBadges(0);
      }
      if (column === 'activity_status') {
        if (input.checked && activeConversation?.id) void startDmConversationRealtime(activeConversation.id);
        else if (!input.checked) void stopDmConversationRealtime();
      }
      if (column !== 'notify_messages') void refreshNotificationBadge();
      settingsMessage('Preference saved.');
    } catch {
      settingsMessage('This preference could not be saved.', 'error');
      await loadSettings();
    } finally {
      input.disabled = false;
    }
  });
}

byId('settings-email-digest').addEventListener('change', async (event) => {
  const select = event.currentTarget;
  select.disabled = true;
  try {
    await savePreferenceSetting('email_digest', select.value);
    settingsMessage('Email summary preference saved.');
  } catch {
    settingsMessage('Email summary preference could not be saved.', 'error');
    await loadSettings();
  } finally {
    select.disabled = false;
  }
});

byId('settings-password-reset').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  if (!currentAccountEmail) return settingsMessage('Your account email is unavailable.', 'error');
  button.disabled = true;
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(currentAccountEmail, {
      redirectTo: authRedirectUrl('recovery'),
    });
    if (error) throw error;
    settingsMessage('Password-change email sent. Open the secure link to continue.');
  } catch {
    settingsMessage('Password-change email could not be sent.', 'error');
  } finally {
    button.disabled = false;
  }
});

byId('settings-signout-others').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const { error } = await supabase.auth.signOut({ scope: 'others' });
    if (error) throw error;
    settingsMessage('Other sessions signed out. This session stays active.');
  } catch {
    settingsMessage('Other sessions could not be signed out.', 'error');
  } finally {
    button.disabled = false;
  }
});

byId('settings-blocked-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-settings-safety-action="unblock"]');
  if (button) void removeSettingsSafetyTarget('unblock', button.dataset.targetId, button);
});

byId('settings-muted-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-settings-safety-action="unmute"]');
  if (button) void removeSettingsSafetyTarget('unmute', button.dataset.targetId, button);
});

byId('settings-export-request').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const data = await settingsApiRequest('/api/account/export', {
      method: 'POST',
      body: { request_id: crypto.randomUUID() },
    });
    renderSettingsExport(data.request || null);
    settingsMessage(data.idempotent ? 'Your existing export request is still active.' : 'Data export requested.');
  } catch (error) {
    settingsMessage(error?.message || 'Data export could not be requested.', 'error');
  } finally {
    button.disabled = false;
  }
});

byId('settings-export-cancel').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const data = await settingsApiRequest('/api/account/export', { method: 'DELETE' });
    renderSettingsExport(data.request || null);
    settingsMessage('Data export request cancelled.');
  } catch (error) {
    settingsMessage(error?.message || 'Data export request could not be cancelled.', 'error');
  } finally {
    button.disabled = false;
  }
});

byId('settings-deletion-start').addEventListener('click', openSettingsDeleteDialog);
byId('settings-delete-close').addEventListener('click', closeSettingsDeleteDialog);
byId('settings-delete-cancel-dialog').addEventListener('click', closeSettingsDeleteDialog);
byId('settings-delete-confirmation').addEventListener('input', (event) => {
  byId('settings-delete-confirm').disabled = event.currentTarget.value.trim().toUpperCase() !== 'DELETE';
});

byId('settings-delete-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const submit = byId('settings-delete-confirm');
  const message = byId('settings-delete-message');
  const confirmation = byId('settings-delete-confirmation').value.trim().toUpperCase();
  if (confirmation !== 'DELETE') return setMessage(message, 'Type DELETE to continue.');

  submit.disabled = true;
  setMessage(message, '', '');
  try {
    const data = await settingsApiRequest('/api/safety/deletion-request', {
      method: 'POST',
      body: { confirmation },
    });
    syncDeletionRequestUI(data.request || null);
    renderSettingsDeletion(data.request || null);
    if (currentMember && data.request?.status === 'pending') {
      currentMember.is_discoverable = false;
      byId('settings-discoverable').checked = false;
      byId('settings-external-indexing').disabled = true;
      if (renderedProfileOwner) renderProfile(currentMember, { owner: true });
    }
    closeSettingsDeleteDialog();
    settingsMessage('Deletion requested. Your 14-day recovery window is active.');
    showToast('Account deletion requested.');
  } catch (error) {
    const copy = error?.code === 'RECENT_AUTH_REQUIRED'
      ? 'For security, sign out and sign in again before requesting deletion.'
      : error?.message || 'Account deletion could not be requested.';
    setMessage(message, copy);
    submit.disabled = false;
  }
});

byId('settings-deletion-cancel').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const data = await settingsApiRequest('/api/safety/deletion-request', { method: 'DELETE' });
    syncDeletionRequestUI(data.request || null);
    renderSettingsDeletion(data.request || null);
    if (currentMember && data.request?.status === 'cancelled') {
      currentMember.is_discoverable = Boolean(data.request.restore_discoverable);
      byId('settings-discoverable').checked = currentMember.is_discoverable;
      byId('settings-external-indexing').disabled = !currentMember.is_discoverable;
      if (renderedProfileOwner) renderProfile(currentMember, { owner: true });
    }
    settingsMessage('Deletion request cancelled.');
    showToast('Account deletion request cancelled.');
  } catch (error) {
    settingsMessage(error?.message || 'Deletion request could not be cancelled.', 'error');
  } finally {
    button.disabled = false;
  }
});

byId('profile-edit-button').addEventListener('click', openProfileEditor);
byId('profile-edit-cancel').addEventListener('click', () => closeProfileEditor({ restoreFocus: true }));
byId('profile-cancel-button').addEventListener('click', () => closeProfileEditor({ restoreFocus: true }));
byId('profile-bio-input').addEventListener('input', (event) => {
  byId('profile-bio-count').textContent = String(event.currentTarget.value.length);
});

byId('sauti-body').addEventListener('input', () => updateComposerState());
byId('sauti-media-add').addEventListener('click', () => {
  if (composerMedia.length < 4) byId('sauti-media-file').click();
});
byId('sauti-media-file').addEventListener('change', (event) => {
  addComposerFiles(event.currentTarget.files);
  event.currentTarget.value = '';
});
byId('sauti-media-list').addEventListener('input', (event) => {
  const input = event.target.closest('[data-media-alt]');
  if (!input) return;
  const item = composerMedia.find((entry) => entry.localId === input.dataset.mediaAlt);
  if (!item) return;
  item.altText = input.value.slice(0, 1000);
  persistComposerCurrent();
});
byId('sauti-media-list').addEventListener('click', (event) => {
  const retry = event.target.closest('[data-media-retry]');
  if (retry) {
    void uploadComposerMedia(retry.dataset.mediaRetry);
    return;
  }
  const remove = event.target.closest('[data-media-remove]');
  if (remove) void removeComposerMedia(remove.dataset.mediaRemove);
});
byId('sauti-audience').addEventListener('change', () => updateComposerState());
byId('sauti-reply-access').addEventListener('change', () => updateComposerState());
byId('sauti-save-draft').addEventListener('click', () => {
  if (saveComposerDraft()) setMessage(byId('sauti-message'), 'Draft saved on this device.', 'success');
});
byId('sauti-drafts-toggle').addEventListener('click', () => {
  const panel = byId('composer-drafts');
  panel.hidden = !panel.hidden;
  byId('sauti-drafts-toggle').setAttribute('aria-expanded', String(!panel.hidden));
  if (!panel.hidden) renderComposerDrafts();
});
byId('sauti-drafts-close').addEventListener('click', () => {
  byId('composer-drafts').hidden = true;
  byId('sauti-drafts-toggle').setAttribute('aria-expanded', 'false');
});
byId('sauti-drafts-list').addEventListener('click', (event) => {
  const restore = event.target.closest('[data-restore-draft]');
  if (restore) {
    restoreComposerDraft(restore.dataset.restoreDraft);
    return;
  }
  const remove = event.target.closest('[data-delete-draft]');
  if (remove) deleteComposerDraft(remove.dataset.deleteDraft);
});
byId('sauti-quote-remove').addEventListener('click', () => {
  setComposerQuote(null);
  byId('sauti-body').focus();
});
byId('sauti-composer').addEventListener('submit', async (event) => {
  event.preventDefault();
  await shareSauti();
});
document.querySelector('.share-sauti-button').addEventListener('click', () => {
  showMemberSurface('stream');
  const composer = byId('sauti-composer');
  composer.hidden = false;
  composer.scrollIntoView({ behavior: motionBehavior(), block: 'start' });
  window.setTimeout(() => byId('sauti-body').focus(), 180);
});
window.addEventListener('online', () => {
  syncComposerOnlineState();
  resumeWaitingComposerMedia();
  updateCircleComposerState();
  updateConversationReplyState();
});
window.addEventListener('offline', () => {
  syncComposerOnlineState();
  updateCircleComposerState();
  updateConversationReplyState();
});
byId('stream-retry').addEventListener('click', () => {
  const sharedSauti = readSharedSautiTarget();
  if (sharedSauti) void loadSharedSautiTarget(sharedSauti);
  else void loadStream({ reset: true });
});
byId('stream-load-more').addEventListener('click', () => loadStream());
byId('conversation-back').addEventListener('click', () => {
  if (window.history.length > 1) window.history.back();
  else showMemberSurface('stream');
});
byId('conversation-retry').addEventListener('click', () => {
  const route = readConversationRoute();
  if (route?.postId) void loadConversation(route.postId);
});
byId('conversation-sort').addEventListener('change', renderConversationThread);
byId('conversation-reply-root').addEventListener('click', () => {
  const root = conversationPostById(activeSautiConversation?.rootId);
  if (root) {
    setConversationReplyTarget(root);
    byId('conversation-reply-body').focus();
  }
});
byId('conversation-reply-body').addEventListener('input', () => {
  ensureThreadReplyRequestId();
  updateConversationReplyState();
  persistThreadReplyDraft();
});
byId('conversation-reply-form').addEventListener('submit', (event) => {
  event.preventDefault();
  void submitThreadReply();
});
function handleSautiFeedClick(event) {
  const media = event.target.closest('[data-open-media-id]');
  if (media) {
    openSautiMediaViewer(media);
    return;
  }

  const branch = event.target.closest('[data-open-thread-branch]');
  if (branch) {
    openSautiTarget(branch.dataset.openThreadBranch);
    return;
  }

  const openQuoted = event.target.closest('[data-open-sauti]');
  if (openQuoted) {
    openSautiTarget(openQuoted.dataset.openSauti);
    return;
  }

  const repostToggle = event.target.closest('[data-repost-toggle]');
  if (repostToggle) {
    const card = repostToggle.closest('.sauti-card');
    const coreButton = card?.querySelector('[data-sauti-action="repost"]');
    if (card && coreButton) {
      closeRepostMenus();
      void toggleRepost(card, coreButton);
    }
    return;
  }

  const quoteButton = event.target.closest('[data-quote-sauti]');
  if (quoteButton) {
    const card = quoteButton.closest('.sauti-card');
    if (card) startQuoteSauti(card);
    return;
  }

  const reportPostButton = event.target.closest('[data-report-post]');
  if (reportPostButton) {
    openReportDialog('post', reportPostButton.dataset.reportPost, reportPostButton.dataset.reportLabel);
    return;
  }

  const reportCommentButton = event.target.closest('[data-report-comment]');
  if (reportCommentButton) {
    openReportDialog('comment', reportCommentButton.dataset.reportComment, reportCommentButton.dataset.reportLabel);
    return;
  }

  const deleteSautiButton = event.target.closest('[data-delete-sauti]');
  if (deleteSautiButton) {
    void deleteSauti(deleteSautiButton.dataset.deleteSauti, deleteSautiButton);
    return;
  }

  const deleteCommentButton = event.target.closest('[data-delete-comment]');
  if (deleteCommentButton) {
    void deleteComment(
      deleteCommentButton.dataset.deleteComment,
      deleteCommentButton.dataset.postId,
      deleteCommentButton,
    );
    return;
  }

  const action = event.target.closest('[data-sauti-action]');
  if (!action) return;
  const card = action.closest('.sauti-card');
  if (!card) return;

  if (action.dataset.sautiAction === 'like') void toggleLike(card, action);
  if (action.dataset.sautiAction === 'comments') {
    const post = conversationPostById(card.dataset.postId);
    if (!conversationSurface.hidden && activeSautiConversation && post) {
      setConversationReplyTarget(post);
      byId('conversation-reply-body').focus();
      byId('conversation-reply-form').scrollIntoView({ behavior: motionBehavior(), block: 'center' });
    } else {
      openSautiTarget(card.dataset.postId);
    }
  }
  if (action.dataset.sautiAction === 'repost') toggleRepostMenu(card);
  if (action.dataset.sautiAction === 'save') void toggleSave(card, action);
  if (action.dataset.sautiAction === 'share') void shareSautiLink(card, action);
}

function handleSautiFeedSubmit(event) {
  const form = event.target.closest('[data-comment-form]');
  if (!form) return;
  event.preventDefault();
  void submitComment(form);
}

for (const feedId of ['stream-feed', 'circle-stream-feed', 'discover-sauti-feed', 'saved-sauti-feed', 'conversation-root', 'conversation-thread']) {
  byId(feedId).addEventListener('click', handleSautiFeedClick);
  byId(feedId).addEventListener('submit', handleSautiFeedSubmit);
}

byId('profile-follow-button').addEventListener('click', () => {
  void toggleProfileFollow();
});
byId('profile-message-button').addEventListener('click', () => {
  const button = byId('profile-message-button');
  if (!button.hidden && button.dataset.peerId) {
    void openDirectConversation(button.dataset.peerId, button.dataset.username);
  }
});
byId('profile-mute-button').addEventListener('click', () => {
  void toggleProfileMute();
});
byId('profile-block-button').addEventListener('click', () => {
  void toggleProfileBlock();
});
byId('profile-report-button').addEventListener('click', () => {
  const button = byId('profile-report-button');
  openReportDialog(
    'profile',
    button.dataset.targetId,
    `Report @${button.dataset.username || renderedProfileUsername} to SautiLink.`,
  );
});

for (const slot of ['avatar', 'header']) {
  const uploadButton = byId(`profile-${slot}-upload-button`);
  const removeButton = byId(`profile-${slot}-remove-button`);
  const fileInput = byId(`profile-${slot}-file`);

  uploadButton.addEventListener('click', () => {
    if (!uploadButton.disabled) fileInput.click();
  });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file) await uploadProfileMedia(slot, file);
  });

  removeButton.addEventListener('click', () => removeProfileMedia(slot));
}


byId('profile-name-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!currentMember) return;
  const value = String(byId('profile-name-input').value || '').trim();
  const invalid = displayNameError(value);
  if (invalid) return setMessage(byId('profile-name-message'), invalid);
  await submitIdentityChange('display_name', value, byId('profile-name-message'), byId('profile-name-submit'));
});

byId('profile-username-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!currentMember) return;
  const value = normalizeUsername(byId('profile-username-input').value);
  const invalid = usernameError(value);
  if (invalid) return setMessage(byId('profile-username-message'), invalid);
  await submitIdentityChange('username', value, byId('profile-username-message'), byId('profile-username-submit'));
});

byId('profile-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('[type="submit"]');
  const message = byId('profile-form-message');
  setMessage(message, '', '');

  let updates;
  try {
    updates = profileValues(form);
  } catch (error) {
    return setMessage(message, error.message);
  }

  setBusy(submit, true, 'Saving profile…');
  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user || user.id !== currentMemberId) throw new Error('Your session needs to be refreshed before editing this profile.');

    const { data, error } = await supabase
      .from('social_profiles')
      .update(updates)
      .eq('id', user.id)
      .select('id, username, display_name, bio, location, website_url, is_discoverable, is_verified, verification_badge_type, followers_count, following_count')
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('The profile was not updated. Refresh the page and try again.');

    currentMember = { ...currentMember, ...data };
    renderProfile(currentMember);
    closeProfileEditor({ restoreFocus: true });
    showToast('Profile basics saved.');
  } catch (error) {
    const safeMessage = error?.message?.startsWith('Your session') || error?.message?.startsWith('The profile')
      ? error.message
      : 'We could not save your profile. Check the fields and try again.';
    setMessage(message, safeMessage);
  } finally {
    setBusy(submit, false, '');
  }
});

async function signOut() {
  streamRequest += 1;
  discoverRequest += 1;
  savedRequest += 1;
  circlesRequest += 1;
  activeCircle = null;
  resetCircleStreamView({ hide: true });
  resetStreamState();
  profileMediaRenderRequest += 1;
  clearProfileMediaUrl('avatar');
  clearProfileMediaUrl('header');
  const { error } = await supabase.auth.signOut();
  if (error) return showToast('Sign out failed. Please try again.');
  currentMember = null;
  currentMemberId = '';
  currentAccountEmail = '';
  currentDeletionRequest = null;
  syncDeletionRequestUI(null);
  syncAccountSecurityEmail();
  await applyLocationRoute();
}

byId('signout-button').addEventListener('click', signOut);
mobileSignoutButton.addEventListener('click', signOut);

supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY') {
    recoverySession = true;
    if (!resolvingAuthTokenHash) {
      showAuthResult('recovery');
      cleanAuthReturnLocation();
      window.setTimeout(() => showAuthPanel('password'), 0);
    }
    return;
  }
  if (event === 'SIGNED_OUT') {
    if (pendingSignup) {
      window.setTimeout(() => {
        byId('verify-email').textContent = pendingSignup.email;
        showAuthPanel('verify');
      }, 0);
      return;
    }
    if (pendingPasswordlessEmail && !byId('passwordless-verify-form').hidden) {
      window.setTimeout(() => showAuthPanel('passwordless'), 0);
      return;
    }
    void stopDmRealtime();
    currentMember = null;
    currentMemberId = '';
    currentAccountEmail = '';
    syncAccountSecurityEmail();
    window.setTimeout(() => applyLocationRoute(), 0);
    return;
  }
  if (event === 'SIGNED_IN' && session?.user && !pendingSignup && !recoverySession && !resolvingAuthTokenHash) {
    if (INITIAL_AUTH_RETURN.action) {
      if (INITIAL_AUTH_RETURN.action === 'email_change') showEmailChangeResult(session.user);
      else showAuthResult(INITIAL_AUTH_RETURN.action);
      cleanAuthReturnLocation();
    }
    window.setTimeout(() => loadMember(session.user), 0);
  }
});

window.addEventListener('popstate', () => {
  applyLocationRoute();
});

async function bootstrap() {
  configureEmailOtpInputs();
  await refreshProfileMediaCapability();
  try {
    if (INITIAL_AUTH_RETURN.error) {
      showAuthResult('', { error: INITIAL_AUTH_RETURN.error });
    }

    if (await resolveTokenHashReturn()) return;

    const { data: { session }, error } = await supabase.auth.getSession();
    if (error || !session) {
      currentMember = null;
      currentMemberId = '';
      currentAccountEmail = '';
      syncAccountSecurityEmail();
      if (INITIAL_AUTH_RETURN.error) cleanAuthReturnLocation();
      if (pendingSignup) {
        byId('verify-email').textContent = pendingSignup.email;
        showAuthPanel('verify');
        byId('signup-verify-code').focus();
        return;
      }
      if (pendingPasswordlessEmail) {
        showAuthPanel('passwordless');
        byId('passwordless-verify-form').hidden = false;
        byId('passwordless-code').focus();
        return;
      }
      return applyLocationRoute();
    }

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      currentMember = null;
      currentMemberId = '';
      currentAccountEmail = '';
      syncAccountSecurityEmail();
      return applyLocationRoute();
    }

    if (INITIAL_AUTH_RETURN.action === 'recovery') {
      recoverySession = true;
      showAuthResult('recovery');
      cleanAuthReturnLocation();
      showAuthPanel('password');
      return;
    }

    if (INITIAL_AUTH_RETURN.action && !authResultKey) {
      if (INITIAL_AUTH_RETURN.action === 'email_change') showEmailChangeResult(user);
      else showAuthResult(INITIAL_AUTH_RETURN.action);
      cleanAuthReturnLocation();
    }

    if (pendingPasswordlessEmail) byId('passwordless-verify-form').hidden = false;
    if (!recoverySession) await loadMember(user);
  } catch {
    currentMember = null;
    currentMemberId = '';
    currentAccountEmail = '';
    syncAccountSecurityEmail();
    await applyLocationRoute();
  }
}

bootstrap();
