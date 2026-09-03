import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  AUTH_EMAIL_FLOWS,
  EMAIL_OTP_LENGTH,
  EMAIL_OTP_MAX_LENGTH,
  EMAIL_OTP_MIN_LENGTH,
  isValidEmailOtp,
  normalizeEmailOtp,
} from '../src/auth-email-contract.js';

const html = fs.readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
const contractDoc = fs.readFileSync(
  new URL('../docs/architecture/auth-email-flow-contract.md', import.meta.url),
  'utf8',
);

test('email OTP contract is one exact eight-digit code across SautiLink auth surfaces', () => {
  assert.equal(EMAIL_OTP_LENGTH, 8);
  assert.equal(EMAIL_OTP_MIN_LENGTH, 8);
  assert.equal(EMAIL_OTP_MAX_LENGTH, 8);
  assert.equal(AUTH_EMAIL_FLOWS.signupConfirmation.otpLength, EMAIL_OTP_LENGTH);
  assert.equal(AUTH_EMAIL_FLOWS.magicLinkOrOtp.otpLength, EMAIL_OTP_LENGTH);
  assert.equal(AUTH_EMAIL_FLOWS.reauthentication.otpLength, EMAIL_OTP_LENGTH);

  assert.equal(normalizeEmailOtp('12 34-56 78'), '12345678');
  assert.equal(normalizeEmailOtp('123456789012'), '12345678');
  assert.equal(isValidEmailOtp('12345678'), true);
  assert.equal(isValidEmailOtp('123456'), false);
  assert.equal(isValidEmailOtp('1234567890'), false);
  assert.equal(isValidEmailOtp('12a45678'), false);
});

test('link and OTP delivery modes are explicitly separated', () => {
  assert.equal(AUTH_EMAIL_FLOWS.signupConfirmation.delivery, 'otp');
  assert.equal(AUTH_EMAIL_FLOWS.passwordRecovery.delivery, 'link');
  assert.equal(AUTH_EMAIL_FLOWS.emailChange.delivery, 'link');
  assert.equal(AUTH_EMAIL_FLOWS.invite.delivery, 'link');
  assert.equal(AUTH_EMAIL_FLOWS.reauthentication.delivery, 'otp');
  assert.equal(AUTH_EMAIL_FLOWS.magicLinkOrOtp.delivery, 'otp');
});

test('signup website is code-only and keeps invalid OTP errors on the verification surface', () => {
  const verifyPanel = html.match(/<section id="verify-panel"[\s\S]*?<\/section>/)?.[0] || '';
  assert.match(verifyPanel, /8-digit verification code/i);
  assert.doesNotMatch(verifyPanel, /confirmation link/i);
  assert.doesNotMatch(verifyPanel, /continue-after-verification/i);
  assert.match(verifyPanel, /id="signup-verify-code"[^>]*data-email-otp/i);
  assert.match(verifyPanel, /placeholder="••••••••"/i);
  assert.match(verifyPanel, /Resend verification email/i);

  assert.match(app, /verify-code-hint/);
  assert.match(app, /supabase\.auth\.verifyOtp\(\{[\s\S]*email:\s*pendingSignup\.email,[\s\S]*token:\s*code,[\s\S]*type:\s*'email'/);
  assert.match(app, /That verification code is incorrect or has expired/);
  assert.match(app, /PENDING_SIGNUP_STORAGE_KEY/);
  assert.match(app, /if \(pendingSignup\)[\s\S]*showAuthPanel\('verify'\)/);
  assert.doesNotMatch(app, /emailRedirectTo:\s*authRedirectUrl\('signup'\)/);
  assert.match(app, /A new \$\{EMAIL_OTP_LENGTH\}-digit verification code has been sent/);
});

test('current password recovery website instructions are recovery-link based', () => {
  const recoveryPanel = html.match(/<section id="recovery-panel"[\s\S]*?<\/section>/)?.[0] || '';
  assert.match(recoveryPanel, /secure recovery link/i);
  assert.match(recoveryPanel, /Send recovery link/i);
  assert.doesNotMatch(recoveryPanel, /\b\d+[- ]digit\b/i);

  assert.match(app, /resetPasswordForEmail/);
  assert.match(app, /recovery link is on its way/i);
  assert.match(app, /Request a fresh recovery link/i);
});

test('contract documents all supported Supabase email flows and forbids drift', () => {
  for (const label of [
    'Confirm signup',
    'Magic Link / Email OTP',
    'Change email address',
    'Reset password',
    'Reauthentication',
    'Invite user',
  ]) {
    assert.ok(contractDoc.includes(label), `missing flow documentation: ${label}`);
  }

  assert.match(contractDoc, /No authentication surface may invent a different delivery method, code length, or instruction copy/i);
  assert.match(contractDoc, /no UI may say "click a link" for an OTP-only flow/i);
  assert.match(contractDoc, /no UI may ask for a code for a link-only flow/i);
});


test('canonical hosted templates match their delivery modes and one SautiLink brand contract', () => {
  const template = (name) => fs.readFileSync(new URL(`../supabase/templates/${name}`, import.meta.url), 'utf8');
  const otpTemplates = [
    'confirmation-code-only.html',
    'magic-link-code-only.html',
    'reauthentication-code-only.html',
  ];
  const linkTemplates = [
    'email-change-link.html',
    'recovery-link.html',
  ];

  for (const name of [...otpTemplates, ...linkTemplates]) {
    const content = template(name);
    assert.match(content, /https:\/\/sautilink\.com\/logo\.png/);
    assert.match(content, /SautiLink Corporation/);
    assert.match(content, /Uhuru Street/);
    assert.match(content, /Mwanza, Tanzania/);
    assert.match(content, /noreply@sautilink\.com/);
    assert.match(content, /Security notice:/);
    assert.match(content, /© SautiLink Corporation\. All Rights Reserved\./);
  }

  for (const name of otpTemplates) {
    const content = template(name);
    assert.match(content, /{{ \.Token }}/);
    assert.doesNotMatch(content, /{{ \.ConfirmationURL }}/);
    assert.doesNotMatch(content, /{{ \.TokenHash }}/);
  }

  for (const name of linkTemplates) {
    const content = template(name);
    assert.match(content, /{{ \.ConfirmationURL }}/);
    assert.doesNotMatch(content, /{{ \.Token }}/);
    assert.doesNotMatch(content, /verification code below|enter (?:this|the) code/i);
  }

  assert.match(template('email-change-link.html'), /{{ \.NewEmail }}/);
});
