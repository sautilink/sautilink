import { createClient } from '@supabase/supabase-js';
import { consumeGuestReturnTarget } from './guest-entry-gate.js';

const SUPABASE_URL = 'https://rggpyiterdbbugluejcs.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_omJ-5Mem-K4vgm6WLXRzJQ_jeGs65ca';
const USERNAME_LOGIN_URL = `${SUPABASE_URL}/functions/v1/sautilink-username-login`;
const GENERIC_LOGIN_ERROR = 'Incorrect email/username or password.';

const usernameLoginClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: 'sautilink.auth.session',
  },
});

export function normalizeLoginUsername(value) {
  return String(value || '').trim().replace(/^@+/, '').toLowerCase();
}

export function looksLikeLoginEmail(value) {
  const candidate = String(value || '').trim();
  return /^[^\s@]+@[^\s@]+$/.test(candidate);
}

export function isValidLoginUsername(value) {
  return /^[a-z0-9][a-z0-9._]{2,29}$/.test(normalizeLoginUsername(value));
}

function setMessage(message) {
  const node = document.getElementById('login-message');
  if (!node) return;
  node.textContent = message || '';
  node.className = 'form-message';
  node.hidden = !message;
}

function setBusy(button, busy) {
  if (!button) return;
  const label = button.querySelector('span');
  if (!button.dataset.usernameLoginLabel) {
    button.dataset.usernameLoginLabel = label?.textContent || button.textContent.trim() || 'Log in';
  }
  if (label) label.textContent = busy ? 'Logging in…' : button.dataset.usernameLoginLabel;
  button.disabled = busy;
  button.setAttribute('aria-busy', String(busy));
}

async function usernamePasswordLogin(identifier, password) {
  const response = await fetch(USERNAME_LOGIN_URL, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      username: normalizeLoginUsername(identifier),
      password: String(password || ''),
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    const error = new Error(payload?.error?.message || GENERIC_LOGIN_ERROR);
    error.code = payload?.error?.code || 'USERNAME_LOGIN_FAILED';
    throw error;
  }
  return payload?.data?.session || null;
}

async function handleUsernameSubmit(event) {
  const form = event.currentTarget;
  const identifierField = form.elements?.email;
  const identifier = String(identifierField?.value || '').trim();

  // Keep the existing Supabase email/password flow completely unchanged.
  if (looksLikeLoginEmail(identifier)) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  const username = normalizeLoginUsername(identifier);
  const password = String(form.elements?.password?.value || '');
  const submit = form.querySelector('[type="submit"]');

  if (!isValidLoginUsername(username)) {
    setMessage('Enter a valid email or username.');
    identifierField?.focus();
    return;
  }
  if (!password) {
    setMessage('Enter your password.');
    form.elements?.password?.focus();
    return;
  }

  setMessage('');
  setBusy(submit, true);
  try {
    const session = await usernamePasswordLogin(username, password);
    if (!session?.access_token || !session?.refresh_token) throw new Error('SESSION_MISSING');

    const { error } = await usernameLoginClient.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    });
    if (error) throw error;

    window.location.assign(consumeGuestReturnTarget() || '/home');
  } catch (error) {
    setMessage(error?.code === 'INVALID_CREDENTIALS' ? GENERIC_LOGIN_ERROR : (error?.message || 'We could not sign you in. Try again.'));
  } finally {
    setBusy(submit, false);
  }
}

function installUsernameLogin() {
  const form = document.getElementById('login-form');
  const identifier = document.getElementById('login-email');
  if (!form || !identifier || form.dataset.usernameLoginReady === 'true') return;

  form.dataset.usernameLoginReady = 'true';
  identifier.type = 'text';
  identifier.inputMode = 'text';
  identifier.autocomplete = 'username';
  identifier.placeholder = 'Email or username';
  identifier.setAttribute('aria-label', 'Email or username');
  const label = document.querySelector('label[for="login-email"]');
  if (label) label.textContent = 'Email or username';

  form.addEventListener('submit', handleUsernameSubmit, true);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installUsernameLogin, { once: true });
} else {
  queueMicrotask(installUsernameLogin);
}
