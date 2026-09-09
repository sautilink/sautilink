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
