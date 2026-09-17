-- Comments UI foundation: comment dislikes, atomic reactions, and canonical comment moderation.

begin;

alter table public.social_posts
  add column if not exists dislike_count integer not null default 0;

alter table public.social_posts
  drop constraint if exists social_posts_dislike_count_nonnegative,
  add constraint social_posts_dislike_count_nonnegative check (dislike_count >= 0);

grant select (dislike_count) on public.social_posts to anon, authenticated;

alter table public.social_post_reactions
  drop constraint if exists social_post_reactions_type_phase17,
  add constraint social_post_reactions_type_phase17
    check (reaction_type = any (array['like'::text, 'dislike'::text]));

drop policy if exists social_post_reactions_insert_own on public.social_post_reactions;
drop policy if exists social_post_reactions_insert_phase18 on public.social_post_reactions;
create policy social_post_reactions_insert_phase18
on public.social_post_reactions
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and (
    reaction_type = 'like'
    or (
      reaction_type = 'dislike'
      and exists (
        select 1
        from public.social_posts comment
        where comment.id = social_post_reactions.post_id
          and comment.parent_post_id is not null
      )
    )
  )
  and exists (
    select 1
    from public.social_posts post
    where post.id = social_post_reactions.post_id
      and post.deleted_at is null
      and post.moderation_state = 'visible'
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

create or replace function private.sync_social_post_interaction_counts()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_post_id uuid;
  delta integer;
begin
  if tg_table_name = 'social_post_reactions' then
    if tg_op = 'INSERT' then
      if new.reaction_type = 'like' then
        update public.social_posts set like_count = greatest(like_count + 1, 0) where id = new.post_id;
      elsif new.reaction_type = 'dislike' then
        update public.social_posts set dislike_count = greatest(dislike_count + 1, 0) where id = new.post_id;
      end if;
      return new;
    elsif tg_op = 'DELETE' then
      if old.reaction_type = 'like' then
        update public.social_posts set like_count = greatest(like_count - 1, 0) where id = old.post_id;
      elsif old.reaction_type = 'dislike' then
        update public.social_posts set dislike_count = greatest(dislike_count - 1, 0) where id = old.post_id;
      end if;
      return old;
    end if;
    return null;
  end if;

  if tg_op = 'INSERT' then
    target_post_id := new.post_id;
    delta := 1;
  elsif tg_op = 'DELETE' then
    target_post_id := old.post_id;
    delta := -1;
  else
    return null;
  end if;

  if tg_table_name = 'social_post_comments' then
    update public.social_posts
    set comment_count = greatest(comment_count + delta, 0)
    where id = target_post_id;
  elsif tg_table_name = 'social_reposts' then
    update public.social_posts
    set repost_count = greatest(repost_count + delta, 0)
    where id = target_post_id;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function private.sync_social_post_interaction_counts() from public, anon, authenticated;

update public.social_posts post
set like_count = counts.like_count,
    dislike_count = counts.dislike_count
from (
  select target.id,
         count(reaction.post_id) filter (where reaction.reaction_type = 'like')::integer as like_count,
         count(reaction.post_id) filter (where reaction.reaction_type = 'dislike')::integer as dislike_count
  from public.social_posts target
  left join public.social_post_reactions reaction on reaction.post_id = target.id
  group by target.id
) counts
where post.id = counts.id;

drop trigger if exists phase19_like_notification on public.social_post_reactions;
drop trigger if exists phase19_like_notification_insert on public.social_post_reactions;
drop trigger if exists phase19_like_notification_delete on public.social_post_reactions;
create trigger phase19_like_notification_insert
after insert on public.social_post_reactions
for each row
when (new.reaction_type = 'like')
execute function private.sync_phase19_notification();
create trigger phase19_like_notification_delete
after delete on public.social_post_reactions
for each row
when (old.reaction_type = 'like')
execute function private.sync_phase19_notification();

create or replace function public.set_comment_reaction(
  p_comment_id uuid,
  p_reaction_type text default null
)
returns table (
  comment_id uuid,
  reaction_type text,
  like_count integer,
  dislike_count integer
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_uid uuid := auth.uid();
begin
  if current_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  if p_reaction_type is not null and p_reaction_type not in ('like', 'dislike') then
    raise exception 'INVALID_COMMENT_REACTION' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.social_posts comment
    where comment.id = p_comment_id
      and comment.parent_post_id is not null
      and comment.deleted_at is null
  ) then
    raise exception 'COMMENT_UNAVAILABLE' using errcode = 'P0002';
  end if;

  delete from public.social_post_reactions reaction
  where reaction.post_id = p_comment_id
    and reaction.user_id = current_uid;

  if p_reaction_type is not null then
    insert into public.social_post_reactions (post_id, user_id, reaction_type)
    values (p_comment_id, current_uid, p_reaction_type);
  end if;

  return query
  select comment.id,
         p_reaction_type,
         comment.like_count,
         comment.dislike_count
  from public.social_posts comment
  where comment.id = p_comment_id;
end;
$$;

revoke all on function public.set_comment_reaction(uuid, text) from public, anon;
grant execute on function public.set_comment_reaction(uuid, text) to authenticated;

drop policy if exists social_posts_moderation_update_phase29 on public.social_posts;
create policy social_posts_moderation_update_phase29
  on public.social_posts
  for update
  to authenticated
  using (
    ((select private.phase29_staff_role()) in ('reviewer', 'senior_reviewer'))
    and exists (
      select 1
      from public.social_reports report
      where report.target_id = social_posts.id::text
        and (
          report.target_type = 'post'
          or (report.target_type = 'comment' and social_posts.parent_post_id is not null)
        )
    )
  )
  with check (((select private.phase29_staff_role()) in ('reviewer', 'senior_reviewer')));

create or replace function private.validate_social_report_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_uid uuid := auth.uid();
  target_owner uuid;
  snapshot jsonb;
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
  new.assigned_to := null;
  new.target_owner_id := null;
  new.context_snapshot := null;
  new.policy_version := 'safety-v1';
  new.priority := case
    when new.reason in ('hate', 'privacy', 'impersonation') then 'high'
    when new.reason = 'spam' then 'medium'
    else 'medium'
  end;
  new.details := nullif(btrim(coalesce(new.details, '')), '');

  if new.target_type in ('profile', 'post', 'comment')
     and new.target_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'REPORT_TARGET_INVALID' using errcode = '22023';
  end if;

  if new.target_type = 'message' and new.target_id !~ '^[0-9]{1,19}$' then
    raise exception 'REPORT_TARGET_INVALID' using errcode = '22023';
  end if;

  case new.target_type
    when 'profile' then
      select profile.id,
             jsonb_build_object(
               'type', 'profile', 'username', profile.username,
               'display_name', profile.display_name, 'bio', left(profile.bio, 500),
               'is_discoverable', profile.is_discoverable
             )
        into target_owner, snapshot
      from public.social_profiles profile
      where profile.id = new.target_id::uuid;
    when 'post' then
      select post.author_id,
             jsonb_build_object(
               'type', 'post', 'author_id', post.author_id, 'body', left(post.body, 1000),
               'visibility', post.visibility, 'created_at', post.created_at, 'media_count', post.media_count
             )
        into target_owner, snapshot
      from public.social_posts post
      where post.id = new.target_id::uuid
        and post.parent_post_id is null;
    when 'comment' then
      select comment.author_id,
             jsonb_build_object(
               'type', 'comment', 'author_id', comment.author_id,
               'post_id', comment.root_post_id, 'parent_comment_id', comment.parent_post_id,
               'body', left(comment.body, 1000), 'created_at', comment.created_at
             )
        into target_owner, snapshot
      from public.social_posts comment
      where comment.id = new.target_id::uuid
        and comment.parent_post_id is not null;
    when 'message' then
      select message.sender_id,
             jsonb_build_object(
               'type', 'message', 'sender_id', message.sender_id,
               'conversation_id', message.conversation_id, 'body', left(message.body, 4000),
               'sent_at', message.sent_at
             )
        into target_owner, snapshot
      from public.dm_messages message
      join public.dm_conversations conversation on conversation.id = message.conversation_id
      where message.id = new.target_id::bigint
        and (conversation.member_one_id = current_uid or conversation.member_two_id = current_uid);
    else
      raise exception 'REPORT_TARGET_NOT_LIVE' using errcode = '0A000';
  end case;

  if not found then
    raise exception 'REPORT_TARGET_UNAVAILABLE' using errcode = 'P0002';
  end if;
  if target_owner = current_uid then
    raise exception 'SELF_REPORT_NOT_ALLOWED' using errcode = '22023';
  end if;

  new.target_owner_id := target_owner;
  new.context_snapshot := snapshot;
  return new;
end;
$$;

revoke all on function private.validate_social_report_insert() from public, anon, authenticated;

create or replace function private.apply_phase29_moderation_action()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.action_type = 'dismissed' then
    update public.social_reports
    set report_status = 'dismissed', moderation_note = new.reason, policy_version = new.policy_version,
        assigned_to = auth.uid(), reviewed_at = coalesce(reviewed_at, now()), resolved_at = now(), status_updated_at = now()
    where id = new.report_id;
  elsif new.action_type in ('visibility_limited', 'content_removed') then
    update public.social_posts
    set moderation_state = case when new.action_type = 'visibility_limited' then 'limited' else 'removed' end,
        moderated_at = now()
    where id = new.target_id::uuid
      and (
        (new.target_type = 'post' and parent_post_id is null)
        or (new.target_type = 'comment' and parent_post_id is not null)
      );

    update public.social_reports
    set report_status = 'resolved', moderation_note = new.reason, policy_version = new.policy_version,
        assigned_to = auth.uid(), reviewed_at = coalesce(reviewed_at, now()), resolved_at = now(), status_updated_at = now()
    where id = new.report_id;
  elsif new.action_type = 'escalated' then
    update public.social_reports
    set report_status = 'reviewing', moderation_note = new.reason, policy_version = new.policy_version,
        priority = case when priority = 'critical' then 'critical' else 'high' end,
        assigned_to = null, reviewed_at = coalesce(reviewed_at, now()), resolved_at = null, status_updated_at = now()
    where id = new.report_id;
  elsif new.action_type in ('appeal_upheld', 'appeal_reversed') then
    update public.social_moderation_appeals
    set appeal_status = case when new.action_type = 'appeal_upheld' then 'upheld' else 'reversed' end,
        assigned_to = auth.uid(), decision_reason = new.reason, updated_at = now(), decided_at = now()
    where id = new.appeal_id;

    if new.action_type = 'appeal_reversed' and new.target_type in ('post', 'comment') then
      update public.social_posts
      set moderation_state = 'visible', moderated_at = now()
      where id = new.target_id::uuid
        and (
          (new.target_type = 'post' and parent_post_id is null)
          or (new.target_type = 'comment' and parent_post_id is not null)
        );
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.apply_phase29_moderation_action() from public, anon, authenticated;

create or replace function private.notify_phase29_moderation_target()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  notification_post_id uuid;
begin
  if new.target_owner_id is null
     or new.action_type not in ('visibility_limited', 'content_removed', 'appeal_upheld', 'appeal_reversed') then
    return new;
  end if;

  if new.target_type = 'post' then
    notification_post_id := new.target_id::uuid;
  elsif new.target_type = 'comment' then
    select comment.id into notification_post_id
    from public.social_posts comment
    where comment.id = new.target_id::uuid
      and comment.parent_post_id is not null;
  end if;

  insert into public.social_notifications (recipient_id, actor_id, post_id, notification_type)
  values (new.target_owner_id, null, notification_post_id, 'safety');

  return new;
end;
$$;

revoke all on function private.notify_phase29_moderation_target() from public, anon, authenticated;

commit;
