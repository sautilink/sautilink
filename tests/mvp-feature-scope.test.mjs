import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('MVP scope guard allows basic Messages while keeping advanced messaging deferred', async () => {
  const scope = await read('docs/product/mvp-feature-scope.md');
  const app = await read('preview-src/app-shell/App.jsx');
  const data = await read('preview-src/app-shell/data.js');

  assert.match(scope, /Must-have now/);
  assert.match(scope, /Deferred until there is a clear product or traffic need/);
  assert.match(scope, /Basic one-to-one text Messages/);
  assert.match(scope, /Group chats, voice\/video calls/);
  assert.match(scope, /Public replies and threads/);
  assert.match(scope, /Account, privacy, notification, session, data-export, and deletion controls/);
  assert.match(app, /function MessagesScreen/);
  assert.match(app, /id: ['"]messages['"]/);
  assert.match(app, /Search messages/);
  assert.match(data, /export const directMessageConversations/);
  assert.doesNotMatch(`${app}\n${data}`, /Group chat|Voice call|Video call|Disappearing message/);
  assert.match(app, /enableConversationPreview/);
});

test('MVP shell uses a SautiLink coral accent instead of X-like blue', async () => {
  const css = await read('preview-src/app-shell/styles.css');
  assert.match(css, /--accent: #c83a4b/);
  assert.match(css, /--accent: #ef6676/);
  assert.doesNotMatch(css, /--accent: #1769e0|--accent: #4b91f1/);
});
