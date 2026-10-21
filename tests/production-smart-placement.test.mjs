import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('production placement lets Cloudflare evaluate the existing Worker without pinning a region', async () => {
  const config = JSON.parse(await readFile(new URL('../wrangler.production.jsonc', import.meta.url), 'utf8'));

  assert.equal(config.name, 'sautilink-social-production');
  assert.equal(config.main, './dist-production-worker/src/worker-entry.js');
  assert.deepEqual(config.placement, { mode: 'smart' });
  for (const environment of Object.values(config.env || {})) {
    assert.equal(environment.placement, undefined, 'an environment must not silently override the placement experiment');
  }
});
