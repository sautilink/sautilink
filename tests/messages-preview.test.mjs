import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Basic Messages preview is isolated from production services', async () => {
  const sourceHtml = await read('preview-src/messages/index.html');
  const builtHtml = await read('preview/messages/index.html');

  assert.match(sourceHtml, /noindex, nofollow/);
  assert.match(sourceHtml, /connect-src 'none'/);
  assert.match(sourceHtml, /form-action 'none'/);
  assert.doesNotMatch(`${sourceHtml}\n${builtHtml}`, /supabase\.co|sb_publishable_|service_role/i);
  assert.doesNotMatch(builtHtml, /<script[^>]+https?:\/\//i);
});

test('Basic Messages preview covers the approved one-to-one interaction contract', async () => {
  const app = await read('preview-src/app-shell/App.jsx');
  const data = await read('preview-src/app-shell/data.js');
  const main = await read('preview-src/messages/main.jsx');

  assert.match(main, /initialSection="messages"/);
  assert.match(main, /Preview 09/);
  for (const term of ['Private one-to-one conversations', 'Search messages', 'Write a message', 'Block account', 'Report conversation', 'Delete conversation']) {
    assert.match(app, new RegExp(term));
  }
  assert.match(data, /directMessageConversations/);
  assert.match(data, /unread: 2/);
  assert.match(data, /status: 'Read'/);
  assert.doesNotMatch(`${app}\n${data}`, /Group chat|Voice call|Video call|Disappearing message/);
});

test('Basic Messages preview has responsive and safety-aware styling', async () => {
  const css = `${await read('preview-src/app-shell/styles.css')}\n${await read('preview-src/messages/MessagesPreview.css')}`;

  assert.match(css, /\.messages-layout/);
  assert.match(css, /\.conversation-unread/);
  assert.match(css, /\.message-action-menu/);
  assert.match(css, /\.message-safety-note/);
  assert.match(css, /@media \(max-width: 700px\)/);
  assert.doesNotMatch(css, /(linear|radial|conic)-gradient\(/i);
});

test('Basic Messages build stays within the web preview budget', async () => {
  const assetDirectory = new URL('../preview/messages/assets/', import.meta.url);
  const assets = await readdir(assetDirectory);
  const javascript = assets.find((name) => name.endsWith('.js'));
  const stylesheet = assets.find((name) => name.endsWith('.css'));

  assert.ok(javascript, 'expected a built JavaScript asset');
  assert.ok(stylesheet, 'expected a built CSS asset');
  assert.ok((await stat(new URL(javascript, assetDirectory))).size < 330_000, 'Messages JavaScript bundle exceeds 330 kB raw');
  assert.ok((await stat(new URL(stylesheet, assetDirectory))).size < 80_000, 'Messages CSS bundle exceeds 80 kB raw');
});

test('Basic Messages architecture records the seeded privacy boundary', async () => {
  const architecture = await read('docs/architecture/basic-messages-preview.md');

  assert.match(architecture, /fictional seeded conversations/);
  assert.match(architecture, /row-level security/);
  assert.match(architecture, /rate limits/);
  assert.match(architecture, /retention/);
  assert.match(architecture, /Group chat/);
});
