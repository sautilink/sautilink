-- Post media only: no change to Story/DM policies, authorization or retention.
begin;
alter table public.social_posts
  drop constraint if exists social_posts_media_count_bounds,
  add constraint social_posts_media_count_bounds check (media_count between 0 and 10);
alter table public.social_post_media
  drop constraint if exists social_post_media_size_bounds,
  add constraint social_post_media_size_bounds check (
    size_bytes between 1 and 262144000 and (media_kind <> 'image' or size_bytes <= 8388608)
  ),
  drop constraint if exists social_post_media_duration_shape,
  add constraint social_post_media_duration_shape check (
    (media_kind = 'image' and duration_ms is null)
    or (media_kind = 'video' and (duration_ms is null or duration_ms between 1 and 180000))
  ),
  drop constraint if exists social_post_media_position_bounds,
  add constraint social_post_media_position_bounds check (position is null or position between 0 and 9),
  drop constraint if exists social_post_media_attach_shape,
  add constraint social_post_media_attach_shape check (
    (upload_status in ('pending','uploaded','ready') and post_id is null and position is null and attached_at is null)
    or (upload_status = 'attached' and post_id is not null and position between 0 and 9
      and finalized_at is not null and attached_at is not null)
  );
-- A CHECK is reapplied to every UPDATE, even when marked NOT VALID. Keep the
-- historical 8MiB storage bound so existing payloads can still be detached,
-- annotated and cleaned up; separately enforce 5MiB for every new payload.
comment on constraint social_post_media_size_bounds on public.social_post_media is
  'MP4 up to 250MiB; historical image storage bound 8MiB. Trigger enforces 5MiB on new image payloads.';

create or replace function private.enforce_post_image_upload_limit()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.media_kind <> 'image' or new.size_bytes <= 5242880 then return new; end if;
  if tg_op = 'UPDATE' then
    -- Grandfather only the identical existing payload, never a timestamp or
    -- client-selected flag. Changing its owner/key/type/size creates a payload
    -- subject to the current limit. Restoring a previously reduced size is also
    -- a change and cannot reuse this exception.
    if row(new.id,new.owner_id,new.object_key,new.media_kind,new.content_type,new.size_bytes)
       is not distinct from row(old.id,old.owner_id,old.object_key,old.media_kind,old.content_type,old.size_bytes) then
      return new;
    end if;
  end if;
  raise exception 'POST_IMAGE_SIZE_LIMIT' using errcode = '23514', constraint = 'social_post_media_image_upload_limit';
end $$;
revoke all on function private.enforce_post_image_upload_limit() from public, anon, authenticated;
create trigger social_post_media_image_upload_limit
before insert or update of id,owner_id,object_key,media_kind,content_type,size_bytes on public.social_post_media
for each row execute function private.enforce_post_image_upload_limit();

-- Enforce the count for direct Data API writes too. The invoker keeps the same
-- RLS visibility/ownership checks; one transaction lock serializes attachments.
create or replace function private.limit_post_media_attachments()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.post_id is null or new.upload_status <> 'attached' then return new; end if;
  if tg_op = 'UPDATE' and old.post_id is not distinct from new.post_id and old.upload_status = 'attached' then return new; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.post_id::text, 2730));
  if (select count(*) from public.social_post_media m where m.post_id = new.post_id and m.id <> new.id) >= 10 then
    raise exception 'POST_MEDIA_LIMIT' using errcode = '22023';
  end if;
  return new;
end $$;
revoke all on function private.limit_post_media_attachments() from public, anon, authenticated;
create trigger social_post_media_attachment_limit
before insert or update of post_id, upload_status on public.social_post_media
for each row execute function private.limit_post_media_attachments();
commit;
