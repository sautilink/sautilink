import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('conversation replies use a compact thread-only visual layer', async () => {
  const css = await read('app/assets/conversation-replies-ui.css');

  assert.match(css, /#conversation-thread \.thread-sauti \{/);
  assert.match(css, /#conversation-thread \.thread-sauti \.sauti-card-head \{/);
  assert.match(css, /#conversation-thread \.thread-sauti \.sauti-card-body \{/);
  assert.match(css, /#conversation-thread \.thread-sauti \.sauti-card-footer \{/);
  assert.match(css, /#conversation-thread \.thread-sauti \.sauti-action svg \{[^}]*width:\s*18px;[^}]*height:\s*18px;/s);
  assert.match(css, /@media \(max-width: 680px\)/);
  assert.match(css, /\.conversation-reply-form textarea \{[^}]*border-radius:\s*22px;/s);
  assert.match(css, /\.conversation-reply-actions \{[^}]*flex-direction:\s*row;/s);
  assert.doesNotMatch(css, /#conversation-root\s+\.sauti-card/);
});

test('reply visual layer keeps one visible replies heading', async () => {
  const css = await read('app/assets/conversation-replies-ui.css');

  assert.match(css, /#conversation-reply-heading \{[^}]*display:\s*none;/s);
});

test('conversation page keeps one visible Conversation heading', async () => {
  const css = await read('app/assets/conversation-heading-ui.css');

  assert.match(css, /#conversation-surface \.conversation-toolbar \.section-label/);
  assert.match(css, /#conversation-surface \.conversation-toolbar h2 \{[^}]*display:\s*none;/s);
});

test('reply visual layer explicitly keeps view metrics off replies', async () => {
  const css = await read('app/assets/conversation-replies-ui.css');

  assert.match(css, /#conversation-thread \[data-sauti-metric="views"\] \{[^}]*display:\s*none !important;/s);
  assert.doesNotMatch(css, /#conversation-root[^\n]*data-sauti-metric/);
});

test('conversation replies stylesheet is versioned and bundled by both builders', async () => {
  const [runtime, normal, production] = await Promise.all([
    read('src/conversation-replies-ui.js'),
    read('scripts/build-app.mjs'),
    read('scripts/build-production-release.mjs'),
  ]);

  assert.match(runtime, /conversation-replies-ui\.css\?v=20260914-conversation1/);
  assert.match(runtime, /conversation-heading-ui\.css\?v=20260914-conversation1/);
  assert.match(runtime, /ensureConversationRepliesUiStyles/);
  assert.match(normal, /src\/conversation-replies-ui\.js/);
  assert.match(production, /conversation-replies-ui\.js/);
  assert.match(production, /APP_JS_FEATURE_RELEASE = '20260914-repliesui2'/);
});
