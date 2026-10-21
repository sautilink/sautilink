-- Disposable local PostgreSQL fixture data, loaded BEFORE the admission migration.
-- Never execute against a hosted project.
do $$ begin
  if current_setting('sautilink.security_test_fixture', true) is distinct from 'rooms-v1' then
    raise exception 'LOCAL_SECURITY_FIXTURE_REQUIRED';
  end if;
end $$;

insert into public.social_profiles(id,username)
select ('d1000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'admission_security_fixture_'||i
from generate_series(1,10)i;
insert into public.social_circles(id,owner_id,name,slug,join_policy)
select ('d2000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
'd1000000-0000-4000-8000-000000000001','Admission security fixture '||i,'admission-security-fixture-'||i,
case i when 2 then 'approval' when 3 then 'open' else 'private' end
from generate_series(1,5)i;
insert into public.social_circle_members(circle_id,member_id,member_role) values
('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000002','member'),
('d2000000-0000-4000-8000-000000000005','d1000000-0000-4000-8000-000000000005','admin'),
('d2000000-0000-4000-8000-000000000005','d1000000-0000-4000-8000-000000000006','moderator'),
('d2000000-0000-4000-8000-000000000005','d1000000-0000-4000-8000-000000000007','member');
insert into public.social_room_invitations(room_id,invited_user_id,invited_by,status,created_at,decided_at) values
('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000002','d1000000-0000-4000-8000-000000000001','accepted','2026-10-01 08:00Z','2026-10-01 09:00Z'),
('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000003','d1000000-0000-4000-8000-000000000001','accepted','2026-10-01 08:00Z','2026-10-01 09:00Z');

