import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('production placement tests the existing Worker near the Ireland database', async () => {
  const config = JSON.parse(await readFile(new URL('../wrangler.production.jsonc', import.meta.url), 'utf8'));

  assert.equal(config.name, 'sautilink-social-production');
  assert.equal(config.main, './dist-production-worker/src/worker-entry.js');
  assert.deepEqual(config.placement, { region: 'aws:eu-west-1' });
  for (const environment of Object.values(config.env || {})) {
    assert.equal(environment.placement, undefined, 'an environment must not silently override the placement experiment');
  }
});
