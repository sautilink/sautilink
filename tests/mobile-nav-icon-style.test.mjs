import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('mobile navigation icon restyle preserves every existing destination', async () => {
  const source = await read('src/mobile-nav-icon-style.js');

  for (const view of ['stream', 'discover', 'messages', 'notifications', 'circles', 'profile']) {
    assert.match(source, new RegExp(`\\b${view}: \\[`));
  }

  assert.match(source, /button\[data-member-view\]/);
  assert.match(source, /existingIcon\.replaceWith\(icon\)/);
  assert.doesNotMatch(source, /button\.remove\(|nav\.replaceChildren\(|append\(button/);
});

test('mobile navigation styling is mobile-only and keeps theme contrast', async () => {
  const css = await read('app/assets/mobile-nav-icon-style.css');

  assert.match(css, /@media \(max-width: 680px\)/);
  assert.match(css, /\.mobile-nav\[data-icon-style="bold-outline"\]/);
  assert.match(css, /grid-template-columns: repeat\(6, minmax\(0, 1fr\)\)/);
  assert.match(css, /button\[data-member-view="stream"\]\.active/);
  assert.match(css, /:root\[data-theme="light"\]/);
  assert.match(css, /:root\[data-theme="dark"\]/);
});

test('mobile navigation styling is included in normal and production bundles', async () => {
  const [appBuild, productionBuild] = await Promise.all([
    read('scripts/build-app.mjs'),
    read('scripts/build-production-release.mjs'),
  ]);

  assert.match(appBuild, /mobile-nav-icon-style\.js/);
  assert.match(productionBuild, /mobile-nav-icon-style\.js/);
});
