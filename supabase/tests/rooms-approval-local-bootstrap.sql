-- Isolated disposable PostgreSQL fixture only. Never run on a hosted project.
do $$ begin
  if current_database() not like 'sautilink_rooms_test%' then
    raise exception 'LOCAL_TEST_DATABASE_REQUIRED';
  end if;
end $$;
create extension if not exists pgcrypto;
create schema if not exists auth;
create schema if not exists private;
create schema if not exists policy_private;
do $$ begin
  if not exists (select from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select from pg_roles where rolname='authenticated') then create role authenticated; end if;
end $$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
grant usage on schema public, auth to authenticated, anon;
create table public.social_profiles(id uuid primary key, username text, is_discoverable boolean default true);
create table public.social_circles(id uuid primary key, owner_id uuid references public.social_profiles(id) on delete cascade,
  name text, slug text, privacy text default 'public', post_permission text default 'all_members');
create table public.social_circle_members(circle_id uuid references public.social_circles(id) on delete cascade,
  member_id uuid references public.social_profiles(id) on delete cascade, member_role text, primary key(circle_id,member_id));
create table public.social_blocks(blocker_id uuid, blocked_id uuid);
create table public.social_posts(id uuid primary key default gen_random_uuid(), author_id uuid references public.social_profiles(id) on delete cascade,
  circle_id uuid references public.social_circles(id) on delete cascade, visibility text, post_status text default 'published',
  body text, reply_access text default 'everyone', quote_post_id uuid, parent_post_id uuid, media_count int default 0,
  created_at timestamptz default now(), client_request_id uuid, deleted_at timestamptz);
create table public.social_post_media(id uuid primary key, owner_id uuid references public.social_profiles(id) on delete cascade,
  post_id uuid references public.social_posts(id) on delete cascade, object_key text, media_kind text, content_type text,
  size_bytes bigint, width int, height int, duration_ms int, alt_text text default '', position smallint,
  upload_status text default 'ready', expires_at timestamptz default(now()+interval '1 hour'),
  finalized_at timestamptz default now(), attached_at timestamptz, created_at timestamptz default now());
create table public.social_notifications(id uuid primary key default gen_random_uuid(), recipient_id uuid references public.social_profiles(id) on delete cascade,
  actor_id uuid references public.social_profiles(id) on delete cascade, post_id uuid references public.social_posts(id) on delete cascade,
  circle_id uuid references public.social_circles(id) on delete cascade, circle_event text, notification_type text,
  read_at timestamptz, created_at timestamptz default now(),
  constraint social_notifications_circle_event_allowed check(circle_event is null or circle_event in('join_request','request_approved','request_declined','member_removed')));
create function policy_private.room_member_role(uuid,uuid default auth.uid()) returns text language sql security definer set search_path='' as $$
  select member_role from public.social_circle_members where circle_id=$1 and member_id=$2;
$$;
create function policy_private.is_room_staff(uuid,uuid default auth.uid()) returns boolean language sql security definer set search_path='' as $$
  select coalesce(policy_private.room_member_role($1,$2) in('owner','admin','moderator'),false);
$$;
grant usage on schema policy_private to authenticated;
alter table public.social_circles enable row level security;
create policy rooms_read on public.social_circles for select to authenticated using(true);
create policy rooms_settings on public.social_circles for update to authenticated using(
  policy_private.room_member_role(id,auth.uid()) in('owner','admin')) with check(
  policy_private.room_member_role(id,auth.uid()) in('owner','admin'));
grant select,update(name) on public.social_circles to authenticated;
alter table public.social_posts enable row level security;
create policy posts_read on public.social_posts for select using(
  visibility='public' or exists(select from public.social_circle_members where circle_id=social_posts.circle_id and member_id=auth.uid()));
create policy posts_insert on public.social_posts for insert to authenticated with check(author_id=auth.uid());
grant select,insert on public.social_posts to authenticated;
grant select on public.social_circle_members to authenticated;
alter table public.social_post_media enable row level security;
create policy media_owner on public.social_post_media for all to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());
grant select,update,delete on public.social_post_media to authenticated;
-- Existing production insert guards are also exercised by native/full-schema QA;
-- this fixture isolates the additive queue's actual auth, transaction and RLS code.
