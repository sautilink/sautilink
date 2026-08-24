import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Identity preview is isolated from production services and indexing', async () => {
  const html = await read('preview-src/identity/index.html');
  const headers = await read('_headers');
  assert.match(html, /noindex, nofollow/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /form-action 'none'/);
  assert.doesNotMatch(html, /supabase\.co|sb_publishable_|service_role/i);
  assert.match(headers, /\/preview\/identity\/\*/);
  assert.match(headers, /connect-src 'none'/);
  assert.match(headers, /Cache-Control: no-store/);
});

test('React Identity surface contains every approved account flow', async () => {
  const gate = await read('preview-src/identity/IdentityGate.jsx');
  const service = await read('src/supabase-auth-service.js');
  for (const label of ['Sign in', 'Create account', 'Verify', 'Recovery', 'New password', 'Onboarding']) {
    assert.match(gate, new RegExp(label));
  }
  for (const operation of ['signInWithPassword', 'signUp', 'verifyOtp', 'resend', 'resetPasswordForEmail', 'updateUser', 'signOut', 'onAuthStateChange']) {
    assert.match(service, new RegExp(operation));
  }
  assert.match(gate, /role="dialog" aria-modal="true"/);
  assert.match(gate, /autoComplete="one-time-code"/);
  assert.match(gate, /Nothing is submitted/);
});

test('Identity preview keeps restrained visual tokens and has no decorative gradients', async () => {
  const css = await read('preview-src/identity/styles.css');
  assert.match(css, /#101318/);
  assert.match(css, /var\(--accent\)/);
  assert.match(css, /@media \(max-width: 820px\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.doesNotMatch(css, /(linear|radial|conic)-gradient\(/i);
});

test('Identity bundle remains within the milestone budget and contains no backend key', async () => {
  const assetDirectory = new URL('../preview/identity/assets/', import.meta.url);
  const assets = await readdir(assetDirectory);
  const javascript = assets.find((name) => name.endsWith('.js'));
  const stylesheet = assets.find((name) => name.endsWith('.css'));
  assert.ok(javascript, 'expected a built Identity JavaScript asset');
  assert.ok(stylesheet, 'expected a built Identity CSS asset');
  assert.ok((await stat(new URL(javascript, assetDirectory))).size < 360_000, 'Identity JavaScript exceeds 360 kB raw');
  assert.ok((await stat(new URL(stylesheet, assetDirectory))).size < 65_000, 'Identity CSS exceeds 65 kB raw');
  const bundle = await read(`preview/identity/assets/${javascript}`);
  assert.doesNotMatch(bundle, /supabase\.co|sb_publishable_|service_role/i);
});

test('real Supabase adapter receives configuration instead of embedding secrets', async () => {
  const service = await read('src/supabase-auth-service.js');
  assert.match(service, /publishableKey/);
  assert.doesNotMatch(service, /rggpyiterdbbugluejcs|sb_publishable_[A-Za-z0-9_-]{8,}|service_role/i);
  assert.match(service, /complete_social_onboarding/);
  assert.match(service, /user_metadata/);
  assert.doesNotMatch(service, /user_metadata[^\n]+(?:role|admin|authorization)/i);
});

test('identity gate resets after authentication and sign-out', async () => {
  const preview = await read('preview-src/identity/IdentityPreview.jsx');
  assert.match(preview, /setGateVersion\(\(current\) => current \+ 1\)/);
  assert.match(preview, /<IdentityGate key=\{gateVersion\}/);
});
