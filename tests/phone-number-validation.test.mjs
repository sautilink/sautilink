import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeOtpPhone, otpPhoneError } from '../src/phone-number-validation.js';

test('Tanzania mobile OTP numbers must contain nine national digits', () => {
  assert.equal(normalizeOtpPhone('+255712345678'), '+255712345678');
  assert.equal(normalizeOtpPhone('+255 662 370 1208'), '');
  assert.match(otpPhoneError('+2556623701208'), /exactly 9 mobile digits/);
  assert.equal(normalizeOtpPhone('+254712345678'), '+254712345678');
});
