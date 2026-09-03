import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { handleSocialInteractionRequest } from '../src/social-interactions-api.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Phase 17 adds follow counts and interaction surfaces without redesign', async () => {
  const html = await read('app/index.html');
  const css = await read('app/assets/app.css');

  for (const id of [
    'profile-follow-button',
    'profile-followers-count',
    'profile-following-count',
    'stream-feed',
  ]) assert.match(html, new RegExp(`id="${id}"`));

  const phase = Number(html.match(/name="sautilink-release-generation" content="([0-9]+)"/)?.[1] || 0);
  assert.ok(phase >= 17, `app milestone regressed below Phase 17: ${phase}`);
  const cssVersion = Number(html.match(/app\.css\?v=(\d+)/)?.[1] || 0);
  const jsVersion = Number(html.match(/app\.js\?v=(\d+)/)?.[1] || 0);
  assert.ok(cssVersion >= 17, `app CSS version regressed below Phase 17: ${cssVersion}`);
  assert.equal(jsVersion, cssVersion, 'app CSS and JS cache-busting versions must stay synchronized');
  assert.match(css, /\.sauti-action/);
  assert.match(css, /\.sauti-comments/);
  assert.match(css, /\.profile-follow-button/);
});

test('Phase 17 Stream uses the security-invoker event read model and canonical post hydration', async () => {
  const source = await read('src/app.js');

  assert.match(source, /\.from\('social_stream_events'\)/);
  assert.match(source, /\.from\('social_posts'\)/);
  assert.match(source, /\.from\('social_post_reactions'\)/);
  assert.match(source, /\.from\('social_reposts'\)/);
  assert.match(source, /\.from\('social_post_comments'\)/);
  assert.match(source, /data-sauti-action/);
  assert.match(source, /data-comment-form/);
  assert.match(source, /profile-follow-button/);
  assert.match(source, /followers_count/);
  assert.match(source, /following_count/);
  assert.doesNotMatch(source, /innerHTML\s*=/);
});

test('all Phase 17 mutation routes require authentication', async () => {
  const cases = [
    new Request('https://test.sautilink.com/api/social/follow/someone', { method: 'POST' }),
    new Request('https://test.sautilink.com/api/social/posts/11111111-2222-4333-8444-555555555555/like', { method: 'POST' }),
    new Request('https://test.sautilink.com/api/social/posts/11111111-2222-4333-8444-555555555555/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'hello' }),
    }),
    new Request('https://test.sautilink.com/api/social/posts/11111111-2222-4333-8444-555555555555/repost', { method: 'POST' }),
  ];

  for (const request of cases) {
    const response = await handleSocialInteractionRequest(request, {});
    assert.equal(response.status, 401);
    const payload = await response.json();
    assert.equal(payload.error.code, 'AUTH_REQUIRED');
  }
});

test('Phase 17 Worker fixes protected identities and uses per-action rate limits', async () => {
  const worker = await read('src/social-interactions-api.js');

  assert.match(worker, /auth\/v1\/user/);
  assert.match(worker, /apikey: SUPABASE_PUBLISHABLE_KEY/);
  assert.match(worker, /follower_id: gate\.session\.user\.id/);
  assert.match(worker, /user_id: gate\.session\.user\.id/);
  assert.match(worker, /author_id: gate\.session\.user\.id/);
  assert.match(worker, /reaction_type: 'like'/);
  assert.match(worker, /body\.length > 500/);
  assert.match(worker, /SOCIAL_FOLLOW_LIMITER/);
  assert.match(worker, /SOCIAL_LIKE_LIMITER/);
  assert.match(worker, /SOCIAL_COMMENT_LIMITER/);
  assert.match(worker, /SOCIAL_COMMENT_DELETE_LIMITER/);
  assert.match(worker, /SOCIAL_REPOST_LIMITER/);
  assert.doesNotMatch(worker, /service_role|sb_secret_|SUPABASE_SECRET/i);
});

test('Phase 17 database contract protects raw identities and maintains server-owned counts', async () => {
  const migration = await read('supabase/migrations/20260831211800_enable_phase17_social_interactions.sql');
  const sqlTest = await read('supabase/tests/phase17_social_interactions_rls.sql');

  assert.match(migration, /create table if not exists public\.social_post_reactions/);
  assert.match(migration, /create table if not exists public\.social_post_comments/);
  assert.match(migration, /create table if not exists public\.social_reposts/);
  assert.match(migration, /reaction_type = 'like'/);
  assert.match(migration, /force row level security/);
  assert.match(migration, /social_follows_insert_phase17/);
  assert.match(migration, /social_post_reactions_select_own/);
  assert.match(migration, /social_post_comments_select_anon/);
  assert.match(migration, /social_reposts_select_anon/);
  assert.match(migration, /security definer/i);
  assert.match(migration, /revoke all on function private\.sync_social_follow_counts\(\) from public, anon, authenticated/i);
  assert.match(migration, /revoke all on function private\.sync_social_post_interaction_counts\(\) from public, anon, authenticated/i);
  assert.match(migration, /with \(security_invoker = true\)/);
  assert.match(migration, /like_count/);
  assert.match(migration, /comment_count/);
  assert.match(migration, /repost_count/);
  assert.match(migration, /followers_count/);
  assert.match(migration, /following_count/);

  for (const marker of [
    'SELF_FOLLOW_ALLOWED',
    'FOLLOW_COUNTERS_NOT_SYNCHRONIZED',
    'POST_COUNTERS_NOT_SYNCHRONIZED',
    'CROSS_USER_COMMENT_DELETE_ALLOWED',
    'CROSS_USER_UNFOLLOW_ALLOWED',
    'HIDDEN_COMMENT_AUTHOR_LEAKED',
    'HIDDEN_REPOSTER_LEAKED',
    'HIDDEN_TARGET_FOLLOW_ALLOWED',
  ]) assert.match(sqlTest, new RegExp(marker));

  assert.match(sqlTest, /begin;[\s\S]*rollback;/i);
});

test('Cloudflare staging config keeps Phase 16 limits and adds Phase 17 limits', async () => {
  const wrangler = JSON.parse(await read('wrangler.jsonc'));
  const bindings = wrangler.env.test.ratelimits || [];
  const byName = (name) => bindings.find((item) => item.name === name);

  assert.deepEqual(byName('SAUTI_CREATE_LIMITER')?.simple, { limit: 10, period: 60 });
  assert.deepEqual(byName('SAUTI_DELETE_LIMITER')?.simple, { limit: 20, period: 60 });
  assert.deepEqual(byName('SOCIAL_FOLLOW_LIMITER')?.simple, { limit: 30, period: 60 });
  assert.deepEqual(byName('SOCIAL_LIKE_LIMITER')?.simple, { limit: 60, period: 60 });
  assert.deepEqual(byName('SOCIAL_COMMENT_LIMITER')?.simple, { limit: 20, period: 60 });
  assert.deepEqual(byName('SOCIAL_COMMENT_DELETE_LIMITER')?.simple, { limit: 30, period: 60 });
  assert.deepEqual(byName('SOCIAL_REPOST_LIMITER')?.simple, { limit: 30, period: 60 });

  const namespaces = bindings.map((item) => item.namespace_id);
  assert.equal(new Set(namespaces).size, namespaces.length);
});

test('Phase 17 keeps a service worker cache generation at or beyond its accepted baseline', async () => {
  const sw = await read('sw.js');
  const version = Number(sw.match(/sautilink-shell-v(\d+)/)?.[1] || 0);
  assert.ok(version >= 6, `service worker cache regressed below Phase 17 baseline: ${version}`);
});
