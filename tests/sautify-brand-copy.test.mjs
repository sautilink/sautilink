import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Sautify is the canonical user-facing community brand', async () => {
  const html = await read('app/index.html');
  const source = await read('src/app.js');
  const router = await read('src/asset-router.js');

  assert.match(html, />Sautify</);
  assert.match(html, /Create Sautify/);
  assert.match(html, /Join Sautify/);
  assert.match(html, /Sautify posts/);
  assert.doesNotMatch(html, /\bCircles?\b/);

  assert.match(source, /\/app\/sautify/);
  assert.match(source, /sautify\|circles/);
  assert.match(router, /sautify\|circles/);
  assert.match(source, /Sautify created/);
  assert.match(source, /Sautify member/);

  // Internal database/API identifiers stay stable during this branding patch.
  assert.match(source, /social_circles/);
  assert.match(source, /social_circle_members/);
  assert.match(source, /circle_id/);
});

test('Composer uses familiar Create Post and Post language', async () => {
  const html = await read('app/index.html');
  const source = await read('src/app.js');
  const preview = await read('preview-src/app-shell/App.jsx');

  assert.match(html, /<span>Create Post<\/span>/);
  assert.match(html, /id="sauti-submit"[^>]*>Post<\/button>/);
  assert.doesNotMatch(html, /Share a Sauti/);
  assert.doesNotMatch(source, /Share a Sauti/);
  assert.doesNotMatch(preview, /Share a Sauti/);
  assert.match(source, /navigator\.onLine \? 'Post' : 'Save draft'/);

  for (const path of [
    'app/index.html',
    'src/app.js',
    'src/sauti-posts-api.js',
    'src/social-interactions-api.js',
    'src/sauti-media-api.js',
    'preview-src/app-shell/App.jsx',
  ]) {
    const runtime = await read(path);
    assert.doesNotMatch(runtime, /\bSauti\b/, `standalone Sauti copy must not remain in ${path}`);
  }
});

test('Sautify branding remains canonical across later app phases and cache rotations', async () => {
  const html = await read('app/index.html');
  const sw = await read('sw.js');

  const phase = Number(html.match(/name="sautilink-release-generation" content="([0-9]+)"/)?.[1] || 0);
  const cssVersion = Number(html.match(/app\.css\?v=(\d+)/)?.[1] || 0);
  const jsVersion = Number(html.match(/app\.js\?v=(\d+)/)?.[1] || 0);
  const cacheVersion = Number(sw.match(/sautilink-shell-v(\d+)/)?.[1] || 0);

  assert.ok(phase >= 29);
  assert.ok(cssVersion >= 29);
  assert.ok(jsVersion >= 29);
  assert.ok(cacheVersion >= 20);
});
