-- Comments UI reactions and moderation compatibility.
-- Threaded comments remain stored as social_posts rows with parent_post_id set.

begin;

create table if not exists public.social_comment_dislikes (
  comment_id uuid not null references public.social_posts(id) on delete cascade,
  user_id uuid not null references public.social_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

create index if not exists social_comment_dislikes_user_created_idx
  on public.social_comment_dislikes (user_id, created_at desc);
create index if not exists social_comment_dislikes_comment_created_idx
  on public.social_comment_dislikes (comment_id, created_at desc);

alter table public.social_comment_dislikes enable row level security;
alter table public.social_comment_dislikes force row level security;

revoke all on table public.social_comment_dislikes from public, anon, authenticated;
grant select, insert, delete on table public.social_comment_dislikes to authenticated;
grant select, insert, update, delete on table public.social_comment_dislikes to service_role;

drop policy if exists social_comment_dislikes_select_visible on public.social_comment_dislikes;
create policy social_comment_dislikes_select_visible
  on public.social_comment_dislikes
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.social_posts comment
      where comment.id = social_comment_dislikes.comment_id
        and comment.parent_post_id is not null
        and comment.post_status = 'published'
        and comment.deleted_at is null
    )
  );

drop policy if exists social_comment_dislikes_insert_own on public.social_comment_dislikes;
create policy social_comment_dislikes_insert_own
  on public.social_comment_dislikes
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.social_posts comment
      where comment.id = social_comment_dislikes.comment_id
        and comment.parent_post_id is not null
        and comment.post_status = 'published'
        and comment.deleted_at is null
    )
  );

drop policy if exists social_comment_dislikes_delete_own on public.social_comment_dislikes;
create policy social_comment_dislikes_delete_own
  on public.social_comment_dislikes
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

create or replace function private.enforce_comment_dislike_exclusivity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if (select auth.uid()) is null or new.user_id <> (select auth.uid()) then
    raise exception 'COMMENT_REACTION_OWNER_REQUIRED' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.social_posts comment
    where comment.id = new.comment_id
      and comment.parent_post_id is not null
      and comment.post_status = 'published'
      and comment.deleted_at is null
  ) then
    raise exception 'COMMENT_UNAVAILABLE' using errcode = 'P0002';
  end if;

  delete from public.social_post_reactions reaction
  where reaction.post_id = new.comment_id
    and reaction.user_id = new.user_id
    and reaction.reaction_type = 'like';

  new.created_at := now();
  return new;
end;
$$;

revoke all on function private.enforce_comment_dislike_exclusivity() from public, anon, authenticated;

drop trigger if exists enforce_comment_dislike_exclusivity on public.social_comment_dislikes;
create trigger enforce_comment_dislike_exclusivity
before insert on public.social_comment_dislikes
for each row execute function private.enforce_comment_dislike_exclusivity();

create or replace function private.clear_comment_dislike_on_like()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.reaction_type = 'like'
     and exists (
       select 1
       from public.social_posts comment
       where comment.id = new.post_id
         and comment.parent_post_id is not null
     ) then
    delete from public.social_comment_dislikes dislike
    where dislike.comment_id = new.post_id
      and dislike.user_id = new.user_id;
  end if;
  return new;
end;
$$;

revoke all on function private.clear_comment_dislike_on_like() from public, anon, authenticated;

drop trigger if exists clear_comment_dislike_on_like on public.social_post_reactions;
create trigger clear_comment_dislike_on_like
after insert on public.social_post_reactions
for each row execute function private.clear_comment_dislike_on_like();

-- Staff must be able to read and moderate reported threaded comments.
drop policy if exists social_posts_select_reported_comments on public.social_posts;
create policy social_posts_select_reported_comments
  on public.social_posts
  for select
  to authenticated
  using (
    parent_post_id is not null
    and (select private.phase29_staff_role()) is not null
    and exists (
      select 1
      from public.social_reports report
      where report.target_type = 'comment'
        and report.target_id = social_posts.id::text
    )
  );

drop policy if exists social_posts_moderation_update_reported_comments on public.social_posts;
create policy social_posts_moderation_update_reported_comments
  on public.social_posts
  for update
  to authenticated
  using (
    parent_post_id is not null
    and (select private.phase29_staff_role()) in ('reviewer', 'senior_reviewer')
    and exists (
      select 1
      from public.social_reports report
      where report.target_type = 'comment'
        and report.target_id = social_posts.id::text
    )
  )
  with check (
    (select private.phase29_staff_role()) in ('reviewer', 'senior_reviewer')
  );

-- Rebuild report validation so target_type=comment supports the canonical threaded model,
-- while retaining legacy social_post_comments compatibility.
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

  if new.target_type = 'message'
     and new.target_id !~ '^[0-9]{1,19}$' then
    raise exception 'REPORT_TARGET_INVALID' using errcode = '22023';
  end if;

  case new.target_type
    when 'profile' then
      select profile.id,
             jsonb_build_object(
               'type', 'profile',
               'username', profile.username,
               'display_name', profile.display_name,
               'bio', left(profile.bio, 500),
               'is_discoverable', profile.is_discoverable
             )
        into target_owner, snapshot
      from public.social_profiles profile
      where profile.id = new.target_id::uuid;
    when 'post' then
      select post.author_id,
             jsonb_build_object(
               'type', 'post',
               'author_id', post.author_id,
               'body', left(post.body, 1000),
               'visibility', post.visibility,
               'created_at', post.created_at,
               'media_count', post.media_count
             )
        into target_owner, snapshot
      from public.social_posts post
      where post.id = new.target_id::uuid
        and post.parent_post_id is null;
    when 'comment' then
      select comment.author_id,
             jsonb_build_object(
               'type', 'comment',
               'author_id', comment.author_id,
               'post_id', coalesce(comment.root_post_id, comment.parent_post_id),
               'parent_comment_id', case
                 when comment.parent_post_id = coalesce(comment.root_post_id, comment.parent_post_id) then null
                 else comment.parent_post_id
               end,
               'body', left(comment.body, 1000),
               'created_at', comment.created_at
             )
        into target_owner, snapshot
      from public.social_posts comment
      where comment.id = new.target_id::uuid
        and comment.parent_post_id is not null;

      if not found then
        select legacy.author_id,
               jsonb_build_object(
                 'type', 'comment',
                 'author_id', legacy.author_id,
                 'post_id', legacy.post_id,
                 'body', left(legacy.body, 1000),
                 'created_at', legacy.created_at
               )
          into target_owner, snapshot
        from public.social_post_comments legacy
        where legacy.id = new.target_id::uuid;
      end if;
    when 'message' then
      select message.sender_id,
             jsonb_build_object(
               'type', 'message',
               'sender_id', message.sender_id,
               'conversation_id', message.conversation_id,
               'body', left(message.body, 4000),
               'sent_at', message.sent_at
             )
        into target_owner, snapshot
      from public.dm_messages message
      join public.dm_conversations conversation
        on conversation.id = message.conversation_id
      where message.id = new.target_id::bigint
        and (
          conversation.member_one_id = current_uid
          or conversation.member_two_id = current_uid
        );
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
    set report_status = 'dismissed',
        moderation_note = new.reason,
        policy_version = new.policy_version,
        assigned_to = auth.uid(),
        reviewed_at = coalesce(reviewed_at, now()),
        resolved_at = now(),
        status_updated_at = now()
    where id = new.report_id;
  elsif new.action_type = 'visibility_limited' then
    if new.target_type = 'post' then
      update public.social_posts
      set moderation_state = 'limited', moderated_at = now()
      where id = new.target_id::uuid
        and parent_post_id is null;
    elsif new.target_type = 'comment' then
      update public.social_posts
      set moderation_state = 'limited', moderated_at = now()
      where id = new.target_id::uuid
        and parent_post_id is not null;
      if not found then
        update public.social_post_comments
        set moderation_state = 'limited', moderated_at = now()
        where id = new.target_id::uuid;
      end if;
    end if;

    update public.social_reports
    set report_status = 'resolved', moderation_note = new.reason,
        policy_version = new.policy_version, assigned_to = auth.uid(),
        reviewed_at = coalesce(reviewed_at, now()), resolved_at = now(), status_updated_at = now()
    where id = new.report_id;
  elsif new.action_type = 'content_removed' then
    if new.target_type = 'post' then
      update public.social_posts
      set moderation_state = 'removed', moderated_at = now()
      where id = new.target_id::uuid
        and parent_post_id is null;
    elsif new.target_type = 'comment' then
      update public.social_posts
      set moderation_state = 'removed', moderated_at = now()
      where id = new.target_id::uuid
        and parent_post_id is not null;
      if not found then
        update public.social_post_comments
        set moderation_state = 'removed', moderated_at = now()
        where id = new.target_id::uuid;
      end if;
    end if;

    update public.social_reports
    set report_status = 'resolved', moderation_note = new.reason,
        policy_version = new.policy_version, assigned_to = auth.uid(),
        reviewed_at = coalesce(reviewed_at, now()), resolved_at = now(), status_updated_at = now()
    where id = new.report_id;
  elsif new.action_type = 'escalated' then
    update public.social_reports
    set report_status = 'reviewing', moderation_note = new.reason,
        policy_version = new.policy_version,
        priority = case when priority = 'critical' then 'critical' else 'high' end,
        assigned_to = null, reviewed_at = coalesce(reviewed_at, now()),
        resolved_at = null, status_updated_at = now()
    where id = new.report_id;
  elsif new.action_type in ('appeal_upheld', 'appeal_reversed') then
    update public.social_moderation_appeals
    set appeal_status = case when new.action_type = 'appeal_upheld' then 'upheld' else 'reversed' end,
        assigned_to = auth.uid(), decision_reason = new.reason,
        updated_at = now(), decided_at = now()
    where id = new.appeal_id;

    if new.action_type = 'appeal_reversed' and new.target_type in ('post', 'comment') then
      if new.target_type = 'post' then
        update public.social_posts
        set moderation_state = 'visible', moderated_at = now()
        where id = new.target_id::uuid
          and parent_post_id is null;
      else
        update public.social_posts
        set moderation_state = 'visible', moderated_at = now()
        where id = new.target_id::uuid
          and parent_post_id is not null;
        if not found then
          update public.social_post_comments
          set moderation_state = 'visible', moderated_at = now()
          where id = new.target_id::uuid;
        end if;
      end if;
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
    select coalesce(comment.root_post_id, comment.parent_post_id)
      into notification_post_id
    from public.social_posts comment
    where comment.id = new.target_id::uuid
      and comment.parent_post_id is not null;

    if not found then
      select legacy.post_id
        into notification_post_id
      from public.social_post_comments legacy
      where legacy.id = new.target_id::uuid;
    end if;
  end if;

  insert into public.social_notifications (
    recipient_id, actor_id, post_id, notification_type
  ) values (
    new.target_owner_id, null, notification_post_id, 'safety'
  );

  return new;
end;
$$;

revoke all on function private.notify_phase29_moderation_target() from public, anon, authenticated;

comment on table public.social_comment_dislikes is
  'Thumbs-down reactions for canonical threaded comments. Like remains canonical social_post_reactions on the same comment post.';

commit;
