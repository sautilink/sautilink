import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Conversations preview is isolated from production services', async () => {
  const sourceHtml = await read('preview-src/conversations/index.html');
  const builtHtml = await read('preview/conversations/index.html');
  const headers = await read('_headers');

  assert.match(sourceHtml, /noindex, nofollow/);
  assert.match(sourceHtml, /connect-src 'none'/);
  assert.match(sourceHtml, /form-action 'none'/);
  assert.doesNotMatch(sourceHtml, /supabase\.co|r2\.cloudflarestorage\.com|sb_publishable_|service_role/i);
  assert.doesNotMatch(builtHtml, /<script[^>]+https?:\/\//i);
  assert.match(headers, /\/preview\/conversations\/\*/);
  assert.match(headers, /Cache-Control: no-store/);
});

test('Conversations preview includes thread, delivery and safety contracts', async () => {
  const app = await read('preview-src/app-shell/App.jsx');
  const conversation = await read('preview-src/app-shell/ConversationPreview.jsx');
  const main = await read('preview-src/conversations/main.jsx');

  for (const term of [
    'Conversation',
    'Context stays attached',
    'Replying to',
    'Queue reply',
    'Waiting for connection',
    'Reply not sent',
    'Retry',
    'Hidden by your reply controls',
    'Quote Sauti',
    'Show 2 more replies',
  ]) {
    assert.match(conversation, new RegExp(term));
  }
  assert.match(app, /enableConversationPreview/);
  assert.match(main, /Preview 06/);
  assert.match(main, /initialSection="thread"/);
});

test('Replies stay local, enforce limits and keep visible hierarchy bounded', async () => {
  const conversation = await read('preview-src/app-shell/ConversationPreview.jsx');

  assert.match(conversation, /slice\(0, 500\)/);
  assert.match(conversation, /local-reply-/);
  assert.match(conversation, /status === 'queued'/);
  assert.match(conversation, /status === 'failed'/);
  assert.match(conversation, /depth: replyingTo === rootPost\.author\.handle \? 0 : 1/);
  assert.doesNotMatch(conversation, /fetch\(|XMLHttpRequest|WebSocket/i);
});

test('Conversation architecture requires canonical adjacency and bounded retrieval', async () => {
  const architecture = await read('docs/architecture/conversations-threads-preview.md');

  for (const term of [
    'parent_post_id',
    'root_post_id',
    'idempotency',
    'RLS',
    'rate limits',
    'cursor pagination',
    'bounded depth',
    'moderation',
  ]) {
    assert.match(architecture, new RegExp(term, 'i'));
  }
  assert.match(architecture, /does not create a database table, Worker route or production notification/);
});

test('Conversation UI stays restrained with no decorative gradients', async () => {
  const conversation = await read('preview-src/app-shell/ConversationPreview.jsx');
  const css = await read('preview-src/app-shell/styles.css');

  assert.match(css, /thread-root/);
  assert.match(css, /thread-depth-1/);
  assert.match(css, /prefers-reduced-motion/);
  assert.doesNotMatch(css, /(linear|radial|conic)-gradient\(/i);
  assert.doesNotMatch(conversation, /<img|https?:\/\//i);
});

test('Conversations preview bundle stays inside its milestone budget', async () => {
  const assetDirectory = new URL('../preview/conversations/assets/', import.meta.url);
  const assets = await readdir(assetDirectory);
  const javascript = assets.find((name) => name.endsWith('.js'));
  const stylesheet = assets.find((name) => name.endsWith('.css'));

  assert.ok(javascript, 'expected a Conversations JavaScript asset');
  assert.ok(stylesheet, 'expected a Conversations CSS asset');
  assert.ok((await stat(new URL(javascript, assetDirectory))).size < 350_000, 'Conversations JavaScript bundle exceeds 350 kB raw');
  assert.ok((await stat(new URL(stylesheet, assetDirectory))).size < 85_000, 'Conversations CSS bundle exceeds 85 kB raw');
});

test('Conversations preview contains no secrets or live account identifiers', async () => {
  const files = [
    await read('preview-src/app-shell/App.jsx'),
    await read('preview-src/app-shell/ConversationPreview.jsx'),
    await read('preview-src/conversations/main.jsx'),
  ].join('\n');

  assert.doesNotMatch(files, /https?:\/\//i);
  assert.doesNotMatch(files, /rggpyiterdbbugluejcs|sb_publishable_|service_role|R2_ACCESS_KEY/i);
});
