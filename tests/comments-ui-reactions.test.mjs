import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('conversation UI presents comments while preserving the Home comment icon', async () => {
  const [source, html] = await Promise.all([read('src/app.js'), read('app/index.html')]);

  assert.match(source, /function createCommentCard\(item\)/);
  assert.match(source, /identity\.append\(verifiedNameNode\([\s\S]*?displayName/);
  assert.match(source, /dataset\.commentReaction = action/);
  assert.match(source, /reply\.dataset\.commentReply = post\.id/);
  assert.match(source, /menuToggle\.append\(homePostMoreIcon\(\)\)/);
  assert.match(source, /report\.dataset\.reportComment = post\.id/);
  assert.match(source, /interactionButton\('comments', 'Comment', post\.comment_count/);
  assert.match(html, />Comments<\/span>/);
  assert.match(html, /Write a comment…/);
  assert.doesNotMatch(html, />Replies<\/span>/);
  assert.doesNotMatch(html, /Write a reply…/);
});

test('comment reactions are atomic, mutually exclusive, and restricted to comment posts', async () => {
  const [migration, api] = await Promise.all([
    read('supabase/migrations/20260917113000_comments_reactions_and_moderation.sql'),
    read('src/social-interactions-api.js'),
  ]);

  assert.match(migration, /add column if not exists dislike_count integer not null default 0/i);
  assert.match(migration, /reaction_type = any \(array\['like'::text, 'dislike'::text\]\)/i);
  assert.match(migration, /create or replace function public\.set_comment_reaction/i);
  assert.match(migration, /comment\.parent_post_id is not null/i);
  assert.match(migration, /delete from public\.social_post_reactions reaction/i);
  assert.match(migration, /report\.target_type = 'comment'/i);
  assert.match(migration, /from public\.social_posts comment[\s\S]*comment\.parent_post_id is not null/i);
  assert.match(api, /commentReactionMatch = path\.match/);
  assert.match(api, /rpc\/set_comment_reaction/);
  assert.doesNotMatch(api, /service_role|sb_secret_|SUPABASE_SECRET/i);
});

test('comment controls expose accessible icon-only actions and reaction counts', async () => {
  const [source, css] = await Promise.all([
    read('src/app.js'),
    read('app/assets/conversation-replies-ui.css'),
  ]);

  assert.match(source, /setAttribute\('aria-label', label\)/);
  assert.match(source, /setAttribute\('aria-pressed', String\(Boolean\(active\)\)\)/);
  assert.match(source, /number\.hidden = Number\(count\) < 1/);
  assert.match(css, /\.comment-menu-toggle svg,[\s\S]*\.comment-action svg \{[\s\S]*width: 20px;[\s\S]*height: 20px;/);
  assert.match(css, /\.comment-reaction-count \{/);
  assert.match(css, /@media \(max-width: 680px\)/);
});
