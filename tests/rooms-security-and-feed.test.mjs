import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Rooms schema adds categories, privacy, covers and role-aware permissions', async () => {
  const migration = await read('supabase/migrations/20260909034500_enable_rooms_platform.sql');

  assert.match(migration, /add column if not exists category text/);
  assert.match(migration, /add column if not exists privacy text/);
  assert.match(migration, /add column if not exists cover_key text/);
  assert.match(migration, /add column if not exists post_permission text/);
  assert.match(migration, /add column if not exists invite_permission text/);
  assert.match(migration, /'member'::text, 'moderator'::text, 'admin'::text, 'owner'::text/);
  assert.match(migration, /policy_private\.is_room_staff/);
  assert.match(migration, /policy_private\.can_manage_room/);
  assert.match(migration, /ROOM_OWNER_ROLE_IMMUTABLE/);
  assert.match(migration, /ROOM_ADMIN_CANNOT_MANAGE_ADMIN/);
});

test('Room posts reach Home only through member-authorized post RLS', async () => {
  const [roomsMigration, phase21] = await Promise.all([
    read('supabase/migrations/20260909034500_enable_rooms_platform.sql'),
    read('supabase/migrations/20260901170000_enable_phase21_circle_stream_mvp.sql'),
  ]);

  assert.match(roomsMigration, /create or replace view public\.social_stream_events\s+with \(security_invoker = true\)/s);
  assert.match(roomsMigration, /post\.circle_id is not null and post\.visibility = 'circle'/);
  assert.match(phase21, /visibility = 'circle'/);
  assert.match(phase21, /membership\.circle_id = social_posts\.circle_id/);
  assert.match(phase21, /membership\.member_id = \(select auth\.uid\(\)\)/);
});

test('Room posting restrictions are enforced in the database, not only the UI', async () => {
  const migration = await read('supabase/migrations/20260909034500_enable_rooms_platform.sql');

  assert.match(migration, /private\.enforce_room_post_permission/);
  assert.match(migration, /ROOM_MEMBERSHIP_REQUIRED/);
  assert.match(migration, /ROOM_POSTING_RESTRICTED/);
  assert.match(migration, /permission = 'staff_only'/);
  assert.match(migration, /actor_role not in \('owner', 'admin', 'moderator'\)/);
});

test('private Rooms remain discoverable by metadata while posts remain member-only', async () => {
  const discovery = await read('supabase/migrations/20260909035500_refine_room_discovery_and_requests.sql');
  const phase21 = await read('supabase/migrations/20260901170000_enable_phase21_circle_stream_mvp.sql');

  assert.match(discovery, /create policy social_circles_select_rooms/);
  assert.match(discovery, /not exists \(\s*select 1\s*from public\.social_blocks/s);
  assert.match(phase21, /visibility = 'circle'/);
  assert.match(phase21, /social_circle_members membership/);
});
