-- Production-safe admission test: synthetic users and all writes roll back.
begin;

insert into auth.users (id, email, email_confirmed_at, created_at, updated_at)
values
  ('e0010000-0000-4000-8000-000000000001', 'signup-gate-new@example.invalid', now(), now() + interval '1 second', now()),
  ('e0010000-0000-4000-8000-000000000002', 'signup-gate-old@example.invalid', now(), now() - interval '1 day', now());

set local role authenticated;
select set_config('request.jwt.claim.sub', 'e0010000-0000-4000-8000-000000000001', true);

do $$
declare blocked boolean := false;
begin
  if (public.get_signup_requirements()->>'required')::boolean is distinct from true then
    raise exception 'NEW_SIGNUP_GATE_MISSING';
  end if;
  begin
    perform public.complete_social_onboarding('signupgate_new', 'New Member');
  exception when sqlstate '42501' then
    blocked := true;
  end;
  if not blocked then raise exception 'MISSING_TERMS_WERE_ACCEPTED'; end if;
end $$;

select public.accept_signup_terms();

do $$
declare blocked boolean := false;
begin
  begin
    perform public.complete_social_onboarding('signupgate_new', 'New Member');
  exception when sqlstate '42501' then
    blocked := true;
  end;
  if not blocked then raise exception 'UNVERIFIED_PHONE_WAS_ACCEPTED'; end if;
end $$;

reset role;
update auth.users
   set phone = '255712345681', phone_confirmed_at = now()
 where id = 'e0010000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'e0010000-0000-4000-8000-000000000001', true);
select public.complete_social_onboarding('signupgate_new', 'New Member');

select set_config('request.jwt.claim.sub', 'e0010000-0000-4000-8000-000000000002', true);
do $$
begin
  if (public.get_signup_requirements()->>'required')::boolean is distinct from false then
    raise exception 'EXISTING_ACCOUNT_WAS_GATED';
  end if;
end $$;
select public.complete_social_onboarding('signupgate_old', 'Existing Member');

rollback;
