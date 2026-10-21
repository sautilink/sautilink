import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const schema = new URL('./fixtures/room-admission-schema.sql', import.meta.url);
const migration = new URL('../supabase/migrations/20261020232313_consume_room_admission_on_leave.sql', import.meta.url);
const seed = new URL('../supabase/tests/room_admission_pre_migration.sql', import.meta.url);
const regression = new URL('../supabase/tests/room_admission_replay.sql', import.meta.url);

test('actual PostgreSQL roles block stale Room invitation admission and preserve current admission flows', { timeout: 120_000 }, async (t) => {
  // In-memory PostgreSQL only: no hosted database URL, user token or live request.
  const db = new PGlite();
  async function stage(name, sql) {
    try { return await db.exec(sql); }
    catch (error) { throw new Error(name + ': ' + error.message, { cause: { code: error.code, detail: error.detail, where: error.where } }); }
  }
  try {
    await stage('canonical Room schema', await readFile(schema, 'utf8'));
    await db.exec("select set_config('sautilink.security_test_fixture','rooms-v1',false)");
    await stage('pre-migration invitation fixtures', await readFile(seed, 'utf8'));

    // Reproduce both actual admission paths before applying the fix. Their
    // transactions roll back so neither becomes an artificial migration input.
    const directBaseline = await stage('baseline direct replay', String.raw`
      begin;
      select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000003',true);
      set local role authenticated;
      insert into public.social_circle_members(circle_id,member_id,member_role)
      values('d2000000-0000-4000-8000-000000000001',auth.uid(),'member');
      select policy_private.is_room_member('d2000000-0000-4000-8000-000000000001') as replay_succeeded;
      rollback;
    `);
    assert.equal(directBaseline.flatMap(result => result.rows ?? []).find(row => 'replay_succeeded' in row)?.replay_succeeded, true);
    const managedBaseline = await stage('baseline definer replay', String.raw`
      begin;
      select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000003',true);
      set local role authenticated;
      select public.room_submit_membership_request('d2000000-0000-4000-8000-000000000001',1,
        'd4000000-0000-4000-8000-000000000001','[]','accept_invitation')->>'status' as replay_status;
      rollback;
    `);
    assert.equal(managedBaseline.flatMap(result => result.rows ?? []).find(row => 'replay_status' in row)?.replay_status, 'member');

    await stage('admission lifecycle migration', await readFile(migration, 'utf8'));
    const results = await stage('role/RLS/trigger/RPC regression', await readFile(regression, 'utf8'));
    const assertions = results.flatMap(result => result.rows ?? []).find(row => 'room_admission_assertions' in row)?.room_admission_assertions;
    assert.ok(assertions >= 33, 'expected at least 33 executed SQL behavioral assertions');
    t.diagnostic('Both pre-fix replay paths reproduced; ' + assertions + ' post-fix SQL behavioral assertions passed.');
    const unchanged = await db.query(`
      select count(*)::integer as invitation_count,
        count(*) filter(where membership_ended_at is null)::integer as active_count,
        count(*) filter(where membership_ended_at is not null)::integer as expired_count
      from public.social_room_invitations
    `);
    assert.deepEqual(unchanged.rows, [{ invitation_count: 2, active_count: 1, expired_count: 1 }]);
    const leakedTestRelations = await db.query("select to_regclass('pg_temp.room_admission_checks') as relation");
    assert.equal(leakedTestRelations.rows[0].relation, null, 'behavioral transaction rolled back its temporary fixtures');
  } finally {
    await db.close();
  }
});

