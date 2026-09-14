import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transformMediaPerformanceSource } from '../scripts/media-performance-source-transform.mjs';
import { transformMemberBootstrapResilienceSource } from '../scripts/member-bootstrap-resilience-source-transform.mjs';
import { transformRuntimePerformanceSource } from '../scripts/runtime-performance-source-transform.mjs';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('deferred member services avoid duplicate message badge refresh at startup', async () => {
  const source = await read('src/app.js');
  const resilient = transformMemberBootstrapResilienceSource('/repo/src/app.js', source);
  const transformed = transformRuntimePerformanceSource('/repo/src/app.js', resilient);
  const start = transformed.indexOf('function startDeferredMemberServices()');
  const end = transformed.indexOf('\nfunction renderMember(', start);
  const block = transformed.slice(start, end);

  assert.match(block, /\.catch\(\(\) => \{\s*currentSettingsPreferences = null;\s*void refreshMessageBadge\(\);\s*\}\);/s);
  assert.equal((block.match(/void refreshMessageBadge\(\);/g) || []).length, 2);
  assert.doesNotMatch(block, /void refreshNotificationBadge\(\);\s*void refreshMessageBadge\(\);\s*void syncModerationAccess\(\);/s);
});

test('production router gives versioned core assets immutable browser caching', async () => {
  const source = await read('src/asset-router.js');
  const mediaOptimized = transformMediaPerformanceSource('/repo/src/asset-router.js', source);
  const transformed = transformRuntimePerformanceSource('/repo/src/asset-router.js', mediaOptimized);

  assert.match(transformed, /versionedCoreAsset/);
  assert.match(transformed, /public, max-age=31536000, immutable/);
  assert.match(transformed, /public, max-age=86400, stale-while-revalidate=604800/);
  assert.match(transformed, /protectedMediaDelivery/);
});

test('normal and production builders apply runtime performance transform', async () => {
  const [normal, production] = await Promise.all([
    read('scripts/build-app.mjs'),
    read('scripts/build-production-release.mjs'),
  ]);

  for (const builder of [normal, production]) {
    assert.match(builder, /transformRuntimePerformanceSource/);
  }
});

test('service worker tolerates partial precache failures and can recover assets by path', async () => {
  const serviceWorker = await read('sw.js');

  assert.match(serviceWorker, /Promise\.allSettled\(APP_SHELL\.map/);
  assert.match(serviceWorker, /async function matchCachedPath\(pathname\)/);
  assert.match(serviceWorker, /CORE_ASSET_PATHS\.has\(url\.pathname\)/);
  assert.match(serviceWorker, /caches\.open\(CACHE_NAME\)\.then\(\(cache\) => cache\.put\(event\.request, copy\)\)/);
});
