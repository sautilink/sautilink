import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Phase 25 activates the advanced Sauti composer inside the accepted app shell', async () => {
  const html = await read('app/index.html');
  const css = await read('app/assets/app.css');

  for (const marker of [
    'id="sauti-audience"',
    'id="sauti-reply-access"',
    'id="sauti-quote-preview"',
    'id="sauti-save-draft"',
    'id="sauti-drafts-toggle"',
    'id="composer-offline"',
    'id="circle-sauti-reply-access"',
    'id="open-sauti-composer"',
  ]) {
    assert.ok(html.includes(marker), `missing Phase 25 UI marker: ${marker}`);
  }

  const phase = Number(html.match(/name="sautilink-release-generation" content="([0-9]+)"/)?.[1] || 0);
  assert.ok(phase >= 25, `app milestone regressed below Phase 25: ${phase}`);
  const cssVersion = Number(html.match(/app\.css\?v=([0-9]+)/)?.[1] || 0);
  const jsVersion = Number(html.match(/app\.js\?v=([0-9]+)/)?.[1] || 0);
  assert.ok(cssVersion >= 25, `app CSS version regressed below Phase 25: ${cssVersion}`);
  assert.equal(jsVersion, cssVersion);
  assert.match(css, /\.composer-settings/);
  assert.match(css, /\.composer-drafts/);
  assert.match(css, /\.composer-quote-preview/);
  assert.match(css, /\.sauti-repost-menu/);
  assert.match(css, /\.sauti-quote-card/);
  assert.match(css, /\.circle-sauti-controls/);
});

test('Phase 25 database contract enables followers, reply permissions and privacy-safe Quote Sauti', async () => {
  const base = await read('supabase/migrations/20260901205349_enable_phase25_advanced_sauti_composer.sql');
  const hardening = await read('supabase/migrations/20260901205615_harden_phase25_reply_permissions.sql');
  const sql = `${base}\n${hardening}`;

  assert.match(sql, /add column if not exists reply_access text not null default 'everyone'/i);
  assert.match(sql, /add column if not exists quote_post_id uuid/i);
  assert.match(sql, /social_posts_reply_access_allowed/i);
  assert.match(sql, /foreign key \(quote_post_id\) references public\.social_posts\(id\) on delete set null/i);
  assert.match(sql, /security invoker/i);
  assert.match(sql, /PHASE25_QUOTE_TARGET_UNAVAILABLE/);
  assert.match(sql, /revoke all on function private\.enforce_phase25_post_insert\(\) from public, anon, authenticated/i);
  assert.match(sql, /visibility = 'followers'/i);
  assert.match(sql, /follow\.follower_id = \(select auth\.uid\(\)\)/i);
  assert.match(sql, /social_post_comments_insert_phase25_own/i);
  assert.match(sql, /post\.reply_access = 'following'/i);
  assert.match(sql, /post\.reply_access = 'mentioned'/i);
  assert.match(hardening, /drop policy if exists social_post_comments_insert_phase18/i);
  assert.match(sql, /create view public\.social_stream_events[\s\S]*security_invoker = true/i);
  assert.match(sql, /post\.visibility in \('public', 'followers'\)/i);
});

test('Phase 25 posting API accepts only validated audience, reply and Quote Sauti fields', async () => {
  const api = await read('src/sauti-posts-api.js');

  for (const marker of [
    'requestedQuote',
    'requestedReplyAccess',
    'requestedVisibility',
    'reply_access: requestedReplyAccess',
    'quote_post_id: requestedQuote || null',
    'visibility: requestedVisibility',
    'MENTION_REQUIRED',
    'QUOTE_UNAVAILABLE',
  ]) {
    assert.ok(api.includes(marker), `posting API missing Phase 25 marker: ${marker}`);
  }

  assert.match(api, /\['public', 'followers'\]/);
  assert.match(api, /\['everyone', 'following', 'mentioned'\]/);
  assert.doesNotMatch(api, /service_role|sb_secret_|SUPABASE_SECRET/i);
});

test('Phase 25 social API gives useful reply-permission failures while DB RLS remains canonical', async () => {
  const api = await read('src/social-interactions-api.js');

  assert.match(api, /async function checkReplyPermission/);
  assert.match(api, /post\.reply_access === 'everyone'/);
  assert.match(api, /post\.reply_access === 'following'/);
  assert.match(api, /post\.reply_access === 'mentioned'/);
  assert.match(api, /REPLIES_RESTRICTED/);
  assert.match(api, /matchAll\(\/\(\^\|\[\^a-z0-9\._\]\)@/);
  assert.doesNotMatch(api, /service_role|sb_secret_|SUPABASE_SECRET/i);
});

test('Phase 25 browser composer persists per-account drafts and supports offline + Quote Sauti flow', async () => {
  const source = await read('src/app.js');

  for (const marker of [
    'COMPOSER_DRAFTS_PREFIX',
    'COMPOSER_CURRENT_PREFIX',
    'composerStorageKey',
    'saveComposerDraft',
    'restoreComposerDraft',
    'loadComposerAudiences',
    'prepareComposer',
    'syncComposerOnlineState',
    'startQuoteSauti',
    'toggleRepostMenu',
    'quote_post_id',
    'reply_access',
    'circle:',
  ]) {
    assert.ok(source.includes(marker), `browser source missing Phase 25 marker: ${marker}`);
  }

  assert.match(source, /window\.localStorage/);
  assert.match(source, /window\.addEventListener\('online'/);
  assert.match(source, /window\.addEventListener\('offline'/);
  assert.match(source, /navigator\.onLine/);
  assert.match(source, /Only public posts can be quoted/);
  assert.doesNotMatch(source, /innerHTML\s*=/);
  assert.doesNotMatch(source, /service_role|sb_secret_|SUPABASE_SECRET/i);
});

test('Phase 25 generated Supabase types include advanced post fields', async () => {
  const types = await read('src/types/database.ts');
  assert.match(types, /reply_access: string/);
  assert.match(types, /quote_post_id: string \| null/);
  assert.match(types, /social_posts_quote_post_id_fkey/);
});

test('Phase 25 rotates the service worker cache', async () => {
  const sw = await read('sw.js');
  const version = Number(sw.match(/sautilink-shell-v([0-9]+)/)?.[1] || 0);
  assert.ok(version >= 15, `service worker cache regressed below Phase 25: ${version}`);
});
