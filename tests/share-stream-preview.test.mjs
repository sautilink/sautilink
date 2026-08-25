import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Share and Stream preview is isolated from production services', async () => {
  const sourceHtml = await read('preview-src/share-stream/index.html');
  const builtHtml = await read('preview/share-stream/index.html');
  const headers = await read('_headers');

  assert.match(sourceHtml, /noindex, nofollow/);
  assert.match(sourceHtml, /connect-src 'none'/);
  assert.match(sourceHtml, /form-action 'none'/);
  assert.doesNotMatch(sourceHtml, /supabase\.co|sb_publishable_|service_role/i);
  assert.doesNotMatch(builtHtml, /<script[^>]+https?:\/\//i);
  assert.match(headers, /\/preview\/share-stream\/\*/);
  assert.match(headers, /Cache-Control: no-store/);
});

test('Share and Stream preview includes its complete interaction contract', async () => {
  const app = await read('preview-src/app-shell/App.jsx');
  const main = await read('preview-src/share-stream/main.jsx');

  for (const term of [
    'Share a Sauti',
    'Sauti audience',
    'Who can reply',
    'Save draft',
    'Drafts on this device',
    'You are offline',
    'The Stream could not refresh',
    'Your Stream is ready for its first voice',
    'Loading Stream',
  ]) {
    assert.match(app, new RegExp(term));
  }
  assert.match(main, /Preview 04/);
  assert.match(main, /enableStreamLab/);
  assert.match(main, /initialSection="stream"/);
});

test('composer enforces the preview content boundary and prepends a local Sauti', async () => {
  const app = await read('preview-src/app-shell/App.jsx');

  assert.match(app, /slice\(0, 500\)/);
  assert.match(app, /slice\(0, 5\)/);
  assert.match(app, /setFeedPosts\(\(current\) => \[\{/);
  assert.match(app, /}, \.\.\.current\]\)/);
  assert.match(app, /Nothing reached production/);
  assert.match(app, /Public/);
  assert.match(app, /Followers/);
  assert.match(app, /East Africa Builders/);
});

test('Share and Stream bundle stays inside the visual milestone budget', async () => {
  const assetDirectory = new URL('../preview/share-stream/assets/', import.meta.url);
  const assets = await readdir(assetDirectory);
  const javascript = assets.find((name) => name.endsWith('.js'));
  const stylesheet = assets.find((name) => name.endsWith('.css'));

  assert.ok(javascript, 'expected a built Share and Stream JavaScript asset');
  assert.ok(stylesheet, 'expected a built Share and Stream CSS asset');
  assert.ok((await stat(new URL(javascript, assetDirectory))).size < 300_000, 'Share and Stream JavaScript bundle exceeds 300 kB raw');
  assert.ok((await stat(new URL(stylesheet, assetDirectory))).size < 55_000, 'Share and Stream CSS bundle exceeds 55 kB raw');
});

test('Share and Stream preview contains no external media or live account identifiers', async () => {
  const files = [
    await read('preview-src/app-shell/App.jsx'),
    await read('preview-src/app-shell/data.js'),
    await read('preview-src/share-stream/main.jsx'),
  ].join('\n');

  assert.doesNotMatch(files, /https?:\/\//i);
  assert.doesNotMatch(files, /rggpyiterdbbugluejcs|sb_publishable_|service_role/i);
});
