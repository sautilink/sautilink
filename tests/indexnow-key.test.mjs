import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const key = 'd3d4cdb4041448ada2374ca450abf31e';
const file = new URL(`../${key}.txt`, import.meta.url);

test('IndexNow ownership key is hosted as a plain UTF-8 text file at site root', async () => {
  const contents = await readFile(file, 'utf8');
  assert.equal(contents, key, 'key file must contain only the IndexNow key');
  assert.match(key, /^[A-Za-z0-9-]{8,128}$/);
});
