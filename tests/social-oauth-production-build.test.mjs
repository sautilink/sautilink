import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('social OAuth module is bundled in both app and production builds', async () => {
  const [appBuild, productionBuild] = await Promise.all([
    read('scripts/build-app.mjs'),
    read('scripts/build-production-release.mjs'),
  ]);

  assert.match(appBuild, /src\/social-oauth-auth\.js/);
  assert.match(productionBuild, /social-oauth-auth\.js/);
});
