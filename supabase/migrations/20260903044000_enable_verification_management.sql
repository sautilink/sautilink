-- SautiLink verification management and audit trail.
-- Verification remains server-owned; members cannot self-assign it.

begin;

create table if not exists private.social_verification_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.social_profiles(id) on delete cascade,
  username_snapshot text not null,
  previous_verified boolean not null,
  new_verified boolean not null,
  source text not null,
  actor_id uuid references public.social_profiles(id) on delete set null,
  actor_role text,
  reason text,
  created_at timestamptz not null default now(),
  constraint social_verification_events_state_changed
    check (previous_verified is distinct from new_verified),
  constraint social_verification_events_source_allowed
    check (source = any (array['staff'::text, 'operator'::text])),
  constraint social_verification_events_username_length
    check (char_length(username_snapshot) between 3 and 30),
  constraint social_verification_events_reason_length
    check (reason is null or char_length(reason) <= 500)
);

create index if not exists social_verification_events_user_time_idx
  on private.social_verification_events (user_id, created_at desc, id desc);

revoke all on table private.social_verification_events from public, anon, authenticated;

create or replace function public.set_social_verification(
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

revoke all on function public.set_social_verification(text, boolean, text) from public, anon, authenticated;
grant execute on function public.set_social_verification(text, boolean, text) to authenticated;

commit;
