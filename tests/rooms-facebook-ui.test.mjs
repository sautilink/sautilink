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
  assert.match(runtime, /Posts/);
  assert.match(runtime, /About/);
  assert.match(runtime, /Members/);
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

test('mobile Rooms landing follows the five-part preview anatomy while preserving Room behavior', async () => {
  const [runtime, previewCss] = await Promise.all([
    read('src/rooms-facebook-ui.js'),
    read('app/assets/rooms-mobile-preview.css'),
  ]);

  assert.match(runtime, /rooms-mobile-preview\.css\?v=20260914-mobile1/);
  assert.match(previewCss, /@media \(max-width:\s*680px\)/);
  assert.match(previewCss, /#circles-surface:not\(\.room-fb-detail-open\)/);
  assert.match(previewCss, /#circles-list \.circle-card/);
  assert.match(previewCss, /grid-template-columns:\s*minmax\(0, 1\.62fr\) minmax\(128px, \.98fr\)/);
  assert.match(previewCss, /\.room-card-cover/);
  assert.match(previewCss, /width:\s*118%/);
  assert.match(previewCss, /border-radius:\s*52% 24px 24px 52%/);
  assert.match(previewCss, /\.circle-card-top \{\s*display: contents;/);
  assert.match(previewCss, /\.circle-card h3 \{[\s\S]*?grid-row:\s*1;/);
  assert.match(previewCss, /\.room-category-badge \{[\s\S]*?grid-column:\s*1;[\s\S]*?grid-row:\s*2;/);
  assert.match(previewCss, /\.circle-card-meta \{[\s\S]*?grid-column:\s*2;[\s\S]*?grid-row:\s*2;/);
  assert.match(previewCss, /\.room-member-count \{/);
  assert.match(previewCss, /\.circle-card-state::after \{\s*content:\s*"View Room";/);
  assert.match(previewCss, /\.circle-card-description \{\s*display: none !important;/);
  assert.match(previewCss, /data-room-category/);
  assert.doesNotMatch(previewCss, /\.room-fb-detail-tabs/);
  assert.doesNotMatch(previewCss, /\.circle-detail\.room-fb-detail/);
  assert.doesNotMatch(previewCss, /^body\s*\{/m);
});

test('opened Room has real post filters, controls, and SautiLink styling without changing the landing preview', async () => {
  const [runtime, css, previewCss, worker] = await Promise.all([
    read('src/rooms-facebook-ui.js'),
    read('app/assets/rooms-facebook.css'),
    read('app/assets/rooms-mobile-preview.css'),
    read('sw.js'),
  ]);

  assert.match(runtime, /\['photos', 'Photos'\]/);
  assert.match(runtime, /\['videos', 'Videos'\]/);
  assert.match(runtime, /\.sauti-media-gallery \$\{media\}/);
  assert.match(runtime, /room-detail-search-input/);
  assert.match(runtime, /Search recent Room posts/);
  assert.match(runtime, /room-detail-menu/);
  assert.match(runtime, /data-room-fb-\$\{key\}/);
  assert.match(runtime, /circle-stream-locked/);
  assert.match(css, /#circles-surface\.room-fb-detail-open/);
  assert.match(css, /--room-fb-blue:\s*var\(--app-accent-strong\)/);
  assert.match(css, /\.circle-detail-actions \.circle-primary-action/);
  assert.match(css, /\.room-fb-detail-tabs button\.active/);
  assert.match(css, /\.circle-sauti-composer textarea/);
  assert.doesNotMatch(previewCss, /room-detail-toolbar|room-detail-filter-empty/);
  assert.match(worker, /sautilink-shell-v87/);
});

test('mobile Room reserves cover and content positions during loading and contains its shortcuts', async () => {
  const [html, app, platform, runtime, css, previewCss] = await Promise.all([
    read('app/index.html'), read('src/app.js'), read('src/rooms-platform.js'),
    read('src/rooms-facebook-ui.js'), read('app/assets/rooms-facebook.css'),
    read('app/assets/rooms-mobile-preview.css'),
  ]);
  assert.match(html, /class="room-detail-cover"/);
  assert.match(html, /id="room-detail-loading-status" role="status" hidden/);
  assert.match(html, /class="room-detail-loading-copy"/);
  assert.match(html, /class="room-detail-loading-sections"/);
  assert.match(html, /class="room-detail-loading-feed"/);
  assert.match(app, /detail\.dataset\.loading = 'true'/);
  assert.match(app, /byId\('room-detail-loading-status'\)\.hidden = false/);
  assert.match(app, /cover\.replaceChildren/);
  assert.match(app, /detail\.querySelector\('\.room-detail-badges'\)\?\.replaceChildren\(\)/);
  assert.match(platform, /detail\.dataset\.loading === 'true'/);
  assert.match(platform, /container\.dataset\.pendingRoomCover !== slug/);
  assert.match(runtime, /loading\.hidden = Boolean\(roomFbById\('circle-detail'\)\?\.dataset\.loading\)/);
  assert.match(css, /\.circle-detail-card \{\s*margin-bottom: 0;/);
  assert.match(css, /\.room-fb-detail-tabs \{[\s\S]*?max-width: 100%;[\s\S]*?overflow-x: auto;/);
  assert.match(css, /\.room-fb-detail-tabs button \{\s*flex: 0 0 auto;/);
  assert.match(css, /\.circle-detail\.room-fb-detail\[data-loading\]/);
  assert.doesNotMatch(previewCss, /room-detail-loading/);
});

test('Rooms Groups-style runtime is injected into normal and production bundles', async () => {
  const [appBuilder, productionBuilder] = await Promise.all([
    read('scripts/build-app.mjs'),
    read('scripts/build-production-release.mjs'),
  ]);

  assert.match(appBuilder, /rooms-facebook-ui\.js/);
  assert.match(productionBuilder, /rooms-facebook-ui\.js/);
});
