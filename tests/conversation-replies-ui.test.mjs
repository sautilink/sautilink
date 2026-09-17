import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('comments use a compact YouTube-scale thread visual layer', async () => {
  const css = await read('app/assets/conversation-replies-ui.css');

  assert.match(css, /#conversation-thread \.comment-card \{/);
  assert.match(css, /\.comment-avatar \{/);
  assert.match(css, /\.comment-author \{/);
  assert.match(css, /\.comment-body \{/);
  assert.match(css, /\.comment-action svg \{[^}]*width:\s*20px;[^}]*height:\s*20px;/s);
  assert.match(css, /\.comment-action \{[^}]*min-width:\s*36px;[^}]*min-height:\s*36px;/s);
  assert.match(css, /@media \(max-width: 680px\)/);
  assert.match(css, /\.conversation-reply-form textarea \{[^}]*border-radius:\s*22px;/s);
  assert.match(css, /\.conversation-reply-actions \{[^}]*flex-direction:\s*row;/s);
  assert.doesNotMatch(css, /#conversation-root\s+\.sauti-card/);
});

test('comment visual layer keeps one visible Comments heading', async () => {
  const css = await read('app/assets/conversation-replies-ui.css');

  assert.match(css, /#conversation-reply-heading \{[^}]*display:\s*none;/s);
});

test('conversation page keeps one visible Conversation heading', async () => {
  const css = await read('app/assets/conversation-replies-ui.css');

  assert.match(css, /#conversation-surface \.conversation-toolbar \.section-label/);
  assert.match(css, /#conversation-surface \.conversation-toolbar h2 \{[^}]*display:\s*none;/s);
});

test('comments stylesheet is versioned and bundled by both builders', async () => {
  const [runtime, normal, production] = await Promise.all([
    read('src/conversation-replies-ui.js'),
    read('scripts/build-app.mjs'),
    read('scripts/build-production-release.mjs'),
  ]);

  assert.match(runtime, /conversation-replies-ui\.css\?v=20260917-comments1/);
  assert.match(runtime, /ensureConversationRepliesUiStyles/);
  assert.match(normal, /src\/conversation-replies-ui\.js/);
  assert.match(production, /conversation-replies-ui\.js/);
  assert.match(production, /APP_JS_FEATURE_RELEASE = '\d{8}-[a-z0-9-]+'/);
});
