-- Android FCM device-token registry for SautiLink.
-- Tokens are server-owned data: authenticated clients can only mutate them through
-- narrow SECURITY DEFINER RPCs bound to auth.uid().

begin;

create table if not exists public.push_device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  installation_id uuid not null,
  token text not null,
  platform text not null default 'android',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  constraint push_device_tokens_platform_check check (platform = 'android'),
  constraint push_device_tokens_token_length_check check (char_length(token) between 32 and 4096),
  constraint push_device_tokens_user_installation_key unique (user_id, installation_id),
  constraint push_device_tokens_token_key unique (token)
);

alter table public.push_device_tokens enable row level security;
alter table public.push_device_tokens force row level security;

revoke all on table public.push_device_tokens from public, anon, authenticated;

create index if not exists push_device_tokens_user_enabled_idx
  on public.push_device_tokens (user_id, enabled, last_seen_at desc);

create or replace function public.register_push_device_token_v1(
  p_installation_id uuid,
  p_token text
)
returns void
language plpgsql
security definer
set search_path = ''
as $register_push_device$
declare
  current_uid uuid := auth.uid();
  normalized_token text := btrim(coalesce(p_token, ''));
begin
  if current_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  if p_installation_id is null then
    raise exception 'PUSH_INSTALLATION_REQUIRED' using errcode = '22023';
  end if;

  if char_length(normalized_token) < 32 or char_length(normalized_token) > 4096 then
    raise exception 'PUSH_TOKEN_INVALID' using errcode = '22023';
  end if;

  -- FCM can rotate tokens and a device can legitimately sign in as another user.
  -- Keep one canonical owner for a token and one token for a user/device install.
  delete from public.push_device_tokens
  where token = normalized_token
     or (user_id = current_uid and installation_id = p_installation_id);

  insert into public.push_device_tokens (
    user_id,
    installation_id,
    token,
    platform,
    enabled,
    created_at,
    updated_at,
    last_seen_at
  ) values (
    current_uid,
    p_installation_id,
    normalized_token,
    'android',
    true,
    now(),
    now(),
    now()
  );
end;
$register_push_device$;

revoke all on function public.register_push_device_token_v1(uuid, text)
  from public, anon, authenticated;
grant execute on function public.register_push_device_token_v1(uuid, text)
  to authenticated;

create or replace function public.unregister_push_device_token_v1(
  p_installation_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $unregister_push_device$
declare
  current_uid uuid := auth.uid();
begin
  if current_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  if p_installation_id is null then
    raise exception 'PUSH_INSTALLATION_REQUIRED' using errcode = '22023';
  end if;

  delete from public.push_device_tokens
  where user_id = current_uid
    and installation_id = p_installation_id;
end;
$unregister_push_device$;

revoke all on function public.unregister_push_device_token_v1(uuid)
  from public, anon, authenticated;
grant execute on function public.unregister_push_device_token_v1(uuid)
  to authenticated;

commit;
