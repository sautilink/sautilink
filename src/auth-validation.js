export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._]{2,29}$/;
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const RESERVED_USERNAMES = new Set([
  'admin', 'administrator', 'root', 'support', 'security', 'sautilink',
  'cloudengine', 'official', 'api', 'help', 'about', 'settings', 'login',
  'signup', 'account', 'privacy', 'terms', 'contact', 'waitlist',
]);

const COMMON_PASSWORDS = new Set([
  '123456789012', 'password1234', 'qwertyuiop12', 'sautilink123',
  'iloveyou1234', 'admin1234567',
]);

export function normalizeUsername(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/[^a-z0-9._]/g, '')
    .slice(0, 30);
}

function isCurrentProfileRouteUsername(username) {
  if (typeof window === 'undefined' || !window.location?.pathname) return false;

  const match = window.location.pathname.match(/^(?:\/app)?\/u\/([^/]+)\/?$/i);
  if (!match) return false;

  try {
    return normalizeUsername(decodeURIComponent(match[1])) === username;
  } catch {
    return false;
  }
}

export function usernameError(value) {
  const username = normalizeUsername(value);
  if (!USERNAME_PATTERN.test(username)) {
    return 'Use 3–30 lowercase letters, numbers, dots or underscores.';
  }
  if (RESERVED_USERNAMES.has(username) && !isCurrentProfileRouteUsername(username)) {
    return 'That username is reserved by SautiLink.';
  }
  return '';
}

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function emailError(value) {
  return EMAIL_PATTERN.test(normalizeEmail(value)) ? '' : 'Enter a valid email address.';
}

export function displayNameError(value) {
  const length = String(value || '').trim().length;
  return length >= 1 && length <= 80 ? '' : 'Display name must be 1–80 characters.';
}

export function passwordError(value, context = {}) {
  const password = String(value || '');
  if (password.length < 12) return 'Use at least 12 characters.';
  if (password.length > 72) return 'Use no more than 72 characters.';
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    return 'Include uppercase, lowercase, a number and a symbol.';
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) return 'Choose a less common password.';

  const username = normalizeUsername(context.username);
  const emailName = normalizeEmail(context.email).split('@')[0] || '';
  const lowered = password.toLowerCase();
  if ((username.length >= 3 && lowered.includes(username)) || (emailName.length >= 3 && lowered.includes(emailName))) {
    return 'Do not include your username or email name in the password.';
  }
  return '';
}

export function friendlyAuthError(error) {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  const name = String(error?.name || '').toLowerCase();
  const status = Number(error?.status || 0);

  if (
    code.includes('over_email_send_rate_limit') ||
    code.includes('over_request_rate_limit') ||
    code.includes('rate_limit') ||
    message.includes('rate limit') ||
    message.includes('too many requests')
  ) {
    return 'Please wait a few minutes before trying again.';
  }
  if (code.includes('request_timeout') || name === 'aborterror' || message.includes('timed out')) {
    return 'The request timed out. Please try again.';
  }
  if (
    message.includes('failed to fetch') ||
    message.includes('network request failed') ||
    message.includes('networkerror') ||
    name === 'networkerror'
  ) {
    return 'SautiLink could not reach the authentication service. Check your connection and try again.';
  }
  if (code.includes('email_address_not_authorized')) {
    return 'SautiLink email delivery could not send to this address. Please try another email address or contact support.';
  }
  if (code.includes('email_address_invalid')) {
    return 'Use a different valid email address.';
  }
  if (code.includes('signup_disabled') || code.includes('email_provider_disabled')) {
    return 'New email signups are temporarily unavailable. Please try again later.';
  }
  if (code.includes('captcha_failed')) {
    return 'The security check could not be verified. Reload the page and try again.';
  }
  if (
    message.includes('smtp') ||
    message.includes('authentication failed') ||
    message.includes('error sending') ||
    message.includes('confirmation email') ||
    message.includes('recovery email') ||
    message.includes('email service')
  ) {
    return 'SautiLink email service is temporarily unavailable. Please try again shortly.';
  }
  if (message.includes('database error saving new user') || message.includes('error saving new user')) {
    return 'SautiLink could not finish creating the account. Please try again shortly.';
  }
  if (code.includes('unexpected_failure') || (name.includes('authapierror') && status >= 500)) {
    return 'SautiLink authentication service is temporarily unavailable. Please try again shortly.';
  }
  if (code.includes('invalid_credentials') || message.includes('invalid login credentials')) {
    return 'Email or password is incorrect.';
  }
  if (code.includes('email_not_confirmed') || message.includes('email not confirmed')) {
    return 'Verify your email before signing in.';
  }
  if (code.includes('otp_expired') || message.includes('expired') || message.includes('invalid token')) {
    return 'That verification code is invalid or has expired.';
  }
  if (code.includes('user_already_exists') || code.includes('email_exists') || message.includes('already registered')) {
    return 'This email already has a SautiLink Account. Sign in or recover the account.';
  }
  if (
    code.includes('weak_password') ||
    message.includes('weak_password') ||
    (message.includes('password') && (message.includes('weak') || message.includes('leaked') || message.includes('pwned')))
  ) {
    return 'Choose a stronger password that meets every requirement.';
  }
  if (code.includes('validation_failed')) {
    return 'Some account details were rejected. Check the form and try again.';
  }
  if (message.includes('username availability') || message.includes('availability check failed')) {
    return 'Username availability is temporarily unavailable. Please try again.';
  }
  if (message.includes('username_taken')) return 'That username was just claimed. Choose another one.';
  if (message.includes('account_username_mismatch')) return 'This account already has a different SautiLink username.';

  const safeCode = code.match(/^[a-z0-9_]{2,64}$/)?.[0] || '';
  if (safeCode) {
    return `SautiLink authentication could not complete this request (${safeCode.toUpperCase()}). Please try again.`;
  }
  if (name.includes('authapierror') || name.includes('authunknownerror')) {
    return 'SautiLink authentication service could not complete this request. Please try again shortly.';
  }
  return 'We could not complete that request. Please try again.';
}
