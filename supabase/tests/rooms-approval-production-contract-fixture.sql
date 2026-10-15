-- Isolated fixture extensions for canonical production RLS/insert/count triggers.
-- The runner loads exact definitions from existing migrations, not replacements.
do $$ begin if current_database() not like 'sautilink_rooms_test%' then raise exception 'LOCAL_TEST_DATABASE_REQUIRED'; end if; end $$;
alter table public.social_circles add column updated_at timestamptz default now();
alter table public.social_posts add column moderation_state text not null default 'visible',
  add column audience_owner_id uuid, add column root_post_id uuid,
  add column reply_to_post_id uuid, add column thread_depth integer not null default 0;
create table private.moderation_staff(user_id uuid primary key references public.social_profiles(id),
  staff_role text, active boolean default true);
revoke all on private.moderation_staff from public, anon, authenticated;
create table public.social_mutes(muter_id uuid, muted_id uuid);
create table public.social_follows(follower_id uuid, followed_id uuid);
create table public.social_reports(id uuid primary key default gen_random_uuid(), target_type text, target_id text);
grant select on public.social_profiles, public.social_blocks, public.social_mutes,
  public.social_follows, public.social_reports to authenticated;
drop policy posts_read on public.social_posts;
alter table public.social_circle_members enable row level security;
grant delete on public.social_circle_members to authenticated;

-- Current production schema already grants this USAGE for its existing staff-role helper.
-- New queue table grants must remain absent even with that inherited schema privilege.
grant usage on schema private to authenticated;

insert into public.social_profiles(id,username) select
  ('a1000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'production_contract_'||i
  from generate_series(1,8) i;
insert into public.social_circles(id,owner_id,name,slug,post_approval_required) values
  ('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',
    'Production contract fixture','production-contract',true);
insert into public.social_circle_members(circle_id,member_id,member_role)
  select 'a2000000-0000-4000-8000-000000000001',('a1000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
    case i when 1 then 'owner' when 2 then 'admin' else 'member' end
  from generate_series(1,3) i;
