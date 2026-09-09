-- One-time post caption edits.
-- Authors can change only the text body of their own published post once.
-- Media, audience, timestamps used for feed ordering, thread shape and all other
-- post fields remain immutable through this contract.

begin;

alter table public.social_posts
  add column if not exists edited_at timestamptz,
  add column if not exists edit_count smallint not null default 0;

alter table public.social_posts
  drop constraint if exists social_posts_edit_count_once;
alter table public.social_posts
  add constraint social_posts_edit_count_once
  check (edit_count between 0 and 1);

alter table public.social_posts
  drop constraint if exists social_posts_edit_state_consistent;
alter table public.social_posts
  add constraint social_posts_edit_state_consistent
  check (
    (edit_count = 0 and edited_at is null)
    or (edit_count = 1 and edited_at is not null)
  );

create or replace function public.edit_social_post_once(
  p_post_id uuid,
  p_body text
)
returns table (
  id uuid,
  body text,
  created_at timestamptz,
  updated_at timestamptz,
  edited_at timestamptz,
  edit_count smallint
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_post public.social_posts%rowtype;
begin
  if v_user_id is null then
    raise exception using message = 'POST_EDIT_AUTH_REQUIRED';
  end if;

  select *
  into v_post
  from public.social_posts
  where social_posts.id = p_post_id
  for update;

  if not found
     or v_post.author_id <> v_user_id
     or v_post.post_status <> 'published'
     or v_post.deleted_at is not null then
    raise exception using message = 'POST_EDIT_UNAVAILABLE';
  end if;

  if v_post.edit_count >= 1 then
    raise exception using message = 'POST_ALREADY_EDITED';
  end if;

  if char_length(v_body) > 500 then
    raise exception using message = 'POST_EDIT_BODY_TOO_LONG';
  end if;

  if v_body = '' and v_post.media_count = 0 and v_post.quote_post_id is null then
    raise exception using message = 'POST_EDIT_BODY_REQUIRED';
  end if;

  if v_post.reply_access = 'mentioned'
     and v_body !~* '(^|[^a-z0-9._])@[a-z0-9][a-z0-9._]{2,29}($|[^a-z0-9._])' then
    raise exception using message = 'POST_EDIT_MENTION_REQUIRED';
  end if;

  return query
  update public.social_posts as post
  set
    body = v_body,
    edited_at = clock_timestamp(),
    updated_at = clock_timestamp(),
    edit_count = 1
  where post.id = p_post_id
    and post.author_id = v_user_id
    and post.edit_count = 0
  returning post.id, post.body, post.created_at, post.updated_at, post.edited_at, post.edit_count;

  if not found then
    raise exception using message = 'POST_ALREADY_EDITED';
  end if;
end;
$$;

revoke all on function public.edit_social_post_once(uuid, text) from public, anon;
grant execute on function public.edit_social_post_once(uuid, text) to authenticated, service_role;

comment on column public.social_posts.edited_at is
  'Timestamp of the author\'s single permitted text edit. NULL until edited.';
comment on column public.social_posts.edit_count is
  'Author text-edit counter. Contract permits at most one edit per post.';
comment on function public.edit_social_post_once(uuid, text) is
  'Atomically edits only the post body once for its author. Media and created_at are never changed, so feed ordering is preserved.';

commit;
