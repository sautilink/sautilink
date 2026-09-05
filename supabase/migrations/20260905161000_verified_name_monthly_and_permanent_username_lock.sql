-- Verified identity policy: direct display-name changes twice per calendar month,
-- plus a permanent username lock once an account has ever been verified.

begin;

alter table public.social_profiles
  add column if not exists username_locked_at timestamptz;

comment on column public.social_profiles.username_locked_at is
  'Server-owned permanent username lock. Once set after verification, the username cannot be changed again.';

revoke update (username_locked_at) on table public.social_profiles from anon, authenticated;
grant select (username_locked_at) on table public.social_profiles to authenticated;

-- Existing verified accounts become locked immediately.
update public.social_profiles
set username_locked_at = coalesce(username_locked_at, now())
where is_verified = true
  and username_locked_at is null;

-- Verified names no longer use the review queue.
update public.social_identity_change_requests
set
  status = 'cancelled',
  updated_at = now()
where status = 'pending';

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
    new.username_locked_at := old.username_locked_at;
  elsif new.is_verified and new.username_locked_at is null then
    new.username_locked_at := now();
  end if;

  return new;
end;
$lock$;

revoke all on function private.apply_permanent_username_lock_on_verification()
  from public, anon, authenticated;

drop trigger if exists social_profiles_lock_username_on_verification_insert on public.social_profiles;
create trigger social_profiles_lock_username_on_verification_insert
before insert on public.social_profiles
for each row execute function private.apply_permanent_username_lock_on_verification();

drop trigger if exists social_profiles_lock_username_on_verification_update on public.social_profiles;
create trigger social_profiles_lock_username_on_verification_update
before update of is_verified, username_locked_at on public.social_profiles
for each row execute function private.apply_permanent_username_lock_on_verification();

create or replace function private.prevent_locked_social_username_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $guard$
begin
  if new.username is distinct from old.username
     and (old.username_locked_at is not null or new.is_verified) then
    raise exception 'USERNAME_LOCKED_VERIFIED' using errcode = 'P0001';
  end if;
  return new;
end;
$guard$;

revoke all on function private.prevent_locked_social_username_change()
  from public, anon, authenticated;

drop trigger if exists social_profiles_prevent_locked_username_change on public.social_profiles;
create trigger social_profiles_prevent_locked_username_change
before update of username on public.social_profiles
for each row execute function private.prevent_locked_social_username_change();

create or replace function private.prevent_locked_account_username_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $guard$
begin
  if new.username is distinct from old.username
     and exists (
       select 1
       from public.social_profiles profile
       where profile.id = old.id
         and (profile.username_locked_at is not null or profile.is_verified)
     ) then
    raise exception 'USERNAME_LOCKED_VERIFIED' using errcode = 'P0001';
  end if;
  return new;
end;
$guard$;

revoke all on function private.prevent_locked_account_username_change()
  from public, anon, authenticated;

drop trigger if exists account_profiles_prevent_locked_username_change on public.account_profiles;
create trigger account_profiles_prevent_locked_username_change
before update of username on public.account_profiles
for each row execute function private.prevent_locked_account_username_change();

create or replace function private.change_social_identity_privileged(
  p_change_type text,
  p_value text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $identity$
declare
  current_uid uuid := auth.uid();
  profile_row public.social_profiles%rowtype;
  normalized_type text := lower(btrim(coalesce(p_change_type, '')));
  normalized_value text := btrim(coalesce(p_value, ''));
  recent_count integer := 0;
  month_start timestamptz := date_trunc('month', now());
  next_month_start timestamptz := date_trunc('month', now()) + interval '1 month';
begin
  if current_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  if p_request_id is null then
    raise exception 'REQUEST_ID_REQUIRED' using errcode = '22023';
  end if;

  select *
  into profile_row
  from public.social_profiles
  where id = current_uid
  for update;

  if not found then
    raise exception 'PROFILE_UNAVAILABLE' using errcode = 'P0002';
  end if;

  if normalized_type = 'display_name' then
    if char_length(normalized_value) < 1 or char_length(normalized_value) > 80 then
      raise exception 'DISPLAY_NAME_INVALID' using errcode = '22023';
    end if;

    if normalized_value = profile_row.display_name then
      return jsonb_build_object(
        'status', 'unchanged',
        'change_type', 'display_name',
        'display_name', profile_row.display_name,
        'username', profile_row.username,
        'is_verified', profile_row.is_verified
      );
    end if;

    if profile_row.is_verified then
      select count(*)::integer
      into recent_count
      from public.social_identity_change_events
      where user_id = current_uid
        and change_type = 'display_name'
        and changed_at >= month_start
        and changed_at < next_month_start;

      if recent_count >= 2 then
        raise exception 'VERIFIED_DISPLAY_NAME_MONTHLY_LIMIT' using errcode = 'P0001';
      end if;

      update public.social_profiles
      set display_name = normalized_value
      where id = current_uid;

      update public.account_profiles
      set full_name = normalized_value
      where id = current_uid;

      insert into public.social_identity_change_events (
        user_id, change_type, old_value, new_value, source, request_id
      )
      values (
        current_uid, 'display_name', profile_row.display_name, normalized_value, 'member', p_request_id
      );

      return jsonb_build_object(
        'status', 'changed',
        'change_type', 'display_name',
        'display_name', normalized_value,
        'username', profile_row.username,
        'is_verified', true,
        'remaining_in_month', 1 - recent_count,
        'next_month_starts_at', next_month_start
      );
    end if;

    select count(*)::integer
    into recent_count
    from public.social_identity_change_events
    where user_id = current_uid
      and change_type = 'display_name'
      and changed_at > now() - interval '14 days';

    if recent_count >= 2 then
      raise exception 'DISPLAY_NAME_CHANGE_LIMIT' using errcode = 'P0001';
    end if;

    update public.social_profiles
    set display_name = normalized_value
    where id = current_uid;

    update public.account_profiles
    set full_name = normalized_value
    where id = current_uid;

    insert into public.social_identity_change_events (
      user_id, change_type, old_value, new_value, source, request_id
    )
    values (
      current_uid, 'display_name', profile_row.display_name, normalized_value, 'member', p_request_id
    );

    return jsonb_build_object(
      'status', 'changed',
      'change_type', 'display_name',
      'display_name', normalized_value,
      'username', profile_row.username,
      'is_verified', false,
      'remaining_in_14_days', 1 - recent_count
    );
  end if;

  if normalized_type = 'username' then
    normalized_value := lower(normalized_value);

    if normalized_value !~ '^[a-z0-9][a-z0-9._]{2,29}$' then
      raise exception 'USERNAME_INVALID' using errcode = '22023';
    end if;

    if normalized_value = any (array[
      'admin','administrator','root','support','security','sautilink','cloudengine',
      'official','api','help','about','settings','login','signup','account','privacy',
      'terms','contact','waitlist'
    ]) then
      raise exception 'USERNAME_RESERVED' using errcode = '22023';
    end if;

    if normalized_value = profile_row.username then
      return jsonb_build_object(
        'status', 'unchanged',
        'change_type', 'username',
        'display_name', profile_row.display_name,
        'username', profile_row.username,
        'is_verified', profile_row.is_verified
      );
    end if;

    if profile_row.username_locked_at is not null or profile_row.is_verified then
      raise exception 'USERNAME_LOCKED_VERIFIED' using errcode = 'P0001';
    end if;

    select count(*)::integer
    into recent_count
    from public.social_identity_change_events
    where user_id = current_uid
      and change_type = 'username'
      and changed_at > now() - interval '30 days';

    if recent_count >= 1 then
      raise exception 'USERNAME_CHANGE_LIMIT' using errcode = 'P0001';
    end if;

    begin
      update public.account_profiles
      set username = normalized_value
      where id = current_uid;
    exception
      when unique_violation then
        raise exception 'USERNAME_TAKEN' using errcode = '23505';
      when check_violation then
        raise exception 'USERNAME_INVALID' using errcode = '22023';
    end;

    insert into public.social_identity_change_events (
      user_id, change_type, old_value, new_value, source, request_id
    )
    values (
      current_uid, 'username', profile_row.username, normalized_value, 'member', p_request_id
    );

    return jsonb_build_object(
      'status', 'changed',
      'change_type', 'username',
      'display_name', profile_row.display_name,
      'username', normalized_value,
      'is_verified', profile_row.is_verified,
      'next_username_change_at', now() + interval '30 days'
    );
  end if;

  raise exception 'IDENTITY_CHANGE_TYPE_INVALID' using errcode = '22023';
end;
$identity$;

revoke all on function private.change_social_identity_privileged(text, text, uuid)
  from public, anon, authenticated;
grant execute on function private.change_social_identity_privileged(text, text, uuid)
  to authenticated;

create or replace function public.change_social_identity(
  p_change_type text,
  p_value text,
  p_request_id uuid
)
returns jsonb
language sql
security invoker
set search_path = ''
as $identity$
  select private.change_social_identity_privileged(
    p_change_type,
    p_value,
    p_request_id
  );
$identity$;

revoke all on function public.change_social_identity(text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.change_social_identity(text, text, uuid)
  to authenticated;

commit;
