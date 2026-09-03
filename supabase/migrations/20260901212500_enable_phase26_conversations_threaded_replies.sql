alter table public.social_posts
  add column if not exists parent_post_id uuid,
  add column if not exists root_post_id uuid,
  add column if not exists thread_depth smallint,
  add column if not exists audience_owner_id uuid,
  add column if not exists client_request_id uuid;

update public.social_posts
set thread_depth = 0
where thread_depth is null;

update public.social_posts
set audience_owner_id = author_id
where audience_owner_id is null;

alter table public.social_posts
  alter column thread_depth set default 0,
  alter column thread_depth set not null,
  alter column audience_owner_id set not null;

alter table public.social_posts
  drop constraint if exists social_posts_parent_post_id_fkey,
  drop constraint if exists social_posts_root_post_id_fkey,
  drop constraint if exists social_posts_audience_owner_id_fkey,
  drop constraint if exists social_posts_thread_shape,
  drop constraint if exists social_posts_parent_not_self,
  drop constraint if exists social_posts_root_not_self;

alter table public.social_posts
  add constraint social_posts_parent_post_id_fkey
    foreign key (parent_post_id) references public.social_posts(id) on delete cascade,
  add constraint social_posts_root_post_id_fkey
    foreign key (root_post_id) references public.social_posts(id) on delete cascade,
  add constraint social_posts_audience_owner_id_fkey
    foreign key (audience_owner_id) references public.social_profiles(id) on delete cascade,
  add constraint social_posts_thread_shape
    check (
      (
        parent_post_id is null
        and root_post_id is null
        and thread_depth = 0
        and reply_to_post_id is null
      )
      or
      (
        parent_post_id is not null
        and root_post_id is not null
        and thread_depth between 1 and 32
        and reply_to_post_id = parent_post_id
      )
    ),
  add constraint social_posts_parent_not_self
    check (parent_post_id is null or parent_post_id <> id),
  add constraint social_posts_root_not_self
    check (root_post_id is null or root_post_id <> id);

create index if not exists social_posts_parent_created_idx
  on public.social_posts (parent_post_id, created_at, id)
  where parent_post_id is not null;

create index if not exists social_posts_root_created_idx
  on public.social_posts (root_post_id, created_at, id)
  where root_post_id is not null;

create index if not exists social_posts_root_depth_created_idx
  on public.social_posts (root_post_id, thread_depth, created_at, id)
  where root_post_id is not null;

create index if not exists social_posts_audience_owner_visibility_idx
  on public.social_posts (audience_owner_id, visibility, created_at desc);

create unique index if not exists social_posts_author_client_request_uidx
  on public.social_posts (author_id, client_request_id)
  where client_request_id is not null;

insert into public.social_posts (
  id,
  author_id,
  circle_id,
  reply_to_post_id,
  parent_post_id,
  root_post_id,
  thread_depth,
  audience_owner_id,
  body,
  visibility,
  post_status,
  created_at,
  updated_at,
  reply_access
)
select
  comment.id,
  comment.author_id,
  parent.circle_id,
  comment.post_id,
  comment.post_id,
  comment.post_id,
  1,
  parent.audience_owner_id,
  comment.body,
  parent.visibility,
  'published',
  comment.created_at,
  comment.created_at,
  'everyone'
from public.social_post_comments comment
join public.social_posts parent on parent.id = comment.post_id
where not exists (
  select 1 from public.social_posts existing where existing.id = comment.id
);

revoke insert on table public.social_post_comments from authenticated;
drop policy if exists social_post_comments_insert_phase25_own on public.social_post_comments;
drop trigger if exists sync_social_post_comment_counts on public.social_post_comments;
drop trigger if exists phase19_comment_notification on public.social_post_comments;

create or replace function private.enforce_phase26_post_insert()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $phase26_insert$
declare
  parent_row public.social_posts%rowtype;
  target_row public.social_posts%rowtype;
  caller_username text;
  allowed_reply boolean := false;
begin
  if new.parent_post_id is null then
    new.root_post_id := null;
    new.thread_depth := 0;
    new.reply_to_post_id := null;
    new.audience_owner_id := new.author_id;
  else
    select *
    into parent_row
    from public.social_posts
    where id = new.parent_post_id;

    if not found
       or parent_row.post_status <> 'published'
       or parent_row.deleted_at is not null then
      raise exception 'PHASE26_PARENT_UNAVAILABLE'
        using errcode = 'P0001';
    end if;

    if parent_row.thread_depth >= 32 then
      raise exception 'PHASE26_THREAD_DEPTH_LIMIT'
        using errcode = 'P0001';
    end if;

    if (select auth.uid()) = parent_row.author_id
       or parent_row.reply_access = 'everyone' then
      allowed_reply := true;
    elsif parent_row.reply_access = 'following' then
      allowed_reply := exists (
        select 1
        from public.social_follows follow
        where follow.follower_id = parent_row.author_id
          and follow.followed_id = (select auth.uid())
      );
    elsif parent_row.reply_access = 'mentioned' then
      select username
      into caller_username
      from public.social_profiles
      where id = (select auth.uid());

      allowed_reply := caller_username is not null
        and parent_row.body ~* (
          '(^|[^a-z0-9._])@'
          || replace(caller_username, '.', E'\\.')
          || '($|[^a-z0-9._])'
        );
    end if;

    if not allowed_reply then
      raise exception 'PHASE26_REPLIES_RESTRICTED'
        using errcode = '42501';
    end if;

    new.root_post_id := coalesce(parent_row.root_post_id, parent_row.id);
    new.thread_depth := parent_row.thread_depth + 1;
    new.reply_to_post_id := parent_row.id;
    new.audience_owner_id := parent_row.audience_owner_id;
    new.visibility := parent_row.visibility;
    new.circle_id := parent_row.circle_id;
  end if;

  if new.quote_post_id is not null then
    select *
    into target_row
    from public.social_posts
    where id = new.quote_post_id;

    if not found
       or target_row.visibility <> 'public'
       or target_row.circle_id is not null
       or target_row.post_status <> 'published'
       or target_row.deleted_at is not null then
      raise exception 'PHASE25_QUOTE_TARGET_UNAVAILABLE'
        using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$phase26_insert$;

revoke all on function private.enforce_phase26_post_insert() from public, anon, authenticated;

drop trigger if exists enforce_phase25_post_insert on public.social_posts;
drop trigger if exists enforce_phase26_post_insert on public.social_posts;
create trigger enforce_phase26_post_insert
before insert on public.social_posts
for each row execute function private.enforce_phase26_post_insert();

drop policy if exists social_posts_select_phase16_anon on public.social_posts;
drop policy if exists social_posts_select_phase25_authenticated on public.social_posts;
drop policy if exists social_posts_insert_phase25_own on public.social_posts;
drop policy if exists social_posts_select_phase26_anon on public.social_posts;
drop policy if exists social_posts_select_phase26_authenticated on public.social_posts;
drop policy if exists social_posts_insert_phase26_own on public.social_posts;

create policy social_posts_select_phase26_anon
  on public.social_posts
  for select
  to anon
  using (
    post_status = 'published'
    and deleted_at is null
    and visibility = 'public'
    and circle_id is null
    and exists (
      select 1 from public.social_profiles root_owner
      where root_owner.id = audience_owner_id
        and root_owner.is_discoverable = true
    )
    and exists (
      select 1 from public.social_profiles author_profile
      where author_profile.id = author_id
        and author_profile.is_discoverable = true
    )
  );

create policy social_posts_select_phase26_authenticated
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
            select 1 from public.social_profiles root_owner
            where root_owner.id = audience_owner_id
              and root_owner.is_discoverable = true
          )
        )
        and (
          (select auth.uid()) = author_id
          or exists (
            select 1 from public.social_profiles author_profile
            where author_profile.id = author_id
              and author_profile.is_discoverable = true
          )
        )
      )
      or
      (
        visibility = 'followers'
        and circle_id is null
        and (
          (select auth.uid()) = audience_owner_id
          or exists (
            select 1
            from public.social_follows follow
            where follow.follower_id = (select auth.uid())
              and follow.followed_id = audience_owner_id
          )
        )
        and (
          (select auth.uid()) = author_id
          or exists (
            select 1 from public.social_profiles author_profile
            where author_profile.id = author_id
              and author_profile.is_discoverable = true
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
      where
        (block.blocker_id = (select auth.uid()) and block.blocked_id in (author_id, audience_owner_id))
        or
        (block.blocked_id = (select auth.uid()) and block.blocker_id in (author_id, audience_owner_id))
    )
  );

create policy social_posts_insert_phase26_own
  on public.social_posts
  for insert
  to authenticated
  with check (
    (select auth.uid()) = author_id
    and post_status = 'published'
    and deleted_at is null
    and (
      (
        parent_post_id is null
        and root_post_id is null
        and thread_depth = 0
        and reply_to_post_id is null
        and audience_owner_id = author_id
        and (
          (
            visibility in ('public', 'followers')
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
      )
      or
      (
        parent_post_id is not null
        and root_post_id is not null
        and reply_to_post_id = parent_post_id
        and thread_depth between 1 and 32
        and audience_owner_id is not null
      )
    )
  );

revoke insert on table public.social_posts from authenticated;
grant insert (
  author_id,
  body,
  circle_id,
  visibility,
  post_status,
  reply_access,
  quote_post_id,
  parent_post_id,
  client_request_id
) on table public.social_posts to authenticated;

create or replace function private.sync_phase26_reply_counts()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $phase26_counts$
declare
  target_parent uuid;
  delta integer;
begin
  if tg_op = 'INSERT' then
    if new.parent_post_id is null then return new; end if;
    target_parent := new.parent_post_id;
    delta := 1;
  elsif tg_op = 'DELETE' then
    if old.parent_post_id is null then return old; end if;
    target_parent := old.parent_post_id;
    delta := -1;
  else
    return null;
  end if;

  update public.social_posts
  set comment_count = greatest(comment_count + delta, 0)
  where id = target_parent;

  return case when tg_op = 'DELETE' then old else new end;
end;
$phase26_counts$;

revoke all on function private.sync_phase26_reply_counts() from public, anon, authenticated;

drop trigger if exists sync_phase26_reply_counts on public.social_posts;
create trigger sync_phase26_reply_counts
after insert or delete on public.social_posts
for each row execute function private.sync_phase26_reply_counts();

update public.social_posts parent
set comment_count = (
  select count(*)::integer
  from public.social_posts child
  where child.parent_post_id = parent.id
    and child.deleted_at is null
);

create or replace function private.sync_phase19_notification()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $phase26_notify$
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
    from public.social_posts where id = target_post;
    target_type := 'like';
  elsif tg_table_name = 'social_posts' then
    if tg_op = 'DELETE' then
      if old.parent_post_id is null then return old; end if;
      delete from public.social_notifications
      where notification_type = 'reply'
        and post_id = old.id;
      return old;
    end if;

    if new.parent_post_id is null then return new; end if;
    target_actor := new.author_id;
    target_post := new.id;
    target_circle := new.circle_id;
    select author_id into target_recipient
    from public.social_posts
    where id = new.parent_post_id;
    target_type := 'reply';
  elsif tg_table_name = 'social_reposts' then
    target_actor := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
    target_post := case when tg_op = 'DELETE' then old.post_id else new.post_id end;
    select author_id, circle_id into target_recipient, target_circle
    from public.social_posts where id = target_post;
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
$phase26_notify$;

revoke all on function private.sync_phase19_notification() from public, anon, authenticated;

drop trigger if exists phase26_reply_notification on public.social_posts;
create trigger phase26_reply_notification
after insert or delete on public.social_posts
for each row execute function private.sync_phase19_notification();

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
where post.parent_post_id is null
  and post.circle_id is null
  and post.visibility in ('public', 'followers')
union all
select
  'repost'::text as event_type,
  repost.post_id,
  repost.user_id as actor_id,
  repost.created_at as event_at,
  repost.post_id::text || ':' || repost.user_id::text as event_key
from public.social_reposts repost
join public.social_posts post on post.id = repost.post_id
where post.parent_post_id is null
  and post.circle_id is null
  and post.visibility in ('public', 'followers');

revoke all on table public.social_stream_events from public, anon, authenticated;
grant select on table public.social_stream_events to anon, authenticated;

comment on column public.social_posts.parent_post_id is
  'Phase 26 immediate parent Sauti for threaded replies.';
comment on column public.social_posts.root_post_id is
  'Phase 26 root Sauti for bounded conversation retrieval.';
comment on column public.social_posts.thread_depth is
  'Phase 26 canonical reply depth. Top-level Sauti use 0; replies use 1..32.';
comment on column public.social_posts.audience_owner_id is
  'Phase 26 root audience owner. Replies inherit the root Sauti author for follower/block visibility.';
comment on column public.social_posts.client_request_id is
  'Phase 26 optional per-author idempotency key for safe reply retries.';
