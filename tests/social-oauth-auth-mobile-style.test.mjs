import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('social OAuth button stays full-width and balanced on narrow auth layouts', async () => {
  const css = await read('app/assets/guest-entry-gate.css');

  assert.match(css, /\.social-oauth-button[\s\S]*width:\s*100%/);
  assert.match(css, /\.social-oauth-button[\s\S]*justify-content:\s*center/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /body\.auth-entry \.social-oauth-button[\s\S]*min-height:\s*50px/);
  assert.match(css, /\.social-oauth-google-icon[\s\S]*width:\s*19px/);
});
