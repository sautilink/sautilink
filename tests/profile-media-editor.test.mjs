import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('profile media editor intercepts owner image selection before upload and preserves the existing upload path', async () => {
  const source = await read('src/profile-media-upload-icons.js');

  assert.match(source, /PROFILE_MEDIA_EDITOR_CONFIG/);
  assert.match(source, /'profile-avatar-file'/);
  assert.match(source, /'profile-header-file'/);
  assert.match(source, /document\.addEventListener\('change', interceptProfileMediaFileSelection, true\)/);
  assert.match(source, /event\.stopPropagation\(\)/);
  assert.match(source, /profileMediaEditorBypass/);
  assert.match(source, /new DataTransfer\(\)/);
  assert.match(source, /input\.dispatchEvent\(new Event\('change', \{ bubbles: true \}\)\)/);
});

test('profile media editor provides crop, rotate and resize controls before the file is uploaded', async () => {
  const source = await read('src/profile-media-upload-icons.js');

  assert.match(source, /Drag the photo to reposition the crop/);
  assert.match(source, /profile-media-editor-rotate-left/);
  assert.match(source, /profile-media-editor-rotate-right/);
  assert.match(source, /profile-media-editor-zoom/);
  assert.match(source, /pointerdown/);
  assert.match(source, /pointermove/);
  assert.match(source, /context\.drawImage/);
  assert.match(source, /context\.rotate/);
  assert.match(source, /context\.scale/);
  assert.match(source, /canvas\.toBlob/);
  assert.match(source, /outputWidth: 1024/);
  assert.match(source, /outputWidth: 1500/);
});

test('profile media ready pill is removed from presentation without changing backend readiness', async () => {
  const [source, css] = await Promise.all([
    read('src/profile-media-upload-icons.js'),
    read('app/assets/profile-media-editor.css'),
  ]);

  assert.match(source, /hideProfileMediaReadinessPill/);
  assert.match(source, /state\.hidden = true/);
  assert.match(source, /state\.setAttribute\('aria-hidden', 'true'\)/);
  assert.match(css, /#profile-media-state\s*\{[\s\S]*?display:\s*none\s*!important/);
  assert.doesNotMatch(source, /profileMediaReady\s*=/);
});

test('profile media editor stylesheet is self-hosted and responsive', async () => {
  const [source, css] = await Promise.all([
    read('src/profile-media-upload-icons.js'),
    read('app/assets/profile-media-editor.css'),
  ]);

  assert.match(source, /\/app\/assets\/profile-media-editor\.css\?v=20260920-mediaeditor1/);
  assert.match(css, /\.profile-media-editor-dialog/);
  assert.match(css, /\.profile-media-editor-stage canvas/);
  assert.match(css, /touch-action:\s*none/);
  assert.match(css, /@media \(max-width: 680px\)/);
});
