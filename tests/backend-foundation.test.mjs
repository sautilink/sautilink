import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const migrationPath = 'supabase/migrations/20260826142952_create_social_mvp_foundation.sql';

test('Phase 11 preview is isolated and clearly reports its staging-only state', async () => {
  const source = await read('preview-src/backend-foundation/index.html');
  const built = await read('dist-preview-site/preview/backend-foundation/index.html');

  assert.match(source, /noindex, nofollow/);
  assert.match(source, /connect-src 'none'/);
  assert.match(source, /Production untouched/);
  assert.match(source, /No live database connection/);
  assert.doesNotMatch(`${source}\n${built}`, /supabase\.co|sb_publishable_|service_role/i);
});

test('MVP backend migration covers the approved authoritative records', async () => {
  const sql = await read(migrationPath);
  const tables = [
    'social_blocks',
    'social_follows',
    'social_circles',
    'social_circle_members',
    'social_posts',
    'user_social_settings',
    'social_notifications',
    'dm_conversations',
    'dm_conversation_states',
    'dm_messages',
    'social_reports',
  ];

  for (const table of tables) {
    assert.match(sql, new RegExp(`create table public\\.${table}\\b`));
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(sql, new RegExp(`alter table public\\.${table} force row level security`));
  }
});

test('RLS policies bind writes to auth identity and protect private records', async () => {
  const sql = await read(migrationPath);

  assert.match(sql, /\(select auth\.uid\(\)\) = author_id/);
  assert.match(sql, /\(select auth\.uid\(\)\) = recipient_id/);
  assert.match(sql, /dm_messages_select_participant/);
  assert.match(sql, /dm_messages_insert_participant/);
  assert.match(sql, /social_reports_insert_own/);
  assert.match(sql, /not exists \(\s*select 1 from public\.social_blocks/s);
  assert.doesNotMatch(sql, /raw_user_meta_data|user_metadata|service_role[^\n]*browser/i);
  assert.doesNotMatch(sql, /security definer/i);
});

test('Every foreign-key access path needed by feeds and messages is indexed', async () => {
  const sql = await read(migrationPath);

  for (const index of [
    'social_follows_followed_created_idx',
    'social_circle_members_member_joined_idx',
    'social_posts_author_created_idx',
    'social_posts_circle_created_idx',
    'social_posts_reply_created_idx',
    'social_notifications_actor_id_idx',
    'social_notifications_post_id_idx',
    'dm_conversations_created_by_idx',
    'dm_messages_conversation_sent_idx',
    'dm_messages_sender_id_idx',
  ]) {
    assert.match(sql, new RegExp(`create index ${index}`));
  }
});

test('Basic Messages stays one-to-one and gives each member private state', async () => {
  const sql = await read(migrationPath);

  assert.match(sql, /member_one_id uuid not null/);
  assert.match(sql, /member_two_id uuid not null/);
  assert.match(sql, /dm_conversations_unique_pair unique/);
  assert.match(sql, /last_read_at timestamptz/);
  assert.match(sql, /hidden_at timestamptz/);
  assert.match(sql, /char_length\(btrim\(body\)\) between 1 and 4000/);
  assert.doesNotMatch(sql, /group_chat|voice_call|video_call|disappearing/i);
});

test('Staging site and deployment headers include Phase 11', async () => {
  const stage = await read('scripts/stage-preview-site.mjs');
  const headers = await read('_headers');
  const architecture = await read('docs/architecture/staging-backend-foundation.md');

  assert.match(stage, /Phase 11/);
  assert.match(stage, /preview\/backend-foundation/);
  assert.match(headers, /\/preview\/backend-foundation\/\*/);
  assert.match(architecture, /migration is \*\*not applied\*\* to production/i);
  assert.match(architecture, /publishable key/);
  assert.match(architecture, /security and performance advisors/);
});
