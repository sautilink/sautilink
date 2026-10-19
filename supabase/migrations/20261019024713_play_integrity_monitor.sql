-- Play Integrity monitoring only. No application authorization policy reads these tables.
-- Root will place this SQL in a CLI-generated migration after review.
begin;

create schema if not exists play_integrity_private;
revoke all on schema play_integrity_private from public, anon;
grant usage on schema play_integrity_private to authenticated, service_role;

create or replace function play_integrity_private.valid_summary_v1(p_summary jsonb)
returns boolean language plpgsql immutable security invoker set search_path = ''
as $validation$
begin
  if p_summary is null or jsonb_typeof(p_summary) <> 'object' or octet_length(p_summary::text) > 2048 then
    return false;
  end if;
  if p_summary->>'outcome' in ('binding_failed', 'google_unavailable', 'token_rejected') then
    return p_summary - 'outcome' = '{}'::jsonb;
  end if;
  if p_summary->>'outcome' is distinct from 'observed'
     or not p_summary ?& array['outcome', 'app_recognition', 'certificate_match', 'version_match', 'licensing', 'device_recognition']
     or p_summary - array['outcome', 'app_recognition', 'certificate_match', 'version_match', 'app_version_code', 'licensing', 'device_recognition'] <> '{}'::jsonb
     or jsonb_typeof(p_summary->'app_recognition') is distinct from 'string'
     or jsonb_typeof(p_summary->'licensing') is distinct from 'string'
     or p_summary->>'app_recognition' not in ('PLAY_RECOGNIZED', 'UNRECOGNIZED_VERSION', 'UNEVALUATED')
     or p_summary->>'licensing' not in ('LICENSED', 'UNLICENSED', 'UNEVALUATED')
     or jsonb_typeof(p_summary->'certificate_match') is distinct from 'boolean'
     or jsonb_typeof(p_summary->'version_match') is distinct from 'boolean'
     or jsonb_typeof(p_summary->'device_recognition') is distinct from 'array' then
    return false;
  end if;
  if jsonb_array_length(p_summary->'device_recognition') > 4 or exists (
    select 1 from jsonb_array_elements(p_summary->'device_recognition') label
    where jsonb_typeof(label) is distinct from 'string'
       or label #>> '{}' not in ('MEETS_BASIC_INTEGRITY', 'MEETS_DEVICE_INTEGRITY', 'MEETS_STRONG_INTEGRITY', 'MEETS_VIRTUAL_INTEGRITY')
  ) then return false; end if;
  if p_summary ? 'app_version_code' then
    if jsonb_typeof(p_summary->'app_version_code') is distinct from 'number'
       or (p_summary->>'app_version_code') !~ '^[1-9][0-9]{0,9}$' then return false; end if;
    if (p_summary->>'app_version_code')::bigint > 2100000000 then return false; end if;
  end if;
  return true;
end;
$validation$;
revoke all on function play_integrity_private.valid_summary_v1(jsonb) from public, anon, authenticated;
grant execute on function play_integrity_private.valid_summary_v1(jsonb) to service_role;

create table if not exists play_integrity_private.monitor_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  session_id uuid,
  challenge_id uuid,
  version_code integer check (version_code between 1 and 2100000000),
  issued_at timestamptz,
  expires_at timestamptz,
  consumed_at timestamptz,
  recorded_at timestamptz,
  counter_day date not null,
  issued_count integer not null default 0 check (issued_count between 0 and 12),
  observed_count integer not null default 0 check (observed_count between 0 and 12),
  invalid_count integer not null default 0 check (invalid_count between 0 and 12),
  unavailable_count integer not null default 0 check (unavailable_count between 0 and 12),
  last_sample_at timestamptz,
  last_summary jsonb check (last_summary is null or play_integrity_private.valid_summary_v1(last_summary)),
  last_activity_at timestamptz not null default now(),
  check (expires_at is null or (issued_at is not null and expires_at = issued_at + interval '5 minutes')),
  check (observed_count + invalid_count + unavailable_count <= issued_count)
);

create table if not exists play_integrity_private.daily_budget (
  singleton boolean primary key default true check (singleton),
  counter_day date not null,
  issued_count integer not null default 0 check (issued_count between 0 and 8000)
);
insert into play_integrity_private.daily_budget (singleton, counter_day)
values (true, (now() at time zone 'UTC')::date) on conflict (singleton) do nothing;

alter table play_integrity_private.monitor_state enable row level security;
alter table play_integrity_private.monitor_state force row level security;
alter table play_integrity_private.daily_budget enable row level security;
alter table play_integrity_private.daily_budget force row level security;
revoke all on table play_integrity_private.monitor_state, play_integrity_private.daily_budget from public, anon, authenticated;
grant select, insert, update, delete on table play_integrity_private.monitor_state, play_integrity_private.daily_budget to service_role;
create index if not exists monitor_state_expiry_idx on play_integrity_private.monitor_state (last_activity_at);

-- Only verified, non-anonymous users with a live owned session may issue or consume.
-- This runs under the ORIGINAL user JWT; no account/session argument is trusted.
create or replace function play_integrity_private.identity_v1()
returns table (user_id uuid, session_id uuid)
language plpgsql stable security definer set search_path = ''
as $identity$
declare
  v_user uuid := auth.uid();
  v_claims jsonb := auth.jwt();
  v_session_text text := v_claims->>'session_id';
  v_session uuid;
begin
  if v_user is null or v_claims->>'role' is distinct from 'authenticated'
     or coalesce(v_claims->>'is_anonymous', 'false') <> 'false'
     or v_session_text is null
     or v_session_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  v_session := v_session_text::uuid;
  if not exists (
    select 1 from auth.sessions s join auth.users u on u.id = s.user_id
    where s.id = v_session and s.user_id = v_user
      and (s.not_after is null or s.not_after > now())
      and not coalesce(u.is_anonymous, false)
      and (u.banned_until is null or u.banned_until <= now())
      and u.deleted_at is null
  ) then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  return query select v_user, v_session;
end;
$identity$;
revoke all on function play_integrity_private.identity_v1() from public, anon, authenticated;

create or replace function play_integrity_private.begin_observation_v1(p_version_code integer)
returns jsonb language plpgsql security definer set search_path = ''
as $begin_observation$
declare
  v_identity record;
  v_state play_integrity_private.monitor_state%rowtype;
  v_budget play_integrity_private.daily_budget%rowtype;
  v_now timestamptz := clock_timestamp();
  v_day date := (v_now at time zone 'UTC')::date;
  v_id uuid;
  v_retry integer;
begin
  select * into strict v_identity from play_integrity_private.identity_v1();
  if p_version_code is null or p_version_code not between 1 and 2100000000 then
    raise exception 'Invalid version' using errcode = '22023';
  end if;

  -- Global-before-user lock ordering is shared by every issue, across isolates.
  select * into strict v_budget from play_integrity_private.daily_budget where singleton for update;
  -- A request may have waited for this lock across UTC midnight.
  v_now := clock_timestamp();
  v_day := (v_now at time zone 'UTC')::date;
  if v_budget.counter_day <> v_day then
    update play_integrity_private.daily_budget set counter_day = v_day, issued_count = 0 where singleton;
    v_budget.issued_count := 0;
  end if;
  v_retry := greatest(1, ceil(extract(epoch from (((v_day + 1)::timestamp at time zone 'UTC') - v_now)))::integer);
  if v_budget.issued_count >= 8000 then
    return jsonb_build_object('status', 'rate_limited', 'retry_after_seconds', v_retry);
  end if;
  insert into play_integrity_private.monitor_state (user_id, counter_day)
  values (v_identity.user_id, v_day) on conflict (user_id) do nothing;
  select * into strict v_state from play_integrity_private.monitor_state where user_id = v_identity.user_id for update;
  if v_state.issued_at is not null and v_state.issued_at > v_now - interval '10 minutes' then
    return jsonb_build_object('status', 'rate_limited', 'retry_after_seconds',
      greatest(1, ceil(extract(epoch from (v_state.issued_at + interval '10 minutes' - v_now)))::integer));
  end if;
  if v_state.counter_day = v_day and v_state.issued_count >= 12 then
    return jsonb_build_object('status', 'rate_limited', 'retry_after_seconds', v_retry);
  end if;

  v_id := gen_random_uuid();
  update play_integrity_private.monitor_state set
    session_id = v_identity.session_id, challenge_id = v_id, version_code = p_version_code,
    issued_at = v_now, expires_at = v_now + interval '5 minutes', consumed_at = null, recorded_at = null,
    counter_day = v_day,
    issued_count = case when v_state.counter_day = v_day then v_state.issued_count + 1 else 1 end,
    observed_count = case when v_state.counter_day = v_day then v_state.observed_count else 0 end,
    invalid_count = case when v_state.counter_day = v_day then v_state.invalid_count else 0 end,
    unavailable_count = case when v_state.counter_day = v_day then v_state.unavailable_count else 0 end,
    last_activity_at = v_now
  where user_id = v_identity.user_id;
  update play_integrity_private.daily_budget set issued_count = issued_count + 1 where singleton;
  return jsonb_build_object(
    'status', 'ready', 'challenge_id', v_id, 'version_code', p_version_code,
    'issued_at_ms', floor(extract(epoch from v_now) * 1000)::bigint,
    'expires_at_ms', floor(extract(epoch from (v_now + interval '5 minutes')) * 1000)::bigint
  );
end;
$begin_observation$;

create or replace function play_integrity_private.consume_observation_v1(p_challenge_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $consume_observation$
declare
  v_identity record;
  v_state play_integrity_private.monitor_state%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  select * into strict v_identity from play_integrity_private.identity_v1();
  select * into v_state from play_integrity_private.monitor_state
  where user_id = v_identity.user_id for update;
  v_now := clock_timestamp();
  if not found or v_state.session_id is distinct from v_identity.session_id
     or v_state.challenge_id is distinct from p_challenge_id
     or v_state.consumed_at is not null or v_state.expires_at is null
     or v_state.expires_at <= v_now or v_state.issued_at > v_now then
    return jsonb_build_object('status', 'invalid_challenge');
  end if;
  update play_integrity_private.monitor_state set consumed_at = v_now, last_activity_at = v_now
  where user_id = v_identity.user_id and session_id = v_identity.session_id
    and challenge_id = p_challenge_id and consumed_at is null and expires_at > v_now
    and issued_at <= v_now
  returning * into v_state;
  if not found then return jsonb_build_object('status', 'invalid_challenge'); end if;
  return jsonb_build_object(
    'status', 'ready', 'challenge_id', v_state.challenge_id, 'version_code', v_state.version_code,
    'issued_at_ms', floor(extract(epoch from v_state.issued_at) * 1000)::bigint,
    'expires_at_ms', floor(extract(epoch from v_state.expires_at) * 1000)::bigint
  );
end;
$consume_observation$;

revoke all on function play_integrity_private.begin_observation_v1(integer), play_integrity_private.consume_observation_v1(uuid) from public, anon;
grant execute on function play_integrity_private.begin_observation_v1(integer), play_integrity_private.consume_observation_v1(uuid) to authenticated;

-- The exposed wrappers do not run with owner privileges. The private helpers
-- enforce auth.uid(), real user/session ownership and all atomic limits.
create or replace function public.begin_play_integrity_observation_v1(p_version_code integer)
returns jsonb language sql security invoker set search_path = ''
as $$ select play_integrity_private.begin_observation_v1(p_version_code); $$;
create or replace function public.consume_play_integrity_observation_v1(p_challenge_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select play_integrity_private.consume_observation_v1(p_challenge_id); $$;
revoke all on function public.begin_play_integrity_observation_v1(integer), public.consume_play_integrity_observation_v1(uuid) from public, anon;
grant execute on function public.begin_play_integrity_observation_v1(integer), public.consume_play_integrity_observation_v1(uuid) to authenticated;

-- Only the server records a fully sanitized result after Google decrypts a token.
create or replace function public.record_play_integrity_observation_v1(
  p_user_id uuid, p_session_id uuid, p_challenge_id uuid, p_summary jsonb
)
returns boolean language plpgsql security invoker set search_path = ''
as $record_observation$
declare v_changed integer;
begin
  if not play_integrity_private.valid_summary_v1(p_summary) then
    raise exception 'Invalid observation summary' using errcode = '22023';
  end if;
  update play_integrity_private.monitor_state set
    recorded_at = clock_timestamp(), last_sample_at = clock_timestamp(), last_summary = p_summary,
    observed_count = observed_count + case when p_summary->>'outcome' = 'observed' then 1 else 0 end,
    invalid_count = invalid_count + case when p_summary->>'outcome' in ('binding_failed', 'token_rejected') then 1 else 0 end,
    unavailable_count = unavailable_count + case when p_summary->>'outcome' = 'google_unavailable' then 1 else 0 end,
    last_activity_at = clock_timestamp()
  where user_id = p_user_id and session_id = p_session_id and challenge_id = p_challenge_id
    and consumed_at is not null and recorded_at is null
    and consumed_at >= clock_timestamp() - interval '2 minutes';
  get diagnostics v_changed = row_count;
  return v_changed = 1;
end;
$record_observation$;
revoke all on function public.record_play_integrity_observation_v1(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_play_integrity_observation_v1(uuid, uuid, uuid, jsonb) to service_role;

-- There is no event history. Latest observations expire after 30 days; daily
-- cleanup removes their physical rows/fields within 31 days. User deletion
-- cascades immediately. Counters cover one UTC day, not lifetime activity.
create or replace function play_integrity_private.expire_observations_v1()
returns void language sql security invoker set search_path = ''
as $expire_observations$
  delete from play_integrity_private.monitor_state where last_activity_at < now() - interval '30 days';
  update play_integrity_private.monitor_state set last_summary = null, last_sample_at = null
    where last_sample_at < now() - interval '30 days';
  update play_integrity_private.monitor_state set
    counter_day = (now() at time zone 'UTC')::date, issued_count = 0,
    observed_count = 0, invalid_count = 0, unavailable_count = 0
    where counter_day < (now() at time zone 'UTC')::date
      and (issued_at is null or issued_at < now() - interval '10 minutes');
$expire_observations$;
revoke all on function play_integrity_private.expire_observations_v1() from public, anon, authenticated, service_role;

-- pg_cron declares its own fixed extension schema; do not relocate it.
create extension if not exists pg_cron;
do $schedule$
declare v_existing bigint;
begin
  select jobid into v_existing from cron.job where jobname = 'sautilink-play-integrity-expire-v1' limit 1;
  if v_existing is not null then perform cron.unschedule(v_existing); end if;
  perform cron.schedule('sautilink-play-integrity-expire-v1', '10 2 * * *', 'select play_integrity_private.expire_observations_v1();');
end;
$schedule$;

comment on schema play_integrity_private is 'Server-owned, short-retention Play Integrity monitoring. Never an application authorization source.';
comment on table play_integrity_private.monitor_state is 'At most one row per user. No raw tokens, request content, email, IP, or device identifiers. Latest summary expires within 31 days; deletion of auth user cascades.';
comment on function public.record_play_integrity_observation_v1(uuid, uuid, uuid, jsonb) is 'Service-only sanitized monitoring; does not authorize or deny app actions.';
commit;
