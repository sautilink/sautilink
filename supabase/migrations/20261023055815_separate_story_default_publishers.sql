-- Badge artwork/classification is not authority to broadcast Stories globally.
begin;
create table private.story_default_publishers (
  user_id uuid primary key references public.social_profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table private.story_default_publishers enable row level security;
alter table private.story_default_publishers force row level security;
revoke all on table private.story_default_publishers from public, anon, authenticated;
grant usage on schema private to service_role;
grant select, insert, delete on table private.story_default_publishers to service_role;
comment on table private.story_default_publishers is
  'Server-managed default Story discovery publishers. No client grants or badge-driven automatic enrolment.';

-- Preserve precisely the previously eligible verified-team publishers at this
-- migration boundary. Future orange badges never add registry membership.
insert into private.story_default_publishers(user_id)
select id from public.social_profiles where is_verified and verification_badge_type = 'team';

create or replace function private.stories_feed_v1(p_username text default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_user uuid:=private.story_current_user(); v_result jsonb;
begin
  select coalesce(jsonb_agg(item.payload order by item.own desc,item.published_at desc,item.id),'[]'::jsonb) into v_result from (
    select s.id,s.owner_id=v_user as own,s.published_at,private.story_project(s.id,v_user) as payload from private.stories s
    join public.social_profiles p on p.id=s.owner_id
    where s.status='published' and s.deleted_at is null and s.expires_at>now() and private.story_can_view(s.owner_id,v_user)
      and not exists(select 1 from public.social_mutes m where m.muter_id=v_user and m.muted_id=s.owner_id)
      and ((p_username is not null and p.username=lower(btrim(p_username))) or (p_username is null and
        (s.owner_id=v_user or (p.is_verified and exists(select 1 from private.story_default_publishers publisher where publisher.user_id=p.id))
          or exists(select 1 from public.social_follows f where f.follower_id=v_user and f.followed_id=s.owner_id))))
    order by (s.owner_id=v_user) desc,s.published_at desc,s.id limit 600
  ) item;
  return v_result;
end;
$$;
-- CREATE OR REPLACE retains the existing authenticated-only function ACL.
-- Public Story visibility, direct/profile reads and all asset RLS stay unchanged.
commit;
