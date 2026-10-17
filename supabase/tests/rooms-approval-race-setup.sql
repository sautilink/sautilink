-- Disposable local DB only; pair with race-a/b/check. Commits fixed QA fixtures
-- so independent authenticated sessions can race the same pending row.
do $$ begin if current_database() not like 'sautilink_rooms_test%' then raise exception 'LOCAL_TEST_DATABASE_REQUIRED'; end if; end $$;
insert into public.social_profiles(id,username) values
 ('10000000-0000-4000-8000-000000000071','race_owner'),
 ('10000000-0000-4000-8000-000000000073','race_moderator'),
 ('10000000-0000-4000-8000-000000000074','race_author');
insert into public.social_circles(id,owner_id,name,slug,post_approval_required) values
 ('20000000-0000-4000-8000-000000000071','10000000-0000-4000-8000-000000000071','Race QA','race-qa',true);
insert into public.social_circle_members values
 ('20000000-0000-4000-8000-000000000071','10000000-0000-4000-8000-000000000071','owner'),
 ('20000000-0000-4000-8000-000000000071','10000000-0000-4000-8000-000000000073','moderator'),
 ('20000000-0000-4000-8000-000000000071','10000000-0000-4000-8000-000000000074','member');
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000074',false);
select public.room_submit_post_for_review('20000000-0000-4000-8000-000000000071','40000000-0000-4000-8000-000000000071','Concurrent fixture');
reset role;
