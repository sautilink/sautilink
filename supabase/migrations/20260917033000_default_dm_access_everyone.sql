-- Make Everyone the default inbound DM policy.
--
-- This intentionally performs a one-time reset of existing profiles to
-- `everyone`, per the product decision. After this migration, members remain
-- free to change the setting to `following` or `none`; there is no trigger or
-- background job that forces it back.

begin;

alter table public.social_profiles
  alter column dm_access set default 'everyone';

update public.social_profiles
set dm_access = 'everyone'
where dm_access is distinct from 'everyone';

comment on column public.social_profiles.dm_access is
  'Inbound DM policy: everyone is the default for new profiles; members may change it to following or none at any time.';

commit;
