create table if not exists public.web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  installation_id uuid not null,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  expiration_time bigint,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  constraint web_push_subscriptions_user_installation_key unique (user_id, installation_id),
  constraint web_push_subscriptions_endpoint_key unique (endpoint),
  constraint web_push_subscriptions_endpoint_length_check check (char_length(endpoint) between 20 and 2048),
  constraint web_push_subscriptions_endpoint_host_check check (
    lower(endpoint) ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com)(/|$)'
  ),
  constraint web_push_subscriptions_p256dh_check check (p256dh ~ '^[A-Za-z0-9_-]{80,120}$'),
  constraint web_push_subscriptions_auth_check check (auth ~ '^[A-Za-z0-9_-]{16,64}$'),
  constraint web_push_subscriptions_expiration_check check (expiration_time is null or expiration_time > 0)
);

create index if not exists web_push_subscriptions_active_user_idx
  on public.web_push_subscriptions (user_id, last_seen_at desc)
  where enabled is true;

alter table public.web_push_subscriptions enable row level security;
alter table public.web_push_subscriptions force row level security;

create policy web_push_subscriptions_no_direct_client_access
  on public.web_push_subscriptions
  for all
  to anon, authenticated
  using (false)
  with check (false);

revoke all on table public.web_push_subscriptions from public, anon, authenticated;
grant select, insert, update, delete on table public.web_push_subscriptions to service_role;

create or replace function public.register_web_push_subscription_v1(
  p_installation_id uuid,
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_expiration_time bigint default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_endpoint text := btrim(coalesce(p_endpoint, ''));
  v_p256dh text := btrim(coalesce(p_p256dh, ''));
  v_auth text := btrim(coalesce(p_auth, ''));
  v_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_installation_id is null
     or char_length(v_endpoint) not between 20 and 2048
     or lower(v_endpoint) !~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com)(/|$)'
     or v_p256dh !~ '^[A-Za-z0-9_-]{80,120}$'
     or v_auth !~ '^[A-Za-z0-9_-]{16,64}$'
     or (p_expiration_time is not null and p_expiration_time <= 0) then
    raise exception 'Invalid web push subscription' using errcode = '22023';
  end if;

  delete from public.web_push_subscriptions
  where endpoint = v_endpoint
    and (user_id <> v_user_id or installation_id <> p_installation_id);

  insert into public.web_push_subscriptions (
    user_id, installation_id, endpoint, p256dh, auth, expiration_time,
    enabled, updated_at, last_seen_at
  ) values (
    v_user_id, p_installation_id, v_endpoint, v_p256dh, v_auth, p_expiration_time,
    true, now(), now()
  )
  on conflict (user_id, installation_id) do update
  set endpoint = excluded.endpoint,
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      expiration_time = excluded.expiration_time,
      enabled = true,
      updated_at = now(),
      last_seen_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.unregister_web_push_subscription_v1(
  p_installation_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  delete from public.web_push_subscriptions
  where user_id = v_user_id
    and installation_id = p_installation_id;

  return found;
end;
$$;

create or replace function public.get_web_push_vapid_private_key_server_v1()
returns text
language sql
security definer
set search_path = ''
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = 'sautilink_web_push_vapid_private_key'
  limit 1
$$;

revoke all on function public.register_web_push_subscription_v1(uuid, text, text, text, bigint) from public, anon;
revoke all on function public.unregister_web_push_subscription_v1(uuid) from public, anon;
revoke all on function public.get_web_push_vapid_private_key_server_v1() from public, anon, authenticated;

grant execute on function public.register_web_push_subscription_v1(uuid, text, text, text, bigint) to authenticated;
grant execute on function public.unregister_web_push_subscription_v1(uuid) to authenticated;
grant execute on function public.get_web_push_vapid_private_key_server_v1() to service_role;

comment on table public.web_push_subscriptions is
  'Private browser push subscriptions. Clients may mutate only their own row through narrow authenticated RPCs.';
comment on function public.get_web_push_vapid_private_key_server_v1() is
  'Server-only access to the encrypted Web Push VAPID private key stored in Supabase Vault.';
