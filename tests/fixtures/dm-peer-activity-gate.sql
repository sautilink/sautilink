CREATE OR REPLACE FUNCTION public.dm_peer_activity_bucket_native_phase38(p_peer_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  last_active timestamptz;
begin
  if (select auth.uid()) is null or p_peer_id is null or p_peer_id = (select auth.uid()) then
    return 'hidden';
  end if;
  -- The hardened phase37 migration removed the old topic-access function.
  -- Reproduce the same reciprocal privacy, DM membership and block checks explicitly.
  if not exists (
    select 1 from public.social_member_preferences p
    where p.user_id = (select auth.uid()) and p.activity_status = true
  ) or not exists (
    select 1 from public.social_member_preferences p
    where p.user_id = p_peer_id and p.activity_status = true
  ) or not exists (
    select 1 from public.dm_conversations c
    where ((c.member_one_id = (select auth.uid()) and c.member_two_id = p_peer_id)
       or (c.member_two_id = (select auth.uid()) and c.member_one_id = p_peer_id))
      and not exists (
        select 1 from public.social_blocks b
        where (b.blocker_id = (select auth.uid()) and b.blocked_id = p_peer_id)
           or (b.blocker_id = p_peer_id and b.blocked_id = (select auth.uid()))
      )
  ) then
    return 'hidden';
  end if;
  select activity.last_active_at into last_active
  from private.member_activity_phase37 activity
  where activity.user_id = p_peer_id;
  if last_active is null or last_active < now() - interval '30 days' then
    return 'long_ago';
  elsif last_active >= now() - interval '3 days' then
    return 'recently';
  elsif last_active >= now() - interval '7 days' then
    return 'week';
  else
    return 'month';
  end if;
end;
$function$;
