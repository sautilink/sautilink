-- Server-owned @mention notifications for SautiLink posts, replies and profile bios.

create or replace function private.extract_social_mention_usernames(source_text text)
returns table(username text)
language sql
immutable
set search_path = pg_catalog
as $mention_extract$
  select distinct normalized_username as username
  from (
    select regexp_replace(lower(parts[2]), '\.+$', '') as normalized_username
    from regexp_matches(
      coalesce(source_text, ''),
      '(^|[^a-z0-9._@])@([a-z0-9][a-z0-9._]{2,29})',
      'gi'
    ) as extracted(parts)
  ) candidates
  where normalized_username ~ '^[a-z0-9][a-z0-9._]{2,29}$'
  order by normalized_username
  limit 20;
$mention_extract$;

revoke all on function private.extract_social_mention_usernames(text)
  from public, anon, authenticated;

create or replace function private.sync_social_mention_notifications()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $mention_sync$
declare
  source_actor uuid;
  source_post uuid;
  source_text text;
begin
  if tg_table_name = 'social_posts' then
    source_actor := case when tg_op = 'DELETE' then old.author_id else new.author_id end;
    source_post := case when tg_op = 'DELETE' then old.id else new.id end;

    delete from public.social_notifications n
    where n.notification_type = 'mention'
      and n.actor_id = source_actor
      and n.post_id = source_post;

    if tg_op = 'DELETE' then
      return old;
    end if;

    if new.post_status <> 'published' or new.deleted_at is not null then
      return new;
    end if;

    source_text := new.body;

    insert into public.social_notifications (
      recipient_id, actor_id, post_id, circle_id, circle_event, notification_type, read_at
    )
    select
      target.id, source_actor, source_post, new.circle_id, null, 'mention', null
    from private.extract_social_mention_usernames(source_text) mention
    join public.social_profiles target on target.username = mention.username
    where target.id <> source_actor
      and not exists (
        select 1 from public.social_blocks block
        where (block.blocker_id = target.id and block.blocked_id = source_actor)
           or (block.blocker_id = source_actor and block.blocked_id = target.id)
      )
      and (
        (
          new.visibility = 'public'
          and exists (
            select 1 from public.social_profiles source_profile
            where source_profile.id = source_actor and source_profile.is_discoverable = true
          )
          and (
            target.id = new.audience_owner_id
            or exists (
              select 1 from public.social_profiles audience_profile
              where audience_profile.id = new.audience_owner_id
                and audience_profile.is_discoverable = true
            )
          )
        )
        or
        (
          new.visibility = 'followers'
          and exists (
            select 1 from public.social_profiles source_profile
            where source_profile.id = source_actor and source_profile.is_discoverable = true
          )
          and (
            target.id = new.audience_owner_id
            or exists (
              select 1 from public.social_follows follow
              where follow.follower_id = target.id
                and follow.followed_id = new.audience_owner_id
            )
          )
        )
        or
        (
          new.visibility = 'circle'
          and new.circle_id is not null
          and exists (
            select 1 from public.social_circle_members membership
            where membership.circle_id = new.circle_id
              and membership.member_id = target.id
          )
        )
      );

    return new;
  end if;

  if tg_table_name = 'social_profiles' then
    source_actor := case when tg_op = 'DELETE' then old.id else new.id end;

    delete from public.social_notifications n
    where n.notification_type = 'mention'
      and n.actor_id = source_actor
      and n.post_id is null;

    if tg_op = 'DELETE' then
      return old;
    end if;

    if new.is_discoverable is not true then
      return new;
    end if;

    source_text := new.bio;

    insert into public.social_notifications (
      recipient_id, actor_id, post_id, circle_id, circle_event, notification_type, read_at
    )
    select
      target.id, source_actor, null, null, null, 'mention', null
    from private.extract_social_mention_usernames(source_text) mention
    join public.social_profiles target on target.username = mention.username
    where target.id <> source_actor
      and not exists (
        select 1 from public.social_blocks block
        where (block.blocker_id = target.id and block.blocked_id = source_actor)
           or (block.blocker_id = source_actor and block.blocked_id = target.id)
      );

    return new;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$mention_sync$;

revoke all on function private.sync_social_mention_notifications()
  from public, anon, authenticated;

drop trigger if exists sync_social_post_mentions_insert_delete on public.social_posts;
create trigger sync_social_post_mentions_insert_delete
after insert or delete on public.social_posts
for each row execute function private.sync_social_mention_notifications();

drop trigger if exists sync_social_post_mentions_update on public.social_posts;
create trigger sync_social_post_mentions_update
after update of body, deleted_at, post_status on public.social_posts
for each row execute function private.sync_social_mention_notifications();

drop trigger if exists sync_social_profile_bio_mentions on public.social_profiles;
create trigger sync_social_profile_bio_mentions
after insert or update of bio, is_discoverable on public.social_profiles
for each row execute function private.sync_social_mention_notifications();