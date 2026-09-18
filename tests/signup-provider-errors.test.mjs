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
  assert.match(friendlyAuthError({ message: 'Failed to fetch' }), /reach the authentication service/i);
  assert.match(friendlyAuthError({ message: 'Error sending confirmation email' }), /email service is temporarily unavailable/i);
  assert.match(friendlyAuthError({ message: 'Database error saving new user' }), /finish creating the account/i);
  assert.match(friendlyAuthError({ code: 'validation_failed' }), /account details were rejected/i);
  assert.match(friendlyAuthError({ name: 'AuthApiError', status: 500, message: 'Internal server error' }), /authentication service is temporarily unavailable/i);
  assert.match(friendlyAuthError({ code: 'provider_specific_failure' }), /PROVIDER_SPECIFIC_FAILURE/);
});
