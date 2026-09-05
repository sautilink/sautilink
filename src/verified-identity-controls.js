const VERIFIED_IDENTITY_STYLESHEET = '/app/assets/verified-identity-controls.css';

let latestIdentityState = null;

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
  const editor = document.getElementById('profile-editor');
  if (!editor) return;
  new MutationObserver(() => {
    if (!editor.hidden && latestIdentityState) scheduleApply(latestIdentityState);
  }).observe(editor, { attributes: true, attributeFilter: ['hidden'] });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installVerifiedIdentityControls, { once: true });
} else {
  queueMicrotask(installVerifiedIdentityControls);
}
