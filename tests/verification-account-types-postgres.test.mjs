import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const member = '11111111-1111-4111-8111-111111111111';
const staff = '22222222-2222-4222-8222-222222222222';
async function fixture() {
  const db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin;
    create schema auth; create schema private;
    grant usage on schema public,auth,private to authenticated,anon;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table auth.users(id uuid primary key,email text);
    create table public.social_profiles(id uuid primary key,username text unique,is_verified boolean default false,
      verification_badge_type text default 'standard',updated_at timestamptz default now());
    create table public.case_records(id uuid primary key default gen_random_uuid(),sequence_no bigint generated always as identity,
      category text,status text,priority text,submitter_id uuid,subject_user_id uuid,title text,summary text,metadata jsonb,
      created_at timestamptz default now(),updated_at timestamptz default now(),resolved_at timestamptz);
    create unique index verification_active on public.case_records(subject_user_id) where category='verification' and status in ('submitted','reviewing','action_required');
    create table public.case_events(id bigint generated always as identity,case_key text,actor_user_id uuid,actor_role text,event_type text,note text,event_payload jsonb);
    create table private.moderation_staff(user_id uuid primary key,staff_role text,active boolean default true);
    create table private.social_verification_events(user_id uuid,username_snapshot text,previous_verified boolean,new_verified boolean,
      previous_badge_type text,new_badge_type text,source text,actor_id uuid,actor_role text,reason text);
    create table private.social_verification_removal_receipts(user_id uuid,retired_case_ids uuid[],completed_at timestamptz);
    alter table public.case_records enable row level security;
    create policy cases_own on public.case_records for select to authenticated using(subject_user_id=auth.uid());
    grant select on public.case_records to authenticated;
    revoke all on all tables in schema private,auth from public,anon,authenticated;
    insert into auth.users values('${member}','member@example.test'),('${staff}','staff@example.test');
    insert into public.social_profiles values('${member}','applicant',false,'standard',now()),('${staff}','ordinary_brand',true,'team',now());`);
  const moderation = await read('supabase/migrations/20260902112000_enable_phase29_moderation_admin_appeals.sql');
  await db.exec(moderation.slice(moderation.indexOf('create or replace function private.phase29_staff_role()'),moderation.indexOf('drop view if exists public.moderation_staff_self')));
  await db.exec(await read('supabase/migrations/20260915235700_fix_verification_social_link_count.sql'));
  const setter = await read('supabase/migrations/20261020195741_enable_self_verification_removal.sql');
  await db.exec(setter.slice(setter.indexOf('CREATE OR REPLACE FUNCTION private.set_social_verification_privileged_v2'),setter.indexOf('-- Historical case outcome')));
  await db.exec(`revoke all on function private.set_social_verification_privileged_v2(text,boolean,text,text) from public,anon,authenticated;
    grant execute on function private.set_social_verification_privileged_v2(text,boolean,text,text) to authenticated;`);
  await db.exec(await read('supabase/migrations/20261023043820_verification_account_types.sql'));
  return db;
}
async function asUser(db,user,sql,args=[]) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[user]);
    await db.exec('set local role authenticated');
    const result = await db.query(sql,args); await db.exec('commit'); return result;
  } catch (error) { await db.exec('rollback'); throw error; }
}
const submit = (type,articles=['https://news.example.test/profile']) => [
  'Applicant Name','Applicant','Technology','Tanzania',JSON.stringify({instagram:'https://instagram.com/applicant'}),
  JSON.stringify(articles),'Independent coverage confirms this public presence.',true,false,type,
];
const call = 'select public.submit_verification_case($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10) as result';

test('typed verification validates evidence/types, persists owner-only metadata and keeps legacy defaults',async()=>{
  const db=await fixture();
  try {
    for(const type of ['business','brand','entity','organisation']) {
      await assert.rejects(asUser(db,member,call,submit(type,[])),/VERIFICATION_ARTICLE_REQUIRED/);
    }
    await assert.rejects(asUser(db,member,call,submit('staff')),/VERIFICATION_ACCOUNT_TYPE_INVALID/);
    await assert.rejects(asUser(db,member,call,submit('brand',['javascript:alert(1)'])),/ARTICLE_LINKS_INVALID/);
    await assert.rejects(asUser(db,member,call,submit('brand',Array(6).fill('https://news.example.test/a'))),/ARTICLE_LINKS_INVALID/);
    await assert.rejects(asUser(db,'',call,submit('business')),/AUTH_REQUIRED/);
    await assert.rejects(asUser(db,member,'select private.submit_verification_case_legacy_v1($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9)',submit('business',[]).slice(0,9)),/permission denied/);
    const result=(await asUser(db,member,call,submit('business'))).rows[0].result;
    assert.equal(result.status,'submitted');
    const own=(await asUser(db,member,'select metadata from public.case_records')).rows[0].metadata;
    assert.equal(own.account_type,'business'); assert.equal(own.requested_badge_type,'team'); assert.equal(own.government_id_requested,false);
    assert.equal((await asUser(db,staff,'select * from public.case_records')).rows.length,0);
    await assert.rejects(asUser(db,member,"update public.case_records set metadata='{}'"),/permission denied/);
    await assert.rejects(db.exec("set role anon; select public.submit_verification_case('Name',null,'Category','TZ','{}','[]','This is a sufficiently long reason',true);"),/permission denied/);
    await db.exec('reset role; delete from public.case_records');
    await asUser(db,member,'select public.submit_verification_case($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8)',submit('individual',[]).slice(0,8));
    assert.equal((await db.query('select metadata from public.case_records')).rows[0].metadata.account_type,'individual');
    const signatures=await db.query("select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='submit_verification_case'");
    assert.equal(signatures.rows[0].n,1);
  } finally {await db.close();}
});

test('orange businesses get no staff privileges; actual senior reviewers derive new typed badge classes',async()=>{
  const db=await fixture();
  try {
    await asUser(db,member,call,submit('business'));
    await assert.rejects(asUser(db,staff,"select private.set_social_verification_privileged_v2('applicant',true,'team','test')"),/VERIFICATION_ADMIN_REQUIRED/);
    await db.exec(`insert into private.moderation_staff values('${staff}','senior_reviewer',true)`);
    await asUser(db,staff,"select private.set_social_verification_privileged_v2('applicant',true,'standard','reviewed')");
    assert.equal((await db.query("select verification_badge_type from public.social_profiles where username='applicant'")).rows[0].verification_badge_type,'team');
    assert.equal((await db.query('select actor_role from private.social_verification_events')).rows[0].actor_role,'senior_reviewer');
    await db.exec("update public.social_profiles set is_verified=false where username='applicant'; update public.case_records set metadata='{}'");
    await asUser(db,staff,"select private.set_social_verification_privileged_v2('applicant',true,'team','legacy review')");
    assert.equal((await db.query("select verification_badge_type from public.social_profiles where username='applicant'")).rows[0].verification_badge_type,'team');
    await db.exec("update public.social_profiles set is_verified=false where username='applicant'; update public.case_records set metadata='{\"account_type\":\"individual\"}'");
    await asUser(db,staff,"select private.set_social_verification_privileged_v2('applicant',true,'team','new individual review')");
    assert.equal((await db.query("select verification_badge_type from public.social_profiles where username='applicant'")).rows[0].verification_badge_type,'standard');
    await db.exec("update public.social_profiles set is_verified=false where username='applicant'; update public.case_records set metadata='{\"account_type\":\"business\"}'");
    await db.exec(`insert into private.social_verification_removal_receipts select '${member}',array[id],now() from public.case_records`);
    await asUser(db,staff,"select private.set_social_verification_privileged_v2('applicant',true,'standard','retired application cannot classify new grant')");
    assert.equal((await db.query("select verification_badge_type from public.social_profiles where username='applicant'")).rows[0].verification_badge_type,'standard');
    await db.exec("update public.social_profiles set verification_badge_type='team' where username='applicant'; update public.case_records set metadata='{\"account_type\":\"individual\"}'");
    await asUser(db,staff,"select private.set_social_verification_privileged_v2('applicant',true,null,'existing account unchanged')");
    assert.equal((await db.query("select verification_badge_type from public.social_profiles where username='applicant'")).rows[0].verification_badge_type,'team');
  } finally {await db.close();}
});
