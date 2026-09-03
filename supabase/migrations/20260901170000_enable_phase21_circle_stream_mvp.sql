-- Phase 21: Circle Stream MVP
--
-- Extends the canonical social_posts model so Circle members can publish and
-- interact inside a Circle without leaking Circle content into the Home Stream.
-- Circle notifications remain intentionally deferred.

begin;

drop policy if exists social_posts_select_phase16_authenticated on public.social_posts;
drop policy if exists social_posts_select_phase21_authenticated on public.social_posts;
drop policy if exists social_posts_insert_phase16_own on public.social_posts;
drop policy if exists social_posts_insert_phase21_own on public.social_posts;

create policy social_posts_select_phase21_authenticated
  on public.social_posts
  for select
  to authenticated
  using (
    post_status = 'published'
    and reply_to_post_id is null
    and deleted_at is null
    and (
      (
        visibility = 'public'
        and circle_id is null
        and (
          (select auth.uid()) = author_id
          or exists (
            select 1
            from public.social_profiles profile
            where profile.id = social_posts.author_id
              and profile.is_discoverable = true
          )
        )
      )
      or
      (
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
      where (block.blocker_id = (select auth.uid()) and block.blocked_id = author_id)
         or (block.blocker_id = author_id and block.blocked_id = (select auth.uid()))
    )
  );

create policy social_posts_insert_phase21_own
  on public.social_posts
  for insert
  to authenticated
  with check (
    (select auth.uid()) = author_id
    and post_status = 'published'
    and reply_to_post_id is null
    and deleted_at is null
    and (
      (
        visibility = 'public'
        and circle_id is null
      )
      or
      (
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
  );

drop view if exists public.social_stream_events;

create view public.social_stream_events
with (security_invoker = true)
as
select
  'post'::text as event_type,
  post.id as post_id,
  post.author_id as actor_id,
  post.created_at as event_at,
  post.id::text as event_key
from public.social_posts post
where post.circle_id is null
  and post.visibility = 'public'
union all
select
  'repost'::text as event_type,
  repost.post_id,
  repost.user_id as actor_id,
  repost.created_at as event_at,
  repost.post_id::text || ':' || repost.user_id::text as event_key
from public.social_reposts repost
join public.social_posts post on post.id = repost.post_id
where post.circle_id is null
  and post.visibility = 'public';

revoke all on table public.social_stream_events from public, anon, authenticated;
grant select on table public.social_stream_events to anon, authenticated;

create or replace function private.sync_phase19_notification()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $phase21_notify$
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

  if target_circle is not null then
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
$phase21_notify$;

revoke all on function private.sync_phase19_notification() from public, anon, authenticated;

delete from public.social_notifications notification
using public.social_posts post
where notification.post_id = post.id
  and post.circle_id is not null;

comment on table public.social_posts is
  'Canonical Sauti records. Phase 21 allows public Home Sauti and member-only Circle Sauti while keeping Circle content out of the Home Stream read model.';

commit;
