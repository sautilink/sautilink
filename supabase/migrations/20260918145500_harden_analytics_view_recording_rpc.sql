begin;

-- INSERT ... ON CONFLICT requires read access to the conflict target and clashes
-- with our intentional no-SELECT-policy privacy boundary. Keep these RPCs as
-- security-invoker functions so existing RLS remains authoritative, and dedupe
-- by catching the unique constraint instead of reading viewer rows.
revoke select on table public.social_post_views from authenticated;
revoke select on table public.social_profile_views from authenticated;

grant insert on table public.social_post_views to authenticated;
grant insert on table public.social_profile_views to authenticated;

create or replace function public.record_social_post_view(target_post_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $record_post_view$
begin
  if (select auth.uid()) is null then
    return false;
  end if;

  begin
    insert into public.social_post_views (post_id, viewer_id)
    values (target_post_id, (select auth.uid()));
    return true;
  exception
    when unique_violation then
      return false;
  end;
end;
$record_post_view$;

revoke all on function public.record_social_post_view(uuid) from public, anon;
grant execute on function public.record_social_post_view(uuid) to authenticated, service_role;

create or replace function public.record_social_profile_view(target_username text)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $record_profile_view$
declare
  target_id uuid;
begin
  if (select auth.uid()) is null then
    return false;
  end if;

  select profile.id into target_id
  from public.social_profiles profile
  where profile.username = lower(btrim(target_username))
    and profile.is_discoverable = true
  limit 1;

  if target_id is null or target_id = (select auth.uid()) then
    return false;
  end if;

  begin
    insert into public.social_profile_views (profile_id, viewer_id, viewed_on)
    values (target_id, (select auth.uid()), current_date);
    return true;
  exception
    when unique_violation then
      return false;
  end;
end;
$record_profile_view$;

revoke all on function public.record_social_profile_view(text) from public, anon;
grant execute on function public.record_social_profile_view(text) to authenticated, service_role;

comment on function public.record_social_post_view(uuid) is
  'Records one unique authenticated non-author post view through existing RLS; duplicate viewers return false without exposing viewer rows.';
comment on function public.record_social_profile_view(text) is
  'Records at most one authenticated non-owner profile view per viewer, profile and day through existing RLS; duplicate viewers return false.';

commit;
