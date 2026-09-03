begin;

insert into auth.users(id,email,email_confirmed_at,created_at,updated_at)
values
('35000000-0000-0000-0000-000000000031','identity31@example.invalid',now(),now(),now()),
('35000000-0000-0000-0000-000000000032','identity32@example.invalid',now(),now(),now());

insert into public.account_profiles(id,username,full_name)
values
('35000000-0000-0000-0000-000000000031','identity31','Identity Thirty One'),
('35000000-0000-0000-0000-000000000032','identity32','Identity Thirty Two');

set local role authenticated;
select set_config('request.jwt.claim.sub','35000000-0000-0000-0000-000000000031',true);

select public.change_social_identity('display_name','Identity One A','35000000-0000-4000-8000-000000000031');
select public.change_social_identity('display_name','Identity One B','35000000-0000-4000-8000-000000000032');

do $limit$
begin
  begin
    perform public.change_social_identity('display_name','Identity One C','35000000-0000-4000-8000-000000000033');
    raise exception 'EXPECTED_DISPLAY_NAME_LIMIT';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'DISPLAY_NAME_CHANGE_LIMIT' then raise; end if;
  end;
end;
$limit$;

select public.change_social_identity('username','identity31new','35000000-0000-4000-8000-000000000034');

do $userlimit$
begin
  begin
    perform public.change_social_identity('username','identity31again','35000000-0000-4000-8000-000000000035');
    raise exception 'EXPECTED_USERNAME_LIMIT';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'USERNAME_CHANGE_LIMIT' then raise; end if;
  end;
end;
$userlimit$;

reset role;
update public.social_profiles set is_verified=true where id='35000000-0000-0000-0000-000000000032';
set local role authenticated;
select set_config('request.jwt.claim.sub','35000000-0000-0000-0000-000000000032',true);
select public.change_social_identity('display_name','Verified Requested Name','35000000-0000-4000-8000-000000000036');

do $verified$
declare
  current_name text;
  pending_count int;
  self_verify_allowed boolean := true;
begin
  select display_name into current_name from public.social_profiles where id='35000000-0000-0000-0000-000000000032';
  if current_name <> 'Identity Thirty Two' then raise exception 'VERIFIED_NAME_CHANGED_WITHOUT_REVIEW'; end if;
  select count(*) into pending_count from public.social_identity_change_requests where user_id='35000000-0000-0000-0000-000000000032' and status='pending';
  if pending_count <> 1 then raise exception 'VERIFIED_REQUEST_NOT_CREATED'; end if;

  begin
    update public.social_profiles set is_verified=false where id='35000000-0000-0000-0000-000000000032';
  exception when insufficient_privilege then
    self_verify_allowed := false;
  end;
  if self_verify_allowed then raise exception 'VERIFICATION_MEMBER_WRITABLE'; end if;
end;
$verified$;

select 'IDENTITY_CHANGE_CONTROLS_PASS' as result;
rollback;
