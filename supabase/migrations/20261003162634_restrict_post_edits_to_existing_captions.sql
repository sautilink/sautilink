-- Existing published captions only; the author and one-edit controls remain in force.
begin;

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

  if v_post.parent_post_id is not null then
    raise exception using message = 'POST_EDIT_UNAVAILABLE';
  end if;

  if btrim(coalesce(v_post.body, '')) = '' then
    raise exception using message = 'POST_EDIT_CAPTION_REQUIRED';
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

commit;
