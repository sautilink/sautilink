-- This runs BEFORE the new management migration: only canonical existing code.
begin;
do $$ begin if current_database() not like 'sautilink_rooms_test%' then raise exception 'LOCAL_TEST_DATABASE_REQUIRED'; end if; end $$;
insert into public.social_profiles(id,username) values
 ('c1000000-0000-4000-8000-000000000001','invitation_baseline_owner'),
 ('c1000000-0000-4000-8000-000000000002','invitation_baseline_recipient');
insert into public.social_circles(id,owner_id,name,slug,join_policy) values
 ('c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','Invitation baseline','invitation-baseline','private');
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',true);
set local role authenticated;
insert into public.social_room_invitations(room_id,invited_user_id,invited_by) values
 ('c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000002',auth.uid());
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000002',true);
do $$ begin
 begin
  update public.social_room_invitations set status='accepted' where room_id='c2000000-0000-4000-8000-000000000001' and invited_user_id=auth.uid();
  raise exception 'BASELINE_REPRO_FAILED';
 exception when insufficient_privilege then
  if position('row-level security policy for table "social_circle_members"' in sqlerrm)=0 then raise; end if;
 end;
 if not exists(select from public.social_room_invitations where room_id='c2000000-0000-4000-8000-000000000001' and status='pending') or
   policy_private.is_room_member('c2000000-0000-4000-8000-000000000001') then raise exception 'BASELINE_ATOMICITY_BROKEN'; end if;
 raise notice 'REPRODUCED: canonical legacy invitation acceptance fails nested member INSERT RLS; invitation stays pending/no membership.';
end $$;
rollback;
