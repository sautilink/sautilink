import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const file = (path) => new URL(`../${path}`, import.meta.url);
const read = (path) => readFile(file(path), 'utf8');

test('Rooms ships one chat layout for the directory and opened Rooms', async () => {
  const [html, runtime, css] = await Promise.all([
    read('app/index.html'), read('src/rooms-facebook-ui.js'), read('app/assets/rooms-chat.css'),
  ]);
  assert.equal((html.match(/rooms-chat\.css/g) || []).length, 1);
  assert.match(runtime, /sidebar\.append\(heading, nav, roomFbById\('circles-list'\), empty\)/);
  assert.match(runtime, /aria-current/);
  assert.match(runtime, /setRoomInfoVisible/);
  assert.match(css, /body\.rooms-facebook-view #circles-surface/);
  assert.match(css, /\.room-message-own\s*\{\s*align-self:\s*flex-end/);
  assert.match(css, /#circle-detail\.room-info-open #room-fb-detail-aside/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /room-fb-detail-open > #room-fb-landing-sidebar\s*\{\s*display:\s*none/);
  for (const legacy of ['rooms-facebook.css', 'rooms-mobile-preview.css', 'rooms-native.css']) {
    assert.ok(!html.includes(legacy) && !runtime.includes(legacy));
    await assert.rejects(access(file(`app/assets/${legacy}`)), { code: 'ENOENT' });
  }
});

test('Rooms keeps the conversation, composer, membership, and settings on existing paths', async () => {
  const [html, app, platform, runtime] = await Promise.all([
    read('app/index.html'), read('src/app.js'), read('src/rooms-platform.js'), read('src/rooms-facebook-ui.js'),
  ]);
  assert.match(html, /id="room-detail-loading-status" role="status" hidden/);
  assert.match(app, /detail\.dataset\.loading = 'true'/);
  assert.match(app, /\[\.\.\.hydrated\]\.reverse\(\)\.forEach/);
  assert.match(app, /card\.classList\.toggle\('room-message-own', item\.post\.author_id === currentMemberId\)/);
  assert.match(app, /circleStreamAllowed\(circle, membership\) \? loadCircleMembers/);
  assert.match(app, /context\.circle\.owner_id === memberId && membership\.member_role !== 'owner'/);
  assert.match(runtime, /stream\.append\(composer\)/);
  assert.match(runtime, /\['photos', 'Photos'\]/);
  assert.match(runtime, /\['videos', 'Videos'\]/);
  assert.match(runtime, /room-detail-search-input/);
  assert.match(runtime, /room-invite-panel/);
  assert.match(runtime, /room-chat-join/);
  assert.match(platform, /summary\.textContent = 'Edit group'/);
  assert.match(platform, /settings\.append\(summary, buildRoomSettings\(room\)\)/);
});

test('Rooms chat runtime is injected into normal and production bundles', async () => {
  const [appBuilder, productionBuilder] = await Promise.all([
    read('scripts/build-app.mjs'),
    read('scripts/build-production-release.mjs'),
  ]);
  assert.match(appBuilder, /rooms-facebook-ui\.js/);
  assert.match(productionBuilder, /rooms-facebook-ui\.js/);
});
