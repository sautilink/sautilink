-- Phase 18 — Reports, Blocks, Account Deletion & Moderation Foundations
-- Applied to staging as Supabase migration 20260901133800.

alter table public.social_reports
  drop constraint social_reports_target_type_allowed;

alter table public.social_reports
  add constraint social_reports_target_type_allowed
  check (target_type = any (array['profile'::text, 'post'::text, 'comment'::text, 'message'::text, 'circle'::text]));

alter table public.social_reports
  add column if not exists status_updated_at timestamptz not null default now(),
  add column if not exists reviewed_at timestamptz,
  add column if not exists resolved_at timestamptz,
  add column if not exists moderation_note text;

alter table public.social_reports
  add constraint social_reports_moderation_note_length
  check (moderation_note is null or char_length(moderation_note) <= 2000);

create unique index if not exists social_reports_active_target_unique
  on public.social_reports (reporter_id, target_type, target_id)
  where report_status in ('open', 'reviewing');

create or replace function private.validate_social_report_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_uid uuid := auth.uid();
  target_owner uuid;
begin
  if current_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  new.reporter_id := current_uid;
  new.report_status := 'open';
  new.status_updated_at := now();
  new.reviewed_at := null;
  new.resolved_at := null;
  new.moderation_note := null;
  new.details := nullif(btrim(coalesce(new.details, '')), '');

  if new.target_type in ('profile', 'post', 'comment')
     and new.target_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'REPORT_TARGET_INVALID' using errcode = '22023';
  end if;

  case new.target_type
    when 'profile' then
      select profile.id
        into target_owner
      from public.social_profiles profile
      where profile.id = new.target_id::uuid;
    when 'post' then
      select post.author_id
        into target_owner
      from public.social_posts post
      where post.id = new.target_id::uuid;
    when 'comment' then
      select comment.author_id
        into target_owner
      from public.social_post_comments comment
      where comment.id = new.target_id::uuid;
    else
      raise exception 'REPORT_TARGET_NOT_LIVE' using errcode = '0A000';
  end case;

  if not found then
    raise exception 'REPORT_TARGET_UNAVAILABLE' using errcode = 'P0002';
  end if;

  if target_owner = current_uid then
    raise exception 'SELF_REPORT_NOT_ALLOWED' using errcode = '22023';
  end if;

  return new;
end;
$$;

revoke all on function private.validate_social_report_insert() from public, anon, authenticated;

drop trigger if exists validate_social_report_insert on public.social_reports;
create trigger validate_social_report_insert
before insert on public.social_reports
for each row
execute function private.validate_social_report_insert();

create or replace function private.normalize_social_report_moderation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.moderation_note := nullif(btrim(coalesce(new.moderation_note, '')), '');

  if new.report_status is distinct from old.report_status then
    new.status_updated_at := now();

    if new.report_status = 'reviewing' then
      new.reviewed_at := coalesce(old.reviewed_at, now());
    end if;

    if new.report_status in ('resolved', 'dismissed') then
      new.resolved_at := now();
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.normalize_social_report_moderation() from public, anon, authenticated;

drop trigger if exists normalize_social_report_moderation on public.social_reports;
create trigger normalize_social_report_moderation
before update of report_status, moderation_note on public.social_reports
for each row
execute function private.normalize_social_report_moderation();

create table if not exists private.social_report_status_audit (
  id bigint generated always as identity primary key,
  report_id bigint not null references public.social_reports(id) on delete cascade,
  old_status text not null,
  new_status text not null,
  actor_id uuid,
  changed_at timestamptz not null default now()
);

revoke all on table private.social_report_status_audit from public, anon, authenticated;

create or replace function private.audit_social_report_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.social_report_status_audit (
    report_id,
    old_status,
    new_status,
    actor_id
  )
  values (
    new.id,
    old.report_status,
    new.report_status,
    auth.uid()
  );

  return new;
end;
$$;

revoke all on function private.audit_social_report_status() from public, anon, authenticated;

drop trigger if exists audit_social_report_status on public.social_reports;
create trigger audit_social_report_status
after update of report_status on public.social_reports
for each row
when (old.report_status is distinct from new.report_status)
execute function private.audit_social_report_status();

create or replace function private.enforce_social_block_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.social_follows follow_row
  where
    (follow_row.follower_id = new.blocker_id and follow_row.followed_id = new.blocked_id)
    or
    (follow_row.follower_id = new.blocked_id and follow_row.followed_id = new.blocker_id);

  return new;
end;
$$;

revoke all on function private.enforce_social_block_insert() from public, anon, authenticated;

drop trigger if exists enforce_social_block_insert on public.social_blocks;
create trigger enforce_social_block_insert
after insert on public.social_blocks
for each row
execute function private.enforce_social_block_insert();

delete from public.social_follows follow_row
where exists (
  select 1
  from public.social_blocks block
  where
    (block.blocker_id = follow_row.follower_id and block.blocked_id = follow_row.followed_id)
    or
    (block.blocker_id = follow_row.followed_id and block.blocked_id = follow_row.follower_id)
);

drop policy if exists social_profiles_select_discoverable_or_own on public.social_profiles;

create policy social_profiles_select_phase18_anon
on public.social_profiles
for select
to anon
using (is_discoverable = true);

create policy social_profiles_select_phase18_authenticated
on public.social_profiles
for select
to authenticated
using (
  (select auth.uid()) = id
  or (
    is_discoverable = true
    and not exists (
      select 1
      from public.social_blocks block
      where block.blocker_id = social_profiles.id
        and block.blocked_id = (select auth.uid())
    )
  )
);

drop policy if exists social_post_reactions_insert_own on public.social_post_reactions;
create policy social_post_reactions_insert_phase18
on public.social_post_reactions
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and reaction_type = 'like'
  and exists (
    select 1
    from public.social_posts post
    where post.id = social_post_reactions.post_id
      and not exists (
        select 1
        from public.social_blocks block
        where
          (block.blocker_id = (select auth.uid()) and block.blocked_id = post.author_id)
          or
          (block.blocker_id = post.author_id and block.blocked_id = (select auth.uid()))
      )
  )
);

drop policy if exists social_post_comments_insert_own on public.social_post_comments;
create policy social_post_comments_insert_phase18
on public.social_post_comments
for insert
to authenticated
with check (
  (select auth.uid()) = author_id
  and exists (
    select 1
    from public.social_posts post
    where post.id = social_post_comments.post_id
      and not exists (
        select 1
        from public.social_blocks block
        where
          (block.blocker_id = (select auth.uid()) and block.blocked_id = post.author_id)
          or
          (block.blocker_id = post.author_id and block.blocked_id = (select auth.uid()))
      )
  )
);

drop policy if exists social_reposts_insert_own on public.social_reposts;
create policy social_reposts_insert_phase18
on public.social_reposts
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.social_posts post
    where post.id = social_reposts.post_id
      and not exists (
        select 1
        from public.social_blocks block
        where
          (block.blocker_id = (select auth.uid()) and block.blocked_id = post.author_id)
          or
          (block.blocker_id = post.author_id and block.blocked_id = (select auth.uid()))
      )
  )
);

create table public.social_account_deletion_requests (
  user_id uuid primary key references public.social_profiles(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'cancelled', 'completed')),
  requested_at timestamptz not null default now(),
  cancelled_at timestamptz,
  completed_at timestamptz,
  restore_discoverable boolean not null default true
);

comment on table public.social_account_deletion_requests is
  'Phase 18 owner-scoped account deletion requests. Final Auth purge requires a privileged backend processor.';

alter table public.social_account_deletion_requests enable row level security;
alter table public.social_account_deletion_requests force row level security;

revoke all on table public.social_account_deletion_requests from public, anon, authenticated;
grant select, insert, update on table public.social_account_deletion_requests to authenticated;
grant select, insert, update, delete on table public.social_account_deletion_requests to service_role;

create policy social_account_deletion_requests_select_own
on public.social_account_deletion_requests
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy social_account_deletion_requests_insert_own
on public.social_account_deletion_requests
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and status = 'pending'
);

create policy social_account_deletion_requests_update_own
on public.social_account_deletion_requests
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create or replace function private.normalize_account_deletion_request()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_uid uuid := auth.uid();
  current_discoverable boolean;
begin
  if current_uid is null then
    if current_user in ('postgres', 'service_role', 'supabase_admin') then
      return new;
    end if;
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    select profile.is_discoverable
      into current_discoverable
    from public.social_profiles profile
    where profile.id = current_uid;

    if not found then
      raise exception 'PROFILE_REQUIRED' using errcode = 'P0002';
    end if;

    new.user_id := current_uid;
    new.status := 'pending';
    new.requested_at := now();
    new.cancelled_at := null;
    new.completed_at := null;
    new.restore_discoverable := current_discoverable;
    return new;
  end if;

  if old.user_id <> current_uid or new.user_id <> old.user_id then
    raise exception 'DELETION_REQUEST_OWNER_MISMATCH' using errcode = '42501';
  end if;

  if old.status = 'pending' and new.status = 'cancelled' then
    new.status := 'cancelled';
    new.requested_at := old.requested_at;
    new.cancelled_at := now();
    new.completed_at := null;
    new.restore_discoverable := old.restore_discoverable;
    return new;
  end if;

  if old.status = 'cancelled' and new.status = 'pending' then
    select profile.is_discoverable
      into current_discoverable
    from public.social_profiles profile
    where profile.id = current_uid;

    if not found then
      raise exception 'PROFILE_REQUIRED' using errcode = 'P0002';
    end if;

    new.status := 'pending';
    new.requested_at := now();
    new.cancelled_at := null;
    new.completed_at := null;
    new.restore_discoverable := current_discoverable;
    return new;
  end if;

  raise exception 'INVALID_DELETION_REQUEST_TRANSITION' using errcode = '22023';
end;
$$;

revoke all on function private.normalize_account_deletion_request() from public, anon, authenticated;

drop trigger if exists normalize_account_deletion_request on public.social_account_deletion_requests;
create trigger normalize_account_deletion_request
before insert or update on public.social_account_deletion_requests
for each row
execute function private.normalize_account_deletion_request();

create or replace function private.apply_account_deletion_visibility()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status = 'pending' then
    update public.social_profiles
    set is_discoverable = false
    where id = new.user_id;
  elsif new.status = 'cancelled' then
    update public.social_profiles
    set is_discoverable = new.restore_discoverable
    where id = new.user_id;
  end if;

  return new;
end;
$$;

revoke all on function private.apply_account_deletion_visibility() from public, anon, authenticated;

drop trigger if exists apply_account_deletion_visibility on public.social_account_deletion_requests;
create trigger apply_account_deletion_visibility
after insert or update of status on public.social_account_deletion_requests
for each row
execute function private.apply_account_deletion_visibility();
