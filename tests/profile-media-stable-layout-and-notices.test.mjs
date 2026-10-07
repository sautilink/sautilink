import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('profile media reserves its frame before protected files arrive', async () => {
  const [source, css] = await Promise.all([
    read('src/profile-activity.js'),
    read('app/assets/profile-activity.css'),
  ]);

  const createMedia = source.slice(source.indexOf('function createProfileActivityMedia('), source.indexOf('function createProfileActivityCard('));
  assert.ok(createMedia.indexOf("grid.style.setProperty('--profile-media-ratio'") < createMedia.indexOf('rows.forEach('));
  assert.match(createMedia, /Number\(rows\[0\]\.width\)[\s\S]*Number\(rows\[0\]\.height\)/);
  assert.match(css, /\.profile-activity-media\s*\{[^}]*aspect-ratio:\s*1\s*\/\s*1/s);
  assert.match(css, /\.profile-activity-media\.single\s*\{[^}]*aspect-ratio:\s*var\(--profile-media-ratio/s);
  assert.match(css, /\.profile-activity-media-item (?:img|video)[\s\S]*position:\s*absolute/s);

  const loadMedia = source.slice(source.indexOf('async function loadProtectedProfileActivityMedia('), source.indexOf('function createProfileActivityAvatar('));
  assert.ok(loadMedia.indexOf('await element.decode()') < loadMedia.indexOf('revealProfileActivityMedia(element, placeholder, requestId)'));
  assert.ok(loadMedia.indexOf("element.addEventListener('loadeddata'") < loadMedia.indexOf('revealProfileActivityMedia(element, placeholder, requestId)'));
  assert.match(source, /function revealProfileActivityMedia\([\s\S]*?element\.classList\.add\('is-ready'\)/);
});

test('success confirmations have no bottom toast while errors remain visible', async () => {
  const [html, css, source, room, invites, images, share, editor] = await Promise.all([
    read('app/index.html'),
    read('app/assets/app.css'),
    read('src/app.js'),
    read('src/rooms-platform.js'),
    read('src/rooms-invitations.js'),
    read('src/room-post-images.js'),
    read('src/rooms-facebook-ui.js'),
    read('src/post-edit.js'),
  ]);

  assert.doesNotMatch(html, /id="toast"/);
  assert.doesNotMatch(css, /\.toast\s*\{/);
  assert.match(html, /id="action-error"[^>]*role="alert"/);
  assert.match(source, /if \(type !== 'error' \|\| !actionError\) return/);
  assert.match(source, /window\.__sautilinkShowActionError/);
  for (const module of [room, invites, images, share, editor]) {
    assert.doesNotMatch(module, /(?:getElementById|roomPostNode|roomFbById|roomById)\(['"]toast['"]\)/);
  }
});
