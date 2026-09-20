-- Private account date of birth.
--
-- Existing members remain valid with a null value and can add the date later in
-- Settings. New signup UI collects it before verification and writes it only to
-- the owner-only account_profiles row after the verified account is created.

begin;

alter table public.account_profiles
  add column if not exists birth_date date;

alter table public.account_profiles
  drop constraint if exists account_profiles_birth_date_valid;

alter table public.account_profiles
  add constraint account_profiles_birth_date_valid
  check (
    birth_date is null
    or (
      birth_date >= date '1900-01-01'
      and birth_date <= current_date
    )
  );

comment on column public.account_profiles.birth_date is
  'Private owner-only date of birth. Nullable for accounts created before birth-date collection was introduced.';

revoke update (birth_date) on table public.account_profiles from authenticated;
grant update (birth_date) on table public.account_profiles to authenticated;

commit;
