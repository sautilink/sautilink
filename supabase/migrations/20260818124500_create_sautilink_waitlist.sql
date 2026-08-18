create table public.waitlist_members (
  id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'waiting',
  source text not null default 'sautilink.com',
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  launch_notified_at timestamptz,
  constraint waitlist_members_status_allowed check (
    status = any (array['waiting', 'invited', 'launched', 'removed']::text[])
  ),
  constraint waitlist_members_source_length check (
    char_length(source) between 1 and 80
  )
);

comment on table public.waitlist_members is
  'Verified SautiLink pre-launch waitlist membership. Email verification remains authoritative in Supabase Auth; usernames remain authoritative in account_profiles.';
comment on column public.waitlist_members.id is
  'Supabase Auth user ID. A row is created only after successful email OTP verification.';
comment on column public.waitlist_members.status is
  'Server-owned waitlist lifecycle state.';
comment on column public.waitlist_members.launch_notified_at is
  'Server-owned timestamp for the launch-access notification.';

create index waitlist_members_status_joined_idx
  on public.waitlist_members (status, joined_at);

alter table public.waitlist_members enable row level security;

revoke all on table public.waitlist_members from anon;
revoke all on table public.waitlist_members from authenticated;
grant select, insert, update, delete on table public.waitlist_members to service_role;
