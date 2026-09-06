import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  AUTH_RESULT_COPY,
  TOKEN_HASH_EMAIL_TYPES,
  actionFromRedirect,
  cleanedAuthReturnUrl,
  parseAuthReturnUrl,
} from '../src/auth-action-state.js';
import {
  AUTH_EMAIL_FLOWS,
  EMAIL_OTP_LENGTH,
  EMAIL_OTP_MAX_LENGTH,
  EMAIL_OTP_MIN_LENGTH,
  isValidEmailOtp,
} from '../src/auth-email-contract.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('callback state maps every SautiLink auth email action', () => {
  assert.equal(parseAuthReturnUrl('https://test.sautilink.com/app/?auth_action=signup#type=signup').action, 'signup');
  assert.equal(parseAuthReturnUrl('https://test.sautilink.com/app/#type=invite').action, 'invite');
  assert.equal(parseAuthReturnUrl('https://test.sautilink.com/app/#type=email_change').action, 'email_change');
  assert.equal(parseAuthReturnUrl('https://test.sautilink.com/app/?auth_action=magiclink#type=email').action, 'magiclink');
  assert.equal(parseAuthReturnUrl('https://test.sautilink.com/app/?auth_action=recovery#type=recovery').action, 'recovery');
  assert.equal(actionFromRedirect('', 'magiclink'), 'magiclink');

  for (const action of ['signup', 'magiclink', 'recovery', 'email_change', 'email_change_complete', 'invite', 'reauthentication', 'password_changed']) {
    assert.ok(AUTH_RESULT_COPY[action], `missing contextual result copy for ${action}`);
  }
});

test('token-hash callback supports all link-based email verification types', () => {
  for (const type of ['email', 'signup', 'magiclink', 'recovery', 'email_change', 'invite']) {
    assert.equal(TOKEN_HASH_EMAIL_TYPES.has(type), true, `missing token hash type ${type}`);
  }

  const parsed = parseAuthReturnUrl(
    'https://test.sautilink.com/app/auth/confirm?token_hash=secret-token&type=recovery&flow=recovery',
  );
  assert.equal(parsed.action, 'recovery');
  assert.equal(parsed.type, 'recovery');
  assert.equal(parsed.tokenHash, 'secret-token');

  const cleaned = cleanedAuthReturnUrl(
    'https://test.sautilink.com/app/auth/confirm?token_hash=secret-token&type=recovery&flow=recovery&auth_action=recovery',
  );
  assert.equal(cleaned.searchParams.has('token_hash'), false);
  assert.equal(cleaned.searchParams.has('type'), false);
  assert.equal(cleaned.searchParams.has('flow'), false);
  assert.equal(cleaned.searchParams.has('auth_action'), false);
});

test('OTP-backed website inputs use one exact eight-digit auth contract', () => {
  assert.equal(EMAIL_OTP_LENGTH, 8);
  assert.equal(EMAIL_OTP_MIN_LENGTH, 8);
  assert.equal(EMAIL_OTP_MAX_LENGTH, 8);
  assert.equal(AUTH_EMAIL_FLOWS.signupConfirmation.otpLength, EMAIL_OTP_LENGTH);
  assert.equal(AUTH_EMAIL_FLOWS.magicLinkOrOtp.otpLength, EMAIL_OTP_LENGTH);
  assert.equal(AUTH_EMAIL_FLOWS.reauthentication.otpLength, EMAIL_OTP_LENGTH);
  assert.equal(isValidEmailOtp('12345678'), true);
  assert.equal(isValidEmailOtp('123456'), false);
  assert.equal(isValidEmailOtp('1234567890'), false);
});

test('website actions are wired to the matching Supabase auth methods', async () => {
  const source = await read('src/app.js');
  const html = await read('app/index.html');
  const router = await read('src/asset-router.js');

  assert.match(source, /signUp\([\s\S]*data:\s*\{ username, full_name: displayName \}/);
  assert.doesNotMatch(source, /signUp\([\s\S]{0,400}emailRedirectTo:\s*authRedirectUrl\('signup'\)/);
  assert.doesNotMatch(source, /resend\([\s\S]{0,300}emailRedirectTo:\s*authRedirectUrl\('signup'\)/);
  assert.match(source, /resetPasswordForEmail\([\s\S]*authRedirectUrl\('recovery'\)/);
  assert.match(source, /signInWithOtp\([\s\S]*shouldCreateUser:\s*false/);
  assert.doesNotMatch(source, /signInWithOtp\([\s\S]{0,400}emailRedirectTo:\s*authRedirectUrl\('magiclink'\)/);
  assert.match(source, /verifyOtp\([\s\S]*email:\s*pendingSignup\.email[\s\S]*type:\s*'email'/);
  assert.match(source, /verifyOtp\([\s\S]*type:\s*'email'/);
  assert.match(source, /updateUser\([\s\S]*emailRedirectTo:\s*authRedirectUrl\('email_change'\)/);
  assert.match(source, /reauthenticate\(\)/);
  assert.match(source, /updateUser\(\{ password, nonce: code \}\)/);
  assert.match(source, /showEmailChangeResult/);
  assert.match(source, /user\.new_email/);
  assert.match(source, /showAuthResult\('password_changed'\)/);
  assert.match(source, /sessionStorage\.setItem\('sautilink\.auth\.passwordless_email'/);
  assert.match(source, /PENDING_SIGNUP_STORAGE_KEY/);
  assert.match(source, /That verification code is incorrect or has expired/);
  assert.match(source, /INITIAL_AUTH_RETURN\.action/);
  assert.match(source, /AUTH_RESULT_COPY/);

  assert.match(html, /id="auth-result-title"/);
  assert.match(html, /id="signup-verify-code"[^>]*data-email-otp/);
  assert.match(html, /id="signup-verify-code"[^>]*placeholder="••••••••"/);
  assert.doesNotMatch(html, /continue-after-verification/);
  assert.doesNotMatch(html, /confirmation link/i);
  assert.match(html, /app\.js\?v=20260906-homehead/);
  assert.match(html, /id="passwordless-code"[^>]*data-email-otp/);
  assert.match(html, /id="reauth-code"[^>]*data-email-otp/);
  assert.match(router, /AUTH_CONFIRM_ROUTE/);
  assert.match(router, /PROFILE_ROUTE\.test\(url\.pathname\)/);
  assert.match(router, /AUTH_CONFIRM_ROUTE\.test\(url\.pathname\)/);

  assert.doesNotMatch(source, /service_role|sb_secret_/i);
});

test('invite acceptance is supported without exposing an admin invite secret in the browser', async () => {
  const source = await read('src/app.js');
  const html = await read('app/index.html');
  assert.equal(actionFromRedirect('', 'invite'), 'invite');
  assert.match(html, /Sending invitations remains restricted to authorized admin tools/i);
  assert.doesNotMatch(source, /auth\.admin\.inviteUserByEmail/);
});

test('signup username prefix stays vertically aligned without intercepting input', async () => {
  const [html, css] = await Promise.all([
    read('app/index.html'),
    read('app/assets/app.css'),
  ]);

  assert.match(html, /<div class="username-field"><span aria-hidden="true">@<\/span><input id="signup-username"/);
  assert.match(css, /\.username-field > span \{[^}]*inset: 0 auto 0 14px/);
  assert.match(css, /\.username-field > span \{[^}]*display: flex; align-items: center/);
  assert.match(css, /\.username-field > span \{[^}]*line-height: normal; pointer-events: none/);
  assert.doesNotMatch(css, /\.username-field > span \{[^}]*translateY\(-50%\)/);
  assert.match(css, /body\.auth-entry \.username-field > span \{[^}]*font-size: 15px;[^}]*font-weight: 400/s);
  assert.match(css, /body\.auth-entry \.username-field input \{\s*padding-left: 34px;\s*\}/);
});


test('generated browser bundle is synchronized with the auth action source', async () => {
  const bundle = await read('app/assets/app.js');
  assert.match(bundle, /You're now verified/);
  assert.match(bundle, /sautilink\.auth\.passwordless_email/);
  assert.match(bundle, /Email confirmation received/);
  assert.match(bundle, /reauthenticate/);
  assert.doesNotMatch(bundle, /APP_CALLBACK_URL/);
  assert.doesNotMatch(bundle, /slice\(0,6\)/);
  assert.match(bundle, /slice\(0,8\)/);
});


test('durable auth contract records the real staging deployment gate', async () => {
  const contract = await read('docs/architecture/auth-email-flow-contract.md');
  assert.match(contract, /Deploy Auth Email Staging/);
  assert.match(contract, /33455981891/);
  assert.match(contract, /99695913830/);
  assert.match(contract, /Deploy existing test Worker.*PASS/s);
  assert.match(contract, /https:\/\/test\.sautilink\.com/);
});
