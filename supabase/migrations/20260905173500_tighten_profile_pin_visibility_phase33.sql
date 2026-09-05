create or replace function private.profile_activity_candidate_ids_phase33(p_target uuid, p_kind text)
returns table(post_id uuid, activity_at timestamptz, pin_position smallint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_viewer uuid := auth.uid();
begin
  if v_viewer is null or p_target is null then
    return;
  end if;

  if p_kind = 'likes' then
    if not private.profile_activity_allowed_phase33(p_target, 'likes') then return; end if;
    return query
      select reaction.post_id, reaction.created_at, null::smallint
      from public.social_post_reactions reaction
      where reaction.user_id = p_target
        and reaction.reaction_type = 'like';
  elsif p_kind = 'saves' then
    if not private.profile_activity_allowed_phase33(p_target, 'saves') then return; end if;
    return query
      select saved.post_id, saved.saved_at, null::smallint
      from public.social_saved_posts saved
      where saved.user_id = p_target;
  elsif p_kind = 'pins' then
    if v_viewer <> p_target then
      if not exists (
        select 1 from public.social_profiles target
        where target.id = p_target and target.is_discoverable = true
      ) then return; end if;

      if exists (
        select 1 from public.social_blocks block
        where (block.blocker_id = v_viewer and block.blocked_id = p_target)
           or (block.blocker_id = p_target and block.blocked_id = v_viewer)
      ) then return; end if;
    end if;

    return query
      select pin.post_id, pin.created_at, pin.position
      from public.social_profile_pins pin
      where pin.user_id = p_target;
  end if;
end;
$$;
