const VERIFIED_IDENTITY_STYLESHEET = '/app/assets/verified-identity-controls.css';
const VERIFICATION_PROFILE_URL = 'https://rggpyiterdbbugluejcs.supabase.co';
const VERIFICATION_PROFILE_PUBLISHABLE_KEY = 'sb_publishable_omJ-5Mem-K4vgm6WLXRzJQ_jeGs65ca';
const VERIFICATION_AUTH_STORAGE_KEY = 'sautilink.auth.session';

let latestIdentityState = null;
let verificationSinceRequest = 0;
const verificationSinceCache = new Map();

function ensureStylesheet() {
  if (document.querySelector(`link[href="${VERIFIED_IDENTITY_STYLESHEET}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = VERIFIED_IDENTITY_STYLESHEET;
  document.head.append(link);
}

function pluralTimes(value) {
  return value === 1 ? 'time' : 'times';
}

function applyVerifiedIdentityControls(data = latestIdentityState) {
  if (!data?.profile) return;
  latestIdentityState = data;

  const profile = data.profile;
  const stateNode = document.getElementById('profile-identity-state');
  const summary = document.getElementById('profile-identity-summary');
  const nameHint = document.getElementById('profile-name-hint');
  const nameSubmit = document.getElementById('profile-name-submit');
  const usernameHint = document.getElementById('profile-username-hint');
  const usernameInput = document.getElementById('profile-username-input');
  const usernameSubmit = document.getElementById('profile-username-submit');
  const usernameField = usernameInput?.closest('.identity-username-field');

  const permanentlyLocked = Boolean(data.username?.locked_permanently || profile.is_verified);

  if (profile.is_verified) {
    const remaining = Number(data.display_name?.changes_remaining_month ?? 2);
    if (stateNode) stateNode.textContent = 'Verified';
    if (summary) summary.textContent = 'Verified accounts can change their display name twice per month. Username is permanently locked.';
    if (nameSubmit) {
      nameSubmit.textContent = 'Save name';
      nameSubmit.disabled = remaining < 1;
    }
    if (nameHint) {
      nameHint.textContent = remaining > 0
        ? `You can change your display name ${remaining} more ${pluralTimes(remaining)} this month.`
        : `You have used both display name changes for this month. You can change it again ${data.display_name?.next_change_at ? new Date(data.display_name.next_change_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'next month'}.`;
    }
  }

  if (permanentlyLocked) {
    if (usernameInput) {
      usernameInput.disabled = true;
      usernameInput.setAttribute('aria-disabled', 'true');
    }
    usernameField?.classList.add('verified-username-locked');
    if (usernameSubmit) {
      usernameSubmit.disabled = true;
      usernameSubmit.dataset.verifiedUsernameLocked = 'true';
    }
    if (usernameHint) usernameHint.textContent = 'Username is permanently locked after verification.';
  } else {
    if (usernameInput) {
      usernameInput.disabled = false;
      usernameInput.removeAttribute('aria-disabled');
    }
    usernameField?.classList.remove('verified-username-locked');
    if (usernameSubmit) delete usernameSubmit.dataset.verifiedUsernameLocked;
  }
}

function scheduleApply(data) {
  latestIdentityState = data;
  window.setTimeout(() => applyVerifiedIdentityControls(data), 0);
  window.setTimeout(() => applyVerifiedIdentityControls(data), 60);
}

function storedAccessToken() {
  try {
    const raw = window.localStorage.getItem(VERIFICATION_AUTH_STORAGE_KEY);
    if (!raw) return '';
    const value = JSON.parse(raw);
    const session = value?.access_token ? value : value?.currentSession;
    return String(session?.access_token || '');
  } catch {
    return '';
  }
}

function currentProfileUsername() {
  const value = String(document.getElementById('profile-username')?.textContent || '').trim();
  const username = value.replace(/^@/, '').toLowerCase();
  return /^[a-z0-9][a-z0-9._]{2,29}$/.test(username) ? username : '';
}

function verificationMonthYear(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function ensureVerificationSinceLine() {
  let line = document.getElementById('verification-info-since');
  if (line) return line;
  const message = document.getElementById('verification-info-message');
  if (!message) return null;
  line = document.createElement('p');
  line.id = 'verification-info-since';
  line.className = 'verification-info-since';
  line.hidden = true;
  message.insertAdjacentElement('afterend', line);
  return line;
}

function renderVerificationSince(value) {
  const line = ensureVerificationSinceLine();
  if (!line) return;
  const monthYear = verificationMonthYear(value);
  line.textContent = monthYear ? `Verified since ${monthYear}` : '';
  line.hidden = !monthYear;
}

async function loadVerificationSince(username) {
  if (!username) return renderVerificationSince('');
  if (verificationSinceCache.has(username)) {
    renderVerificationSince(verificationSinceCache.get(username));
    return;
  }

  const accessToken = storedAccessToken();
  if (!accessToken) return renderVerificationSince('');

  const requestId = ++verificationSinceRequest;
  const params = new URLSearchParams({
    select: 'username,username_locked_at,is_verified',
    username: `eq.${username}`,
    is_verified: 'eq.true',
    limit: '1',
  });

  try {
    const response = await nativeFetch(`${VERIFICATION_PROFILE_URL}/rest/v1/social_profiles?${params}`, {
      headers: {
        apikey: VERIFICATION_PROFILE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });
    if (requestId !== verificationSinceRequest || currentProfileUsername() !== username) return;
    if (!response.ok) return renderVerificationSince('');
    const rows = await response.json().catch(() => []);
    const verifiedAt = Array.isArray(rows) ? String(rows[0]?.username_locked_at || '') : '';
    verificationSinceCache.set(username, verifiedAt);
    renderVerificationSince(verifiedAt);
  } catch {
    if (requestId === verificationSinceRequest && currentProfileUsername() === username) {
      renderVerificationSince('');
    }
  }
}

function syncVerificationSince() {
  const badge = document.getElementById('profile-verified-badge');
  const username = currentProfileUsername();
  if (!badge || badge.hidden || !username) {
    verificationSinceRequest += 1;
    renderVerificationSince('');
    return;
  }
  void loadVerificationSince(username);
}

const nativeFetch = window.fetch.bind(window);
window.fetch = async (...args) => {
  const response = await nativeFetch(...args);
  try {
    const requestUrl = typeof args[0] === 'string' || args[0] instanceof URL
      ? String(args[0])
      : String(args[0]?.url || '');
    const url = new URL(requestUrl, window.location.origin);
    const method = String(args[1]?.method || args[0]?.method || 'GET').toUpperCase();
    if (method === 'GET' && url.origin === window.location.origin && url.pathname === '/api/account/identity' && response.ok) {
      const payload = await response.clone().json().catch(() => null);
      if (payload?.ok && payload?.data?.profile) scheduleApply(payload.data);
    }
  } catch {
    // Identity styling is progressive enhancement; the account API remains authoritative.
  }
  return response;
};

function installVerifiedIdentityControls() {
  ensureStylesheet();
  ensureVerificationSinceLine();

  const editor = document.getElementById('profile-editor');
  if (editor) {
    new MutationObserver(() => {
      if (!editor.hidden && latestIdentityState) scheduleApply(latestIdentityState);
    }).observe(editor, { attributes: true, attributeFilter: ['hidden'] });
  }

  const badge = document.getElementById('profile-verified-badge');
  const username = document.getElementById('profile-username');
  if (badge) {
    new MutationObserver(syncVerificationSince).observe(badge, {
      attributes: true,
      attributeFilter: ['hidden'],
    });
    badge.addEventListener('click', syncVerificationSince);
  }
  if (username) {
    new MutationObserver(syncVerificationSince).observe(username, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  }

  syncVerificationSince();
  window.setTimeout(syncVerificationSince, 80);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installVerifiedIdentityControls, { once: true });
} else {
  queueMicrotask(installVerifiedIdentityControls);
}
