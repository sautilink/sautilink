-- Phase 28 — Mute + Safety Completion
-- Staging-first member mute semantics layered on the Phase 18 block/report foundation.

create table if not exists public.social_mutes (
  muter_id uuid not null references public.social_profiles(id) on delete cascade,
  muted_id uuid not null references public.social_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (muter_id, muted_id),
  constraint social_mutes_no_self check (muter_id <> muted_id)
);

comment on table public.social_mutes is
  'Phase 28 private member mute relationships. Mute suppresses content/notifications without breaking follows or DM delivery.';

create index if not exists social_mutes_muted_id_idx
  on public.social_mutes (muted_id);

alter table public.social_mutes enable row level security;
alter table public.social_mutes force row level security;

revoke all on table public.social_mutes from public, anon, authenticated;
grant select, insert, delete on table public.social_mutes to authenticated;

drop policy if exists social_mutes_select_own_phase28 on public.social_mutes;
create policy social_mutes_select_own_phase28
  on public.social_mutes
  for select
  to authenticated
  using ((select auth.uid()) = muter_id);

drop policy if exists social_mutes_insert_own_phase28 on public.social_mutes;
create policy social_mutes_insert_own_phase28
  on public.social_mutes
  for insert
  to authenticated
  with check (
    (select auth.uid()) = muter_id
    and muter_id <> muted_id
  );

drop policy if exists social_mutes_delete_own_phase28 on public.social_mutes;
create policy social_mutes_delete_own_phase28
  on public.social_mutes
  for delete
  to authenticated
  using ((select auth.uid()) = muter_id);

-- Muted authors/root owners disappear from the signed-in member's readable Sauti set.
drop policy if exists social_posts_select_phase26_authenticated on public.social_posts;
drop policy if exists social_posts_select_phase28_authenticated on public.social_posts;
create policy social_posts_select_phase28_authenticated
  on public.social_posts
  for select
  to authenticated
  using (
    post_status = 'published'
    and deleted_at is null
    and (
      (
        visibility = 'public'
        and circle_id is null
        and (
          (select auth.uid()) = audience_owner_id
          or exists (
            select 1
            from public.social_profiles root_owner
            where root_owner.id = social_posts.audience_owner_id
              and root_owner.is_discoverable = true
          )
        )
        and (
          (select auth.uid()) = author_id
          or exists (
            select 1
            from public.social_profiles author_profile
            where author_profile.id = social_posts.author_id
              and author_profile.is_discoverable = true
          )
        )
      )
      or (
        visibility = 'followers'
        and circle_id is null
        and (
          (select auth.uid()) = audience_owner_id
          or exists (
            select 1
            from public.social_follows follow
            where follow.follower_id = (select auth.uid())
              and follow.followed_id = social_posts.audience_owner_id
          )
        )
        and (
          (select auth.uid()) = author_id
          or exists (
            select 1
            from public.social_profiles author_profile
            where author_profile.id = social_posts.author_id
              and author_profile.is_discoverable = true
          )
        )
      )
      or (
        visibility = 'circle'
        and circle_id is not null
        and exists (
          select 1
          from public.social_circle_members membership
          where membership.circle_id = social_posts.circle_id
            and membership.member_id = (select auth.uid())
        )
      )
    )
    and not exists (
      select 1
      from public.social_blocks block
      where
        (
          block.blocker_id = (select auth.uid())
          and block.blocked_id = any (array[social_posts.author_id, social_posts.audience_owner_id])
        )
        or
        (
          block.blocked_id = (select auth.uid())
          and block.blocker_id = any (array[social_posts.author_id, social_posts.audience_owner_id])
        )
    )
    and not exists (
      select 1
      from public.social_mutes mute
      where mute.muter_id = (select auth.uid())
        and mute.muted_id = any (array[social_posts.author_id, social_posts.audience_owner_id])
    )
  );

-- Muted legacy comment authors are suppressed, while own comments remain readable.
drop policy if exists social_post_comments_select_authenticated on public.social_post_comments;
drop policy if exists social_post_comments_select_phase28_authenticated on public.social_post_comments;
create policy social_post_comments_select_phase28_authenticated
  on public.social_post_comments
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.social_posts post
      where post.id = social_post_comments.post_id
    )
    and (
      (select auth.uid()) = author_id
      or exists (
        select 1
        from public.social_profiles profile
        where profile.id = social_post_comments.author_id
          and profile.is_discoverable = true
      )
    )
    and not exists (
      select 1
      from public.social_blocks block
      where
        (block.blocker_id = (select auth.uid()) and block.blocked_id = social_post_comments.author_id)
        or
        (block.blocker_id = social_post_comments.author_id and block.blocked_id = (select auth.uid()))
    )
    and not exists (
      select 1
      from public.social_mutes mute
      where mute.muter_id = (select auth.uid())
        and mute.muted_id = social_post_comments.author_id
    )
  );

-- A repost by a muted account should not surface even when the underlying Sauti remains readable.
drop policy if exists social_reposts_select_authenticated on public.social_reposts;
drop policy if exists social_reposts_select_phase28_authenticated on public.social_reposts;
create policy social_reposts_select_phase28_authenticated
  on public.social_reposts
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.social_posts post
      where post.id = social_reposts.post_id
    )
    and (
      (select auth.uid()) = user_id
      or exists (
        select 1
        from public.social_profiles profile
        where profile.id = social_reposts.user_id
          and profile.is_discoverable = true
      )
    )
    and not exists (
      select 1
      from public.social_blocks block
      where
        (block.blocker_id = (select auth.uid()) and block.blocked_id = social_reposts.user_id)
        or
        (block.blocker_id = social_reposts.user_id and block.blocked_id = (select auth.uid()))
    )
    and not exists (
      select 1
      from public.social_mutes mute
      where mute.muter_id = (select auth.uid())
        and mute.muted_id = social_reposts.user_id
    )
  );

-- Existing notifications from muted actors stay private and hidden.
drop policy if exists social_notifications_select_own_phase19 on public.social_notifications;
drop policy if exists social_notifications_select_own_phase28 on public.social_notifications;
create policy social_notifications_select_own_phase28
  on public.social_notifications
  for select
  to authenticated
  using (
    (select auth.uid()) = recipient_id
    and (
      actor_id is null
      or (
        not exists (
          select 1
          from public.social_blocks block
          where
            (block.blocker_id = recipient_id and block.blocked_id = actor_id)
            or
            (block.blocker_id = actor_id and block.blocked_id = recipient_id)
        )
        and not exists (
          select 1
          from public.social_mutes mute
          where mute.muter_id = recipient_id
            and mute.muted_id = actor_id
        )
      )
    )
  );

-- Do not create a new social notification while its actor is muted by the recipient.
create or replace function private.suppress_phase28_muted_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.actor_id is not null
     and exists (
       select 1
       from public.social_mutes mute
       where mute.muter_id = new.recipient_id
         and mute.muted_id = new.actor_id
     ) then
    return null;
  end if;

  return new;
end;
$$;

revoke all on function private.suppress_phase28_muted_notification() from public, anon, authenticated;

drop trigger if exists phase28_suppress_muted_notification on public.social_notifications;
create trigger phase28_suppress_muted_notification
before insert on public.social_notifications
for each row execute function private.suppress_phase28_muted_notification();

-- Creating a mute clears old notifications from that actor so unmute does not reveal a backlog.
create or replace function private.purge_phase28_muted_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.social_notifications notification
  where notification.recipient_id = new.muter_id
    and notification.actor_id = new.muted_id;

  return new;
end;
$$;

revoke all on function private.purge_phase28_muted_notifications() from public, anon, authenticated;

drop trigger if exists phase28_purge_muted_notifications on public.social_mutes;
create trigger phase28_purge_muted_notifications
after insert on public.social_mutes
for each row execute function private.purge_phase28_muted_notifications();

-- Block supersedes mute. Unblocking does not silently recreate a previous mute.
create or replace function private.clear_phase28_mute_on_block()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.social_mutes mute
  where mute.muter_id = new.blocker_id
    and mute.muted_id = new.blocked_id;

  return new;
end;
$$;

revoke all on function private.clear_phase28_mute_on_block() from public, anon, authenticated;

drop trigger if exists phase28_clear_mute_on_block on public.social_blocks;
create trigger phase28_clear_mute_on_block
after insert on public.social_blocks
for each row execute function private.clear_phase28_mute_on_block();
