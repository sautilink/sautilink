import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Room cover media is authenticated, validated and manager-only', async () => {
  const [api, router] = await Promise.all([
    read('src/room-media-api.js'),
    read('src/asset-router.js'),
  ]);

  assert.match(router, /handleRoomMediaRequest/);
  assert.match(router, /pathname\.startsWith\('\/api\/room-media\/'\)/);
  assert.match(api, /COVER_LIMIT = 10 \* 1024 \* 1024/);
  assert.match(api, /image\/jpeg/);
  assert.match(api, /image\/png/);
  assert.match(api, /image\/webp/);
  assert.match(api, /inspected\.width < 600 \|\| inspected\.height < 200/);
  assert.match(api, /Only Room owners and admins can change the cover photo/);
  assert.match(api, /rooms\/\$\{room\.id\}\/cover/);
});

test('Room invitations enforce member/staff permissions and recipient acceptance', async () => {
  const migration = await read('supabase/migrations/20260909040000_enable_room_invitations.sql');
  const reentry = await read('supabase/migrations/20260909040500_allow_room_reinvites.sql');

  assert.match(migration, /create table if not exists public\.social_room_invitations/);
  assert.match(migration, /room\.invite_permission = 'all_members'/);
  assert.match(migration, /policy_private\.is_room_staff\(room\.id\)/);
  assert.match(migration, /invited_user_id = \(select auth\.uid\(\)\)/);
  assert.match(migration, /status in \('accepted', 'declined'\)/);
  assert.match(migration, /apply_room_invitation_acceptance/);
  assert.match(migration, /insert into public\.social_circle_members/);
  assert.match(reentry, /status <> 'accepted'/);
});

test('Room invitation UI supports invite, accept and decline flows', async () => {
  const [source, packageJson] = await Promise.all([
    read('src/rooms-invitations.js'),
    read('package.json'),
  ]);

  assert.match(source, /Invite a member/);
  assert.match(source, /SautiLink username/);
  assert.match(source, /Invitation sent to @/);
  assert.match(source, /textContent = 'Accept'/);
  assert.match(source, /textContent = 'Decline'/);
  assert.match(source, /social_room_invitations/);
  assert.match(packageJson, /--inject:\.\/src\/rooms-invitations\.js/);
});
