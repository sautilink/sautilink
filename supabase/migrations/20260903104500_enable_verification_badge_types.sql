-- Add official SautiLink verification badge classes while keeping badge assignment server-controlled.

begin;

alter table public.social_profiles
  add column if not exists verification_badge_type text not null default 'standard';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.social_profiles'::regclass
      and conname = 'social_profiles_verification_badge_type_allowed'
  ) then
    alter table public.social_profiles
      add constraint social_profiles_verification_badge_type_allowed
      check (verification_badge_type = any (array['standard'::text, 'team'::text]));
  end if;
end $$;

revoke update (verification_badge_type) on public.social_profiles from anon, authenticated;

alter table private.social_verification_events
  add column if not exists previous_badge_type text not null default 'standard',
  add column if not exists new_badge_type text not null default 'standard';

alter table private.social_verification_events
  drop constraint if exists social_verification_events_state_changed;

alter table private.social_verification_events
  add constraint social_verification_events_state_changed
  check (
    previous_verified is distinct from new_verified
    or previous_badge_type is distinct from new_badge_type
  );

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'private.social_verification_events'::regclass
      and conname = 'social_verification_events_badge_types_allowed'
  ) then
    alter table private.social_verification_events
      add constraint social_verification_events_badge_types_allowed
      check (
        previous_badge_type = any (array['standard'::text, 'team'::text])
        and new_badge_type = any (array['standard'::text, 'team'::text])
      );
  end if;
end $$;

create or replace function private.set_social_verification_privileged_v2(
  p_username text,
  p_verified boolean,
  p_badge_type text default null,
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
  requested_badge_type text := nullif(lower(btrim(coalesce(p_badge_type, ''))), '');
  reason text := nullif(btrim(coalesce(p_reason, '')), '');
  profile_row public.social_profiles%rowtype;
  next_badge_type text;
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

  if p_verified then
    next_badge_type := coalesce(
      requested_badge_type,
      case when profile_row.is_verified then profile_row.verification_badge_type else 'standard' end
    );
  else
    next_badge_type := 'standard';
  end if;

  if next_badge_type <> all (array['standard'::text, 'team'::text]) then
    raise exception 'VERIFICATION_BADGE_TYPE_INVALID' using errcode = '22023';
  end if;

  if profile_row.is_verified = p_verified
     and profile_row.verification_badge_type = next_badge_type then
    return jsonb_build_object(
      'status', 'unchanged',
      'user_id', profile_row.id,
      'username', profile_row.username,
      'is_verified', profile_row.is_verified,
      'badge_type', profile_row.verification_badge_type
    );
  end if;

  update public.social_profiles
  set
    is_verified = p_verified,
    verification_badge_type = next_badge_type,
    updated_at = now()
  where id = profile_row.id;

  insert into private.social_verification_events (
    user_id,
    username_snapshot,
    previous_verified,
    new_verified,
    previous_badge_type,
    new_badge_type,
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
    profile_row.verification_badge_type,
    next_badge_type,
    'staff',
    current_uid,
    staff_role,
    reason
  );

  return jsonb_build_object(
    'status', case
      when not p_verified then 'unverified'
      when next_badge_type = 'team' then 'verified_team'
      else 'verified'
    end,
    'user_id', profile_row.id,
    'username', profile_row.username,
    'is_verified', p_verified,
    'badge_type', next_badge_type
  );
end;
$verification$;

revoke all on function private.set_social_verification_privileged_v2(text, boolean, text, text)
  from public, anon, authenticated;
grant execute on function private.set_social_verification_privileged_v2(text, boolean, text, text)
  to authenticated;

create or replace function private.set_social_verification_privileged(
  p_username text,
  p_verified boolean,
  p_reason text default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $verification$
  select private.set_social_verification_privileged_v2(
    p_username,
    p_verified,
    null,
    p_reason
  );
$verification$;

revoke all on function private.set_social_verification_privileged(text, boolean, text)
  from public, anon, authenticated;
grant execute on function private.set_social_verification_privileged(text, boolean, text)
  to authenticated;

create or replace function public.set_social_verification_badge(
  p_username text,
  p_verified boolean,
  p_badge_type text default 'standard',
  p_reason text default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $verification$
  select private.set_social_verification_privileged_v2(
    p_username,
    p_verified,
    p_badge_type,
    p_reason
  );
$verification$;

revoke all on function public.set_social_verification_badge(text, boolean, text, text)
  from public, anon, authenticated;
grant execute on function public.set_social_verification_badge(text, boolean, text, text)
  to authenticated;

commit;
