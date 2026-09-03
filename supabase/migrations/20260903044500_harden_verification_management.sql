-- Harden verification management by keeping privileged logic outside the exposed public schema.

begin;

create or replace function private.set_social_verification_privileged(
  p_username text,
  p_verified boolean,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $verification$
declare
  current_uid uuid := auth.uid();
  staff_role text := private.phase29_staff_role();
  normalized_username text := lower(btrim(coalesce(p_username, '')));
  reason text := nullif(btrim(coalesce(p_reason, '')), '');
  profile_row public.social_profiles%rowtype;
begin
  if current_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  if staff_role <> 'senior_reviewer' then
    raise exception 'VERIFICATION_ADMIN_REQUIRED' using errcode = '42501';
  end if;

  if p_verified is null then
    raise exception 'VERIFICATION_STATE_REQUIRED' using errcode = '22023';
  end if;

  if normalized_username !~ '^[a-z0-9][a-z0-9._]{2,29}$' then
    raise exception 'USERNAME_INVALID' using errcode = '22023';
  end if;

  if reason is not null and char_length(reason) > 500 then
    raise exception 'VERIFICATION_REASON_TOO_LONG' using errcode = '22023';
  end if;

  select *
  into profile_row
  from public.social_profiles
  where username = normalized_username
  for update;

  if not found then
    raise exception 'PROFILE_UNAVAILABLE' using errcode = 'P0002';
  end if;

  if profile_row.is_verified = p_verified then
    return jsonb_build_object(
      'status', 'unchanged',
      'user_id', profile_row.id,
      'username', profile_row.username,
      'is_verified', profile_row.is_verified
    );
  end if;

  update public.social_profiles
  set
    is_verified = p_verified,
    updated_at = now()
  where id = profile_row.id;

  insert into private.social_verification_events (
    user_id,
    username_snapshot,
    previous_verified,
    new_verified,
    source,
    actor_id,
    actor_role,
    reason
  )
  values (
    profile_row.id,
    profile_row.username,
    profile_row.is_verified,
    p_verified,
    'staff',
    current_uid,
    staff_role,
    reason
  );

  return jsonb_build_object(
    'status', case when p_verified then 'verified' else 'unverified' end,
    'user_id', profile_row.id,
    'username', profile_row.username,
    'is_verified', p_verified
  );
end;
$verification$;

revoke all on function private.set_social_verification_privileged(text, boolean, text)
  from public, anon, authenticated;
grant execute on function private.set_social_verification_privileged(text, boolean, text)
  to authenticated;

create or replace function public.set_social_verification(
  p_username text,
  p_verified boolean,
  p_reason text default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $verification$
  select private.set_social_verification_privileged(p_username, p_verified, p_reason);
$verification$;

revoke all on function public.set_social_verification(text, boolean, text)
  from public, anon, authenticated;
grant execute on function public.set_social_verification(text, boolean, text)
  to authenticated;

commit;
