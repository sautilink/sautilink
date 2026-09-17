import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('conversation comments use a compact thread-only visual layer', async () => {
  const css = await read('app/assets/conversation-replies-ui.css');

  assert.match(css, /#conversation-thread \.thread-sauti \{/);
  assert.match(css, /#conversation-thread \.thread-sauti \.sauti-card-head \{/);
  assert.match(css, /#conversation-thread \.thread-sauti \.sauti-card-body \{/);
  assert.match(css, /#conversation-thread \.thread-sauti \.sauti-card-footer \{/);
  assert.match(css, /#conversation-thread \.thread-sauti \.sauti-action svg \{[^}]*width:\s*18px;[^}]*height:\s*18px;/s);
  assert.match(css, /\.comment-more-toggle/);
  assert.match(css, /\.comment-more-menu/);
  assert.match(css, /@media \(max-width: 680px\)/);
  assert.match(css, /\.conversation-reply-form textarea \{[^}]*border-radius:\s*22px;/s);
  assert.match(css, /\.conversation-reply-actions \{[^}]*flex-direction:\s*row;/s);
  assert.doesNotMatch(css, /#conversation-root\s+\.sauti-card/);
});

test('comment layer keeps one visible Comments heading', async () => {
  const [css, runtime] = await Promise.all([
    read('app/assets/conversation-replies-ui.css'),
    read('src/conversation-replies-ui.js'),
  ]);

  assert.match(css, /#conversation-reply-heading \{[^}]*display:\s*none;/s);
  assert.match(runtime, /label\.textContent !== 'Comments'/);
  assert.match(runtime, /No comments yet\./);
  assert.match(runtime, /Write a comment…/);
});

test('conversation page keeps one visible Conversation heading', async () => {
  const css = await read('app/assets/conversation-replies-ui.css');

  assert.match(css, /#conversation-surface \.conversation-toolbar \.section-label/);
  assert.match(css, /#conversation-surface \.conversation-toolbar h2 \{[^}]*display:\s*none;/s);
});

test('comment layer explicitly keeps view metrics off comments', async () => {
  const css = await read('app/assets/conversation-replies-ui.css');

  assert.match(css, /#conversation-thread \[data-sauti-metric="views"\] \{[^}]*display:\s*none !important;/s);
  assert.doesNotMatch(css, /#conversation-root[^\n]*data-sauti-metric/);
});

test('comment actions keep Home controls untouched and add thumbs, reply, report and save', async () => {
  const runtime = await read('src/conversation-replies-ui.js');

  assert.match(runtime, /COMMENT_CARD_SELECTOR = '#conversation-thread \.thread-sauti\[data-post-id\]'/);
  assert.match(runtime, /commentThumbIcon\('up'\)/);
  assert.match(runtime, /commentThumbIcon\('down'\)/);
  assert.match(runtime, /commentReplyIcon\(\)/);
  assert.match(runtime, /dataset\.reportComment = postId/);
  assert.match(runtime, /data-sauti-action=\\"save\\"/);
  assert.match(runtime, /identity\?\.querySelector\('a'\)\?\.remove\(\)/);
  assert.doesNotMatch(runtime, /#stream-feed/);
});

test('comment dislike reactions are RLS-backed and mutually exclusive with Like', async () => {
  const sql = await read('supabase/migrations/20260917034500_comments_ui_reactions.sql');

  for (const marker of [
    'create table if not exists public.social_comment_dislikes',
    'social_comment_dislikes_select_visible',
    'social_comment_dislikes_insert_own',
    'social_comment_dislikes_delete_own',
    'enforce_comment_dislike_exclusivity',
    'clear_comment_dislike_on_like',
    "report.target_type = 'comment'",
    'social_posts_moderation_update_reported_comments',
  ]) {
    assert.ok(sql.includes(marker), `comments migration missing marker: ${marker}`);
  }

  assert.match(sql, /delete from public\.social_post_reactions[\s\S]*reaction_type = 'like'/);
  assert.match(sql, /delete from public\.social_comment_dislikes[\s\S]*new\.reaction_type = 'like'/);
  assert.match(sql, /comment\.parent_post_id is not null/);
});

test('conversation comments stylesheet is versioned and bundled by both builders', async () => {
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
