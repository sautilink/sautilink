import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Profiles preview is isolated from production services', async () => {
  const sourceHtml = await read('preview-src/profiles/index.html');
  const builtHtml = await read('preview/profiles/index.html');
  const headers = await read('_headers');

  assert.match(sourceHtml, /noindex, nofollow/);
  assert.match(sourceHtml, /connect-src 'none'/);
  assert.match(sourceHtml, /form-action 'none'/);
  assert.doesNotMatch(sourceHtml, /supabase\.co|sb_publishable_|service_role/i);
  assert.doesNotMatch(builtHtml, /<script[^>]+https?:\/\//i);
  assert.match(headers, /\/preview\/profiles\/\*/);
  assert.match(headers, /Cache-Control: no-store/);
});

test('Profiles and Sautify preview includes its complete interaction contract', async () => {
  const app = await read('preview-src/app-shell/App.jsx');
  const data = await read('preview-src/app-shell/data.js');
  const main = await read('preview-src/profiles/main.jsx');

  for (const term of [
    'Edit profile',
    'View public profile',
    'Following',
    'Mute',
    'Block',
    'Show in Discover',
    'Your Sautify',
    'Request to join',
    'Sautify rules',
  ]) {
    assert.match(app, new RegExp(term));
  }
  assert.match(data, /Quiet Design Club/);
  assert.match(data, /Approval/);
  assert.match(main, /Preview 03/);
  assert.match(main, /initialSection="profile"/);
});

test('Profile editor mirrors the public profile boundary', async () => {
  const app = await read('preview-src/app-shell/App.jsx');
  const migration = await read('supabase/migrations/20260823081315_create_social_profiles.sql');

  for (const field of ['Display name', 'Bio', 'Location', 'Website']) {
    assert.match(app, new RegExp(field));
  }
  assert.match(app, /Private account details remain separate/);
  assert.match(migration, /display_name text not null/);
  assert.match(migration, /bio text not null/);
  assert.match(migration, /website_url text/);
  assert.match(migration, /location text/);
  assert.doesNotMatch(app, /whatsapp_e164|email_updates|whatsapp_updates/);
});

test('Profiles bundle stays inside the visual milestone budget', async () => {
  const assetDirectory = new URL('../preview/profiles/assets/', import.meta.url);
  const assets = await readdir(assetDirectory);
  const javascript = assets.find((name) => name.endsWith('.js'));
  const stylesheet = assets.find((name) => name.endsWith('.css'));

  assert.ok(javascript, 'expected a built Profiles JavaScript asset');
  assert.ok(stylesheet, 'expected a built Profiles CSS asset');
  assert.ok((await stat(new URL(javascript, assetDirectory))).size < 285_000, 'Profiles JavaScript bundle exceeds 285 kB raw');
  assert.ok((await stat(new URL(stylesheet, assetDirectory))).size < 70_000, 'Profiles CSS bundle exceeds 70 kB raw');
});

test('Profiles preview contains no external media or live account identifiers', async () => {
  const files = [
    await read('preview-src/app-shell/App.jsx'),
    await read('preview-src/app-shell/data.js'),
    await read('preview-src/profiles/main.jsx'),
  ].join('\n');

  assert.doesNotMatch(files, /https?:\/\//i);
  assert.doesNotMatch(files, /rggpyiterdbbugluejcs|sb_publishable_|service_role/i);
});
