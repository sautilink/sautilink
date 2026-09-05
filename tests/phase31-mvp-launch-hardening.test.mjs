import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import router from '../src/asset-router.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

function readyEnv({ assetBody = '<!doctype html><p>asset</p>', throwAsset = false } = {}) {
  const env = {
    ASSETS: {
      fetch: async () => {
        if (throwAsset) throw new Error('synthetic asset failure');
        return new Response(assetBody, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      },
    },
    PROFILE_MEDIA: {},
    SAUTI_MEDIA: {},
  };

  for (const name of [
    'SAUTI_CREATE_LIMITER',
    'SAUTI_DELETE_LIMITER',
    'SAUTI_MEDIA_BEGIN_LIMITER',
    'SOCIAL_FOLLOW_LIMITER',
    'SOCIAL_LIKE_LIMITER',
    'SOCIAL_COMMENT_LIMITER',
    'SOCIAL_COMMENT_DELETE_LIMITER',
    'SOCIAL_REPOST_LIMITER',
    'SAFETY_REPORT_LIMITER',
    'SAFETY_BLOCK_LIMITER',
    'SAFETY_DELETION_LIMITER',
    'SAFETY_MUTE_LIMITER',
    'SAFETY_APPEAL_LIMITER',
    'MODERATION_ACTION_LIMITER',
    'ACCOUNT_CONTROL_LIMITER',
  ]) {
    env[name] = {};
  }

  return env;
}

test('Phase 31 health endpoint reports staging readiness without authentication', async () => {
  const requestId = 'staging-health-test-0001';
  const response = await router.fetch(
    new Request('https://test.sautilink.com/api/health', {
      headers: { 'X-Request-ID': requestId },
    }),
    readyEnv(),
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-request-id'), requestId);
  assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.match(response.headers.get('cache-control') || '', /no-store/);

  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.data.status, 'ok');
  assert.equal(payload.data.service, 'sautilink-web');
  assert.equal(payload.data.release_generation, 31);
  assert.equal(payload.data.environment, 'staging');
  assert.deepEqual(payload.data.checks, {
    assets: true,
    media: true,
    rate_limits: true,
  });
});

test('Phase 31 health fails closed when a required deployment binding is missing', async () => {
  const env = readyEnv();
  delete env.ACCOUNT_CONTROL_LIMITER;

  const response = await router.fetch(
    new Request('https://test.sautilink.com/api/health'),
    env,
  );
  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.equal(payload.ok, false);
  assert.equal(payload.data.status, 'degraded');
  assert.equal(payload.data.checks.rate_limits, false);
});

test('Phase 31 staging robots and response headers prevent accidental indexing', async () => {
  const response = await router.fetch(
    new Request('https://test.sautilink.com/robots.txt'),
    readyEnv(),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
  assert.match(await response.text(), /^User-agent: \*\nDisallow: \/\n$/);

  const productionLike = await router.fetch(
    new Request('https://sautilink.com/example'),
    readyEnv(),
  );
  assert.equal(productionLike.status, 200);
  assert.equal(productionLike.headers.get('x-robots-tag'), null);
});

test('Phase 31 Worker error boundary returns correlation id without internals', async () => {
  const requestId = 'phase31-error-test-0001';
  const response = await router.fetch(
    new Request('https://test.sautilink.com/example', {
      headers: { 'X-Request-ID': requestId },
    }),
    readyEnv({ throwAsset: true }),
  );

  assert.equal(response.status, 500);
  assert.equal(response.headers.get('x-request-id'), requestId);
  assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
  const body = await response.text();
  assert.equal(body, 'SautiLink is temporarily unavailable.');
  assert.doesNotMatch(body, /synthetic asset failure/i);
});

test('Phase 31 app shell rotates caches and respects reduced motion', async () => {
  const html = await read('app/index.html');
  const css = await read('app/assets/app.css');
  const source = await read('src/app.js');
  const sw = await read('sw.js');

  assert.doesNotMatch(html, /Private preview|Phase 31|Phase 27|Foundation in progress/i);
  assert.match(html, /id="settings-surface"/);
  assert.match(html, /app\.css\?v=20260905-homefeed/);
  assert.match(html, /app\.js\?v=20260905-homefeed/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(source, /function motionBehavior\(\)/);
  assert.match(source, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(source, /behavior: 'smooth'/);
  const cacheVersion = Number(sw.match(/sautilink-shell-v([0-9]+)/)?.[1] || 0);
  assert.ok(cacheVersion >= 34, `service worker cache did not rotate for the Home viewer experience rollout: ${cacheVersion}`);
});

test('Phase 31 build gate verifies the staged artifact allowlist and sensitive markers', async () => {
  const pkg = JSON.parse(await read('package.json'));
  const verifier = await read('scripts/verify-staging-artifact.mjs');
  const staging = await read('scripts/stage-preview-site.mjs');

  assert.match(pkg.scripts.check, /verify:staging-artifact/);
  assert.equal(pkg.scripts['verify:staging-artifact'], 'node scripts/verify-staging-artifact.mjs');

  for (const marker of [
    'forbiddenSegments',
    'source map must not ship to staging',
    'sb_secret_',
    'SUPABASE_SERVICE_ROLE',
    'SERVICE_ROLE_KEY',
    'CLOUDFLARE_API_TOKEN',
    'X-Robots-Tag: noindex, nofollow, noarchive',
    'development presentation copy leaked into staged app shell',
  ]) {
    assert.ok(verifier.includes(marker), `artifact verifier missing marker: ${marker}`);
  }

  assert.match(staging, /X-Robots-Tag: noindex, nofollow, noarchive/);
  assert.match(staging, /assets\/development\.css/);
  assert.match(staging, /preview\/mvp\/mvp\.css/);
  assert.doesNotMatch(staging, /Profiles &amp; Circles/);
  assert.doesNotMatch(staging, /Share a Sauti/);
  assert.doesNotMatch(staging, /participate in circles/i);
});

test('Phase 31 main deployment is serialized and has a permanent live readiness smoke', async () => {
  const workflow = await read('.github/workflows/phase-1-auth.yml');

  for (const marker of [
    'group: sautilink-test-staging-main',
    'Verify live staging readiness',
    '/api/health',
    '/robots.txt',
    'x-robots-tag: noindex, nofollow, noarchive',
    'x-request-id:',
    '"release_generation":31',
    'id="settings-surface"',
    '/api/account/export',
    '"AUTH_REQUIRED"',
  ]) {
    assert.ok(workflow.includes(marker), `deployment workflow missing marker: ${marker}`);
  }
});

test('Phase 31 runtime never embeds elevated credentials and keeps request ids bounded', async () => {
  const source = await read('src/asset-router.js');

  assert.match(source, /X-Request-ID/);
  assert.match(source, /crypto\.randomUUID\(\)/);
  assert.match(source, /\{8,128\}/);
  assert.match(source, /INTERNAL_ERROR/);
  assert.match(source, /Unhandled SautiLink request/);
  assert.doesNotMatch(source, /service_role|sb_secret_|SUPABASE_SECRET/i);
});
