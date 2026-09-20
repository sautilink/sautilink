import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('account entry refresh is presentation-only and keeps every existing auth panel', async () => {
  const [html, css, guestCss, socialSource] = await Promise.all([
    read('app/index.html'),
    read('app/assets/auth-entry-polish.css'),
    read('app/assets/guest-entry-gate.css'),
    read('src/social-oauth-auth.js'),
  ]);

  assert.match(guestCss, /@import url\('\/app\/assets\/auth-entry-polish\.css\?v=20260920-authui1'\)/);
  assert.match(socialSource, /guest-entry-gate\.css\?v=20260920-authui1/);
  assert.match(socialSource, /function syncAuthEntryPresentationCopy\(\)/);
  assert.match(socialSource, /title\.textContent = 'Share\. Connect\. Discover\.'/);
  assert.match(socialSource, /copy\.textContent = 'Posts, messages and Rooms — all in one SautiLink\.'/);

  for (const marker of [
    'id="login-panel"',
    'id="signup-panel"',
    'id="verify-panel"',
    'id="passwordless-panel"',
    'id="recovery-panel"',
    'id="password-panel"',
    'id="onboarding-panel"',
    'id="login-form"',
    'id="signup-form"',
  ]) assert.match(html, new RegExp(marker));

  assert.match(css, /body\.auth-entry \.auth-view/);
  assert.match(css, /body\.auth-entry \.auth-card/);
  assert.match(css, /body\.auth-entry \.auth-tabs/);
  assert.match(css, /body\.auth-entry \.birth-date-control > select/);
  assert.match(css, /@media \(max-width: 820px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(css, /url\(https?:\/\//i);
});

test('account entry refresh does not introduce auth, storage, network or backend logic', async () => {
  const [css, socialSource] = await Promise.all([
    read('app/assets/auth-entry-polish.css'),
    read('src/social-oauth-auth.js'),
  ]);
  assert.doesNotMatch(css, /supabase|fetch\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage/i);
  assert.doesNotMatch(socialSource, /fetch\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage/i);
});
