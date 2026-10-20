import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('actual PostgreSQL onboarding RPC preserves identity quotas, signup and partial bootstrap', async () => {
  const db = new PGlite();
  try {
    await db.exec(await read('tests/fixtures/onboarding-identity-schema.sql'));
    const legacy = await read('supabase/migrations/20260823083626_add_social_onboarding.sql');
    await db.exec(legacy.slice(legacy.indexOf('create or replace function public.complete_social_onboarding')));
    const regression = await read('supabase/tests/onboarding_identity_once.sql');
    // A negative control ensures this regression catches the pre-fix bypass.
    await assert.rejects(db.exec(regression), /ONBOARDING_REWROTE_EXISTING_NAME/);
    await db.exec('rollback');
    await db.exec(await read('supabase/migrations/20261020232314_prevent_onboarding_identity_rewrites.sql'));
    const results = await db.exec(regression);
    assert.ok(results.some((r) => r.rows?.some((row) => row.result === 'ONBOARDING_IDENTITY_ONCE_SECURITY_PASS')));
    assert.equal((await db.query('select count(*)::int as count from auth.users')).rows[0].count, 0);
  } finally { await db.close(); }
});

test('actual PostgreSQL reciprocal realtime authorization enforces live sessions and hidden peer privacy/blocks', async () => {
  const db = new PGlite();
  try {
    await db.exec(await read('tests/fixtures/realtime-authorization-schema.sql'));
    await db.exec(await read('supabase/migrations/20261020232404_authorize_realtime_presence_leases.sql'));
    const results = await db.exec(await read('supabase/tests/realtime_authorization.sql'));
    assert.ok(results.some((r) => r.rows?.some((row) => row.result === 'REALTIME_AUTHORIZATION_SECURITY_PASS')));
    assert.equal((await db.query('select count(*)::int as count from auth.sessions')).rows[0].count, 0);
  } finally { await db.close(); }
});

test('actual PostgreSQL Room cover CHECK repairs legacy pointers and rejects foreign namespaces on writes', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create table public.social_circles (id uuid primary key, owner_id uuid not null,
      slug text not null, name text not null, cover_key text);
      insert into public.social_circles values
      ('71000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000001',
       'bad-cover','Bad cover','profiles/foreign/avatar/known.jpg'),
      ('71000000-0000-4000-8000-000000000003','71000000-0000-4000-8000-000000000001',
       'valid-cover','Valid cover','rooms/71000000-0000-4000-8000-000000000003/cover/71000000-0000-4000-8000-000000000004.jpg');`);
    await db.exec(await read('supabase/migrations/20261020232312_harden_room_cover_scope.sql'));
    const rows = (await db.query('select slug,cover_key from public.social_circles order by slug')).rows;
    assert.equal(rows[0].cover_key, null);
    assert.match(rows[1].cover_key, /^rooms\/71000000-0000-4000-8000-000000000003\//);
    await db.exec(await read('supabase/tests/room_cover_scope.sql'));
  } finally { await db.close(); }
});
