-- Phase 22: Circle notifications + basic owner member management.
--
-- Keeps moderator/invite systems deferred. Extends the existing notification
-- table and Circle membership RLS without exposing privileged browser writes.

begin;

alter table public.social_notifications
  add column if not exists circle_id uuid references public.social_circles(id) on delete cascade,
  add column if not exists circle_event text;

alter table public.social_notifications
  drop constraint if exists social_notifications_circle_event_allowed;

alter table public.social_notifications
  add constraint social_notifications_circle_event_allowed
  check (
    circle_event is null
    or circle_event = any (array[
      'join_request'::text,
      'request_approved'::text,
      'request_declined'::text,
      'member_removed'::text
    ])
  );

create index if not exists social_notifications_recipient_circle_created_idx
  on public.social_notifications (recipient_id, circle_id, created_at desc, id desc)
  where circle_id is not null;

create or replace function policy_private.is_phase22_circle_owner(p_circle_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $phase22_owner$
  select auth.uid() is not null
    and exists (
      select 1
      from public.social_circles circle
      where circle.id = p_circle_id
        and circle.owner_id = auth.uid()
    );
$phase22_owner$;

revoke all on function policy_private.is_phase22_circle_owner(uuid) from public, anon, authenticated;
grant execute on function policy_private.is_phase22_circle_owner(uuid) to authenticated;

drop policy if exists social_circle_members_select_self_phase20 on public.social_circle_members;
drop policy if exists social_circle_members_select_phase22 on public.social_circle_members;
create policy social_circle_members_select_phase22
  on public.social_circle_members
  for select
  to authenticated
  using (
    (select auth.uid()) = member_id
    or policy_private.is_phase22_circle_owner(circle_id)
  );

drop policy if exists social_circle_members_delete_self_phase20 on public.social_circle_members;
drop policy if exists social_circle_members_delete_phase22 on public.social_circle_members;
create policy social_circle_members_delete_phase22
  on public.social_circle_members
  for delete
  to authenticated
  using (
    member_role <> 'owner'
    and (
      (select auth.uid()) = member_id
      or policy_private.is_phase22_circle_owner(circle_id)
    )
  );

create or replace function private.sync_phase19_notification()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $phase22_interaction_notify$
declare
  target_recipient uuid;
  target_actor uuid;
  target_post uuid;
  target_circle uuid;
  target_type text;
begin
  if tg_table_name = 'social_follows' then
    target_recipient := case when tg_op = 'DELETE' then old.followed_id else new.followed_id end;
    target_actor := case when tg_op = 'DELETE' then old.follower_id else new.follower_id end;
    target_post := null;
    target_circle := null;
    target_type := 'follow';
  elsif tg_table_name = 'social_post_reactions' then
    target_actor := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
    target_post := case when tg_op = 'DELETE' then old.post_id else new.post_id end;
    select author_id, circle_id into target_recipient, target_circle
    from public.social_posts
    where id = target_post;
    target_type := 'like';
  elsif tg_table_name = 'social_post_comments' then
    target_actor := case when tg_op = 'DELETE' then old.author_id else new.author_id end;
    target_post := case when tg_op = 'DELETE' then old.post_id else new.post_id end;
    select author_id, circle_id into target_recipient, target_circle
    from public.social_posts
    where id = target_post;
    target_type := 'reply';
  elsif tg_table_name = 'social_reposts' then
    target_actor := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
    target_post := case when tg_op = 'DELETE' then old.post_id else new.post_id end;
    select author_id, circle_id into target_recipient, target_circle
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
      and n.post_id is not distinct from target_post
      and n.circle_id is not distinct from target_circle;
    return old;
  end if;

  delete from public.social_notifications n
  where n.recipient_id = target_recipient
    and n.actor_id = target_actor
    and n.notification_type = target_type
    and n.post_id is not distinct from target_post
    and n.circle_id is not distinct from target_circle;

  insert into public.social_notifications (
    recipient_id,
    actor_id,
    post_id,
    circle_id,
    circle_event,
    notification_type,
    read_at
  ) values (
    target_recipient,
    target_actor,
    target_post,
    target_circle,
    null,
    target_type,
    null
  );

  return new;
end;
$phase22_interaction_notify$;

revoke all on function private.sync_phase19_notification() from public, anon, authenticated;

create or replace function private.sync_phase22_circle_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $phase22_circle_notify$
declare
  target_circle uuid;
  target_recipient uuid;
  target_actor uuid;
  target_event text;
  circle_owner uuid;
begin
  if tg_table_name = 'social_circle_join_requests' then
    target_circle := case when tg_op = 'INSERT' then new.circle_id else new.circle_id end;

    select circle.owner_id
      into circle_owner
    from public.social_circles circle
    where circle.id = target_circle;

    if circle_owner is null then
      return new;
    end if;

    if tg_op = 'INSERT' then
      target_recipient := circle_owner;
      target_actor := new.requester_id;
      target_event := 'join_request';
    elsif tg_op = 'UPDATE'
      and old.status = 'pending'
      and new.status in ('approved', 'declined')
      and new.status is distinct from old.status then
      target_recipient := new.requester_id;
      target_actor := circle_owner;
      target_event := case when new.status = 'approved' then 'request_approved' else 'request_declined' end;
    else
      return new;
    end if;
  elsif tg_table_name = 'social_circle_members' and tg_op = 'DELETE' then
    if old.member_role = 'owner' or auth.uid() is null or auth.uid() = old.member_id then
      return old;
    end if;

    target_circle := old.circle_id;

    select circle.owner_id
      into circle_owner
    from public.social_circles circle
    where circle.id = target_circle;

    if circle_owner is null or auth.uid() <> circle_owner then
      return old;
    end if;

    if exists (
      select 1
      from public.social_blocks block
      where (block.blocker_id = circle_owner and block.blocked_id = old.member_id)
         or (block.blocker_id = old.member_id and block.blocked_id = circle_owner)
    ) then
      return old;
    end if;

    target_recipient := old.member_id;
    target_actor := circle_owner;
    target_event := 'member_removed';
  else
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if target_recipient is null or target_actor is null or target_recipient = target_actor then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  delete from public.social_notifications n
  where n.recipient_id = target_recipient
    and n.actor_id = target_actor
    and n.notification_type = 'circle'
    and n.circle_id = target_circle
    and n.circle_event = target_event;

  insert into public.social_notifications (
    recipient_id,
    actor_id,
    post_id,
    circle_id,
    circle_event,
    notification_type,
    read_at
  ) values (
    target_recipient,
    target_actor,
    null,
    target_circle,
    target_event,
    'circle',
    null
  );

  return case when tg_op = 'DELETE' then old else new end;
end;
$phase22_circle_notify$;

revoke all on function private.sync_phase22_circle_notification() from public, anon, authenticated;

drop trigger if exists phase22_circle_join_request_notification on public.social_circle_join_requests;
create trigger phase22_circle_join_request_notification
after insert or update on public.social_circle_join_requests
for each row execute function private.sync_phase22_circle_notification();

drop trigger if exists phase22_circle_member_removed_notification on public.social_circle_members;
create trigger phase22_circle_member_removed_notification
after delete on public.social_circle_members
for each row execute function private.sync_phase22_circle_notification();

comment on column public.social_notifications.circle_id is
  'Optional Circle context for Phase 22 Circle activity and Circle Sauti notifications.';

comment on column public.social_notifications.circle_event is
  'Optional Phase 22 membership event subtype for notification_type=circle.';

commit;
