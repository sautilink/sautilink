const AUTH_ACTIONS = new Set([
  'signup',
  'magiclink',
  'recovery',
  'email_change',
  'email_change_complete',
  'invite',
  'reauthentication',
  'password_changed',
]);

export const TOKEN_HASH_EMAIL_TYPES = new Set([
  'email',
  'signup',
  'magiclink',
  'recovery',
  'email_change',
  'invite',
]);

export const AUTH_RESULT_COPY = Object.freeze({
  signup: Object.freeze({
    label: 'Email verification',
    title: "You're now verified",
    message: 'Your email address is confirmed. Finish setting up your SautiLink identity.',
  }),
  magiclink: Object.freeze({
    label: 'Secure sign-in',
    title: 'Sign-in verified',
    message: "You're securely signed in to your SautiLink account.",
  }),
  recovery: Object.freeze({
    label: 'Account recovery',
    title: 'Recovery link verified',
    message: 'Your recovery request is verified. Choose a new password to finish securing your account.',
  }),
  email_change: Object.freeze({
    label: 'Email security',
    title: 'Email confirmation received',
    message: 'This confirmation was accepted. If Secure Email Change requires a second confirmation, use the SautiLink email sent to your other address to finish the change.',
  }),
  email_change_complete: Object.freeze({
    label: 'Email security',
    title: 'Email address changed',
    message: 'Your new email address is now confirmed and active on your SautiLink account.',
  }),
  invite: Object.freeze({
    label: 'SautiLink invitation',
    title: 'Invitation accepted',
    message: 'Your invitation is verified. Finish setting up your SautiLink account.',
  }),
  reauthentication: Object.freeze({
    label: 'Identity verification',
    title: 'Identity verified',
    message: 'Your verification code was accepted and the sensitive account action was completed securely.',
  }),
  password_changed: Object.freeze({
    label: 'Account security',
    title: 'Password updated',
    message: 'Your SautiLink password has been changed successfully.',
  }),
});

function normalizedAction(value) {
  const action = String(value || '').trim().toLowerCase();
  return AUTH_ACTIONS.has(action) ? action : '';
}

export function actionFromRedirect(explicitAction, redirectType) {
  const explicit = normalizedAction(explicitAction);
  if (explicit) return explicit;

  const type = String(redirectType || '').trim().toLowerCase();
  if (type === 'signup') return 'signup';
  if (type === 'recovery') return 'recovery';
  if (type === 'email_change') return 'email_change';
  if (type === 'invite') return 'invite';
  if (type === 'magiclink' || type === 'email') return 'magiclink';
  return '';
}

export function parseAuthReturnUrl(value) {
  const url = value instanceof URL ? new URL(value.href) : new URL(String(value));
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
  const explicitAction = url.searchParams.get('auth_action') || url.searchParams.get('flow');
  const redirectType = url.searchParams.get('type') || hash.get('type') || '';
  const error = (
    url.searchParams.get('error_description') ||
    hash.get('error_description') ||
    url.searchParams.get('error') ||
    hash.get('error') ||
    ''
  ).replace(/\+/g, ' ');

  return {
    action: actionFromRedirect(explicitAction, redirectType),
    type: String(redirectType || '').trim().toLowerCase(),
    tokenHash: url.searchParams.get('token_hash') || '',
    error,
  };
}

export function cleanedAuthReturnUrl(value) {
  const url = value instanceof URL ? new URL(value.href) : new URL(String(value));
  for (const key of [
    'auth_action',
    'flow',
    'token_hash',
    'type',
    'error',
    'error_code',
    'error_description',
  ]) {
    url.searchParams.delete(key);
  }
  url.hash = '';
  return url;
}
