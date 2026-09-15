import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/auth-flow-hardening.js', import.meta.url), 'utf8');
const mobileNav = fs.readFileSync(new URL('../src/mobile-nav-icon-style.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../app/assets/auth-flow-hardening.css', import.meta.url), 'utf8');
const template = fs.readFileSync(new URL('../supabase/templates/email-change-link.html', import.meta.url), 'utf8');

test('recovery return is locked to the new-password panel until password update succeeds', () => {
  assert.match(mobileNav, /import '\.\/auth-flow-hardening\.js'/);
  assert.match(source, /RECOVERY_LOCK_KEY\s*=\s*'sautilink\.auth\.recovery_lock\.v2'/);
  assert.match(source, /isInitialRecoveryReturn\(\)/);
  assert.match(source, /auth_action'\) === 'recovery'/);
  assert.match(source, /document\.addEventListener\('submit', handleRecoveryPasswordSubmit, true\)/);
  assert.match(source, /form\.id !== 'password-form'/);
  assert.match(source, /authClient\(\)\.auth\.updateUser\(\{ password \}\)/);
  assert.match(source, /MutationObserver/);
  assert.match(source, /passwordPanel\.hidden = false/);
  assert.match(source, /setRecoveryLock\(false\)/);
});

test('email change presents an eight-box OTP flow and verifies email_change codes', () => {
  assert.match(source, /EMAIL_OTP_LENGTH/);
  assert.match(source, /data-email-change-otp-digit/);
  assert.match(source, /change-email-verify-form/);
  assert.match(source, /type:\s*'email_change'/);
  assert.match(source, /state\.newEmail/);
  assert.match(source, /state\.currentEmail/);
  assert.match(source, /Secure Email Change/);
  assert.match(source, /auth\.resend\(\{[\s\S]*type:\s*'email_change'/);
  assert.match(css, /grid-template-columns:\s*repeat\(8,/);
});

test('email-change template is OTP-only and matches the website action', () => {
  assert.match(template, /{{ \.Token }}/);
  assert.match(template, /{{ \.NewEmail }}/);
  assert.match(template, /8-digit code/i);
  assert.doesNotMatch(template, /{{ \.ConfirmationURL }}/);
  assert.doesNotMatch(template, /{{ \.TokenHash }}/);
});
