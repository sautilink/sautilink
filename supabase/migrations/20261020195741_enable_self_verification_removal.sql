-- Voluntary verification removal is owner-bound and irreversible without a new review.
-- Existing staff revocations retain the permanent username lock.

begin;

create table private.social_verification_removal_receipts (
  request_id uuid primary key,
  user_id uuid not null references public.social_profiles(id) on delete cascade,
  username_snapshot text not null,
  previous_badge_type text not null check (previous_badge_type in ('standard', 'team')),
  previous_username_locked_at timestamptz,
  retired_case_ids uuid[] not null default '{}'::uuid[],
  removal_txid bigint not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index social_verification_removal_receipts_user_idx
  on private.social_verification_removal_receipts (user_id, completed_at desc);

alter table private.social_verification_removal_receipts enable row level security;
revoke all on table private.social_verification_removal_receipts from public, anon, authenticated;

alter table private.social_verification_events
  drop constraint social_verification_events_source_allowed;
alter table private.social_verification_events
  add constraint social_verification_events_source_allowed
  check (source in ('staff', 'operator', 'member_removal'));

-- The pending receipt is written only by the owner-bound helper below. An arbitrary
-- JWT claim, session GUC, direct column write, or old completed receipt cannot unlock.
create or replace function private.apply_permanent_username_lock_on_verification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $lock$
begin
  if tg_op = 'INSERT' then
    if new.is_verified and new.username_locked_at is null then
      new.username_locked_at := now();
    end if;
    return new;
  end if;

  if old.username_locked_at is not null then
    if old.is_verified
       and new.is_verified = false
       and new.username_locked_at is null
       and new.verification_badge_type = 'standard'
       and new.username = old.username
       and auth.uid() = old.id
       and exists (
         select 1
         from private.social_verification_removal_receipts receipt
         where receipt.user_id = old.id
           and receipt.removal_txid = txid_current()
           and receipt.completed_at is null
           and receipt.username_snapshot = old.username
           and receipt.previous_badge_type = old.verification_badge_type
           and receipt.previous_username_locked_at is not distinct from old.username_locked_at
       ) then
      return new;
    end if;
    new.username_locked_at := old.username_locked_at;
  elsif new.is_verified and new.username_locked_at is null then
    new.username_locked_at := now();
  end if;

  return new;
end;
$lock$;

revoke all on function private.apply_permanent_username_lock_on_verification()
  from public, anon, authenticated;

-- The staff console locks a case before its profile. Removal takes the same order.
-- An approval queued on an old case must roll back its profile update as well, so
-- the guard runs inside the existing staff transaction without changing staff ACLs.
create or replace function private.prevent_removed_verification_case_reuse()
returns trigger
language plpgsql
security definer
set search_path = ''
as $case_guard$
begin
  if new.category = 'verification'
     and new.status in ('submitted', 'reviewing', 'action_required', 'approved')
     and exists (
       select 1
       from private.social_verification_removal_receipts receipt
       where receipt.user_id = new.subject_user_id
         and receipt.completed_at is not null
         and new.id = any (receipt.retired_case_ids)
     ) then
    raise exception 'VERIFICATION_CASE_REAPPLICATION_REQUIRED' using errcode = '22023';
  end if;
  return new;
end;
$case_guard$;

revoke all on function private.prevent_removed_verification_case_reuse()
  from public, anon, authenticated;

create trigger prevent_removed_verification_case_reuse
before update of status on public.case_records
for each row execute function private.prevent_removed_verification_case_reuse();

create or replace function private.remove_my_social_verification_privileged(
  p_request_id uuid,
  p_confirmation text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $removal$
declare
  current_uid uuid := auth.uid();
  profile_row public.social_profiles%rowtype;
  receipt_row private.social_verification_removal_receipts%rowtype;
  retired_case_ids uuid[] := '{}'::uuid[];
  case_id_value uuid;
  result_status text := 'removed';
begin
  if current_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if p_request_id is null then
    raise exception 'REQUEST_ID_REQUIRED' using errcode = '22023';
  end if;
  if p_confirmation is distinct from 'remove-verification-v1' then
    raise exception 'VERIFICATION_REMOVAL_CONFIRMATION_REQUIRED' using errcode = '22023';
  end if;

  -- Cases -> social profile -> account profile: compatible with staff case review
  -- and the existing identity RPC's social -> account lock order.
  for case_id_value in
    select item.id
    from public.case_records item
    where item.category = 'verification' and item.subject_user_id = current_uid
    order by item.id
    for update
  loop
    retired_case_ids := array_append(retired_case_ids, case_id_value);
  end loop;

  select * into profile_row
  from public.social_profiles
  where id = current_uid
  for update;
  if not found then
    raise exception 'PROFILE_UNAVAILABLE' using errcode = 'P0002';
  end if;

  select * into receipt_row
  from private.social_verification_removal_receipts
  where request_id = p_request_id;

  if found then
    if receipt_row.user_id <> current_uid then
      raise exception 'REQUEST_ID_REUSED' using errcode = '22023';
    end if;
    if profile_row.is_verified
       or profile_row.username_locked_at is not null
       or profile_row.verification_badge_type <> 'standard'
       or receipt_row.completed_at is null then
      raise exception 'VERIFICATION_REMOVAL_REPLAY_REJECTED' using errcode = '22023';
    end if;
    result_status := 'already_removed';
  else
    if not profile_row.is_verified then
      raise exception 'VERIFICATION_NOT_ACTIVE' using errcode = '22023';
    end if;

    perform id from public.account_profiles where id = current_uid for update;
    if not found then
      raise exception 'PROFILE_UNAVAILABLE' using errcode = 'P0002';
    end if;

    insert into private.social_verification_removal_receipts (
      request_id, user_id, username_snapshot, previous_badge_type,
      previous_username_locked_at, retired_case_ids, removal_txid
    ) values (
      p_request_id, current_uid, profile_row.username, profile_row.verification_badge_type,
      profile_row.username_locked_at, retired_case_ids, txid_current()
    ) on conflict (request_id) do nothing;
    if not found then
      raise exception 'REQUEST_ID_REUSED' using errcode = '22023';
    end if;

    update public.social_profiles
    set is_verified = false,
        verification_badge_type = 'standard',
        username_locked_at = null,
        updated_at = now()
    where id = current_uid;

    insert into private.social_verification_events (
      user_id, username_snapshot, previous_verified, new_verified,
      previous_badge_type, new_badge_type, source, actor_id, actor_role, reason
    ) values (
      current_uid, profile_row.username, true, false,
      profile_row.verification_badge_type, 'standard', 'member_removal', current_uid,
      'member', 'Voluntary removal confirmed by the account owner; future verification requires a new application and is not guaranteed.'
    );

    -- Approved/rejected cases remain historical. A rare active case is cancelled
    -- so the existing full application RPC will not reuse an earlier submission.
    update public.case_records
    set status = 'cancelled', resolved_at = now(), updated_at = now()
    where id = any (retired_case_ids)
      and status in ('submitted', 'reviewing', 'action_required');

    update private.social_verification_removal_receipts
    set completed_at = now()
    where request_id = p_request_id and user_id = current_uid;

    select * into profile_row from public.social_profiles where id = current_uid;
    if profile_row.is_verified or profile_row.username_locked_at is not null then
      raise exception 'VERIFICATION_REMOVAL_FAILED' using errcode = 'P0001';
    end if;
  end if;

  return jsonb_build_object(
    'status', result_status,
    'user_id', current_uid,
    'profile', jsonb_build_object(
      'id', current_uid,
      'username', profile_row.username,
      'display_name', profile_row.display_name,
      'is_verified', false,
      'verification_badge_type', 'standard'
    ),
    'username_unlocked', true
  );
end;
$removal$;

revoke all on function private.remove_my_social_verification_privileged(uuid, text)
  from public, anon, authenticated;
grant execute on function private.remove_my_social_verification_privileged(uuid, text) to authenticated;

create or replace function public.remove_my_social_verification(p_request_id uuid, p_confirmation text)
returns jsonb
language sql
security invoker
set search_path = ''
as $removal$
  select private.remove_my_social_verification_privileged(p_request_id, p_confirmation);
$removal$;

revoke all on function public.remove_my_social_verification(uuid, text) from public, anon, authenticated;
grant execute on function public.remove_my_social_verification(uuid, text) to authenticated;

-- Reject a missing staff role explicitly. Without this null-safe check, a normal
-- member could bypass the new full-reapplication contract through the old setter.
-- This is the live function definition with only that guard changed; ACLs stay intact.
CREATE OR REPLACE FUNCTION private.set_social_verification_privileged_v2(p_username text, p_verified boolean, p_badge_type text DEFAULT NULL::text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  if staff_role is distinct from 'senior_reviewer' then
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
$function$;

-- Historical case outcome and active badge state are separate. Returning the old
-- approved case never grants verification or bypasses full submission validation.
create or replace function public.get_my_verification_case()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $verification$
declare
  current_uid uuid := auth.uid();
  item public.case_records%rowtype;
  reapply_at timestamptz;
  cooldown_days integer;
  active_verified boolean;
  removed_at timestamptz;
begin
  if current_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select is_verified into active_verified
  from public.social_profiles where id = current_uid;

  select * into item
  from public.case_records
  where category = 'verification' and subject_user_id = current_uid
  order by created_at desc, sequence_no desc
  limit 1;
  if not found then return null; end if;

  select max(completed_at) into removed_at
  from private.social_verification_removal_receipts
  where user_id = current_uid and item.id = any (retired_case_ids);

  if item.status = 'rejected' then
    reapply_at := coalesce(item.resolved_at, item.updated_at) + interval '30 days';
    cooldown_days := greatest(0, ceil(extract(epoch from (reapply_at - now())) / 86400.0)::integer);
  end if;

  return jsonb_build_object(
    'case_id', item.id,
    'case_number', 'SL-' || to_char(item.created_at at time zone 'UTC', 'YYYY') || '-' || lpad(item.sequence_no::text, 6, '0'),
    'status', item.status,
    'staff_message', item.metadata ->> 'staff_message',
    'created_at', item.created_at,
    'updated_at', item.updated_at,
    'reapply_available_at', reapply_at,
    'cooldown_days_remaining', case when item.status = 'rejected' then cooldown_days else null end,
    'verification_removed', not coalesce(active_verified, false) and removed_at is not null,
    'verification_removed_at', removed_at,
    'can_reapply', not coalesce(active_verified, false) and case
      when item.status = 'rejected' then now() >= reapply_at
      when removed_at is not null and item.status in ('approved', 'cancelled', 'resolved') then true
      else false
    end
  );
end;
$verification$;

revoke all on function public.get_my_verification_case() from public, anon, authenticated;
grant execute on function public.get_my_verification_case() to authenticated;

commit;
