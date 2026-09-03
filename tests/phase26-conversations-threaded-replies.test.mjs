import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Phase 26 activates focused Sauti conversations inside the accepted shell', async () => {
  const html = await read('app/index.html');
  const css = await read('app/assets/app.css');

  const phase = Number(html.match(/name="sautilink-release-generation" content="([0-9]+)"/)?.[1] || 0);
  assert.ok(phase >= 26, `app milestone regressed below Phase 26: ${phase}`);

  for (const marker of [
    'id="conversation-surface"',
    'id="conversation-root"',
    'id="conversation-thread"',
    'id="conversation-reply-form"',
    'id="conversation-reply-body"',
    'id="conversation-sort"',
    'id="conversation-reply-target"',
  ]) {
    assert.ok(html.includes(marker), `missing Phase 26 UI marker: ${marker}`);
  }

  const cssVersion = Number(html.match(/app\.css\?v=([0-9]+)/)?.[1] || 0);
  const jsVersion = Number(html.match(/app\.js\?v=([0-9]+)/)?.[1] || 0);
  assert.ok(cssVersion >= 26, `app stylesheet milestone regressed below Phase 26: ${cssVersion}`);
  assert.equal(jsVersion, cssVersion);
  assert.match(css, /\.conversation-surface/);
  assert.match(css, /\.thread-sauti/);
  assert.match(css, /\.thread-continue/);
  assert.match(css, /@media \(max-width: 680px\)/);
});

test('Phase 26 database contract makes replies canonical Sauti with parent/root/depth and idempotency', async () => {
  const sql = await read('supabase/migrations/20260901212500_enable_phase26_conversations_threaded_replies.sql');

  for (const marker of [
    'parent_post_id uuid',
    'root_post_id uuid',
    'thread_depth smallint',
    'audience_owner_id uuid',
    'client_request_id uuid',
    'social_posts_thread_shape',
    'social_posts_author_client_request_uidx',
    'enforce_phase26_post_insert',
    'sync_phase26_reply_counts',
    'phase26_reply_notification',
  ]) {
    assert.ok(sql.includes(marker), `migration missing Phase 26 marker: ${marker}`);
  }

  assert.match(sql, /foreign key \(parent_post_id\) references public\.social_posts\(id\) on delete cascade/i);
  assert.match(sql, /foreign key \(root_post_id\) references public\.social_posts\(id\) on delete cascade/i);
  assert.match(sql, /thread_depth between 1 and 32/i);
  assert.match(sql, /new\.root_post_id := coalesce\(parent_row\.root_post_id, parent_row\.id\)/i);
  assert.match(sql, /new\.audience_owner_id := parent_row\.audience_owner_id/i);
  assert.match(sql, /new\.visibility := parent_row\.visibility/i);
  assert.match(sql, /new\.circle_id := parent_row\.circle_id/i);
  assert.match(sql, /PHASE26_REPLIES_RESTRICTED/);
  assert.match(sql, /PHASE26_THREAD_DEPTH_LIMIT/);
  assert.match(sql, /revoke insert on table public\.social_post_comments from authenticated/i);
  assert.match(sql, /post\.parent_post_id is null[\s\S]*post\.visibility in \('public', 'followers'\)/i);
});

test('Phase 26 keeps follower and Circle thread visibility rooted in the original audience owner', async () => {
  const sql = await read('supabase/migrations/20260901212500_enable_phase26_conversations_threaded_replies.sql');

  assert.match(sql, /audience_owner_id = author_id/i);
  assert.match(sql, /follow\.followed_id = audience_owner_id/i);
  assert.match(sql, /membership\.circle_id = social_posts\.circle_id/i);
  assert.match(sql, /block\.blocked_id in \(author_id, audience_owner_id\)/i);
  assert.match(sql, /social_posts_select_phase26_authenticated/i);
  assert.match(sql, /social_posts_select_phase26_anon/i);
});

test('Phase 26 social API creates idempotent replies as social_posts and deletes replies through the Sauti model', async () => {
  const api = await read('src/social-interactions-api.js');

  for (const marker of [
    'async function findReplyByRequest',
    'async function createReply',
    'async function deleteReply',
    'client_request_id',
    'parent_post_id: postId',
    'idempotent: true',
    'PHASE26_PARENT_UNAVAILABLE',
    'PHASE26_THREAD_DEPTH_LIMIT',
    '/(?:replies|comments)',
  ]) {
    assert.ok(api.includes(marker), `social API missing Phase 26 marker: ${marker}`);
  }

  assert.match(api, /rest\([\s\S]*social_posts\?select=/);
  assert.doesNotMatch(api, /async function createComment/);
  assert.doesNotMatch(api, /service_role|sb_secret_|SUPABASE_SECRET/i);
});

test('Phase 26 browser supports direct Sauti routes, bounded branches, reply drafts and notification routing', async () => {
  const source = await read('src/app.js');
  const router = await read('src/asset-router.js');
  const html = await read('app/index.html');

  for (const marker of [
    'conversationPath',
    'readConversationRoute',
    'loadConversation',
    'renderConversationThread',
    'THREAD_RENDER_DEPTH',
    'THREAD_DRAFT_PREFIX',
    'submitThreadReply',
    'item.dataset.sautiId',
    'conversation-reply-body',
  ]) {
    assert.ok(source.includes(marker), `browser source missing Phase 26 marker: ${marker}`);
  }

  assert.match(source, /\/post\//);
  assert.match(source, /\/app\/sauti/);
  assert.match(html, /<option value="relevant">Relevant<\/option>/);
  assert.match(html, /<option value="newest">Newest<\/option>/);
  assert.match(source, /client_request_id: threadReplyRequestId/);
  assert.match(source, /window\.localStorage/);
  assert.match(source, /navigator\.onLine/);
  assert.match(source, /item\.dataset\.sautiId/);
  assert.match(router, /SAUTI_ROUTE/);
  assert.match(router, /CLEAN_POST_ROUTE/);
  assert.doesNotMatch(source, /innerHTML\s*=/);
  assert.doesNotMatch(source, /service_role|sb_secret_|SUPABASE_SECRET/i);
});

test('Phase 26 generated Supabase types include thread fields', async () => {
  const types = await read('src/types/database.ts');
  assert.match(types, /parent_post_id: string \| null/);
  assert.match(types, /root_post_id: string \| null/);
  assert.match(types, /thread_depth: number/);
  assert.match(types, /audience_owner_id: string/);
  assert.match(types, /client_request_id: string \| null/);
});

test('Phase 26 rotates the service worker cache', async () => {
  const sw = await read('sw.js');
  const version = Number(sw.match(/sautilink-shell-v(\d+)/)?.[1] || 0);
  assert.ok(version >= 16, `service worker cache regressed below Phase 26: ${version}`);
});
