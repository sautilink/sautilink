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
