-- Phase 19: meaningful notifications for the live social loop.
-- Reuses public.social_notifications from the existing MVP foundation.

alter table public.social_notifications enable row level security;
alter table public.social_notifications force row level security;

revoke all on table public.social_notifications from public, anon, authenticated;
grant select on table public.social_notifications to authenticated;
grant update (read_at) on table public.social_notifications to authenticated;

drop policy if exists social_notifications_select_own on public.social_notifications;
drop policy if exists social_notifications_update_own on public.social_notifications;
drop policy if exists social_notifications_delete_own on public.social_notifications;

create policy social_notifications_select_own_phase19
  on public.social_notifications
  for select
  to authenticated
  using (
    (select auth.uid()) = recipient_id
    and (
      actor_id is null
      or not exists (
        select 1
        from public.social_blocks block
        where (block.blocker_id = recipient_id and block.blocked_id = actor_id)
           or (block.blocker_id = actor_id and block.blocked_id = recipient_id)
      )
    )
  );

create policy social_notifications_mark_read_own_phase19
  on public.social_notifications
  for update
  to authenticated
  using ((select auth.uid()) = recipient_id)
  with check (
    (select auth.uid()) = recipient_id
    and read_at is not null
  );

create index if not exists social_notifications_recipient_created_idx
  on public.social_notifications (recipient_id, created_at desc, id desc);

create or replace function private.sync_phase19_notification()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $phase19_notify$
declare
  target_recipient uuid;
  target_actor uuid;
  target_post uuid;
  target_type text;
begin
  if tg_table_name = 'social_follows' then
    target_recipient := case when tg_op = 'DELETE' then old.followed_id else new.followed_id end;
    target_actor := case when tg_op = 'DELETE' then old.follower_id else new.follower_id end;
    target_post := null;
    target_type := 'follow';
  elsif tg_table_name = 'social_post_reactions' then
    target_actor := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
    target_post := case when tg_op = 'DELETE' then old.post_id else new.post_id end;
    select author_id into target_recipient
    from public.social_posts
    where id = target_post;
    target_type := 'like';
  elsif tg_table_name = 'social_post_comments' then
    target_actor := case when tg_op = 'DELETE' then old.author_id else new.author_id end;
    target_post := case when tg_op = 'DELETE' then old.post_id else new.post_id end;
    select author_id into target_recipient
    from public.social_posts
    where id = target_post;
    target_type := 'reply';
  elsif tg_table_name = 'social_reposts' then
    target_actor := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
    target_post := case when tg_op = 'DELETE' then old.post_id else new.post_id end;
    select author_id into target_recipient
    from public.social_posts
    where id = target_post;
    target_type := 'reshare';
  else
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if target_recipient is null or target_actor is null or target_recipient = target_actor then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    delete from public.social_notifications n
    where n.recipient_id = target_recipient
      and n.actor_id = target_actor
      and n.notification_type = target_type
      and n.post_id is not distinct from target_post;
    return old;
  end if;

  delete from public.social_notifications n
  where n.recipient_id = target_recipient
    and n.actor_id = target_actor
    and n.notification_type = target_type
    and n.post_id is not distinct from target_post;

  insert into public.social_notifications (
    recipient_id,
    actor_id,
    post_id,
    notification_type,
    read_at
  ) values (
    target_recipient,
    target_actor,
    target_post,
    target_type,
    null
  );

  return new;
end;
$phase19_notify$;

revoke all on function private.sync_phase19_notification() from public, anon, authenticated;

create or replace function private.purge_phase19_block_notifications()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $phase19_block$
begin
  delete from public.social_notifications n
  where
    (n.recipient_id = new.blocker_id and n.actor_id = new.blocked_id)
    or
    (n.recipient_id = new.blocked_id and n.actor_id = new.blocker_id);

  return new;
end;
$phase19_block$;

revoke all on function private.purge_phase19_block_notifications() from public, anon, authenticated;

drop trigger if exists phase19_purge_block_notifications on public.social_blocks;
create trigger phase19_purge_block_notifications
after insert on public.social_blocks
for each row execute function private.purge_phase19_block_notifications();

drop trigger if exists phase19_follow_notification on public.social_follows;
create trigger phase19_follow_notification
after insert or delete on public.social_follows
for each row execute function private.sync_phase19_notification();

drop trigger if exists phase19_like_notification on public.social_post_reactions;
create trigger phase19_like_notification
after insert or delete on public.social_post_reactions
for each row execute function private.sync_phase19_notification();

drop trigger if exists phase19_comment_notification on public.social_post_comments;
create trigger phase19_comment_notification
after insert or delete on public.social_post_comments
for each row execute function private.sync_phase19_notification();

drop trigger if exists phase19_repost_notification on public.social_reposts;
create trigger phase19_repost_notification
after insert or delete on public.social_reposts
for each row execute function private.sync_phase19_notification();
