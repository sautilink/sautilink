-- Phase 22 notification lifecycle: clear stale owner join-request notices
-- when a request reaches an owner decision.

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
    target_circle := new.circle_id;

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

      delete from public.social_notifications n
      where n.recipient_id = circle_owner
        and n.actor_id = new.requester_id
        and n.notification_type = 'circle'
        and n.circle_id = target_circle
        and n.circle_event = 'join_request';

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
