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

const SUPABASE_URL = 'https://rggpyiterdbbugluejcs.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_omJ-5Mem-K4vgm6WLXRzJQ_jeGs65ca';
const USERNAME_API = `${SUPABASE_URL}/functions/v1/sautilink-waitlist`;

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
const authTabs = byId('auth-tabs');
const railAccount = byId('rail-account');
const mobilePreviewBadge = byId('mobile-preview-badge');
const mobileSignoutButton = byId('mobile-signout-button');
const toast = byId('toast');

const panels = {
  login: byId('login-panel'),
  signup: byId('signup-panel'),
  verify: byId('verify-panel'),
  recovery: byId('recovery-panel'),
  password: byId('password-panel'),
  onboarding: byId('onboarding-panel'),
};

let pendingSignup = null;
let usernameTimer = 0;
let usernameRequest = 0;
let availableUsername = '';
let recoverySession = false;
let toastTimer = 0;

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

function setBusy(button, busy, label) {
  if (!button) return;
  const text = button.querySelector('span');
  if (!button.dataset.defaultLabel) button.dataset.defaultLabel = text?.textContent || button.textContent.trim();
  if (text) text.textContent = busy ? label : button.dataset.defaultLabel;
  button.disabled = busy;
  button.setAttribute('aria-busy', String(busy));
}

function showAuthPanel(name) {
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
  railAccount.hidden = true;
  mobilePreviewBadge.hidden = false;
  mobileSignoutButton.hidden = true;
  document.querySelector('.share-sauti-button').disabled = true;
  showAuthPanel(mode);
}

function avatarLetter(value) {
  return String(value || 'S').trim().charAt(0).toUpperCase() || 'S';
}

function renderMember(profile) {
  const displayName = profile.display_name || profile.full_name || profile.username;
  const username = profile.username;
  const letter = avatarLetter(displayName);

  byId('member-avatar').textContent = letter;
  byId('rail-avatar').textContent = letter;
  byId('member-display-name').textContent = displayName;
  byId('member-username').textContent = `@${username}`;
  byId('rail-name').textContent = displayName;
  byId('rail-username').textContent = `@${username}`;
  byId('member-first-name').textContent = displayName.split(/\s+/)[0];

  loadingView.hidden = true;
  authView.hidden = true;
  memberView.hidden = false;
  railAccount.hidden = false;
  mobilePreviewBadge.hidden = true;
  mobileSignoutButton.hidden = false;
  document.querySelector('.share-sauti-button').disabled = true;
}

async function loadMember(user) {
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
    .select('username, display_name, is_discoverable')
    .eq('id', user.id)
    .maybeSingle();

  if (socialError || !social) {
    showSignedOut('login');
    setMessage(byId('login-message'), 'Your account is secure, but social profile setup is unavailable right now.');
    return;
  }

  renderMember({ ...account, ...social });
}

async function completeOnboarding(username, displayName) {
  const { data, error } = await supabase.rpc('complete_social_onboarding', {
    p_username: username,
    p_display_name: displayName,
  });
  if (error) throw error;
  renderMember(data);
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
    if (mode === 'login' || mode === 'signup') showAuthPanel(mode);
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
    if (button.dataset.previewNav !== 'stream') showToast('This area opens in a later Phase 1 slice.');
  });
});

byId('show-recovery').addEventListener('click', () => showAuthPanel('recovery'));
byId('cancel-verification').addEventListener('click', () => {
  pendingSignup = null;
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

    pendingSignup = { email, username, displayName };
    byId('verify-email').textContent = email;
    byId('verification-code').value = '';
    setMessage(byId('verify-message'), '', '');
    showAuthPanel('verify');
    byId('verification-code').focus();
  } catch (error) {
    setMessage(message, friendlyAuthError(error));
  } finally {
    setBusy(submit, false, '');
  }
});

byId('verify-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('[type="submit"]');
  const message = byId('verify-message');
  const code = String(form.code.value || '').replace(/\D/g, '');
  setMessage(message, '', '');

  if (!pendingSignup) return showAuthPanel('signup');
  if (code.length < 6 || code.length > 10) return setMessage(message, 'Enter the complete verification code.');

  setBusy(submit, true, 'Verifying…');
  try {
    const { error } = await supabase.auth.verifyOtp({
      email: pendingSignup.email,
      token: code,
      type: 'email',
    });
    if (error) throw error;
    const signup = pendingSignup;
    pendingSignup = null;
    await completeOnboarding(signup.username, signup.displayName);
  } catch (error) {
    setMessage(message, friendlyAuthError(error));
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
    const { error } = await supabase.auth.resend({ type: 'signup', email: pendingSignup.email });
    if (error) throw error;
    setMessage(message, 'A new code has been sent.', 'success');
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
    const redirectTo = new URL('/app/', window.location.origin).href;
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
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

async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) return showToast('Sign out failed. Please try again.');
  showSignedOut('login');
}

byId('signout-button').addEventListener('click', signOut);
mobileSignoutButton.addEventListener('click', signOut);

supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY') {
    recoverySession = true;
    window.setTimeout(() => showAuthPanel('password'), 0);
    return;
  }
  if (event === 'SIGNED_OUT') {
    window.setTimeout(() => showSignedOut('login'), 0);
    return;
  }
  if (event === 'SIGNED_IN' && session?.user && !pendingSignup && !recoverySession) {
    window.setTimeout(() => loadMember(session.user), 0);
  }
});

async function bootstrap() {
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error || !session) return showSignedOut('login');
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return showSignedOut('login');
    if (!recoverySession) await loadMember(user);
  } catch {
    showSignedOut('login');
  }
}

bootstrap();
