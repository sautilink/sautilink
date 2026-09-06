-- Home author-interest preference RLS regression. All fixtures roll back.

begin;

insert into auth.users (id, email, email_confirmed_at, created_at, updated_at)
values
  ('96000000-0000-0000-0000-000000000001', 'home-interest-a@example.invalid', now(), now(), now()),
  ('96000000-0000-0000-0000-000000000002', 'home-interest-b@example.invalid', now(), now(), now());

insert into public.account_profiles (id, username, full_name)
values
  ('96000000-0000-0000-0000-000000000001', 'home_interest_a', 'Home Interest A'),
  ('96000000-0000-0000-0000-000000000002', 'home_interest_b', 'Home Interest B');

update public.social_profiles
set is_discoverable = true
where id in (
  '96000000-0000-0000-0000-000000000001',
  '96000000-0000-0000-0000-000000000002'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '96000000-0000-0000-0000-000000000001', true);

insert into public.social_feed_author_interests (user_id, author_id)
values (
  '96000000-0000-0000-0000-000000000001',
  '96000000-0000-0000-0000-000000000002'
);

do $$
declare own_rows integer;
declare self_insert_blocked boolean := false;
begin
  select count(*) into own_rows from public.social_feed_author_interests;
  if own_rows <> 1 then raise exception 'OWN_INTEREST_NOT_VISIBLE'; end if;

  begin
    insert into public.social_feed_author_interests (user_id, author_id)
    values (
      '96000000-0000-0000-0000-000000000001',
      '96000000-0000-0000-0000-000000000001'
    );
  exception when others then
    self_insert_blocked := true;
  end;
  if not self_insert_blocked then raise exception 'SELF_INTEREST_ALLOWED'; end if;
end $$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '96000000-0000-0000-0000-000000000002', true);

do $$
declare leaked_rows integer;
declare cross_insert_blocked boolean := false;
begin
  select count(*) into leaked_rows from public.social_feed_author_interests;
  if leaked_rows <> 0 then raise exception 'OTHER_MEMBER_INTEREST_LEAKED'; end if;

  begin
    insert into public.social_feed_author_interests (user_id, author_id)
    values (
      '96000000-0000-0000-0000-000000000001',
      '96000000-0000-0000-0000-000000000002'
    );
  exception when others then
    cross_insert_blocked := true;
  end;
  if not cross_insert_blocked then raise exception 'CROSS_MEMBER_INTEREST_INSERT_ALLOWED'; end if;
end $$;

reset role;
rollback;
