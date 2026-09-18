import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('professional dashboard hides only the duplicate shell title while open and restores it on exit', async () => {
  const source = await read('src/professional-dashboard.js');

  assert.match(source, /if \(title\) title\.hidden = true;/);
  assert.match(source, /title\.hidden = false;/);
  assert.match(source, /title\.textContent = 'Profile';/);
  assert.match(source, /if \(title\) title\.hidden = false;/);
  assert.doesNotMatch(source, /title\.textContent = 'Dashboard'/);
});
