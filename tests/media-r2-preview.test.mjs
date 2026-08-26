import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Media preview is isolated from R2 and production services', async () => {
  const sourceHtml = await read('preview-src/media/index.html');
  const builtHtml = await read('preview/media/index.html');
  const headers = await read('_headers');

  assert.match(sourceHtml, /noindex, nofollow/);
  assert.match(sourceHtml, /connect-src 'none'/);
  assert.match(sourceHtml, /form-action 'none'/);
  assert.doesNotMatch(sourceHtml, /supabase\.co|r2\.cloudflarestorage\.com|sb_publishable_|service_role/i);
  assert.doesNotMatch(builtHtml, /<script[^>]+https?:\/\//i);
  assert.match(headers, /\/preview\/media\/\*/);
  assert.match(headers, /Cache-Control: no-store/);
});

test('Media preview includes upload, accessibility and recovery contracts', async () => {
  const app = await read('preview-src/app-shell/App.jsx');
  const media = await read('preview-src/app-shell/MediaPreview.jsx');
  const main = await read('preview-src/media/main.jsx');

  for (const term of [
    'Add demo image',
    'Add demo video',
    'Test invalid file',
    'Uploading',
    'Waiting for connection',
    'Upload blocked',
    'Retry',
    'Alternative text editor',
    'Close media viewer',
  ]) {
    assert.match(media, new RegExp(term));
  }
  assert.match(app, /attachments\.length >= 4/);
  assert.match(app, /media: attachments/);
  assert.match(main, /Preview 05/);
  assert.match(main, /enableMediaPreview/);
});

test('R2 production boundary requires short-lived authorization and final validation', async () => {
  const architecture = await read('docs/architecture/media-r2-preview.md');

  for (const term of [
    'never receive a permanent R2 credential',
    'short-lived, operation-specific upload authorization',
    'magic bytes',
    'checksum',
    'idempotently',
    'R2 lifecycle rules',
    'CORS',
    'rate\\s+limits',
  ]) {
    assert.match(architecture, new RegExp(term, 'i'));
  }
  assert.match(architecture, /creates no Cloudflare R2 bucket, object or credential/);
});

test('Media artwork is original, restrained and contains no decorative gradients', async () => {
  const media = await read('preview-src/app-shell/MediaPreview.jsx');
  const css = await read('preview-src/app-shell/styles.css');

  assert.match(media, /scene === 'workshop'/);
  assert.match(media, /scene === 'studio'/);
  assert.match(css, /media-scene-workshop/);
  assert.match(css, /media-scene-studio/);
  assert.match(css, /--media-deep:/);
  assert.doesNotMatch(css, /(linear|radial|conic)-gradient\(/i);
  assert.doesNotMatch(media, /<img|https?:\/\//i);
});

test('Media preview bundle stays inside the visual milestone budget', async () => {
  const assetDirectory = new URL('../preview/media/assets/', import.meta.url);
  const assets = await readdir(assetDirectory);
  const javascript = assets.find((name) => name.endsWith('.js'));
  const stylesheet = assets.find((name) => name.endsWith('.css'));

  assert.ok(javascript, 'expected a built Media JavaScript asset');
  assert.ok(stylesheet, 'expected a built Media CSS asset');
  assert.ok((await stat(new URL(javascript, assetDirectory))).size < 330_000, 'Media JavaScript bundle exceeds 330 kB raw');
  assert.ok((await stat(new URL(stylesheet, assetDirectory))).size < 75_000, 'Media CSS bundle exceeds 75 kB raw');
});

test('Media preview contains no external media, secrets or live account identifiers', async () => {
  const files = [
    await read('preview-src/app-shell/App.jsx'),
    await read('preview-src/app-shell/MediaPreview.jsx'),
    await read('preview-src/media/main.jsx'),
  ].join('\n');

  assert.doesNotMatch(files, /https?:\/\//i);
  assert.doesNotMatch(files, /rggpyiterdbbugluejcs|sb_publishable_|service_role|R2_ACCESS_KEY/i);
});
