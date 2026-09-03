-- Phase 17 RLS + counter regression.
-- Staging-only fixtures. Everything rolls back.

begin;

insert into auth.users (id, email, email_confirmed_at, created_at, updated_at)
values
  ('17000000-0000-0000-0000-000000000001', 'phase17-a@example.invalid', now(), now(), now()),
  ('17000000-0000-0000-0000-000000000002', 'phase17-b@example.invalid', now(), now(), now());

insert into public.account_profiles (id, username, full_name)
values
  ('17000000-0000-0000-0000-000000000001', 'phase17_a', 'Phase 17 A'),
  ('17000000-0000-0000-0000-000000000002', 'phase17_b', 'Phase 17 B');

update public.social_profiles
set is_discoverable = true
where id in (
  '17000000-0000-0000-0000-000000000001',
  '17000000-0000-0000-0000-000000000002'
);

insert into public.social_posts (id, author_id, body)
values (
  '17000000-0000-4000-8000-000000000010',
  '17000000-0000-0000-0000-000000000002',
  'Phase 17 target Sauti'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '17000000-0000-0000-0000-000000000001', true);

insert into public.social_follows (follower_id, followed_id)
values (
  '17000000-0000-0000-0000-000000000001',
  '17000000-0000-0000-0000-000000000002'
);

do $$
declare blocked boolean := false;
begin
  begin
    insert into public.social_follows (follower_id, followed_id)
    values (
      '17000000-0000-0000-0000-000000000001',
      '17000000-0000-0000-0000-000000000001'
    );
  exception when others then
    blocked := true;
  end;
  if not blocked then raise exception 'SELF_FOLLOW_ALLOWED'; end if;
end $$;

insert into public.social_post_reactions (post_id, user_id)
values (
  '17000000-0000-4000-8000-000000000010',
  '17000000-0000-0000-0000-000000000001'
);

insert into public.social_post_comments (id, post_id, author_id, body)
values (
  '17000000-0000-4000-8000-000000000020',
  '17000000-0000-4000-8000-000000000010',
  '17000000-0000-0000-0000-000000000001',
  'Phase 17 comment'
);

insert into public.social_reposts (post_id, user_id)
values (
  '17000000-0000-4000-8000-000000000010',
  '17000000-0000-0000-0000-000000000001'
);

reset role;

do $$
declare
  follower_count_value integer;
  following_count_value integer;
  likes integer;
  comments integer;
  reposts integer;
begin
  select followers_count into follower_count_value
  from public.social_profiles
  where id = '17000000-0000-0000-0000-000000000002';

  select following_count into following_count_value
  from public.social_profiles
  where id = '17000000-0000-0000-0000-000000000001';

  select like_count, comment_count, repost_count
  into likes, comments, reposts
  from public.social_posts
  where id = '17000000-0000-4000-8000-000000000010';

  if follower_count_value <> 1 or following_count_value <> 1 then
    raise exception 'FOLLOW_COUNTERS_NOT_SYNCHRONIZED';
  end if;

  if likes <> 1 or comments <> 1 or reposts <> 1 then
    raise exception 'POST_COUNTERS_NOT_SYNCHRONIZED';
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '17000000-0000-0000-0000-000000000002', true);

insert into public.social_post_comments (id, post_id, author_id, body)
values (
  '17000000-0000-4000-8000-000000000021',
  '17000000-0000-4000-8000-000000000010',
  '17000000-0000-0000-0000-000000000002',
  'Owner comment'
);

reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '17000000-0000-0000-0000-000000000001', true);

do $$
declare changed integer;
begin
  delete from public.social_post_comments
  where id = '17000000-0000-4000-8000-000000000021';
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'CROSS_USER_COMMENT_DELETE_ALLOWED'; end if;
end $$;

do $$
declare changed integer;
begin
  delete from public.social_follows
  where follower_id = '17000000-0000-0000-0000-000000000002'
    and followed_id = '17000000-0000-0000-0000-000000000001';
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'CROSS_USER_UNFOLLOW_ALLOWED'; end if;
end $$;

reset role;

update public.social_profiles
set is_discoverable = false
where id = '17000000-0000-0000-0000-000000000001';

set local role anon;
select set_config('request.jwt.claim.sub', '', true);

do $$
declare comment_rows integer;
declare repost_rows integer;
begin
  select count(*) into comment_rows
  from public.social_post_comments
  where id = '17000000-0000-4000-8000-000000000020';

  select count(*) into repost_rows
  from public.social_reposts
  where post_id = '17000000-0000-4000-8000-000000000010'
    and user_id = '17000000-0000-0000-0000-000000000001';

  if comment_rows <> 0 then raise exception 'HIDDEN_COMMENT_AUTHOR_LEAKED'; end if;
  if repost_rows <> 0 then raise exception 'HIDDEN_REPOSTER_LEAKED'; end if;
end $$;

reset role;

update public.social_profiles
set is_discoverable = false
where id = '17000000-0000-0000-0000-000000000002';

set local role authenticated;
select set_config('request.jwt.claim.sub', '17000000-0000-0000-0000-000000000001', true);

delete from public.social_follows
where follower_id = '17000000-0000-0000-0000-000000000001'
  and followed_id = '17000000-0000-0000-0000-000000000002';

do $$
declare blocked boolean := false;
begin
  begin
    insert into public.social_follows (follower_id, followed_id)
    values (
      '17000000-0000-0000-0000-000000000001',
      '17000000-0000-0000-0000-000000000002'
    );
  exception when others then
    if sqlstate = '42501' then blocked := true; else raise; end if;
  end;
  if not blocked then raise exception 'HIDDEN_TARGET_FOLLOW_ALLOWED'; end if;
end $$;

reset role;
rollback;
