-- Phase 25: Advanced Sauti Composer.
-- Adds follower audiences, reply permissions, public Quote Sauti and keeps the
-- Home Stream security-invoker/RLS based.

alter table public.social_posts
  add column if not exists reply_access text not null default 'everyone',
  add column if not exists quote_post_id uuid;

alter table public.social_posts
  drop constraint if exists social_posts_reply_access_allowed,
  drop constraint if exists social_posts_quote_post_id_fkey,
  drop constraint if exists social_posts_quote_not_self,
  drop constraint if exists social_posts_body_length;

alter table public.social_posts
  add constraint social_posts_reply_access_allowed
    check (reply_access = any (array['everyone'::text, 'following'::text, 'mentioned'::text])),
  add constraint social_posts_quote_post_id_fkey
    foreign key (quote_post_id) references public.social_posts(id) on delete set null,
  add constraint social_posts_quote_not_self
    check (quote_post_id is null or quote_post_id <> id),
  add constraint social_posts_body_length
    check (
      (
        quote_post_id is null
        and char_length(btrim(body)) between 1 and 500
      )
      or
      (
        quote_post_id is not null
        and char_length(btrim(body)) between 0 and 500
      )
    );

create index if not exists social_posts_quote_post_id_idx
  on public.social_posts (quote_post_id)
  where quote_post_id is not null;

create or replace function private.enforce_phase25_post_insert()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $phase25_post$
declare
  target_visibility text;
  target_circle uuid;
  target_status text;
  target_deleted_at timestamptz;
begin
  if new.quote_post_id is null then
    return new;
  end if;

  select
    target.visibility,
    target.circle_id,
    target.post_status,
    target.deleted_at
  into
    target_visibility,
    target_circle,
    target_status,
    target_deleted_at
  from public.social_posts target
  where target.id = new.quote_post_id;

  if not found
     or target_visibility <> 'public'
     or target_circle is not null
     or target_status <> 'published'
     or target_deleted_at is not null then
    raise exception 'PHASE25_QUOTE_TARGET_UNAVAILABLE'
      using errcode = 'P0001';
  end if;

  return new;
end;
$phase25_post$;

revoke all on function private.enforce_phase25_post_insert() from public, anon, authenticated;

drop trigger if exists enforce_phase25_post_insert on public.social_posts;
create trigger enforce_phase25_post_insert
before insert on public.social_posts
for each row execute function private.enforce_phase25_post_insert();

drop policy if exists social_posts_select_phase21_authenticated on public.social_posts;
drop policy if exists social_posts_select_phase25_authenticated on public.social_posts;
drop policy if exists social_posts_insert_phase21_own on public.social_posts;
drop policy if exists social_posts_insert_phase25_own on public.social_posts;

create policy social_posts_select_phase25_authenticated
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
        visibility = 'followers'
        and circle_id is null
        and (
          (select auth.uid()) = author_id
          or exists (
            select 1
            from public.social_follows follow
            where follow.follower_id = (select auth.uid())
              and follow.followed_id = social_posts.author_id
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

create policy social_posts_insert_phase25_own
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
  );

drop policy if exists social_post_comments_insert_own on public.social_post_comments;
drop policy if exists social_post_comments_insert_phase25_own on public.social_post_comments;

create policy social_post_comments_insert_phase25_own
  on public.social_post_comments
  for insert
  to authenticated
  with check (
    (select auth.uid()) = author_id
    and exists (
      select 1
      from public.social_posts post
      where post.id = post_id
        and (
          (select auth.uid()) = post.author_id
          or post.reply_access = 'everyone'
          or (
            post.reply_access = 'following'
            and exists (
              select 1
              from public.social_follows follow
              where follow.follower_id = post.author_id
                and follow.followed_id = (select auth.uid())
            )
          )
          or (
            post.reply_access = 'mentioned'
            and exists (
              select 1
              from public.social_profiles me
              where me.id = (select auth.uid())
                and post.body ~* (
                  '(^|[^a-z0-9._])@'
                  || replace(me.username, '.', E'\\.')
                  || '($|[^a-z0-9._])'
                )
            )
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
where post.circle_id is null
  and post.visibility in ('public', 'followers');

revoke all on table public.social_stream_events from public, anon, authenticated;
grant select on table public.social_stream_events to anon, authenticated;

comment on column public.social_posts.reply_access is
  'Phase 25 reply permission: everyone, people the author follows, or people explicitly mentioned in the Sauti body.';
comment on column public.social_posts.quote_post_id is
  'Phase 25 optional quoted public Sauti. Private/follower/Circle targets are rejected by the insert trigger.';
comment on function private.enforce_phase25_post_insert() is
  'Invoker-rights Phase 25 trigger that rejects inaccessible or non-public quote targets before Sauti insertion.';
comment on view public.social_stream_events is
  'Security-invoker chronological Home Stream containing public and follower-audience Sauti permitted by underlying RLS.';
