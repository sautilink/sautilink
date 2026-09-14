import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Rooms uses the dedicated Groups-style layout without changing other app surfaces', async () => {
  const [runtime, css] = await Promise.all([
    read('src/rooms-facebook-ui.js'),
    read('app/assets/rooms-facebook.css'),
  ]);

  assert.match(runtime, /Rooms/);
  assert.match(runtime, /Your Rooms/);
  assert.match(runtime, /Create new Room/);
  assert.match(runtime, /Discussion/);
  assert.match(runtime, /About/);
  assert.match(runtime, /People/);
  assert.match(runtime, /rooms-facebook-view/);
  assert.match(runtime, /room-fb-detail-tabs/);
  assert.match(runtime, /room-fb-detail-aside/);
  assert.match(runtime, /room-invite-panel/);
  assert.match(runtime, /circle-stream/);

  assert.match(css, /body\.rooms-facebook-view/);
  assert.match(css, /grid-template-columns:\s*286px minmax\(0, 1fr\)/);
  assert.match(css, /room-fb-detail-tabs/);
  assert.match(css, /room-fb-detail-aside/);
  assert.match(css, /circle-sauti-composer/);
  assert.match(css, /#circles-list \.circle-card/);

  // The redesign is deliberately feature-scoped: no global body/app restyle is allowed.
  assert.doesNotMatch(css, /^body\s*\{/m);
  assert.doesNotMatch(css, /^\.app-layout\s*\{/m);
});

test('mobile Rooms landing uses a preview-card layer while preserving the existing Room detail view', async () => {
  const [runtime, previewCss] = await Promise.all([
    read('src/rooms-facebook-ui.js'),
    read('app/assets/rooms-mobile-preview.css'),
  ]);

  assert.match(runtime, /rooms-mobile-preview\.css\?v=20260914-mobile1/);
  assert.match(previewCss, /@media \(max-width:\s*680px\)/);
  assert.match(previewCss, /#circles-surface:not\(\.room-fb-detail-open\)/);
  assert.match(previewCss, /#circles-list \.circle-card/);
  assert.match(previewCss, /grid-template-columns:\s*minmax\(0, 1\.42fr\) minmax\(122px, \.88fr\)/);
  assert.match(previewCss, /\.room-card-cover/);
  assert.match(previewCss, /\.room-cover-image/);
  assert.match(previewCss, /data-room-category/);
  assert.doesNotMatch(previewCss, /\.room-fb-detail-tabs/);
  assert.doesNotMatch(previewCss, /\.circle-detail\.room-fb-detail/);
  assert.doesNotMatch(previewCss, /^body\s*\{/m);
});

test('Rooms Groups-style runtime is injected into normal and production bundles', async () => {
  const [appBuilder, productionBuilder] = await Promise.all([
    read('scripts/build-app.mjs'),
    read('scripts/build-production-release.mjs'),
  ]);

  assert.match(appBuilder, /rooms-facebook-ui\.js/);
  assert.match(productionBuilder, /rooms-facebook-ui\.js/);
});
