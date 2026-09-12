import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { normalizeSautiMediaVariantWidth } from '../src/sauti-media-api.js';
import { transformMediaPerformanceSource } from '../scripts/media-performance-source-transform.mjs';
import { transformPostMediaSource } from '../scripts/post-media-source-transform.mjs';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('responsive Sauti image variants use a bounded measured width contract', async () => {
  assert.equal(normalizeSautiMediaVariantWidth('480'), 480);
  assert.equal(normalizeSautiMediaVariantWidth('960'), 960);
  assert.equal(normalizeSautiMediaVariantWidth('1440'), 1440);
  assert.equal(normalizeSautiMediaVariantWidth('800'), 0);
  assert.equal(normalizeSautiMediaVariantWidth('0'), 0);

  const api = await read('src/sauti-media-api.js');
  for (const marker of [
    "IMAGE_VARIANT_WIDTHS = Object.freeze([480, 960, 1440])",
    "output({ format: 'image/webp', quality: 85, anim: true })",
    'globalThis.caches?.default',
    'X-Sauti-Media-Cache',
    'serveOriginalMedia(request, env, row, id)',
    'responsiveImagesEnabled(env)',
  ]) assert.match(api, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('production Worker binds Images and keeps a reversible media flag', async () => {
  const wrangler = JSON.parse(await read('wrangler.production.jsonc'));
  assert.equal(wrangler.images?.binding, 'IMAGES');
  assert.equal(wrangler.vars?.SAUTI_MEDIA_VARIANTS_ENABLED, 'true');
  assert.ok(wrangler.r2_buckets?.some((binding) => binding.binding === 'SAUTI_MEDIA'));
});

test('Home feed waits for viewport proximity, requests sized protected blobs, and releases blob URLs', async () => {
  const appPath = new URL('../src/app.js', import.meta.url).pathname;
  const source = await read('src/app.js');
  const reserved = transformPostMediaSource(appPath, source);
  const optimized = transformMediaPerformanceSource(appPath, reserved);

  for (const marker of [
    'SAUTI_MEDIA_VARIANT_WIDTHS = Object.freeze([480, 960, 1440])',
    'waitForSautiMediaNearViewport(button)',
    "url.searchParams.set('w', String(variantWidth))",
    'new IntersectionObserver',
    'selectSautiMediaVariantWidth(media, button)',
    'fetchSautiMediaBlobUrl(button.dataset.openMediaId)',
    'content.dataset.mediaViewerObjectUrl = originalUrl',
    'function revokeHomeFeedMediaObjectUrls',
    "root.querySelectorAll('[data-media-object-url]')",
    'URL.revokeObjectURL(url)',
    'revokeHomeFeedMediaObjectUrls();',
    'revokeHomeFeedMediaObjectUrls(authorCard);',
  ]) assert.ok(optimized.includes(marker), `missing transformed marker: ${marker}`);

  const mediaFetchStart = optimized.indexOf('await waitForSautiMediaNearViewport(button)');
  const protectedFetch = optimized.indexOf('fetchSautiMediaBlobUrl(media.id, variantWidth)', mediaFetchStart);
  assert.ok(mediaFetchStart >= 0 && protectedFetch > mediaFetchStart, 'feed media fetch must happen after viewport gating');
  assert.match(
    optimized,
    /clearHomeFeedMediaState\(\);\s*byId\('stream-feed'\)\.replaceChildren\(\);/,
    'feed state cleanup must run before reset removes media nodes',
  );
  assert.doesNotMatch(optimized, /setTimeout\(finish,\s*45_000\)/);
});

test('production variants privately revalidate while protected originals stay no-store', async () => {
  const routerPath = new URL('../src/asset-router.js', import.meta.url).pathname;
  const mediaApiPath = new URL('../src/sauti-media-api.js', import.meta.url).pathname;
  const router = transformMediaPerformanceSource(routerPath, await read('src/asset-router.js'));
  const mediaApi = transformMediaPerformanceSource(mediaApiPath, await read('src/sauti-media-api.js'));

  assert.match(router, /protectedMediaDelivery/);
  assert.match(router, /isApiPath\(url\.pathname\) && !protectedMediaDelivery/);
  assert.match(mediaApi, /private, max-age=0, must-revalidate/);
  assert.match(mediaApi, /headers\.set\('Cache-Control', 'private, no-store, max-age=0'\);/);
});

test('production protected media reports access, cache, R2, transform, and total Server-Timing', async () => {
  const mediaApiPath = new URL('../src/sauti-media-api.js', import.meta.url).pathname;
  const mediaApi = transformMediaPerformanceSource(mediaApiPath, await read('src/sauti-media-api.js'));

  for (const marker of [
    "headers.set('Server-Timing', metrics.join(', '))",
    "add('access', timings.accessMs)",
    "add('cache', timings.cacheMs, timings.cacheState || '')",
    "add('r2', timings.r2Ms)",
    "add('transform', timings.transformMs)",
    "add('total', mediaTimingDuration(totalStartedAt))",
    "timings.cacheState = 'HIT'",
    "timings.cacheState = 'MISS'",
    'const accessStartedAt = mediaTimingNow()',
    'const r2StartedAt = mediaTimingNow()',
    'const transformStartedAt = mediaTimingNow()',
  ]) assert.ok(mediaApi.includes(marker), `missing media timing marker: ${marker}`);

  const accessStart = mediaApi.indexOf('const accessStartedAt = mediaTimingNow()');
  const accessQuery = mediaApi.indexOf('const row = await selectMedia(id, authorization(request))', accessStart);
  const accessDone = mediaApi.indexOf('timings.accessMs = mediaTimingDuration(accessStartedAt)', accessQuery);
  assert.ok(accessStart >= 0 && accessQuery > accessStart && accessDone > accessQuery, 'access timing must wrap the existing RLS media lookup');
  assert.doesNotMatch(mediaApi, /Server-Timing[^\n]*(?:owner_id|object_key|Authorization|Bearer)/i);
});

test('development and production builds apply post-media reservation before media performance transform', async () => {
  const appBuild = await read('scripts/build-app.mjs');
  assert.match(appBuild, /transformMediaPerformanceSource/);
  assert.match(appBuild, /transformMediaPerformanceSource\(\s*appSourcePath,\s*transformPostMediaSource/s);

  const productionBuild = await read('scripts/build-production-release.mjs');
  assert.match(productionBuild, /transformMediaPerformanceSource/);
  assert.match(productionBuild, /transformMediaPerformanceSource\(\s*file,\s*transformPostMediaSource/s);
});
