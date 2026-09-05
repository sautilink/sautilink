import assert from 'node:assert/strict';
import test from 'node:test';

import {
  displayNameError,
  emailError,
  friendlyAuthError,
  normalizeEmail,
  normalizeUsername,
  passwordError,
  usernameError,
} from '../src/auth-validation.js';

test('normalizes usernames without widening the accepted alphabet', () => {
  assert.equal(normalizeUsername('@@Mr. X! '), 'mr.x');
  assert.equal(normalizeUsername('A'.repeat(40)).length, 30);
});

test('rejects malformed and reserved usernames', () => {
  assert.match(usernameError('ab'), /3–30/);
  assert.match(usernameError('privacy'), /reserved/);
  assert.equal(usernameError('charles.x'), '');
});

test('allows reserved usernames only when resolving their profile route', () => {
  const previousWindow = globalThis.window;

  try {
    globalThis.window = { location: { pathname: '/u/sautilink' } };
    assert.equal(usernameError('sautilink'), '');
    assert.match(usernameError('support'), /reserved/);

    globalThis.window.location.pathname = '/app/u/support';
    assert.equal(usernameError('support'), '');

    globalThis.window.location.pathname = '/signup';
    assert.match(usernameError('sautilink'), /reserved/);
    assert.match(usernameError('support'), /reserved/);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('normalizes and validates email addresses', () => {
  assert.equal(normalizeEmail(' Test@Example.COM '), 'test@example.com');
  assert.equal(emailError('test@example.com'), '');
  assert.match(emailError('not-an-email'), /valid email/);
});

test('requires a bounded display name', () => {
  assert.match(displayNameError(''), /1–80/);
  assert.equal(displayNameError('Charles Alex'), '');
  assert.match(displayNameError('x'.repeat(81)), /1–80/);
});

test('requires strong passwords that do not contain account identity', () => {
  assert.match(passwordError('Short1!'), /12/);
  assert.equal(passwordError('Correct-Horse9!Battery'), '');
  assert.match(passwordError('Charles.x-Strong9!', { username: 'charles.x' }), /username/);
  assert.match(passwordError('Person-Strong9!', { email: 'person@example.com' }), /email/);
});

test('maps provider errors without leaking provider details', () => {
  assert.equal(friendlyAuthError({ message: 'Invalid login credentials' }), 'Email or password is incorrect.');
  assert.match(friendlyAuthError({ code: 'over_email_send_rate_limit' }), /wait/);
  assert.match(
    friendlyAuthError({ code: 'unexpected_failure', message: '535 "Authentication Failed"' }),
    /email service is temporarily unavailable/i,
  );
  assert.match(
    friendlyAuthError({ code: 'unexpected_failure', message: 'Error sending confirmation email' }),
    /email service is temporarily unavailable/i,
  );
  assert.match(friendlyAuthError({ message: 'USERNAME_TAKEN' }), /claimed/);
});
