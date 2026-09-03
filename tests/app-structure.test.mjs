import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const readBinary = (path) => readFile(new URL(`../${path}`, import.meta.url));

test('app shell is self-hosted and carries a restrictive CSP', async () => {
  const html = await read('app/index.html');
  const headers = await read('_headers');
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /script-src 'self'/);
  assert.match(html, /connect-src 'self' https:\/\/rggpyiterdbbugluejcs\.supabase\.co/);
  assert.match(html, /wss:\/\/rggpyiterdbbugluejcs\.supabase\.co/);
  assert.doesNotMatch(html, /bbrydwzlhweuqxpgbahu/);
  assert.doesNotMatch(html, /<script[^>]+https?:\/\//i);
  assert.match(html, /\/assets\/brand\/system\.css/);
  assert.match(html, /\/assets\/fonts\/inter\/InterVariable\.woff2/);
  assert.match(headers, /frame-ancestors 'none'/);
  assert.match(headers, /https:\/\/rggpyiterdbbugluejcs\.supabase\.co/);
  assert.match(headers, /wss:\/\/rggpyiterdbbugluejcs\.supabase\.co/);
  assert.doesNotMatch(headers, /bbrydwzlhweuqxpgbahu/);
  assert.match(headers, /Strict-Transport-Security: max-age=31536000; includeSubDomains/);
  assert.match(headers, /X-Frame-Options: DENY/);
  assert.match(headers, /Cache-Control: no-store/);
  assert.equal((html.match(/\/assets\/brand\/logo-compact\.webp/g) || []).length, 2);
});

test('authentication surface includes all required account flows', async () => {
  const html = await read('app/index.html');
  for (const id of [
    'login-form',
    'signup-form',
    'verify-panel',
    'resend-verification',
    'passwordless-request-form',
    'passwordless-verify-form',
    'recovery-form',
    'password-form',
    'onboarding-form',
    'change-email-form',
    'send-reauth-code',
    'reauth-password-form',
    'auth-result',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /autocomplete="current-password"/);
  assert.match(html, /autocomplete="new-password"/);
  assert.match(html, /autocomplete="one-time-code"/);
  assert.match(html, /data-email-otp/);
  assert.match(html, /8[- ]digit verification code/i);
  assert.match(html, /8[- ]digit verification code to your email/i);
  assert.doesNotMatch(html, /id="continue-after-verification"/);
  const verifyPanel = html.match(/<section id="verify-panel"[\s\S]*?<\/section>/)?.[0] || '';
  const passwordlessPanel = html.match(/<section id="passwordless-panel"[\s\S]*?<\/section>/)?.[0] || '';
  assert.doesNotMatch(verifyPanel, /confirmation link/i);
  assert.doesNotMatch(passwordlessPanel, /sign-in link|magic link/i);
});

test('standalone account entry uses SautiLink split login hierarchy without social chrome', async () => {
  const html = await read('app/index.html');
  const css = await read('app/assets/app.css');
  const source = await read('src/app.js');

  for (const marker of [
    'class="auth-entry-logo"',
    'class="create-account-action"',
    'class="auth-card-divider"',
    'class="auth-entry-footer"',
    'Log in with email code',
    'Create new account',
  ]) assert.ok(html.includes(marker), `missing account-entry marker: ${marker}`);

  assert.doesNotMatch(html, /older waitlist accounts/i);
  assert.match(css, /body\.auth-entry \.auth-view\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 396px/s);
  assert.match(css, /body\.auth-entry \.primary-rail[\s\S]*display:\s*none !important/);
  assert.match(css, /body\.auth-entry \.auth-card\s*\{[^}]*background:\s*#fff/s);
  assert.match(source, /document\.body\.classList\.add\('auth-entry'\)/);
  assert.match(source, /document\.body\.classList\.remove\('auth-entry'\)/);
});

test('member UI contains no development-phase or preview presentation copy', async () => {
  const html = await read('app/index.html');
  const css = await read('app/assets/app.css');
  const productionBuild = await read('scripts/build-production-release.mjs');

  for (const phrase of [
    'Private preview',
    'Phase 31',
    'Phase 27',
    'The SautiLink way',
    'Fast conversation. Clear ownership.',
    'One trusted identity',
    'Media built to scale',
    'Your Stream, your signal',
    'Foundation in progress',
    'Authentication and identity are the first live layer.',
  ]) {
    assert.equal(html.toLowerCase().includes(phrase.toLowerCase()), false, `development copy leaked into member UI: ${phrase}`);
  }

  assert.doesNotMatch(html, /class="status-dot"/i);
  assert.doesNotMatch(html, /class="preview-badge"/i);
  assert.doesNotMatch(html, /class="context-card principle-card"/i);
  assert.doesNotMatch(html, /class="context-card phase-card"/i);
  assert.doesNotMatch(css, /\.status-dot\b|\.preview-badge\b|\.principle-card\b|\.phase-card\b|\.phase-number\b/);
  assert.doesNotMatch(productionBuild, /replaceAll\('Private preview', 'Live'\)|status-dot[\s\S]{0,120}Live/);
});

test('deployment excludes source, database and dependency metadata', async () => {
  const ignore = await read('.assetsignore');
  for (const path of ['supabase/', 'src/', 'preview-src/', 'scripts/', 'tests/', 'vite.preview.config.js', 'vite.identity.config.js', 'package.json', 'package-lock.json']) {
    assert.match(ignore, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('browser bundle contains a publishable key and never a service secret', async () => {
  const bundle = await read('app/assets/app.js');
  const source = await read('src/app.js');
  assert.match(bundle, /sb_publishable_/);
  assert.doesNotMatch(source, /service_role|sb_secret_|eyJ[A-Za-z0-9_-]{20,}\./i);
});

test('app uses a compact valid WebP brand asset for small rendered logos', async () => {
  const logo = await readBinary('assets/brand/logo-compact.webp');
  assert.ok(logo.length < 12_000, `compact logo exceeds 12 kB: ${logo.length} bytes`);
  assert.equal(logo.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(logo.subarray(8, 12).toString('ascii'), 'WEBP');

  const html = await read('app/index.html');
  const css = await read('app/assets/app.css');
  assert.match(html, /logo-compact\.webp" alt="" width="44" height="23"/);
  assert.match(html, /logo-compact\.webp" alt="" width="50" height="26"/);
  assert.match(css, /\.app-brand img\s*\{[^}]*display:\s*block;[^}]*width:\s*50px/s);
  assert.match(css, /\.mobile-header \.app-brand img\s*\{[^}]*width:\s*44px/s);
});

test('service worker keeps the social app fallback inside the app', async () => {
  const worker = await read('sw.js');
  assert.match(worker, /const socialRoute =/);
  assert.match(worker, /login\|signup\|home\|discover/);
  assert.match(worker, /const fallback = socialRoute \? "\/app\/" : "\/"/);
});


test('app footer keeps readable WCAG AA text contrast', async () => {
  const css = await read('app/assets/app.css');
  const backgroundMatch = css.match(/--app-bg:\s*(#[0-9a-f]{6})/i);
  const footerMatch = css.match(/--app-footer-text:\s*(#[0-9a-f]{6})/i);
  assert.ok(backgroundMatch, 'expected the app background color token');
  assert.ok(footerMatch, 'expected the app footer text color token');

  const rgb = (hex) => hex.match(/[0-9a-f]{2}/gi).map((part) => Number.parseInt(part, 16) / 255);
  const luminance = (hex) => rgb(hex)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index], 0);
  const foreground = luminance(footerMatch[1]);
  const background = luminance(backgroundMatch[1]);
  const contrast = (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);

  assert.ok(contrast >= 4.5, 'footer text contrast must be at least 4.5:1; received ' + contrast.toFixed(2));
  assert.match(css, /\.app-footer\s*\{[^}]*color:\s*var\(--app-footer-text\)[^}]*font-size:\s*10px/s);
});


test('verification badge uses official PNG artwork and profile disclosure', async () => {
  const css = await read('app/assets/app.css');
  const html = await read('app/index.html');
  const source = await read('src/app.js');

  assert.match(css, /\.verification-badge img\s*\{[\s\S]*object-fit:\s*contain/);
  assert.match(css, /\.verification-badge\s*\{[\s\S]*width:\s*var\(--verification-badge-size, 1em\)[\s\S]*height:\s*var\(--verification-badge-size, 1em\)/);
  assert.doesNotMatch(css, /\.verification-badge::after|--verification-badge-fill/);
  assert.match(source, /verified-user-primary\.png/);
  assert.match(html, /id="verification-info-dialog"/);
  assert.match(source, /verified-team\.png/);
  assert.match(source, /verified-user-secondary\.png/);
});
