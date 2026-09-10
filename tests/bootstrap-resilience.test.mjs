import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transformBootstrapResilienceSource } from '../scripts/bootstrap-resilience-source-transform.mjs';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('profile media capability check cannot block SautiLink bootstrap', async () => {
  const source = await read('src/app.js');
  const transformed = transformBootstrapResilienceSource('/repo/src/app.js', source);

  assert.match(transformed, /void refreshProfileMediaCapability\(\);/);
  assert.doesNotMatch(transformed, /await refreshProfileMediaCapability\(\);/);
  assert.match(transformed, /async function bootstrap\(\)/);
  assert.match(transformed, /bootstrap\(\);/);
});

test('normal and production builders apply bootstrap resilience transform', async () => {
  const normal = await read('scripts/build-app.mjs');
  const production = await read('scripts/build-production-release.mjs');

  for (const builder of [normal, production]) {
    assert.match(builder, /transformBootstrapResilienceSource/);
  }
});

test('startup hotfix rotates both browser and service-worker cache identities', async () => {
  const [html, serviceWorker] = await Promise.all([
    read('app/index.html'),
    read('sw.js'),
  ]);

  assert.match(html, /app\.css\?v=20260909-home-loading/);
  assert.match(html, /app\.js\?v=20260909-authsession4/);
  assert.match(serviceWorker, /sautilink-shell-v50/);
  assert.match(serviceWorker, /app\.js\?v=20260910-profileui1/);
  assert.doesNotMatch(html, /app\.(?:css|js)\?v=20260906-optimistic/);
  assert.doesNotMatch(serviceWorker, /sautilink-shell-v45/);
});
