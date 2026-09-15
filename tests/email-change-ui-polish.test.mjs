import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const polish = fs.readFileSync(new URL('../src/email-change-ui-polish.js', import.meta.url), 'utf8');
const mobileNav = fs.readFileSync(new URL('../src/mobile-nav-icon-style.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../app/assets/auth-flow-hardening.css', import.meta.url), 'utf8');
const production = fs.readFileSync(new URL('../scripts/build-production-release.mjs', import.meta.url), 'utf8');

test('email change request clearly presents the eight-digit OTP flow', () => {
  assert.match(polish, /change-email-form/);
  assert.match(polish, /8-digit verification code/);
  assert.match(polish, /Send verification code/);
  assert.match(polish, /change-email-message/);
  assert.match(polish, /confirmation email sent\|confirmation link/i);
  assert.match(mobileNav, /import '\.\/email-change-ui-polish\.js';/);
});

test('email change OTP styling has an explicit readable light-theme contract', () => {
  assert.match(polish, /auth-flow-hardening\.css\?v=20260915-authflow2/);
  assert.match(css, /:root\[data-theme="light"\] \.account-security-panel \.security-form label/);
  assert.match(css, /color: #172033/);
  assert.match(css, /background: #ffffff/);
  assert.match(css, /color: #111827/);
  assert.match(css, /border-color: #c8d1dc/);
});

test('production rotates the app bundle cache and removes legacy link copy', () => {
  assert.match(production, /APP_JS_FEATURE_RELEASE = '20260915-verification1'/);
  assert.match(production, /We will send an 8-digit verification code before the address changes\./);
  assert.match(production, />Send verification code<\/button>/);
  assert.match(production, /Verification code sent\. Enter the 8-digit code below to finish changing your email address\./);
});
