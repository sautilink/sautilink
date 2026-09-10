import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

async function source(path) {
  return readFile(resolve(projectRoot, path), 'utf8');
}

test('SautiLink exposes an installable PWA shell without changing app behavior', async () => {
  const [rootHtml, manifestText, serviceWorker, registration, productionBuild] = await Promise.all([
    source('index.html'),
    source('manifest.json'),
    source('sw.js'),
    source('assets/pwa.js'),
    source('scripts/build-production-release.mjs'),
  ]);
  const manifest = JSON.parse(manifestText);

  assert.match(rootHtml, /<link rel="manifest" href="\/manifest\.json">/);
  assert.match(rootHtml, /<script src="\/assets\/pwa\.js" defer><\/script>/);
  assert.equal(manifest.name, 'SautiLink');
  assert.equal(manifest.start_url, '/home');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons.some((icon) => icon.sizes === '192x192'));
  assert.ok(manifest.icons.some((icon) => icon.sizes === '512x512' && String(icon.purpose || '').includes('maskable')));

  assert.match(registration, /navigator\.serviceWorker\.register\('\/sw\.js'/);
  assert.match(registration, /scope:\s*'\/'/);
  assert.match(serviceWorker, /sautilink-shell-v50/);
  assert.match(serviceWorker, /\(\?:rooms\|sautify\)/);
  assert.match(serviceWorker, /url\.pathname\.startsWith\("\/api\/"\)/);

  assert.match(productionBuild, /wireProductionPwa/);
  assert.match(productionBuild, /<link rel=\\?"manifest\\?" href=\\?"\/manifest\.json\\?">/);
  assert.match(productionBuild, /<script src=\\?"\/assets\/pwa\.js\\?" defer><\/script>/);
});
