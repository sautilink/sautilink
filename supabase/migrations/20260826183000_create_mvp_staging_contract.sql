-- Phase 12: isolated staging backend contract for the SautiLink web MVP.
--
-- Apply this migration to a non-production Supabase project first.
-- public.social_profiles already exists and remains the public profile table.
-- These ten tables bring the protected MVP contract to eleven public tables:
-- social_profiles plus the ten tables below.

create schema if not exists private;
revoke all on schema private from public;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.set_updated_at() from public, anon, authenticated;

create table public.account_settings (
  user_id uuid primary key references public.account_profiles(id) on delete cascade,
  profile_visibility text not null default 'public'
    check (profile_visibility in ('public', 'followers', 'private')),
  allow_mentions text not null default 'everyone'
    check (allow_mentions in ('everyone', 'following', 'none')),
  allow_messages text not null default 'following'
    check (allow_messages in ('everyone', 'following', 'none')),
  notify_follows boolean not null default true,
  notify_mentions boolean not null default true,
  notify_replies boolean not null default true,
  language_code text not null default 'en'
    check (language_code ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  reduce_motion boolean not null default false,
  high_contrast boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.account_settings is
  'Private member-owned social, notification, language and accessibility settings.';

create table public.circles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.social_profiles(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  description text not null default '' check (char_length(description) <= 500),
  join_policy text not null default 'approval'
    check (join_policy in ('open', 'approval', 'closed')),
  is_discoverable boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.circle_members (
  circle_id uuid not null references public.circles(id) on delete cascade,
  member_id uuid not null references public.social_profiles(id) on delete cascade,
  role text not null default 'member'
    check (role in ('owner', 'moderator', 'member')),
  status text not null default 'pending'
    check (status in ('pending', 'active', 'declined')),
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (circle_id, member_id),
  check (
    (status = 'active' and joined_at is not null)
    or (status <> 'active' and joined_at is null)
  )
);

create table public.follows (
  follower_id uuid not null references public.social_profiles(id) on delete cascade,
  followed_id uuid not null references public.social_profiles(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (follower_id, followed_id),
  check (follower_id <> followed_id),
  check (
    (status = 'accepted' and accepted_at is not null)
    or (status <> 'accepted' and accepted_at is null)
  )
);

create table public.blocks (
  blocker_id uuid not null references public.social_profiles(id) on delete cascade,
  blocked_id uuid not null references public.social_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create table public.sautis (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.social_profiles(id) on delete cascade,
  parent_sauti_id uuid references public.sautis(id) on delete cascade,
  circle_id uuid references public.circles(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  audience text not null default 'public'
    check (audience in ('public', 'followers', 'circle')),
  reply_policy text not null default 'everyone'
    check (reply_policy in ('everyone', 'following', 'mentioned', 'none')),
  media_keys text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (audience = 'circle' and circle_id is not null)
    or (audience <> 'circle' and circle_id is null)
  ),
  check (cardinality(media_keys) <= 4)
);

comment on column public.sautis.media_keys is
  'Cloudflare R2 object keys only. Postgres never stores uploaded binary media.';

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.social_profiles(id) on delete cascade,
  actor_id uuid references public.social_profiles(id) on delete set null,
  kind text not null
    check (kind in ('follow', 'mention', 'reply', 'reshare', 'circle', 'system')),
  entity_type text check (entity_type in ('sauti', 'profile', 'circle', 'system')),
  entity_id uuid,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  check (
    (entity_type is null and entity_id is null)
    or (entity_type is not null and entity_id is not null)
  )
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  member_low_id uuid not null references public.social_profiles(id) on delete cascade,
  member_high_id uuid not null references public.social_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (member_low_id, member_high_id),
  check (member_low_id < member_high_id)
);

comment on table public.conversations is
  'Canonical one-to-one conversations. The lower UUID is always stored first.';

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.social_profiles(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  edited_at timestamptz
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.social_profiles(id) on delete cascade,
  target_type text not null check (target_type in ('sauti', 'profile', 'circle', 'message')),
  target_id uuid not null,
  reason text not null
    check (reason in ('spam', 'harassment', 'hate', 'violence', 'sexual', 'privacy', 'other')),
  details text not null default '' check (char_length(details) <= 2000),
  status text not null default 'submitted'
    check (status in ('submitted', 'triaged', 'actioned', 'dismissed')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.social_profiles(id) on delete set null
);

comment on table public.reports is
  'Members can submit and read their reports. Moderation lifecycle fields remain server-owned.';

create index circles_owner_created_idx
  on public.circles (owner_id, created_at desc);
create index circles_discoverable_created_idx
  on public.circles (is_discoverable, created_at desc);
create index circle_members_member_status_idx
  on public.circle_members (member_id, status, circle_id);
create index follows_followed_status_created_idx
  on public.follows (followed_id, status, created_at desc);
create index blocks_blocked_idx
  on public.blocks (blocked_id, blocker_id);
create index sautis_author_created_idx
  on public.sautis (author_id, created_at desc, id);
create index sautis_parent_created_idx
  on public.sautis (parent_sauti_id, created_at, id)
  where parent_sauti_id is not null;
create index sautis_circle_created_idx
  on public.sautis (circle_id, created_at desc, id)
  where circle_id is not null;
create index sautis_public_created_idx
  on public.sautis (created_at desc, id)
  where audience = 'public';
create index notifications_recipient_unread_idx
  on public.notifications (recipient_id, created_at desc, id)
  where read_at is null;
create index notifications_recipient_created_idx
  on public.notifications (recipient_id, created_at desc, id);
create index messages_conversation_created_idx
  on public.messages (conversation_id, created_at, id);
create index messages_sender_created_idx
  on public.messages (sender_id, created_at desc);
create index reports_reporter_created_idx
  on public.reports (reporter_id, created_at desc);
create index reports_status_created_idx
  on public.reports (status, created_at);
create index reports_reviewer_idx
  on public.reports (reviewed_by)
  where reviewed_by is not null;

create or replace function private.is_blocked_pair(p_left uuid, p_right uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_left is not null
    and p_right is not null
    and exists (
      select 1
      from public.blocks
      where (blocker_id = p_left and blocked_id = p_right)
         or (blocker_id = p_right and blocked_id = p_left)
    );
$$;

create or replace function private.is_active_circle_member(
  p_circle_id uuid,
  p_member_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_member_id is not null
    and exists (
      select 1
      from public.circle_members
      where circle_id = p_circle_id
        and member_id = p_member_id
        and status = 'active'
    );
$$;

create or replace function private.is_conversation_participant(
  p_conversation_id uuid,
  p_member_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_member_id is not null
    and exists (
      select 1
      from public.conversations
      where id = p_conversation_id
        and p_member_id in (member_low_id, member_high_id)
    );
$$;

revoke all on function private.is_blocked_pair(uuid, uuid) from public;
revoke all on function private.is_active_circle_member(uuid, uuid) from public;
revoke all on function private.is_conversation_participant(uuid, uuid) from public;
grant usage on schema private to anon, authenticated;
grant execute on function private.is_blocked_pair(uuid, uuid) to anon, authenticated;
grant execute on function private.is_active_circle_member(uuid, uuid) to authenticated;
grant execute on function private.is_conversation_participant(uuid, uuid) to authenticated;

create or replace function private.enforce_unblocked_relationship()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.is_blocked_pair(new.follower_id, new.followed_id) then
    raise exception using errcode = '42501', message = 'RELATIONSHIP_BLOCKED';
  end if;
  return new;
end;
$$;

create or replace function private.add_circle_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.circle_members (
    circle_id,
    member_id,
    role,
    status,
    joined_at
  ) values (
    new.id,
    new.owner_id,
    'owner',
    'active',
    now()
  );
  return new;
end;
$$;

create or replace function private.enforce_unblocked_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null
     or caller_id not in (new.member_low_id, new.member_high_id) then
    raise exception using errcode = '42501', message = 'CONVERSATION_NOT_ALLOWED';
  end if;
  if private.is_blocked_pair(new.member_low_id, new.member_high_id) then
    raise exception using errcode = '42501', message = 'CONVERSATION_BLOCKED';
  end if;
  return new;
end;
$$;

create or replace function private.enforce_message_sender()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  peer_id uuid;
begin
  if caller_id is null or caller_id <> new.sender_id then
    raise exception using errcode = '42501', message = 'MESSAGE_SENDER_MISMATCH';
  end if;

  select case
    when member_low_id = new.sender_id then member_high_id
    when member_high_id = new.sender_id then member_low_id
    else null
  end
  into peer_id
  from public.conversations
  where id = new.conversation_id;

  if peer_id is null then
    raise exception using errcode = '42501', message = 'NOT_A_CONVERSATION_PARTICIPANT';
  end if;
  if private.is_blocked_pair(new.sender_id, peer_id) then
    raise exception using errcode = '42501', message = 'MESSAGE_BLOCKED';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_unblocked_relationship() from public, anon, authenticated;
revoke all on function private.add_circle_owner_membership() from public, anon, authenticated;
revoke all on function private.enforce_unblocked_conversation() from public, anon, authenticated;
revoke all on function private.enforce_message_sender() from public, anon, authenticated;

create trigger add_circle_owner_membership
  after insert on public.circles
  for each row execute function private.add_circle_owner_membership();
create trigger enforce_unblocked_follow
  before insert or update on public.follows
  for each row execute function private.enforce_unblocked_relationship();
create trigger enforce_unblocked_conversation
  before insert or update on public.conversations
  for each row execute function private.enforce_unblocked_conversation();
create trigger enforce_message_sender
  before insert or update of conversation_id, sender_id on public.messages
  for each row execute function private.enforce_message_sender();

create trigger set_account_settings_updated_at
  before update on public.account_settings
  for each row execute function private.set_updated_at();
create trigger set_circles_updated_at
  before update on public.circles
  for each row execute function private.set_updated_at();
create trigger set_sautis_updated_at
  before update on public.sautis
  for each row execute function private.set_updated_at();
create trigger set_conversations_updated_at
  before update on public.conversations
  for each row execute function private.set_updated_at();
create trigger set_messages_updated_at
  before update on public.messages
  for each row execute function private.set_updated_at();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'account_settings', 'circles', 'circle_members', 'follows', 'blocks',
    'sautis', 'notifications', 'conversations', 'messages', 'reports'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
  end loop;
end;
$$;

create policy account_settings_select_own
  on public.account_settings for select to authenticated
  using ((select auth.uid()) = user_id);
create policy account_settings_insert_own
  on public.account_settings for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy account_settings_update_own
  on public.account_settings for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy blocks_select_own
  on public.blocks for select to authenticated
  using ((select auth.uid()) = blocker_id);
create policy blocks_insert_own
  on public.blocks for insert to authenticated
  with check ((select auth.uid()) = blocker_id);
create policy blocks_delete_own
  on public.blocks for delete to authenticated
  using ((select auth.uid()) = blocker_id);

create policy follows_select_participant
  on public.follows for select to authenticated
  using ((select auth.uid()) in (follower_id, followed_id));
create policy follows_insert_own
  on public.follows for insert to authenticated
  with check (
    (select auth.uid()) = follower_id
    and status = 'pending'
    and accepted_at is null
  );
create policy follows_delete_own
  on public.follows for delete to authenticated
  using ((select auth.uid()) = follower_id);

create policy circles_select_visible
  on public.circles for select to anon, authenticated
  using (
    is_discoverable
    or owner_id = (select auth.uid())
    or (select private.is_active_circle_member(id, auth.uid()))
  );
create policy circles_insert_own
  on public.circles for insert to authenticated
  with check ((select auth.uid()) = owner_id);
create policy circles_update_owner
  on public.circles for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy circles_delete_owner
  on public.circles for delete to authenticated
  using ((select auth.uid()) = owner_id);

create policy circle_members_select_self_or_owner
  on public.circle_members for select to authenticated
  using (
    member_id = (select auth.uid())
    or exists (
      select 1 from public.circles
      where circles.id = circle_members.circle_id
        and circles.owner_id = (select auth.uid())
    )
  );
create policy circle_members_insert_self_or_owner
  on public.circle_members for insert to authenticated
  with check (
    (
      member_id = (select auth.uid())
      and role = 'member'
      and status = 'pending'
      and exists (
        select 1 from public.circles
        where circles.id = circle_members.circle_id
          and circles.join_policy in ('open', 'approval')
      )
    )
    or exists (
      select 1 from public.circles
      where circles.id = circle_members.circle_id
        and circles.owner_id = (select auth.uid())
    )
  );
create policy circle_members_update_owner
  on public.circle_members for update to authenticated
  using (
    exists (
      select 1 from public.circles
      where circles.id = circle_members.circle_id
        and circles.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.circles
      where circles.id = circle_members.circle_id
        and circles.owner_id = (select auth.uid())
    )
  );
create policy circle_members_delete_self_or_owner
  on public.circle_members for delete to authenticated
  using (
    member_id = (select auth.uid())
    or exists (
      select 1 from public.circles
      where circles.id = circle_members.circle_id
        and circles.owner_id = (select auth.uid())
    )
  );

create policy sautis_select_visible
  on public.sautis for select to anon, authenticated
  using (
    not (select private.is_blocked_pair(author_id, auth.uid()))
    and (
      author_id = (select auth.uid())
      or audience = 'public'
      or (
        audience = 'followers'
        and exists (
          select 1 from public.follows
          where follows.follower_id = (select auth.uid())
            and follows.followed_id = sautis.author_id
            and follows.status = 'accepted'
        )
      )
      or (
        audience = 'circle'
        and (select private.is_active_circle_member(circle_id, auth.uid()))
      )
    )
  );
create policy sautis_insert_own
  on public.sautis for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and (
      audience <> 'circle'
      or (select private.is_active_circle_member(circle_id, auth.uid()))
    )
  );
create policy sautis_update_own
  on public.sautis for update to authenticated
  using (author_id = (select auth.uid()))
  with check (
    author_id = (select auth.uid())
    and (
      audience <> 'circle'
      or (select private.is_active_circle_member(circle_id, auth.uid()))
    )
  );
create policy sautis_delete_own
  on public.sautis for delete to authenticated
  using (author_id = (select auth.uid()));

create policy notifications_select_own
  on public.notifications for select to authenticated
  using (recipient_id = (select auth.uid()));
create policy notifications_update_own
  on public.notifications for update to authenticated
  using (recipient_id = (select auth.uid()))
  with check (recipient_id = (select auth.uid()));
create policy notifications_delete_own
  on public.notifications for delete to authenticated
  using (recipient_id = (select auth.uid()));

create policy conversations_select_participant
  on public.conversations for select to authenticated
  using ((select auth.uid()) in (member_low_id, member_high_id));
create policy conversations_insert_participant
  on public.conversations for insert to authenticated
  with check (
    (select auth.uid()) in (member_low_id, member_high_id)
    and not (select private.is_blocked_pair(member_low_id, member_high_id))
  );

create policy messages_select_participant
  on public.messages for select to authenticated
  using (
    (select private.is_conversation_participant(conversation_id, auth.uid()))
    and not (
      select private.is_blocked_pair(
        sender_id,
        case
          when sender_id = (select auth.uid()) then (
            select case
              when member_low_id = sender_id then member_high_id
              else member_low_id
            end
            from public.conversations
            where id = conversation_id
          )
          else (select auth.uid())
        end
      )
    )
  );
create policy messages_insert_sender
  on public.messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and (select private.is_conversation_participant(conversation_id, auth.uid()))
  );
create policy messages_update_sender
  on public.messages for update to authenticated
  using (sender_id = (select auth.uid()))
  with check (
    sender_id = (select auth.uid())
    and (select private.is_conversation_participant(conversation_id, auth.uid()))
  );

create policy reports_select_own
  on public.reports for select to authenticated
  using (reporter_id = (select auth.uid()));
create policy reports_insert_own
  on public.reports for insert to authenticated
  with check (
    reporter_id = (select auth.uid())
    and status = 'submitted'
    and reviewed_at is null
    and reviewed_by is null
  );

revoke all on table
  public.account_settings,
  public.circles,
  public.circle_members,
  public.follows,
  public.blocks,
  public.sautis,
  public.notifications,
  public.conversations,
  public.messages,
  public.reports
from anon, authenticated;

grant select on public.circles, public.sautis to anon;
grant select, insert, update on public.account_settings to authenticated;
grant select, insert, delete on public.follows, public.blocks to authenticated;
grant select, insert, update, delete on public.circles, public.circle_members to authenticated;
grant select, insert, update, delete on public.sautis to authenticated;
grant select, update (read_at), delete on public.notifications to authenticated;
grant select, insert on public.conversations to authenticated;
grant select, insert, update (body, edited_at) on public.messages to authenticated;
grant select, insert on public.reports to authenticated;

grant select, insert, update, delete on table
  public.account_settings,
  public.circles,
  public.circle_members,
  public.follows,
  public.blocks,
  public.sautis,
  public.notifications,
  public.conversations,
  public.messages,
  public.reports
to service_role;
