-- Local support schema. Table keys/types and ownership policies mirror production;
-- auth.uid/auth.jwt read only synthetic claims. No actual sessions or user data.
create role anon nologin;
create role authenticated nologin;
create schema auth;
create schema private;
grant usage on schema public,auth to anon,authenticated;
grant usage on schema private to authenticated;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb
$$;
create table auth.sessions (id uuid primary key,user_id uuid not null,not_after timestamptz);
create table public.dm_conversations (id uuid primary key,member_one_id uuid not null,member_two_id uuid not null);
create table public.social_member_preferences (user_id uuid primary key,activity_status boolean not null default true);
create table public.social_blocks (blocker_id uuid not null,blocked_id uuid not null,primary key(blocker_id,blocked_id));
revoke all on all tables in schema auth,public from public,anon,authenticated;
grant select on public.dm_conversations,public.social_member_preferences,public.social_blocks to authenticated;
alter table public.dm_conversations enable row level security;
alter table public.social_member_preferences enable row level security;
alter table public.social_blocks enable row level security;
create policy conversations_participant on public.dm_conversations for select to authenticated
  using (auth.uid() in (member_one_id,member_two_id));
create policy preferences_owner on public.social_member_preferences for select to authenticated using (auth.uid()=user_id);
create policy blocks_owner on public.social_blocks for select to authenticated using (auth.uid()=blocker_id);
