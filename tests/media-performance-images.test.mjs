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
    "output({ format: 'image/webp', quality: 'high', anim: true })",
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

test('Home feed waits for viewport proximity and requests sized protected blobs', async () => {
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
  ]) assert.ok(optimized.includes(marker), `missing transformed marker: ${marker}`);

  const mediaFetchStart = optimized.indexOf('await waitForSautiMediaNearViewport(button)');
  const protectedFetch = optimized.indexOf('fetchSautiMediaBlobUrl(media.id, variantWidth)', mediaFetchStart);
  assert.ok(mediaFetchStart >= 0 && protectedFetch > mediaFetchStart, 'feed media fetch must happen after viewport gating');
});

test('app build applies post-media reservation before media performance transform', async () => {
  const build = await read('scripts/build-app.mjs');
  assert.match(build, /transformMediaPerformanceSource/);
  assert.match(build, /transformMediaPerformanceSource\(\s*appSourcePath,\s*transformPostMediaSource/s);
});
