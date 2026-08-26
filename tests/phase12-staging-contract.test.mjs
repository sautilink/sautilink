import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  new URL('../supabase/migrations/20260826183000_create_mvp_staging_contract.sql', import.meta.url),
  'utf8',
);

const newTables = [
  'account_settings',
  'circles',
  'circle_members',
  'follows',
  'blocks',
  'sautis',
  'notifications',
  'conversations',
  'messages',
  'reports',
];

test('Phase 12 creates the ten missing tables in the eleven-table MVP contract', () => {
  for (const table of newTables) {
    assert.match(migration, new RegExp(`create table public\\.${table}\\b`));
  }
  assert.equal((migration.match(/create table public\./g) || []).length, 10);
});

test('Phase 12 enables and forces RLS on every new table', () => {
  for (const table of newTables) {
    assert.match(migration, new RegExp(`['\"]${table}['\"]`));
  }
  assert.match(migration, /enable row level security/);
  assert.match(migration, /force row level security/);
  assert.match(migration, /\(select auth\.uid\(\)\)/);
  assert.doesNotMatch(migration, /auth\.role\(\)|user_metadata|raw_user_meta_data/i);
});

test('Phase 12 protects private capabilities and block boundaries', () => {
  assert.match(migration, /revoke all on table[\s\S]+from anon, authenticated/);
  assert.match(migration, /grant select on public\.circles, public\.sautis to anon/);
  assert.doesNotMatch(migration, /grant[^;]+notifications[^;]+insert[^;]+to authenticated/i);
  assert.match(migration, /RELATIONSHIP_BLOCKED/);
  assert.match(migration, /CONVERSATION_BLOCKED/);
  assert.match(migration, /MESSAGE_BLOCKED/);
  assert.match(migration, /check \(member_low_id < member_high_id\)/);
});

test('Phase 12 indexes feed, membership, unread and message access paths', () => {
  for (const index of [
    'circle_members_member_status_idx',
    'follows_followed_status_created_idx',
    'sautis_public_created_idx',
    'notifications_recipient_unread_idx',
    'messages_conversation_created_idx',
  ]) {
    assert.match(migration, new RegExp(`create index ${index}\\b`));
  }
});
