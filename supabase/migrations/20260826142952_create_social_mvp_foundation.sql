-- Phase 11: versioned backend contract for the SautiLink web MVP.
--
-- This migration is intentionally committed before it is applied. It depends on
-- the Phase 1 account_profiles/social_profiles foundation and must first run on
-- an isolated staging Supabase project. Cloudflare Workers remain responsible
-- for rate limits, abuse controls and privileged lifecycle transitions.

create table public.social_blocks (
  blocker_id uuid not null references public.social_profiles(id) on delete cascade,
  blocked_id uuid not null references public.social_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint social_blocks_distinct_members check (blocker_id <> blocked_id)
);

create index social_blocks_blocked_id_idx
  on public.social_blocks (blocked_id);

create table public.social_follows (
  follower_id uuid not null references public.social_profiles(id) on delete cascade,
  followed_id uuid not null references public.social_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followed_id),
  constraint social_follows_distinct_members check (follower_id <> followed_id)
);

create index social_follows_followed_created_idx
  on public.social_follows (followed_id, created_at desc);

create table public.social_circles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.social_profiles(id) on delete cascade,
  slug text not null unique,
  name text not null,
  description text not null default '',
  join_policy text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_circles_slug_format check (
    slug = lower(slug)
    and slug ~ '^[a-z0-9][a-z0-9-]{2,49}$'
  ),
  constraint social_circles_name_length check (
    char_length(btrim(name)) between 1 and 80
  ),
  constraint social_circles_description_length check (
    char_length(description) <= 1000
  ),
  constraint social_circles_join_policy_allowed check (
    join_policy = any (array['open', 'approval']::text[])
  )
);

create index social_circles_owner_created_idx
  on public.social_circles (owner_id, created_at desc);

create table public.social_circle_members (
  circle_id uuid not null references public.social_circles(id) on delete cascade,
  member_id uuid not null references public.social_profiles(id) on delete cascade,
  member_role text not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (circle_id, member_id),
  constraint social_circle_members_role_allowed check (
    member_role = any (array['member', 'moderator', 'owner']::text[])
  )
);

create index social_circle_members_member_joined_idx
  on public.social_circle_members (member_id, joined_at desc);

create table public.social_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.social_profiles(id) on delete cascade,
  circle_id uuid references public.social_circles(id) on delete cascade,
  reply_to_post_id uuid references public.social_posts(id) on delete cascade,
  body text not null,
  visibility text not null default 'public',
  post_status text not null default 'published',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint social_posts_body_length check (
    char_length(btrim(body)) between 1 and 10000
  ),
  constraint social_posts_visibility_allowed check (
    visibility = any (array['public', 'followers', 'circle']::text[])
  ),
  constraint social_posts_status_allowed check (
    post_status = any (array['published', 'removed']::text[])
  ),
  constraint social_posts_circle_visibility_scope check (
    (visibility = 'circle') = (circle_id is not null)
  )
);

create index social_posts_author_created_idx
  on public.social_posts (author_id, created_at desc);
create index social_posts_circle_created_idx
  on public.social_posts (circle_id, created_at desc)
  where circle_id is not null;
create index social_posts_reply_created_idx
  on public.social_posts (reply_to_post_id, created_at)
  where reply_to_post_id is not null;
create index social_posts_public_stream_idx
  on public.social_posts (created_at desc)
  where visibility = 'public' and post_status = 'published';

create table public.user_social_settings (
  user_id uuid primary key references public.social_profiles(id) on delete cascade,
  account_visibility text not null default 'public',
  message_permission text not null default 'following',
  external_search_indexing boolean not null default false,
  email_notifications boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_social_settings_visibility_allowed check (
    account_visibility = any (array['public', 'followers']::text[])
  ),
  constraint user_social_settings_message_permission_allowed check (
    message_permission = any (array['everyone', 'following', 'none']::text[])
  )
);

create table public.social_notifications (
  id bigint generated always as identity primary key,
  recipient_id uuid not null references public.social_profiles(id) on delete cascade,
  actor_id uuid references public.social_profiles(id) on delete set null,
  post_id uuid references public.social_posts(id) on delete cascade,
  notification_type text not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint social_notifications_type_allowed check (
    notification_type = any (array[
      'follow', 'reply', 'mention', 'like', 'reshare', 'circle', 'message', 'safety'
    ]::text[])
  )
);

create index social_notifications_recipient_unread_idx
  on public.social_notifications (recipient_id, created_at desc)
  where read_at is null;
create index social_notifications_actor_id_idx
  on public.social_notifications (actor_id)
  where actor_id is not null;
create index social_notifications_post_id_idx
  on public.social_notifications (post_id)
  where post_id is not null;

create table public.dm_conversations (
  id uuid primary key default gen_random_uuid(),
  member_one_id uuid not null references public.social_profiles(id) on delete cascade,
  member_two_id uuid not null references public.social_profiles(id) on delete cascade,
  created_by uuid not null references public.social_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  constraint dm_conversations_distinct_members check (member_one_id <> member_two_id),
  constraint dm_conversations_canonical_pair check (
    member_one_id::text < member_two_id::text
  ),
  constraint dm_conversations_creator_is_member check (
    created_by = member_one_id or created_by = member_two_id
  ),
  constraint dm_conversations_unique_pair unique (member_one_id, member_two_id)
);

create index dm_conversations_member_one_activity_idx
  on public.dm_conversations (member_one_id, last_message_at desc);
create index dm_conversations_member_two_activity_idx
  on public.dm_conversations (member_two_id, last_message_at desc);
create index dm_conversations_created_by_idx
  on public.dm_conversations (created_by);

create table public.dm_conversation_states (
  conversation_id uuid not null references public.dm_conversations(id) on delete cascade,
  user_id uuid not null references public.social_profiles(id) on delete cascade,
  last_read_at timestamptz,
  hidden_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create index dm_conversation_states_user_visible_idx
  on public.dm_conversation_states (user_id, conversation_id)
  where hidden_at is null;

create table public.dm_messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.dm_conversations(id) on delete cascade,
  sender_id uuid not null references public.social_profiles(id) on delete cascade,
  body text not null,
  sent_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  constraint dm_messages_body_length check (
    char_length(btrim(body)) between 1 and 4000
  )
);

create index dm_messages_conversation_sent_idx
  on public.dm_messages (conversation_id, sent_at desc, id desc);
create index dm_messages_sender_id_idx
  on public.dm_messages (sender_id);

create table public.social_reports (
  id bigint generated always as identity primary key,
  reporter_id uuid not null references public.social_profiles(id) on delete cascade,
  target_type text not null,
  target_id text not null,
  reason text not null,
  details text,
  report_status text not null default 'open',
  created_at timestamptz not null default now(),
  constraint social_reports_target_type_allowed check (
    target_type = any (array['profile', 'post', 'message', 'circle']::text[])
  ),
  constraint social_reports_target_id_length check (
    char_length(target_id) between 1 and 128
  ),
  constraint social_reports_reason_allowed check (
    reason = any (array['spam', 'harassment', 'hate', 'impersonation', 'privacy', 'other']::text[])
  ),
  constraint social_reports_details_length check (
    details is null or char_length(details) <= 2000
  ),
  constraint social_reports_status_allowed check (
    report_status = any (array['open', 'reviewing', 'resolved', 'dismissed']::text[])
  )
);

create index social_reports_status_created_idx
  on public.social_reports (report_status, created_at);
create index social_reports_reporter_created_idx
  on public.social_reports (reporter_id, created_at desc);

comment on table public.social_posts is
  'Authoritative Sauti and public-thread records. R2 object keys will live in a separate media slice.';
comment on table public.dm_conversations is
  'Canonical one-to-one SautiLink conversation pairs. Group messaging is outside the web MVP.';
comment on table public.dm_conversation_states is
  'Per-member read and locally hidden conversation state.';
comment on table public.dm_messages is
  'Basic one-to-one text messages. Realtime is transport only; Postgres remains authoritative.';
comment on table public.social_reports is
  'Private moderation intake. Report lifecycle fields are server-owned.';

alter table public.social_blocks enable row level security;
alter table public.social_blocks force row level security;
alter table public.social_follows enable row level security;
alter table public.social_follows force row level security;
alter table public.social_circles enable row level security;
alter table public.social_circles force row level security;
alter table public.social_circle_members enable row level security;
alter table public.social_circle_members force row level security;
alter table public.social_posts enable row level security;
alter table public.social_posts force row level security;
alter table public.user_social_settings enable row level security;
alter table public.user_social_settings force row level security;
alter table public.social_notifications enable row level security;
alter table public.social_notifications force row level security;
alter table public.dm_conversations enable row level security;
alter table public.dm_conversations force row level security;
alter table public.dm_conversation_states enable row level security;
alter table public.dm_conversation_states force row level security;
alter table public.dm_messages enable row level security;
alter table public.dm_messages force row level security;
alter table public.social_reports enable row level security;
alter table public.social_reports force row level security;

revoke all on table
  public.social_blocks,
  public.social_follows,
  public.social_circles,
  public.social_circle_members,
  public.social_posts,
  public.user_social_settings,
  public.social_notifications,
  public.dm_conversations,
  public.dm_conversation_states,
  public.dm_messages,
  public.social_reports
from anon, authenticated;

grant select on table public.social_circles, public.social_posts to anon;

grant select, insert, delete on table public.social_blocks, public.social_follows
  to authenticated;
grant select, insert, update, delete on table
  public.social_circles,
  public.social_circle_members,
  public.user_social_settings,
  public.dm_conversation_states
to authenticated;
grant select, insert, delete on table public.social_posts
  to authenticated;
grant update (body, circle_id, reply_to_post_id, visibility, deleted_at)
  on table public.social_posts to authenticated;
grant select, delete on table public.social_notifications
  to authenticated;
grant update (read_at) on table public.social_notifications
  to authenticated;
grant select, insert on table public.dm_conversations
  to authenticated;
grant select, insert on table public.dm_messages
  to authenticated;
grant update (body, edited_at, deleted_at) on table public.dm_messages
  to authenticated;
grant insert on table public.social_reports
  to authenticated;

grant select, insert, update, delete on table
  public.social_blocks,
  public.social_follows,
  public.social_circles,
  public.social_circle_members,
  public.social_posts,
  public.user_social_settings,
  public.social_notifications,
  public.dm_conversations,
  public.dm_conversation_states,
  public.dm_messages,
  public.social_reports
to service_role;

revoke all on sequence
  public.social_notifications_id_seq,
  public.dm_messages_id_seq,
  public.social_reports_id_seq
from anon, authenticated;
grant usage, select on sequence public.dm_messages_id_seq, public.social_reports_id_seq
  to authenticated;
grant usage, select on sequence
  public.social_notifications_id_seq,
  public.dm_messages_id_seq,
  public.social_reports_id_seq
to service_role;

create policy social_blocks_select_involved
  on public.social_blocks for select to authenticated
  using (
    (select auth.uid()) = blocker_id
    or (select auth.uid()) = blocked_id
  );
create policy social_blocks_insert_own
  on public.social_blocks for insert to authenticated
  with check ((select auth.uid()) = blocker_id);
create policy social_blocks_delete_own
  on public.social_blocks for delete to authenticated
  using ((select auth.uid()) = blocker_id);

create policy social_follows_select_authenticated
  on public.social_follows for select to authenticated
  using ((select auth.uid()) is not null);
create policy social_follows_insert_own
  on public.social_follows for insert to authenticated
  with check ((select auth.uid()) = follower_id);
create policy social_follows_delete_own
  on public.social_follows for delete to authenticated
  using ((select auth.uid()) = follower_id);

create policy social_circles_select_public
  on public.social_circles for select to anon, authenticated
  using (slug is not null);
create policy social_circles_insert_owned
  on public.social_circles for insert to authenticated
  with check ((select auth.uid()) = owner_id);
create policy social_circles_update_owned
  on public.social_circles for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy social_circles_delete_owned
  on public.social_circles for delete to authenticated
  using ((select auth.uid()) = owner_id);

create policy social_circle_members_select_authenticated
  on public.social_circle_members for select to authenticated
  using ((select auth.uid()) is not null);
create policy social_circle_members_insert_allowed
  on public.social_circle_members for insert to authenticated
  with check (
    (
      (select auth.uid()) = member_id
      and member_role = 'member'
      and exists (
        select 1 from public.social_circles circle
        where circle.id = circle_id and circle.join_policy = 'open'
      )
    )
    or exists (
      select 1 from public.social_circles circle
      where circle.id = circle_id and circle.owner_id = (select auth.uid())
    )
  );
create policy social_circle_members_update_by_owner
  on public.social_circle_members for update to authenticated
  using (
    exists (
      select 1 from public.social_circles circle
      where circle.id = circle_id and circle.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.social_circles circle
      where circle.id = circle_id and circle.owner_id = (select auth.uid())
    )
  );
create policy social_circle_members_delete_self_or_owner
  on public.social_circle_members for delete to authenticated
  using (
    (select auth.uid()) = member_id
    or exists (
      select 1 from public.social_circles circle
      where circle.id = circle_id and circle.owner_id = (select auth.uid())
    )
  );

create policy social_posts_select_visible
  on public.social_posts for select to anon, authenticated
  using (
    post_status = 'published'
    and (
      (select auth.uid()) = author_id
      or visibility = 'public'
      or (
        visibility = 'followers'
        and exists (
          select 1 from public.social_follows follow
          where follow.follower_id = (select auth.uid())
            and follow.followed_id = author_id
        )
      )
      or (
        visibility = 'circle'
        and exists (
          select 1 from public.social_circle_members membership
          where membership.circle_id = social_posts.circle_id
            and membership.member_id = (select auth.uid())
        )
      )
    )
    and (
      (select auth.uid()) is null
      or not exists (
        select 1 from public.social_blocks block
        where (block.blocker_id = (select auth.uid()) and block.blocked_id = author_id)
           or (block.blocker_id = author_id and block.blocked_id = (select auth.uid()))
      )
    )
  );
create policy social_posts_insert_own
  on public.social_posts for insert to authenticated
  with check (
    (select auth.uid()) = author_id
    and (
      circle_id is null
      or exists (
        select 1 from public.social_circle_members membership
        where membership.circle_id = social_posts.circle_id
          and membership.member_id = (select auth.uid())
      )
    )
  );
create policy social_posts_update_own
  on public.social_posts for update to authenticated
  using ((select auth.uid()) = author_id)
  with check ((select auth.uid()) = author_id);
create policy social_posts_delete_own
  on public.social_posts for delete to authenticated
  using ((select auth.uid()) = author_id);

create policy user_social_settings_select_own
  on public.user_social_settings for select to authenticated
  using ((select auth.uid()) = user_id);
create policy user_social_settings_insert_own
  on public.user_social_settings for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy user_social_settings_update_own
  on public.user_social_settings for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy user_social_settings_delete_own
  on public.user_social_settings for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy social_notifications_select_own
  on public.social_notifications for select to authenticated
  using ((select auth.uid()) = recipient_id);
create policy social_notifications_update_own
  on public.social_notifications for update to authenticated
  using ((select auth.uid()) = recipient_id)
  with check ((select auth.uid()) = recipient_id);
create policy social_notifications_delete_own
  on public.social_notifications for delete to authenticated
  using ((select auth.uid()) = recipient_id);

create policy dm_conversations_select_participant
  on public.dm_conversations for select to authenticated
  using (
    (select auth.uid()) = member_one_id
    or (select auth.uid()) = member_two_id
  );
create policy dm_conversations_insert_participant
  on public.dm_conversations for insert to authenticated
  with check (
    (select auth.uid()) = created_by
    and (
      (select auth.uid()) = member_one_id
      or (select auth.uid()) = member_two_id
    )
    and not exists (
      select 1 from public.social_blocks block
      where (block.blocker_id = member_one_id and block.blocked_id = member_two_id)
         or (block.blocker_id = member_two_id and block.blocked_id = member_one_id)
    )
  );

create policy dm_conversation_states_select_own
  on public.dm_conversation_states for select to authenticated
  using ((select auth.uid()) = user_id);
create policy dm_conversation_states_insert_own
  on public.dm_conversation_states for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.dm_conversations conversation
      where conversation.id = conversation_id
        and (
          conversation.member_one_id = (select auth.uid())
          or conversation.member_two_id = (select auth.uid())
        )
    )
  );
create policy dm_conversation_states_update_own
  on public.dm_conversation_states for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy dm_conversation_states_delete_own
  on public.dm_conversation_states for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy dm_messages_select_participant
  on public.dm_messages for select to authenticated
  using (
    exists (
      select 1 from public.dm_conversations conversation
      where conversation.id = conversation_id
        and (
          conversation.member_one_id = (select auth.uid())
          or conversation.member_two_id = (select auth.uid())
        )
    )
  );
create policy dm_messages_insert_participant
  on public.dm_messages for insert to authenticated
  with check (
    (select auth.uid()) = sender_id
    and exists (
      select 1 from public.dm_conversations conversation
      where conversation.id = conversation_id
        and (
          conversation.member_one_id = (select auth.uid())
          or conversation.member_two_id = (select auth.uid())
        )
        and not exists (
          select 1 from public.social_blocks block
          where (block.blocker_id = conversation.member_one_id and block.blocked_id = conversation.member_two_id)
             or (block.blocker_id = conversation.member_two_id and block.blocked_id = conversation.member_one_id)
        )
    )
  );
create policy dm_messages_update_own
  on public.dm_messages for update to authenticated
  using ((select auth.uid()) = sender_id)
  with check ((select auth.uid()) = sender_id);

create policy social_reports_insert_own
  on public.social_reports for insert to authenticated
  with check ((select auth.uid()) = reporter_id and report_status = 'open');

create trigger set_social_circles_updated_at
  before update on public.social_circles
  for each row execute function private.set_social_profile_updated_at();
create trigger set_social_posts_updated_at
  before update on public.social_posts
  for each row execute function private.set_social_profile_updated_at();
create trigger set_user_social_settings_updated_at
  before update on public.user_social_settings
  for each row execute function private.set_social_profile_updated_at();
