-- Extend the narrow approval fixture before loading whole existing Rooms and
-- invitation migrations plus exact canonical join-request definitions.
do $$ begin if current_database() not like 'sautilink_rooms_test%' then raise exception 'LOCAL_TEST_DATABASE_REQUIRED'; end if; end $$;
alter table public.social_circles add column description text default '',
 add column join_policy text not null default 'open',add column created_at timestamptz not null default now();
create table public.social_circle_join_requests (
 circle_id uuid not null references public.social_circles(id) on delete cascade,
 requester_id uuid not null references public.social_profiles(id) on delete cascade,
 status text not null default 'pending',created_at timestamptz not null default now(),decided_at timestamptz,
 primary key(circle_id,requester_id),
 constraint social_circle_join_requests_status_allowed check(status in('pending','approved','declined')),
 constraint social_circle_join_requests_decision_consistency check((status='pending' and decided_at is null) or (status in('approved','declined') and decided_at is not null))
);
alter table public.social_circle_join_requests enable row level security;
alter table public.social_circle_join_requests force row level security;
alter table public.social_circle_members force row level security;
alter table public.social_circles force row level security;
drop policy rooms_read on public.social_circles;
drop policy rooms_settings on public.social_circles;
grant select,insert,delete on public.social_circles,public.social_circle_members,public.social_circle_join_requests to authenticated;
grant update(status) on public.social_circle_join_requests to authenticated;
grant delete on public.social_posts to authenticated;
create policy social_posts_delete_phase16_own on public.social_posts for delete to authenticated using(author_id=auth.uid());
