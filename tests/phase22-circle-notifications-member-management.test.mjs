import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Phase 22 activates Circle notifications and owner member controls without redesign', async () => {
  const html = await read('app/index.html');
  const css = await read('app/assets/app.css');

  for (const marker of [
    'id="circle-members"',
    'id="circle-members-list"',
    'id="circle-member-count"',
    'id="circle-members-empty"',
    'id="notifications-list"',
  ]) {
    assert.ok(html.includes(marker), `missing Phase 22 UI marker: ${marker}`);
  }

  const phase = Number(html.match(/name="sautilink-release-generation" content="([0-9]+)"/)?.[1] || 0);
  assert.ok(phase >= 22, `app milestone regressed below Phase 22: ${phase}`);
  const cssVersion = Number(html.match(/app\.css\?v=([0-9]+)/)?.[1] || 0);
  const jsVersion = Number(html.match(/app\.js\?v=([0-9]+)/)?.[1] || 0);
  assert.ok(cssVersion >= 22, `app CSS version regressed below Phase 22: ${cssVersion}`);
  assert.equal(jsVersion, cssVersion);
  assert.match(css, /\.circle-members/);
  assert.match(css, /\.circle-member-remove/);
});

test('Phase 22 migration adds Circle notification context and owner-only roster boundaries', async () => {
  const base = await read('supabase/migrations/20260901172000_enable_phase22_circle_notifications_member_management.sql');
  const lifecycle = await read('supabase/migrations/20260901173000_finalize_phase22_circle_notification_lifecycle.sql');
  const sql = [base, lifecycle].join('\n');

  assert.match(base, /add column if not exists circle_id uuid references public\.social_circles/i);
  assert.match(sql, /add column if not exists circle_event text/i);
  assert.match(sql, /join_request/i);
  assert.match(sql, /request_approved/i);
  assert.match(sql, /request_declined/i);
  assert.match(sql, /member_removed/i);
  assert.match(sql, /policy_private\.is_phase22_circle_owner/i);
  assert.match(sql, /social_circle_members_select_phase22/i);
  assert.match(sql, /social_circle_members_delete_phase22/i);
  assert.match(sql, /member_role <> 'owner'/i);
  assert.match(sql, /private\.sync_phase22_circle_notification/i);
  assert.match(sql, /revoke all on function private\.sync_phase22_circle_notification\(\) from public, anon, authenticated/i);
  assert.match(sql, /n\.circle_id is not distinct from target_circle/i);
  assert.match(lifecycle, /n\.circle_event = 'join_request'/i);
  assert.match(lifecycle, /delete from public\.social_notifications/i);
});

test('Phase 22 browser renders Circle notification context and owner roster without privileged keys', async () => {
  const source = await read('src/app.js');

  for (const marker of [
    'circle_event',
    'circle_id',
    'loadCircleMembers',
    'removeCircleMember',
    "from('social_circle_members')",
    'data-circle-member-remove',
    'circleMemberRemove',
    'circleSlug',
  ]) {
    assert.ok(source.includes(marker), `source missing Phase 22 marker: ${marker}`);
  }

  assert.match(source, /notification\.notification_type === 'circle'/);
  assert.match(source, /window\.location\.assign\(circlePath\(item\.dataset\.circleSlug\)\)/);
  assert.doesNotMatch(source, /service_role|sb_secret_|SUPABASE_SECRET/i);
  assert.doesNotMatch(source, /innerHTML\s*=/);
});

test('Phase 22 rotates the service worker cache beyond Phase 21', async () => {
  const sw = await read('sw.js');
  const version = Number(sw.match(/sautilink-shell-v([0-9]+)/)?.[1] || 0);
  assert.ok(version >= 12, `service worker cache regressed below Phase 22: ${version}`);
});
