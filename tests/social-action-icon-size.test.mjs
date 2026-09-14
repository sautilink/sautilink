import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Like, comment and share icons use the 24px post-action scale only', async () => {
  const css = await read('app/assets/post-media-carousel.css');

  for (const action of ['like', 'comments', 'share']) {
    assert.match(css, new RegExp(`\\.sauti-action\\[data-sauti-action="${action}"\\] svg`));
  }
  assert.match(css, /width:\s*24px;\s*height:\s*24px;/s);
  assert.doesNotMatch(css, /data-sauti-action="(?:repost|save)"[^}]*24px/s);
});

test('Production loads the updated post-action stylesheet with a fresh cache key', async () => {
  const build = await read('scripts/build-production-release.mjs');

  assert.match(build, /POST_ACTION_ICON_CSS_RELEASE = '20260914-instagram1'/);
  assert.match(build, /post-media-carousel\.css\?v=\$\{POST_ACTION_ICON_CSS_RELEASE\}/);
});
