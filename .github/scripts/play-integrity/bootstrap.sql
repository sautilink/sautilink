-- Minimal auth contract for a new disposable Postgres database. Never production.
-- Auth/users/session columns used by the migration were checked against production
-- read-only. This fixture deliberately includes no application triggers or data.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
revoke all on schema auth from public;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (
  id uuid primary key,
  aud text,
  role text,
  email text,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  is_anonymous boolean not null default false,
  banned_until timestamptz,
  deleted_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
);
create table auth.sessions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  not_after timestamptz,
  created_at timestamptz,
  updated_at timestamptz
);
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub'
  )::uuid;
$$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb;
$$;
