import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('app shell is self-hosted and carries a restrictive CSP', async () => {
  const html = await read('app/index.html');
  const headers = await read('_headers');
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /script-src 'self'/);
  assert.match(html, /connect-src 'self' https:\/\/rggpyiterdbbugluejcs\.supabase\.co/);
  assert.doesNotMatch(html, /<script[^>]+https?:\/\//i);
  assert.match(html, /\/assets\/brand\/system\.css/);
  assert.match(html, /\/assets\/fonts\/inter\/InterVariable\.woff2/);
  assert.match(headers, /frame-ancestors 'none'/);
  assert.match(headers, /X-Frame-Options: DENY/);
  assert.match(headers, /Cache-Control: no-store/);
});

test('authentication surface includes all required account flows', async () => {
  const html = await read('app/index.html');
  for (const id of ['login-form', 'signup-form', 'verify-form', 'recovery-form', 'password-form', 'onboarding-form']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /autocomplete="current-password"/);
  assert.match(html, /autocomplete="new-password"/);
  assert.match(html, /autocomplete="one-time-code"/);
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

test('service worker keeps the social app fallback inside the app', async () => {
  const worker = await read('sw.js');
  assert.match(worker, /url\.pathname\.startsWith\("\/app"\)/);
  assert.match(worker, /"\/app\/"/);
});
