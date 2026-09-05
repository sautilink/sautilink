import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Phase 32 production artifact targets production Supabase and removes preview copy', async () => {
  const html = await read('dist-production-site/app/index.html');
  const bundle = await read('dist-production-site/app/assets/app.js');
  const router = await read('dist-production-worker/src/asset-router.js');

  for (const value of [html, bundle]) {
    assert.match(value, /rggpyiterdbbugluejcs/);
    assert.doesNotMatch(value, /bbrydwzlhweuqxpgbahu/);
  }
  assert.match(bundle, /sb_publishable_omJ-5Mem-K4vgm6WLXRzJQ_jeGs65ca/);
  assert.doesNotMatch(bundle, /sb_publishable_oTYKPMJoxN1b8YBmG-a5eQ_M75Kl6VF/);
  assert.doesNotMatch(html, /Private preview|Phase 31/);
  assert.doesNotMatch(html, /name="robots"[^>]+noindex/i);
  assert.match(html, /app\.css\?v=20260905-badge2/);
  assert.match(html, /app\.js\?v=20260905-badge2/);
  assert.match(html, /theme-init\.js\?v=20260904-account2/);
  assert.match(html, /\/logo\.png/);
  assert.doesNotMatch(html, /logo-compact\.webp/);
  assert.match(router, /environment: isStaging\(url\) \? 'staging' : 'production'/);
});

test('Phase 32 production Worker is path-scoped and keeps the account-entry root outside its route', async () => {
  const config = await read('wrangler.production.jsonc');

  for (const route of [
    'sautilink.com/app/*',
    'www.sautilink.com/app/*',
    'sautilink.com/api/*',
    'www.sautilink.com/api/*',
    'sautilink.com/login*',
    'sautilink.com/signup*',
    'sautilink.com/home*',
    'sautilink.com/messages*',
    'sautilink.com/sautify*',
    'sautilink.com/u/*',
    'sautilink.com/post/*',
    'www.sautilink.com/login*',
    'www.sautilink.com/signup*',
    'www.sautilink.com/home*',
  ]) assert.ok(config.includes(route), `missing production route ${route}`);

  assert.doesNotMatch(config, /"pattern"\s*:\s*"(?:www\.)?sautilink\.com\/\*"/);
  assert.match(config, /"name": "sautilink-social-production"/);
  assert.match(config, /"bucket_name": "sautilink-media-production"/);
  assert.match(config, /"run_worker_first": true/);

  const namespaceIds = [...config.matchAll(/"namespace_id": "(\d+)"/g)].map((match) => match[1]);
  assert.equal(namespaceIds.length, 15);
  assert.equal(new Set(namespaceIds).size, namespaceIds.length);
  assert.ok(namespaceIds.every((id) => Number(id) >= 3201 && Number(id) <= 3215));
});

test('Phase 32 production headers use production CSP without staging noindex', async () => {
  const headers = await read('dist-production-site/_headers');
  assert.match(headers, /rggpyiterdbbugluejcs\.supabase\.co/);
  assert.match(headers, /media-src 'self' blob:/);
  assert.match(headers, /frame-ancestors 'none'/);
  assert.doesNotMatch(headers, /X-Robots-Tag:\s*noindex/i);
  assert.doesNotMatch(headers, /bbrydwzlhweuqxpgbahu/);
});

test('Phase 32 production build and verifier are permanent repository gates', async () => {
  const pkg = JSON.parse(await read('package.json'));
  const workflow = await read('.github/workflows/phase32-production.yml');
  const buildScript = await read('scripts/build-production-release.mjs');
  const verifyScript = await read('scripts/verify-production-artifact.mjs');

  assert.equal(pkg.scripts['build:production'], 'node scripts/build-production-release.mjs');
  assert.equal(pkg.scripts['verify:production-artifact'], 'node scripts/verify-production-artifact.mjs');
  assert.match(pkg.scripts.check, /build:production/);
  assert.match(pkg.scripts.check, /verify:production-artifact/);
  assert.equal(pkg.scripts['deploy:production:dry'], 'wrangler deploy --config wrangler.production.jsonc --dry-run');

  for (const marker of [
    'Verify production release',
    'Deploy SautiLink social app production',
    'Credential scope only',
    'environment: staging',
    'sautilink-social-production-main',
    'sautilink-media-production',
    'Verify production cutover and account-entry root',
    'data-sautilink-entry=\"login-redirect\"',
    'signed-out production account API',
    'https://sautilink.com/login',
    'https://sautilink.com/signup',
    'https://sautilink.com/home',
  ]) assert.ok(workflow.includes(marker), `production workflow missing ${marker}`);

  assert.match(buildScript, /dist-production-worker/);
  assert.match(buildScript, /dist-production-site/);
  assert.match(buildScript, /PRODUCTION_URL/);
  assert.match(verifyScript, /staging Supabase identity leaked into production artifact/);
});

test('Phase 32 generated production files exist and no source map is emitted', async () => {
  for (const path of [
    'dist-production-site/app/index.html',
    'dist-production-site/app/assets/app.js',
    'dist-production-site/app/assets/app.css',
    'dist-production-site/app/assets/theme-init.js',
    'dist-production-site/_headers',
    'dist-production-worker/src/asset-router.js',
  ]) {
    assert.equal((await stat(new URL(`../${path}`, import.meta.url))).isFile(), true, `missing ${path}`);
  }
  await assert.rejects(stat(new URL('../dist-production-site/app/assets/app.js.map', import.meta.url)));
});
