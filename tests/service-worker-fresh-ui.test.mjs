import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('service worker refreshes navigation/legacy code and reuses verified immutable code', async () => {
  const source = await read('sw.js');

  assert.match(source, /event\.request\.mode === "navigate"[\s\S]*?fetch\(event\.request, \{ cache: "no-store" \}\)/);
  assert.match(source, /isAppCodeAsset[\s\S]*?fetch\(event\.request, \{ cache: "no-store" \}\)/);
  assert.match(source, /immutableAppCodeAsset/);
  assert.match(source, /immutableCodeMatches/);
  assert.match(source, /\.catch\(async \(\) => \{[\s\S]*?matchCachedPath\(url\.pathname\)/);
});


test('adaptive wordmark always checks the server instead of returning stale PWA cache', async () => {
  const [source, html, css] = await Promise.all([
    read('sw.js'), read('app/index.html'), read('assets/brand/system.css'),
  ]);
  assert.match(source, /const BRAND_ASSET_PATHS = new Set/);
  for (const path of [
    '/assets/brand/system.css',
    '/assets/brand/sautilink-wordmark-white.png',
    '/assets/brand/sautilink-wordmark-black.png',
  ]) assert.ok(source.includes(`"${path}"`), `network-first route missing ${path}`);
  const brandBlock = source.slice(source.indexOf('if (url.origin === self.location.origin && BRAND_ASSET_PATHS.has'), source.indexOf('const isAppCodeAsset'));
  assert.match(brandBlock, /fetch\(event\.request, \{ cache: "no-store" \}\)/);
  assert.match(brandBlock, /\.catch\(async \(\) =>/);
  assert.doesNotMatch(brandBlock, /caches\.match\(event\.request\)[\s\S]*fetch\(event\.request/);
  assert.match(html, /\/assets\/brand\/system\.css\?v=20261104-adaptive1/);
  assert.match(css, /sautilink-wordmark-white\.png/);
  assert.match(css, /sautilink-wordmark-black\.png/);
});
