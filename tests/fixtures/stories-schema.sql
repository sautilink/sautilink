-- Minimal canonical support schema for offline PostgreSQL Story security tests.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create schema private;
grant usage on schema public,auth to anon,authenticated,service_role;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
create table auth.users(id uuid primary key,deleted_at timestamptz,banned_until timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid not null references auth.users(id),not_after timestamptz);
create table public.social_profiles(id uuid primary key references auth.users(id),username text unique not null,display_name text not null,
  is_discoverable boolean not null default true,is_verified boolean not null default false,verification_badge_type text not null default 'standard',avatar_key text);
create table public.social_account_deletion_requests(user_id uuid primary key,status text not null);
create table public.social_blocks(blocker_id uuid not null,blocked_id uuid not null,primary key(blocker_id,blocked_id));
create table public.social_mutes(muter_id uuid not null,muted_id uuid not null,primary key(muter_id,muted_id));
create table public.social_follows(follower_id uuid not null,followed_id uuid not null,primary key(follower_id,followed_id));
create table public.social_member_preferences(user_id uuid primary key,notify_post_activity boolean not null default true);
create table public.social_posts(id uuid primary key,author_id uuid not null,post_status text not null default 'published',deleted_at timestamptz,moderation_state text not null default 'visible');
create table public.social_post_media(id uuid primary key,owner_id uuid not null,post_id uuid references public.social_posts(id),object_key text not null,
  media_kind text not null,upload_status text not null,size_bytes bigint,width integer,height integer,duration_ms integer);
create table public.social_notifications(id bigint generated always as identity primary key,recipient_id uuid not null,actor_id uuid,post_id uuid,
  notification_type text not null,read_at timestamptz,created_at timestamptz not null default now(),
  constraint social_notifications_type_allowed check(notification_type in ('follow','reply','mention','like','reshare','circle','message','safety')));
alter table public.social_notifications enable row level security;
alter table public.social_notifications force row level security;
create policy notifications_own on public.social_notifications for select to authenticated using(recipient_id=auth.uid());
grant select on public.social_notifications to authenticated;
create table public.push_delivery_queue(id uuid primary key default gen_random_uuid(),dispatch_key uuid not null default gen_random_uuid(),recipient_id uuid not null,
  source_type text not null,source_id text not null,unique(source_type,source_id,recipient_id));
create table private.dispatch_test_calls(queue_id uuid,dispatch_key uuid);
create function private.dispatch_push_delivery_v1(p_queue_id uuid,p_dispatch_key uuid) returns void language sql security definer set search_path='' as $$
  insert into private.dispatch_test_calls values(p_queue_id,p_dispatch_key);
$$;
revoke all on all tables in schema public,auth,private from public,anon,authenticated;
grant select on public.social_notifications to authenticated;
