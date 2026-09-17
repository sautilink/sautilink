import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('comments use a compact YouTube-scale thread visual layer', async () => {
  const [html, css] = await Promise.all([
    read('app/index.html'),
    read('app/assets/conversation-replies-ui.css'),
  ]);

  assert.match(css, /#conversation-thread \.comment-card \{/);
  assert.match(css, /\.comment-avatar \{/);
  assert.match(css, /\.comment-author \{/);
  assert.match(css, /\.comment-body \{/);
  assert.match(css, /\.comment-action svg \{[^}]*width:\s*20px;[^}]*height:\s*20px;/s);
  assert.match(css, /\.comment-action \{[^}]*min-width:\s*36px;[^}]*min-height:\s*36px;/s);
  assert.match(css, /@media \(max-width: 680px\)/);
  assert.match(css, /\.conversation-reply-form textarea \{[^}]*border-radius:\s*22px;/s);
  assert.match(css, /\.conversation-reply-compose \{[^}]*display:\s*flex;/s);
  assert.match(css, /\.conversation-reply-form \{[^}]*position:\s*sticky;[^}]*bottom:\s*0;/s);
  assert.doesNotMatch(html, /id="conversation-root"/);
});

test('comments page keeps only an iOS-style back control and Comments header', async () => {
  const [html, css] = await Promise.all([
    read('app/index.html'),
    read('app/assets/conversation-replies-ui.css'),
  ]);

  assert.match(html, /id="conversation-back"[\s\S]*?<svg[\s\S]*?<span>Back<\/span>[\s\S]*?<h2>Comments<\/h2>/);
  assert.match(css, /#conversation-surface \.conversation-back svg \{[^}]*width:\s*27px;/s);
  assert.doesNotMatch(html, /Focused conversation|<h2>Conversation<\/h2>|Commenting on|Text comment|conversation-thread-heading|conversation-sort/);
});

test('comments list appears without the original post and composer stays below the list', async () => {
  const [html, source] = await Promise.all([
    read('app/index.html'),
    read('src/app.js'),
  ]);

  assert.ok(html.indexOf('id="conversation-thread"') < html.indexOf('id="conversation-reply-form"'));
  assert.doesNotMatch(source, /rootCard\s*=\s*createSautiCard|rootSlot\.append/);
  assert.match(source, /\(children\.get\(rootId\) \|\| \[\]\)\.forEach/);
});

test('comments stylesheet is versioned and bundled by both builders', async () => {
  const [runtime, normal, production] = await Promise.all([
    read('src/conversation-replies-ui.js'),
    read('scripts/build-app.mjs'),
    read('scripts/build-production-release.mjs'),
  ]);

  assert.match(runtime, /conversation-replies-ui\.css\?v=20260917-commentmenu1/);
  assert.match(runtime, /ensureConversationRepliesUiStyles/);
  assert.match(normal, /src\/conversation-replies-ui\.js/);
  assert.match(production, /conversation-replies-ui\.js/);
  assert.match(production, /APP_JS_FEATURE_RELEASE = '\d{8}-[a-z0-9-]+'/);
});
