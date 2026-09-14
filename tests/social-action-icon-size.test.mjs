import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('All post action icons use the same 24px scale', async () => {
  const css = await read('app/assets/post-media-carousel.css');

  assert.match(css, /\.sauti-action\s+svg\s*\{[^}]*width:\s*24px;[^}]*height:\s*24px;/s);
  assert.doesNotMatch(css, /\.sauti-action\[data-sauti-action=/);
});

test('Production loads the updated post-action stylesheet with a fresh cache key', async () => {
  const build = await read('scripts/build-production-release.mjs');

  assert.match(build, /POST_ACTION_ICON_CSS_RELEASE = '20260914-instagram2'/);
  assert.match(build, /post-media-carousel\.css\?v=\$\{POST_ACTION_ICON_CSS_RELEASE\}/);
});
