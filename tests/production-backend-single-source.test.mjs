import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const sourceFiles = [
  'src/app.js',
  'src/account-controls-api.js',
  'src/moderation-api.js',
  'src/profile-media-api.js',
  'src/sauti-media-api.js',
  'src/sauti-posts-api.js',
  'src/social-interactions-api.js',
  'src/trust-safety-api.js',
];

const PRODUCTION_REF = 'rggpyiterdbbugluejcs';
const PRODUCTION_KEY = 'sb_publishable_omJ-5Mem-K4vgm6WLXRzJQ_jeGs65ca';
const RETIRED_STAGING_REF = 'bbrydwzlhweuqxpgbahu';
const RETIRED_STAGING_KEY = 'sb_publishable_oTYKPMJoxN1b8YBmG-a5eQ_M75Kl6VF';

test('social runtime uses one production Supabase identity and data source', async () => {
  for (const path of sourceFiles) {
    const source = await read(path);
    assert.match(source, new RegExp(PRODUCTION_REF), `${path} must target production Supabase`);
    assert.match(source, new RegExp(PRODUCTION_KEY), `${path} must use the production publishable key`);
    assert.doesNotMatch(source, new RegExp(RETIRED_STAGING_REF), `${path} still targets the retired staging backend`);
    assert.doesNotMatch(source, new RegExp(RETIRED_STAGING_KEY), `${path} still contains the retired staging key`);
  }
});

test('test.sautilink.com remains a frontend preview, not a separate account universe', async () => {
  const [html, stageScript, headers, buildScript] = await Promise.all([
    read('app/index.html'),
    read('scripts/stage-preview-site.mjs'),
    read('_headers'),
    read('scripts/build-production-release.mjs'),
  ]);

  for (const value of [html, stageScript, headers]) {
    assert.match(value, /rggpyiterdbbugluejcs\.supabase\.co/);
    assert.doesNotMatch(value, /bbrydwzlhweuqxpgbahu/);
  }

  assert.doesNotMatch(buildScript, /STAGING_(?:REF|URL|KEY)/);
  assert.doesNotMatch(buildScript, /bbrydwzlhweuqxpgbahu/);
});

test('auth links return to the official SautiLink domain from every frontend', async () => {
  const source = await read('src/app.js');
  assert.match(source, /const APP_HOME_URL = 'https:\/\/sautilink\.com\/home';/);
  assert.match(source, /authRedirectUrl\('recovery'\)/);
  assert.match(source, /authRedirectUrl\('email_change'\)/);
});

test('unified backend rollout rotates browser caches', async () => {
  const [html, sw] = await Promise.all([read('app/index.html'), read('sw.js')]);
  assert.match(html, /app\.css\?v=20260904-account1/);
  assert.match(html, /app\.js\?v=20260904-account1/);
  const version = Number(sw.match(/sautilink-shell-v([0-9]+)/)?.[1] || 0);
  assert.ok(version >= 34, `service worker cache version must be at least 34, got ${version}`);
});
