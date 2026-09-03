alter table public.social_posts
  add column if not exists media_count smallint not null default 0;

alter table public.social_posts
  drop constraint if exists social_posts_media_count_bounds,
  drop constraint if exists social_posts_body_length;

alter table public.social_posts
  add constraint social_posts_media_count_bounds
    check (media_count between 0 and 4),
  add constraint social_posts_body_length
    check (
      char_length(btrim(body)) <= 500
      and (
        char_length(btrim(body)) >= 1
        or quote_post_id is not null
        or media_count > 0
      )
    );

create table if not exists public.social_post_media (
  id uuid primary key,
  owner_id uuid not null references public.social_profiles(id) on delete cascade,
  post_id uuid references public.social_posts(id) on delete cascade,
  object_key text not null unique,
  media_kind text not null,
  content_type text not null,
  size_bytes bigint not null,
  width integer,
  height integer,
  duration_ms integer,
  alt_text text not null default '',
  position smallint,
  upload_status text not null default 'pending',
  expires_at timestamptz not null default (now() + interval '1 hour'),
  finalized_at timestamptz,
  attached_at timestamptz,
  created_at timestamptz not null default now(),
  constraint social_post_media_kind_allowed
    check (media_kind in ('image', 'video')),
  constraint social_post_media_content_type_allowed
    check (
      (media_kind = 'image' and content_type in ('image/jpeg', 'image/png', 'image/webp'))
      or
      (media_kind = 'video' and content_type = 'video/mp4')
    ),
  constraint social_post_media_size_bounds
    check (
      size_bytes between 1 and 26214400
      and (media_kind <> 'image' or size_bytes <= 8388608)
    ),
  constraint social_post_media_dimension_shape
    check (
      (width is null and height is null)
      or
      (
        width between 1 and 8192
        and height between 1 and 8192
      )
    ),
  constraint social_post_media_duration_shape
    check (
      (media_kind = 'image' and duration_ms is null)
      or
      (media_kind = 'video' and (duration_ms is null or duration_ms between 1 and 90000))
    ),
  constraint social_post_media_alt_text_length
    check (char_length(alt_text) <= 1000),
  constraint social_post_media_position_bounds
    check (position is null or position between 0 and 3),
  constraint social_post_media_status_allowed
    check (upload_status in ('pending', 'uploaded', 'ready', 'attached')),
  constraint social_post_media_attach_shape
    check (
      (
        upload_status in ('pending', 'uploaded', 'ready')
        and post_id is null
        and position is null
        and attached_at is null
      )
      or
      (
        upload_status = 'attached'
        and post_id is not null
        and position between 0 and 3
        and finalized_at is not null
        and attached_at is not null
      )
    ),
  constraint social_post_media_object_key_scope
    check (
      object_key = (
        'sauti/' || owner_id::text || '/' || id::text || '.' ||
        case content_type
          when 'image/jpeg' then 'jpg'
          when 'image/png' then 'png'
          when 'image/webp' then 'webp'
          when 'video/mp4' then 'mp4'
        end
      )
    )
);

create index if not exists social_post_media_owner_status_created_idx
  on public.social_post_media (owner_id, upload_status, created_at desc);

create index if not exists social_post_media_post_position_idx
  on public.social_post_media (post_id, position)
  where post_id is not null;

create unique index if not exists social_post_media_post_position_uidx
  on public.social_post_media (post_id, position)
  where post_id is not null;

alter table public.social_post_media enable row level security;

drop policy if exists social_post_media_select_phase27_anon on public.social_post_media;
drop policy if exists social_post_media_select_phase27_authenticated on public.social_post_media;
drop policy if exists social_post_media_insert_phase27_owner on public.social_post_media;
drop policy if exists social_post_media_update_phase27_owner on public.social_post_media;
drop policy if exists social_post_media_delete_phase27_owner_unattached on public.social_post_media;

create policy social_post_media_select_phase27_anon
  on public.social_post_media
  for select
  to anon
  using (
    upload_status = 'attached'
    and post_id is not null
    and exists (
      select 1
      from public.social_posts post
      where post.id = social_post_media.post_id
    )
  );

create policy social_post_media_select_phase27_authenticated
  on public.social_post_media
  for select
  to authenticated
  using (
    owner_id = (select auth.uid())
    or (
      upload_status = 'attached'
      and post_id is not null
      and exists (
        select 1
        from public.social_posts post
        where post.id = social_post_media.post_id
      )
    )
  );

create policy social_post_media_insert_phase27_owner
  on public.social_post_media
  for insert
  to authenticated
  with check (
    owner_id = (select auth.uid())
    and post_id is null
    and upload_status = 'pending'
    and width is null
    and height is null
    and duration_ms is null
    and position is null
    and finalized_at is null
    and attached_at is null
    and expires_at > now()
  );

create policy social_post_media_update_phase27_owner
  on public.social_post_media
  for update
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and (
      post_id is null
      or exists (
        select 1
        from public.social_posts post
        where post.id = social_post_media.post_id
          and post.author_id = (select auth.uid())
      )
    )
  );

create policy social_post_media_delete_phase27_owner_unattached
  on public.social_post_media
  for delete
  to authenticated
  using (
    owner_id = (select auth.uid())
    and post_id is null
  );

revoke all on table public.social_post_media from public, anon, authenticated;
grant select on table public.social_post_media to anon, authenticated;
grant insert (
  id,
  owner_id,
  object_key,
  media_kind,
  content_type,
  size_bytes,
  upload_status,
  expires_at
) on table public.social_post_media to authenticated;
grant update (
  width,
  height,
  duration_ms,
  alt_text,
  position,
  upload_status,
  finalized_at,
  post_id,
  attached_at,
  expires_at
) on table public.social_post_media to authenticated;
grant delete on table public.social_post_media to authenticated;

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
  client_request_id,
  media_count
) on table public.social_posts to authenticated;

comment on column public.social_posts.media_count is
  'Phase 27 declared count of validated Sauti media attachments. The Worker verifies each R2 object before attaching it.';

comment on table public.social_post_media is
  'Phase 27 Sauti media metadata. Binary bytes live in Cloudflare R2; rows remain owner-scoped until attached to a visible Sauti.';
