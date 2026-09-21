import { createClient } from '@supabase/supabase-js';
import {
  emailError,
  friendlyAuthError,
  isAuthEmailDeliveryError,
  normalizeEmail,
  passwordError,
} from './auth-validation.js';
import {
  EMAIL_OTP_LENGTH,
  isValidEmailOtp,
  normalizeEmailOtp,
} from './auth-email-contract.js';

const SUPABASE_URL = 'https://rggpyiterdbbugluejcs.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_omJ-5Mem-K4vgm6WLXRzJQ_jeGs65ca';
const AUTH_STORAGE_KEY = 'sautilink.auth.session';
const RECOVERY_LOCK_KEY = 'sautilink.auth.recovery_lock.v2';
const EMAIL_CHANGE_PENDING_KEY = 'sautilink.auth.pending_email_change.v2';
const EMAIL_CHANGE_SUCCESS_KEY = 'sautilink.auth.email_change_success.v2';
const STYLE_HREF = '/app/assets/auth-flow-hardening.css?v=20260915-authflow1';

let hardenedAuthClient = null;
let recoveryObserver = null;
let recoveryEnforcementQueued = false;

function safeSessionGet(key) {
  try {
    return sessionStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

function safeSessionSet(key, value) {
  try {
    if (value === null || value === undefined || value === '') sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, String(value));
  } catch {
    // Auth flow still works in memory when browser storage is unavailable.
  }
}

function authClient() {
  if (!hardenedAuthClient) {
    hardenedAuthClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: AUTH_STORAGE_KEY,
      },
    });
  }
  return hardenedAuthClient;
}

function isInitialRecoveryReturn() {
  const url = new URL(window.location.href);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
  return url.searchParams.get('auth_action') === 'recovery'
    || url.searchParams.get('type') === 'recovery'
    || hash.get('type') === 'recovery';
}

function recoveryLocked() {
  return safeSessionGet(RECOVERY_LOCK_KEY) === '1';
}

function setRecoveryLock(active) {
  safeSessionSet(RECOVERY_LOCK_KEY, active ? '1' : '');
}

if (isInitialRecoveryReturn()) setRecoveryLock(true);

function ensureStylesheet() {
  if (document.querySelector(`link[href="${STYLE_HREF}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = STYLE_HREF;
  document.head.append(link);
}

function setFormMessage(node, message, type = 'error') {
  if (!node) return;
  node.textContent = message || '';
  node.className = `form-message${type === 'success' ? ' success' : ''}`;
  node.hidden = !message;
}

function setButtonBusy(button, busy, busyLabel = '') {
  if (!button) return;
  if (!button.dataset.authFlowDefaultLabel) {
    const text = button.querySelector('span');
    button.dataset.authFlowDefaultLabel = text?.textContent || button.textContent.trim();
  }
  const text = button.querySelector('span');
  const label = busy ? busyLabel : button.dataset.authFlowDefaultLabel;
  if (text) text.textContent = label;
  else button.textContent = label;
  button.disabled = busy;
  button.setAttribute('aria-busy', String(busy));
}

function enforceRecoveryPanel() {
  if (!recoveryLocked()) return;
  const loading = document.getElementById('loading-view');
  const member = document.getElementById('member-view');
  const authView = document.getElementById('auth-view');
  const authTabs = document.getElementById('auth-tabs');
  const passwordPanel = document.getElementById('password-panel');
  if (!authView || !passwordPanel) return;

  if (!document.body.classList.contains('auth-entry')) document.body.classList.add('auth-entry');
  if (document.body.dataset.authMode !== 'password') document.body.dataset.authMode = 'password';
  if (loading && !loading.hidden) loading.hidden = true;
  if (member && !member.hidden) member.hidden = true;
  if (authView.hidden) authView.hidden = false;
  if (authTabs && !authTabs.hidden) authTabs.hidden = true;

  for (const id of [
    'login-panel',
    'signup-panel',
    'verify-panel',
    'passwordless-panel',
    'recovery-panel',
    'onboarding-panel',
  ]) {
    const panel = document.getElementById(id);
    if (panel && !panel.hidden) panel.hidden = true;
  }
  if (passwordPanel.hidden) passwordPanel.hidden = false;
}

function recoveryPanelNeedsEnforcement() {
  if (!recoveryLocked()) return false;
  const loading = document.getElementById('loading-view');
  const member = document.getElementById('member-view');
  const authView = document.getElementById('auth-view');
  const authTabs = document.getElementById('auth-tabs');
  const passwordPanel = document.getElementById('password-panel');
  if (!authView || !passwordPanel) return false;

  if (!document.body.classList.contains('auth-entry')) return true;
  if (document.body.dataset.authMode !== 'password') return true;
  if (loading && !loading.hidden) return true;
  if (member && !member.hidden) return true;
  if (authView.hidden) return true;
  if (authTabs && !authTabs.hidden) return true;
  if (passwordPanel.hidden) return true;

  return [
    'login-panel',
    'signup-panel',
    'verify-panel',
    'passwordless-panel',
    'recovery-panel',
    'onboarding-panel',
  ].some((id) => {
    const panel = document.getElementById(id);
    return panel && !panel.hidden;
  });
}

function scheduleRecoveryPanelEnforcement() {
  if (recoveryEnforcementQueued || !recoveryPanelNeedsEnforcement()) return;
  recoveryEnforcementQueued = true;
  queueMicrotask(() => {
    recoveryEnforcementQueued = false;
    if (recoveryPanelNeedsEnforcement()) enforceRecoveryPanel();
  });
}

function installRecoveryGuard() {
  if (!recoveryLocked()) return;
  ensureStylesheet();
  enforceRecoveryPanel();
  if (recoveryObserver) return;

  recoveryObserver = new MutationObserver(() => {
    if (!recoveryLocked()) {
      recoveryObserver?.disconnect();
      recoveryObserver = null;
      recoveryEnforcementQueued = false;
      return;
    }
    scheduleRecoveryPanelEnforcement();
  });
  recoveryObserver.observe(document.documentElement, {
    subtree: true,
    attributes: true,
    attributeFilter: ['hidden', 'class', 'data-auth-mode'],
  });
}

async function waitForRecoverySession(timeoutMs = 5000) {
  const client = authClient();
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const { data, error } = await client.auth.getSession();
    if (!error && data.session?.user) return data.session;
    await new Promise((resolve) => window.setTimeout(resolve, 120));
  }
  return null;
}

async function passwordUpdateCommittedAfterEmailError(client, session, error) {
  if (!isAuthEmailDeliveryError(error)) return false;

  const beforeUpdatedAt = Date.parse(session?.user?.updated_at || '');
  if (!Number.isFinite(beforeUpdatedAt)) return false;

  const { data, error: userError } = await client.auth.getUser();
  const user = data?.user;
  const afterUpdatedAt = Date.parse(user?.updated_at || '');

  return !userError &&
    user?.id === session.user.id &&
    Number.isFinite(afterUpdatedAt) &&
    afterUpdatedAt > beforeUpdatedAt;
}

async function handleRecoveryPasswordSubmit(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || form.id !== 'password-form' || !recoveryLocked()) return;

  event.preventDefault();
  event.stopImmediatePropagation();

  const message = document.getElementById('password-message');
  const submit = form.querySelector('[type="submit"]');
  const password = String(form.password?.value || '');
  const passwordConfirm = String(form.passwordConfirm?.value || '');
  setFormMessage(message, '');

  const invalidPassword = passwordError(password);
  if (invalidPassword) return setFormMessage(message, invalidPassword);
  if (password !== passwordConfirm) return setFormMessage(message, 'Passwords do not match.');

  setButtonBusy(submit, true, 'Saving password…');
  try {
    const session = await waitForRecoverySession();
    if (!session) {
      throw new Error('Your recovery session is still being established. Open the recovery email again or try this page once more.');
    }

    const client = authClient();
    const { error } = await client.auth.updateUser({ password });
    if (error && !(await passwordUpdateCommittedAfterEmailError(client, session, error))) throw error;

    setRecoveryLock(false);
    recoveryObserver?.disconnect();
    recoveryObserver = null;
    setFormMessage(message, 'Password updated successfully. Opening your account…', 'success');
    safeSessionSet('sautilink.auth.recovery_completed.v1', '1');
    window.history.replaceState({}, document.title, '/home');
    window.setTimeout(() => window.location.reload(), 450);
  } catch (error) {
    setFormMessage(message, friendlyAuthError(error) || error?.message || 'We could not update your password.');
  } finally {
    setButtonBusy(submit, false);
  }
}

document.addEventListener('submit', handleRecoveryPasswordSubmit, true);

function readPendingEmailChange() {
  try {
    const value = JSON.parse(safeSessionGet(EMAIL_CHANGE_PENDING_KEY) || 'null');
    const currentEmail = normalizeEmail(value?.currentEmail || '');
    const newEmail = normalizeEmail(value?.newEmail || '');
    if (!newEmail) return null;
    return {
      currentEmail,
      newEmail,
      acceptedCount: Number(value?.acceptedCount || 0),
      startedAt: Number(value?.startedAt || Date.now()),
    };
  } catch {
    return null;
  }
}

function writePendingEmailChange(value) {
  if (!value) {
    safeSessionSet(EMAIL_CHANGE_PENDING_KEY, '');
    return;
  }
  safeSessionSet(EMAIL_CHANGE_PENDING_KEY, JSON.stringify(value));
}

function emailChangeDigits() {
  return [...document.querySelectorAll('[data-email-change-otp-digit]')];
}

function clearEmailChangeDigits() {
  for (const input of emailChangeDigits()) input.value = '';
}

function emailChangeCode() {
  return normalizeEmailOtp(emailChangeDigits().map((input) => input.value).join(''));
}

function focusEmailChangeDigit(index = 0) {
  const digits = emailChangeDigits();
  digits[Math.min(Math.max(index, 0), digits.length - 1)]?.focus();
}

function fillEmailChangeDigits(value, startIndex = 0) {
  const digits = normalizeEmailOtp(value);
  const inputs = emailChangeDigits();
  if (!digits || !inputs.length) return;
  for (let index = 0; index < digits.length && startIndex + index < inputs.length; index += 1) {
    inputs[startIndex + index].value = digits[index];
  }
  focusEmailChangeDigit(Math.min(startIndex + digits.length, inputs.length - 1));
}

function ensureEmailChangeVerificationUi() {
  const requestForm = document.getElementById('change-email-form');
  if (!requestForm || document.getElementById('change-email-verify-form')) return;
  ensureStylesheet();

  const verifyForm = document.createElement('form');
  verifyForm.id = 'change-email-verify-form';
  verifyForm.className = 'security-form email-change-verify-form';
  verifyForm.noValidate = true;
  verifyForm.hidden = true;

  const intro = document.createElement('div');
  intro.className = 'email-change-code-intro';
  const title = document.createElement('strong');
  title.textContent = 'Verify email change';
  const copy = document.createElement('p');
  copy.id = 'change-email-code-copy';
  intro.append(title, copy);

  const label = document.createElement('span');
  label.className = 'email-change-code-label';
  label.textContent = 'Verification code';

  const boxes = document.createElement('div');
  boxes.className = 'email-change-otp-boxes';
  boxes.setAttribute('role', 'group');
  boxes.setAttribute('aria-label', `${EMAIL_OTP_LENGTH}-digit email change verification code`);
  for (let index = 0; index < EMAIL_OTP_LENGTH; index += 1) {
    const input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'numeric';
    input.autocomplete = index === 0 ? 'one-time-code' : 'off';
    input.maxLength = 1;
    input.pattern = '[0-9]*';
    input.setAttribute('aria-label', `Digit ${index + 1}`);
    input.dataset.emailChangeOtpDigit = String(index);
    boxes.append(input);
  }

  const hint = document.createElement('small');
  hint.className = 'field-hint';
  hint.textContent = 'Enter the code from your SautiLink email. If Secure Email Change is enabled, a second code may be required.';

  const message = document.createElement('div');
  message.className = 'form-message';
  message.id = 'change-email-code-message';
  message.setAttribute('role', 'alert');
  message.hidden = true;

  const submit = document.createElement('button');
  submit.className = 'secondary-action';
  submit.type = 'submit';
  submit.textContent = 'Verify code';

  const resend = document.createElement('button');
  resend.className = 'text-action email-change-resend';
  resend.id = 'resend-email-change-code';
  resend.type = 'button';
  resend.textContent = 'Resend verification code';

  verifyForm.append(intro, label, boxes, hint, message, submit, resend);
  requestForm.insertAdjacentElement('afterend', verifyForm);

  boxes.addEventListener('input', (event) => {
    const input = event.target.closest('[data-email-change-otp-digit]');
    if (!input) return;
    const index = Number(input.dataset.emailChangeOtpDigit || 0);
    const value = normalizeEmailOtp(input.value);
    if (value.length > 1) {
      input.value = '';
      fillEmailChangeDigits(value, index);
      return;
    }
    input.value = value.slice(-1);
    if (input.value) focusEmailChangeDigit(index + 1);
  });

  boxes.addEventListener('keydown', (event) => {
    const input = event.target.closest('[data-email-change-otp-digit]');
    if (!input) return;
    const index = Number(input.dataset.emailChangeOtpDigit || 0);
    if (event.key === 'Backspace' && !input.value && index > 0) {
      event.preventDefault();
      const previous = emailChangeDigits()[index - 1];
      if (previous) {
        previous.value = '';
        previous.focus();
      }
    }
    if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      focusEmailChangeDigit(index - 1);
    }
    if (event.key === 'ArrowRight' && index < EMAIL_OTP_LENGTH - 1) {
      event.preventDefault();
      focusEmailChangeDigit(index + 1);
    }
  });

  boxes.addEventListener('paste', (event) => {
    const pasted = normalizeEmailOtp(event.clipboardData?.getData('text') || '');
    if (!pasted) return;
    event.preventDefault();
    clearEmailChangeDigits();
    fillEmailChangeDigits(pasted, 0);
  });

  verifyForm.addEventListener('submit', verifyEmailChangeCode);
  resend.addEventListener('click', resendEmailChangeCode);
}

function renderPendingEmailChange(state = readPendingEmailChange()) {
  ensureEmailChangeVerificationUi();
  const form = document.getElementById('change-email-verify-form');
  if (!form) return;
  form.hidden = !state;
  if (!state) return;

  const copy = document.getElementById('change-email-code-copy');
  if (copy) {
    copy.textContent = state.acceptedCount > 0
      ? 'One verification code was accepted. Enter the code sent to your other email address to finish the change.'
      : `Enter the ${EMAIL_OTP_LENGTH}-digit code sent for the change from ${state.currentEmail || 'your current email'} to ${state.newEmail}.`;
  }
  window.setTimeout(() => focusEmailChangeDigit(0), 0);
}

async function requestEmailChange(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || form.id !== 'change-email-form') return;

  event.preventDefault();
  event.stopImmediatePropagation();

  const message = document.getElementById('change-email-message');
  const submit = form.querySelector('[type="submit"]');
  const email = normalizeEmail(form.email?.value || '');
  const invalidEmail = emailError(email);
  setFormMessage(message, '');
  if (invalidEmail) return setFormMessage(message, invalidEmail);

  setButtonBusy(submit, true, 'Sending code…');
  try {
    const client = authClient();
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError || !userData.user) throw userError || new Error('Sign in again before changing your email address.');
    const currentEmail = normalizeEmail(userData.user.email || '');
    if (currentEmail && currentEmail === email) {
      return setFormMessage(message, 'That is already your account email address.');
    }

    const { data, error } = await client.auth.updateUser(
      { email },
      { emailRedirectTo: `${window.location.origin}/home?auth_action=email_change` },
    );
    if (error) throw error;

    writePendingEmailChange({
      currentEmail: normalizeEmail(data.user?.email || currentEmail),
      newEmail: email,
      acceptedCount: 0,
      startedAt: Date.now(),
    });
    form.reset();
    renderPendingEmailChange();
    setFormMessage(
      message,
      `Verification code sent. Enter the ${EMAIL_OTP_LENGTH}-digit code below to finish changing your email address.`,
      'success',
    );
  } catch (error) {
    setFormMessage(message, friendlyAuthError(error) || error?.message || 'We could not start the email change.');
  } finally {
    setButtonBusy(submit, false);
  }
}

document.addEventListener('submit', requestEmailChange, true);

async function verifyEmailChangeCode(event) {
  event.preventDefault();
  const state = readPendingEmailChange();
  const message = document.getElementById('change-email-code-message');
  const submit = event.currentTarget.querySelector('[type="submit"]');
  const code = emailChangeCode();
  setFormMessage(message, '');

  if (!state) return setFormMessage(message, 'Start a new email change request first.');
  if (!isValidEmailOtp(code)) {
    return setFormMessage(message, `Enter the complete ${EMAIL_OTP_LENGTH}-digit verification code.`);
  }

  setButtonBusy(submit, true, 'Verifying…');
  try {
    const candidates = [...new Set([state.newEmail, state.currentEmail].filter(Boolean))];
    let acceptedEmail = '';
    let acceptedData = null;
    let lastError = null;

    for (const email of candidates) {
      const result = await authClient().auth.verifyOtp({
        email,
        token: code,
        type: 'email_change',
      });
      if (!result.error) {
        acceptedEmail = email;
        acceptedData = result.data;
        break;
      }
      lastError = result.error;
    }

    if (!acceptedEmail) throw lastError || new Error('That verification code is incorrect or has expired.');

    const { data: refreshed } = await authClient().auth.getUser();
    const user = refreshed.user || acceptedData?.user || null;
    const stillPending = normalizeEmail(user?.new_email || '');

    if (stillPending) {
      const nextState = {
        currentEmail: normalizeEmail(user?.email || state.currentEmail),
        newEmail: stillPending || state.newEmail,
        acceptedCount: state.acceptedCount + 1,
        startedAt: state.startedAt,
      };
      writePendingEmailChange(nextState);
      clearEmailChangeDigits();
      renderPendingEmailChange(nextState);
      setFormMessage(
        message,
        'One verification code was accepted. Enter the code sent to your other email address to complete Secure Email Change.',
        'success',
      );
      return;
    }

    writePendingEmailChange(null);
    clearEmailChangeDigits();
    document.getElementById('change-email-verify-form').hidden = true;
    safeSessionSet(EMAIL_CHANGE_SUCCESS_KEY, normalizeEmail(user?.email || state.newEmail));
    setFormMessage(message, 'Email address changed successfully.', 'success');
    window.setTimeout(() => window.location.reload(), 500);
  } catch (error) {
    const friendly = friendlyAuthError(error);
    setFormMessage(
      message,
      friendly && !/request failed/i.test(friendly)
        ? friendly
        : 'That verification code is incorrect or has expired. Request a new code and try again.',
    );
    clearEmailChangeDigits();
    focusEmailChangeDigit(0);
  } finally {
    setButtonBusy(submit, false);
  }
}

async function resendEmailChangeCode() {
  const state = readPendingEmailChange();
  const message = document.getElementById('change-email-code-message');
  const button = document.getElementById('resend-email-change-code');
  if (!state) return setFormMessage(message, 'Start a new email change request first.');

  setButtonBusy(button, true, 'Sending…');
  try {
    const { error } = await authClient().auth.resend({
      type: 'email_change',
      email: state.newEmail,
      options: { emailRedirectTo: `${window.location.origin}/home?auth_action=email_change` },
    });
    if (error) throw error;
    setFormMessage(message, 'A new verification code has been sent.', 'success');
  } catch (error) {
    setFormMessage(message, friendlyAuthError(error) || error?.message || 'We could not resend the verification code.');
  } finally {
    setButtonBusy(button, false);
  }
}

function installEmailChangeFlow() {
  ensureEmailChangeVerificationUi();
  const pending = readPendingEmailChange();
  if (pending) renderPendingEmailChange(pending);

  const successEmail = normalizeEmail(safeSessionGet(EMAIL_CHANGE_SUCCESS_KEY));
  if (successEmail) {
    safeSessionSet(EMAIL_CHANGE_SUCCESS_KEY, '');
    setFormMessage(
      document.getElementById('change-email-message'),
      `Email address changed successfully${successEmail ? ` to ${successEmail}` : ''}.`,
      'success',
    );
  }
}

function installAuthFlowHardening() {
  ensureStylesheet();
  if (recoveryLocked()) installRecoveryGuard();
  installEmailChangeFlow();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installAuthFlowHardening, { once: true });
} else {
  queueMicrotask(installAuthFlowHardening);
}

window.addEventListener('pageshow', () => {
  if (recoveryLocked()) installRecoveryGuard();
});
