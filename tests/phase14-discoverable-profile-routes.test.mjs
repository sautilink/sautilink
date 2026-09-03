import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('profile route UI has safe loading unavailable and error states', async () => {
  const html = await read('app/index.html');
  for (const id of [
    'profile-card',
    'profile-route-state',
    'profile-route-title',
    'profile-route-message',
    'profile-edit-button',
  ]) assert.match(html, new RegExp(`id="${id}"`));

  const phase = Number(html.match(/name="sautilink-release-generation" content="([0-9]+)"/)?.[1] || 0);
  assert.ok(phase >= 14, `app milestone regressed below Phase 14: ${phase}`);
  assert.match(html, /profile-route-home" href="\/home"/);
});

test('discoverable route reads only the public profile slice and requires discoverability', async () => {
  const source = await read('src/app.js');

  assert.ok(source.includes("pathname.match(/^(?:\\/app)?\\/u\\/([^/]+)\\/?$/)"));
  assert.match(source, /\.select\('id, username, display_name, bio, location, website_url, is_discoverable, is_verified, verification_badge_type, followers_count, following_count'\)/);
  assert.match(source, /\.eq\('username', username\)[\s\S]*?\.eq\('is_discoverable', true\)/);
  assert.match(source, /currentMember\?\.username === route\.username/);
  assert.match(source, /renderProfile\(currentMember, \{ owner: true \}\)/);
  assert.match(source, /renderProfile\(profile, \{ owner: false \}\)/);
  assert.match(source, /byId\('profile-edit-button'\)\.hidden = !owner/);
  assert.match(source, /normalizedWebsite = safeWebsite\(website\)/);
  assert.doesNotMatch(source, /\.from\('account_profiles'\)[\s\S]*?\.eq\('username', username\)/);
  assert.doesNotMatch(source, /innerHTML\s*=/);
});

test('profile navigation owns canonical history and responds to browser history', async () => {
  const source = await read('src/app.js');
  assert.match(source, /return `\/u\/\$\{encodeURIComponent\(username\)\}`/);
  assert.match(source, /window\.history\.pushState\(\{\}, '', nextPath\)/);
  assert.match(source, /window\.history\.replaceState\(\{\}, '', canonicalPath\)/);
  assert.match(source, /window\.addEventListener\('popstate',[\s\S]*?applyLocationRoute\(\)/);
});

test('deep profile URLs resolve through Worker and static-asset fallbacks', async () => {
  const worker = await read('src/asset-router.js');
  const wrangler = JSON.parse(await read('wrangler.social-staging.jsonc'));
  const redirects = await read('_redirects');
  const staging = await read('scripts/stage-preview-site.mjs');
  const html = await read('app/index.html');
  const sw = await read('sw.js');

  assert.ok(worker.includes("const PROFILE_ROUTE = /^\\/app\\/u\\/[^/]+\\/?$/;"));
  assert.match(worker, /CLEAN_PROFILE_ROUTE/);
  assert.match(worker, /new URL\('\/app\/', url\)/);
  assert.match(worker, /env\.ASSETS\.fetch/);
  assert.equal(wrangler.main, 'src/asset-router.js');
  assert.equal(wrangler.assets.binding, 'ASSETS');
  assert.equal(wrangler.env.test.assets.binding, 'ASSETS');
  assert.match(redirects, /\/app\/u\/\* \/app\/ 200/);
  assert.match(staging, /\['_redirects', '_redirects'\]/);
  assert.match(staging, /\['sw\.js', 'sw\.js'\]/);
  assert.match(html, /app\.css\?v=\d+/);
  assert.match(html, /app\.js\?v=\d+/);
  assert.match(sw, /sautilink-shell-v\d+/);
});

test('staging SQL proves discoverable visibility without leaking hidden existence', async () => {
  const sql = await read('supabase/tests/phase14_discoverable_profile_routes_rls.sql');
  assert.match(sql, /set local role anon/i);
  assert.match(sql, /DISCOVERABLE_PROFILE_NOT_VISIBLE_TO_ANON/);
  assert.match(sql, /HIDDEN_PROFILE_VISIBLE_TO_ANON/);
  assert.match(sql, /OWNER_HIDDEN_PROFILE_NOT_VISIBLE/);
  assert.match(sql, /begin;[\s\S]*rollback;/i);
});
