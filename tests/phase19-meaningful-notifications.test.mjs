import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Phase 19 activates notifications without redesigning the app shell', async () => {
  const html = await read('app/index.html');
  const css = await read('app/assets/app.css');

  for (const marker of [
    'data-member-view="notifications"',
    'id="notifications-surface"',
    'id="notifications-list"',
    'id="notifications-mark-all"',
    'data-notification-badge',
    'name="sautilink-release-generation"',
  ]) {
    assert.ok(html.includes(marker), `missing Phase 19 app marker: ${marker}`);
  }

  assert.match(css, /\.notifications-surface/);
  assert.match(css, /\.notification-item\.unread/);
  assert.match(css, /\.notification-badge/);
});

test('Phase 19 notification migration keeps recipient privacy and immutable identity fields', async () => {
  const sql = await read('supabase/migrations/20260901154500_enable_phase19_meaningful_notifications.sql');

  assert.match(sql, /alter table public\.social_notifications force row level security/i);
  assert.match(sql, /grant select on table public\.social_notifications to authenticated/i);
  assert.match(sql, /grant update \(read_at\) on table public\.social_notifications to authenticated/i);
  assert.doesNotMatch(sql, /grant\s+insert[^;]*social_notifications\s+to\s+authenticated/i);
  assert.doesNotMatch(sql, /grant\s+delete[^;]*social_notifications\s+to\s+authenticated/i);

  assert.match(sql, /social_notifications_select_own_phase19/);
  assert.match(sql, /\(select auth\.uid\(\)\) = recipient_id/);
  assert.match(sql, /social_blocks/);
  assert.match(sql, /social_notifications_mark_read_own_phase19/);
  assert.match(sql, /read_at is not null/);
});

test('Phase 19 generates and cleans up notifications for the live interaction loop', async () => {
  const sql = await read('supabase/migrations/20260901154500_enable_phase19_meaningful_notifications.sql');

  for (const table of [
    'social_follows',
    'social_post_reactions',
    'social_post_comments',
    'social_reposts',
  ]) {
    assert.match(sql, new RegExp(`on public\\.${table}`));
  }

  for (const type of ["'follow'", "'like'", "'reply'", "'reshare'"]) {
    assert.ok(sql.includes(type), `missing notification type ${type}`);
  }

  assert.match(sql, /target_recipient = target_actor/);
  assert.match(sql, /tg_op = 'DELETE'/);
  assert.match(sql, /delete from public\.social_notifications/);
  assert.match(sql, /phase19_purge_block_notifications/);
  assert.match(sql, /revoke all on function private\.sync_phase19_notification\(\) from public, anon, authenticated/i);
  assert.match(sql, /revoke all on function private\.purge_phase19_block_notifications\(\) from public, anon, authenticated/i);
});

test('Phase 19 browser source supports unread badge and read controls without privileged keys', async () => {
  const source = await read('src/app.js');
  const bundle = await read('app/assets/app.js');
  const router = await read('src/asset-router.js');

  for (const marker of [
    'refreshNotificationBadge',
    'loadNotifications',
    'markNotificationRead',
    'markAllNotificationsRead',
    "from('social_notifications')",
    '/notifications',
  ]) {
    assert.ok(source.includes(marker), `source missing Phase 19 marker: ${marker}`);
  }

  assert.doesNotMatch(source, /service_role|sb_secret_/i);
  assert.ok(bundle.includes('social_notifications'), 'generated app bundle is missing notifications data source');
  assert.ok(bundle.includes('/notifications'), 'generated app bundle is missing canonical notifications route');
  assert.match(router, /MEMBER_ROUTE/);
  assert.match(router, /\/app\\\/notifications/);
});


test('Phase 19 rotates the service worker cache beyond Phase 18', async () => {
  const sw = await read('sw.js');
  const match = sw.match(/sautilink-shell-v(\d+)/);
  assert.ok(match, 'service worker cache version is missing');
  assert.ok(Number(match[1]) >= 9, 'service worker cache regressed below Phase 19');
});
