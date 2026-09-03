import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { handleTrustSafetyRequest } from '../src/trust-safety-api.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Phase 28 exposes mute controls without changing the accepted app shell', async () => {
  const html = await read('app/index.html');
  const css = await read('app/assets/app.css');

  for (const id of [
    'profile-mute-button',
    'profile-block-button',
    'profile-report-button',
    'message-thread-mute',
    'message-thread-block',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }

  const phase = Number(html.match(/name="sautilink-release-generation" content="([0-9]+)"/)?.[1] || 0);
  const cssVersion = Number(html.match(/app\.css\?v=(\d+)/)?.[1] || 0);
  const jsVersion = Number(html.match(/app\.js\?v=(\d+)/)?.[1] || 0);
  assert.ok(phase >= 28, `visible app phase regressed below Phase 28: ${phase}`);
  assert.ok(cssVersion >= 28, `app.css version regressed below Phase 28: ${cssVersion}`);
  assert.ok(jsVersion >= 28, `app.js version regressed below Phase 28: ${jsVersion}`);
  assert.match(css, /profile-safety-button\.muted/);
  assert.match(css, /message-inbox-item\.muted/);
});

test('Phase 28 mute Worker routes require authentication', async () => {
  for (const method of ['GET', 'POST', 'DELETE']) {
    const response = await handleTrustSafetyRequest(
      new Request('https://test.sautilink.com/api/safety/mute/someone', { method }),
      {},
    );
    assert.equal(response.status, 401);
    const payload = await response.json();
    assert.equal(payload.error.code, 'AUTH_REQUIRED');
  }
});

test('Phase 28 Worker keeps mute owner-scoped and block-aware', async () => {
  const worker = await read('src/trust-safety-api.js');

  for (const marker of [
    'async function muteState',
    'async function setMute',
    'const muteMatch',
    'social_mutes',
    'SAFETY_MUTE_LIMITER',
    'SELF_MUTE',
    'BLOCK_SUPERSEDES_MUTE',
  ]) {
    assert.ok(worker.includes(marker), `missing mute Worker marker: ${marker}`);
  }
  assert.doesNotMatch(worker, /service_role|sb_secret_|SUPABASE_SECRET/i);
});

test('Phase 28 database model suppresses muted content and notifications without becoming block', async () => {
  const migration = await read('supabase/migrations/20260902090000_enable_phase28_mute_safety_completion.sql');

  for (const marker of [
    'create table if not exists public.social_mutes',
    'social_mutes_no_self',
    'force row level security',
    'social_mutes_select_own_phase28',
    'social_mutes_insert_own_phase28',
    'social_mutes_delete_own_phase28',
    'social_posts_select_phase28_authenticated',
    'social_post_comments_select_phase28_authenticated',
    'social_reposts_select_phase28_authenticated',
    'social_notifications_select_own_phase28',
    'private.suppress_phase28_muted_notification',
    'private.purge_phase28_muted_notifications',
    'private.clear_phase28_mute_on_block',
  ]) {
    assert.ok(migration.includes(marker), `migration missing Phase 28 marker: ${marker}`);
  }

  assert.match(migration, /mute\.muter_id = \(select auth\.uid\(\)\)/i);
  assert.match(migration, /return null;/i);
  assert.match(migration, /delete from public\.social_notifications/i);
  assert.match(migration, /delete from public\.social_mutes/i);
  assert.doesNotMatch(migration, /delete from public\.social_follows/i);
  assert.doesNotMatch(migration, /dm_messages_insert|dm_conversations_insert/i);

  for (const fn of [
    'private.suppress_phase28_muted_notification\\(\\)',
    'private.purge_phase28_muted_notifications\\(\\)',
    'private.clear_phase28_mute_on_block\\(\\)',
  ]) {
    assert.match(
      migration,
      new RegExp(`security definer[\\s\\S]*set search_path = ''[\\s\\S]*revoke all on function ${fn} from public, anon, authenticated`, 'i'),
    );
  }
});

test('Phase 28 browser distinguishes mute from block across feeds Discover notifications and DMs', async () => {
  const app = await read('src/app.js');

  for (const marker of [
    'toggleProfileMute',
    '/api/safety/mute/',
    'muted_by_you',
    'effective_unread_count',
    'Messages still arrive',
    'Muted ·',
    'toggleMessageThreadMute',
    "from('social_mutes')",
    'loadNotifications()',
    'loadStream({ reset: true })',
  ]) {
    assert.ok(app.includes(marker), `browser missing Phase 28 marker: ${marker}`);
  }

  assert.match(app, /effective_unread_count:\s*muted \? 0/i);
  assert.match(app, /if \(!query && mutedIds\.has\(profile\.id\)\) return;/);
  assert.doesNotMatch(app, /innerHTML\s*=/);
  assert.doesNotMatch(app, /service_role|sb_secret_/i);
});

test('Phase 28 adds an independent Cloudflare mute limiter and rotates the shell cache', async () => {
  const wrangler = JSON.parse(await read('wrangler.jsonc'));
  const bindings = wrangler.env.test.ratelimits || [];
  const mute = bindings.find((item) => item.name === 'SAFETY_MUTE_LIMITER');

  assert.deepEqual(mute?.simple, { limit: 30, period: 60 });
  assert.equal(mute?.namespace_id, '2801');
  const namespaces = bindings.map((item) => item.namespace_id);
  assert.equal(new Set(namespaces).size, namespaces.length);

  const sw = await read('sw.js');
  const version = Number(sw.match(/sautilink-shell-v(\d+)/)?.[1] || 0);
  assert.ok(version >= 17, `service worker cache regressed below Phase 28: ${version}`);
});


test('Phase 28 generated Supabase types include private mute relationships', async () => {
  const types = await read('src/types/database.ts');
  assert.match(types, /social_mutes:/);
  assert.match(types, /muter_id: string/);
  assert.match(types, /muted_id: string/);
});
