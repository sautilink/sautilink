-- Phase 16: live Text Sauti contract.
-- Narrow the wider Phase 11 foundation to the first public text-posting slice.

begin;

alter table public.social_posts
  drop constraint if exists social_posts_body_length;

alter table public.social_posts
  add constraint social_posts_body_length check (
    char_length(btrim(body)) between 1 and 500
  );

drop policy if exists social_posts_select_visible on public.social_posts;
drop policy if exists social_posts_insert_own on public.social_posts;
drop policy if exists social_posts_update_own on public.social_posts;
drop policy if exists social_posts_delete_own on public.social_posts;
drop policy if exists social_posts_select_phase16_visible on public.social_posts;
drop policy if exists social_posts_select_phase16_anon on public.social_posts;
drop policy if exists social_posts_select_phase16_authenticated on public.social_posts;
drop policy if exists social_posts_insert_phase16_own on public.social_posts;
drop policy if exists social_posts_delete_phase16_own on public.social_posts;

revoke update on table public.social_posts from anon, authenticated;
revoke update (
  body,
  circle_id,
  reply_to_post_id,
  visibility,
  deleted_at
) on table public.social_posts from authenticated;

revoke all on table public.social_posts from anon, authenticated;
grant select on table public.social_posts to anon;
grant select, insert, delete on table public.social_posts to authenticated;

create policy social_posts_select_phase16_anon
  on public.social_posts
  for select
  to anon
  using (
    post_status = 'published'
    and visibility = 'public'
    and circle_id is null
    and reply_to_post_id is null
    and exists (
      select 1
      from public.social_profiles profile
      where profile.id = social_posts.author_id
        and profile.is_discoverable = true
    )
  );

create policy social_posts_select_phase16_authenticated
  on public.social_posts
  for select
  to authenticated
  using (
    post_status = 'published'
    and visibility = 'public'
    and circle_id is null
    and reply_to_post_id is null
    and (
      (select auth.uid()) = author_id
      or exists (
        select 1
        from public.social_profiles profile
        where profile.id = social_posts.author_id
          and profile.is_discoverable = true
      )
    )
    and not exists (
      select 1
      from public.social_blocks block
      where (block.blocker_id = (select auth.uid()) and block.blocked_id = author_id)
         or (block.blocker_id = author_id and block.blocked_id = (select auth.uid()))
    )
  );

create policy social_posts_insert_phase16_own
  on public.social_posts
  for insert
  to authenticated
  with check (
    (select auth.uid()) = author_id
    and visibility = 'public'
    and post_status = 'published'
    and circle_id is null
    and reply_to_post_id is null
    and deleted_at is null
  );

create policy social_posts_delete_phase16_own
  on public.social_posts
  for delete
  to authenticated
  using ((select auth.uid()) = author_id);

comment on table public.social_posts is
  'Canonical Sauti records. Phase 16 live contract exposes public top-level text Sauti up to 500 characters; wider foundation fields remain reserved for later slices.';

commit;
