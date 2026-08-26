import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('MVP scope guard keeps private messaging deferred and public threads available', async () => {
  const scope = await read('docs/product/mvp-feature-scope.md');
  const app = await read('preview-src/app-shell/App.jsx');
  const data = await read('preview-src/app-shell/data.js');

  assert.match(scope, /Must-have now/);
  assert.match(scope, /Deferred until there is a clear product or traffic need/);
  assert.match(scope, /Private DM \/ Messages/);
  assert.match(scope, /Public replies and threads/);
  assert.doesNotMatch(app, /MessagesScreen|id: ['"]messages['"]|Search messages|New message/);
  assert.doesNotMatch(data, /export const conversations/);
  assert.match(app, /enableConversationPreview/);
});

test('MVP shell uses a SautiLink coral accent instead of X-like blue', async () => {
  const css = await read('preview-src/app-shell/styles.css');
  assert.match(css, /--accent: #c83a4b/);
  assert.match(css, /--accent: #ef6676/);
  assert.doesNotMatch(css, /--accent: #1769e0|--accent: #4b91f1/);
});
