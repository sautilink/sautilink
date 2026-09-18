import assert from 'node:assert/strict';
import test from 'node:test';

import { friendlyAuthError } from '../src/auth-validation.js';

test('signup provider errors are actionable instead of collapsing to the generic request failure', () => {
  assert.match(friendlyAuthError({ code: 'weak_password', message: 'Password does not meet strength requirements' }), /stronger password/i);
  assert.match(friendlyAuthError({ code: 'email_address_not_authorized' }), /email delivery/i);
  assert.match(friendlyAuthError({ code: 'email_address_invalid' }), /valid email/i);
  assert.match(friendlyAuthError({ code: 'signup_disabled' }), /signups are temporarily unavailable/i);
  assert.match(friendlyAuthError({ code: 'email_provider_disabled' }), /signups are temporarily unavailable/i);
  assert.match(friendlyAuthError({ code: 'captcha_failed' }), /security check/i);
  assert.match(friendlyAuthError({ code: 'request_timeout' }), /try again/i);
  assert.match(friendlyAuthError({ name: 'AbortError' }), /try again/i);
  assert.match(friendlyAuthError({ message: 'Username availability is temporarily unavailable.' }), /username availability/i);
});
