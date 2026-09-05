create table if not exists private.reserved_username_assignments (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  created_at timestamptz not null default now(),
  constraint reserved_username_assignments_username_check check (
    username = any (array[
      'admin','administrator','root','support','security','sautilink',
      'cloudengine','official','api','help','about','settings','login',
      'signup','account','privacy','terms','contact','waitlist'
    ]::text[])
  )
);

revoke all on table private.reserved_username_assignments from public, anon, authenticated;

create or replace function private.enforce_reserved_username_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if lower(new.username) = any (array[
    'admin','administrator','root','support','security','sautilink',
    'cloudengine','official','api','help','about','settings','login',
    'signup','account','privacy','terms','contact','waitlist'
  ]::text[]) then
    if not exists (
      select 1
      from private.reserved_username_assignments assignment
      where assignment.user_id = new.id
        and assignment.username = lower(new.username)
    ) then
      raise exception 'RESERVED_USERNAME' using errcode = '22023';
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function private.enforce_reserved_username_assignment() from public, anon, authenticated;

alter table public.account_profiles drop constraint if exists account_profiles_username_reserved;
alter table public.social_profiles drop constraint if exists social_profiles_username_reserved;

drop trigger if exists account_profiles_enforce_reserved_username on public.account_profiles;
create trigger account_profiles_enforce_reserved_username
before insert or update of id, username on public.account_profiles
for each row execute function private.enforce_reserved_username_assignment();

drop trigger if exists social_profiles_enforce_reserved_username on public.social_profiles;
create trigger social_profiles_enforce_reserved_username
before insert or update of id, username on public.social_profiles
for each row execute function private.enforce_reserved_username_assignment();

insert into private.reserved_username_assignments (user_id, username)
select au.id, 'sautilink'
from auth.users au
join public.account_profiles ap on ap.id = au.id
where lower(au.email) = 'team@sautilink.com'
  and ap.username in ('sautilink.setup', 'sautilink')
on conflict (user_id) do update set username = excluded.username;

insert into private.reserved_username_assignments (user_id, username)
select au.id, 'support'
from auth.users au
join public.account_profiles ap on ap.id = au.id
where lower(au.email) = 'support@sautilink.com'
  and ap.username in ('support.setup', 'support')
on conflict (user_id) do update set username = excluded.username;

update public.account_profiles ap
set username = assignment.username
from private.reserved_username_assignments assignment
where ap.id = assignment.user_id
  and ap.username <> assignment.username
  and (
    (assignment.username = 'sautilink' and ap.username = 'sautilink.setup')
    or (assignment.username = 'support' and ap.username = 'support.setup')
  );