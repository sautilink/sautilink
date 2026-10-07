-- Default key member-facing settings to enabled and backfill current members once.
-- Future member changes remain authoritative after this one-time rollout.

begin;

alter table public.social_profiles
  alter column is_discoverable set default true,
  alter column allow_external_indexing set default true,
  alter column dm_access set default 'everyone';

alter table public.social_member_preferences
  alter column read_receipts set default true,
  alter column activity_status set default true;

alter table public.user_social_settings
  alter column message_permission set default 'everyone',
  alter column external_search_indexing set default true;

update public.social_profiles
set is_discoverable = true,
    allow_external_indexing = true,
    dm_access = 'everyone'
where is_discoverable is distinct from true
   or allow_external_indexing is distinct from true
   or dm_access is distinct from 'everyone';

update public.social_member_preferences
set read_receipts = true,
    activity_status = true
where read_receipts is distinct from true
   or activity_status is distinct from true;

update public.user_social_settings
set message_permission = 'everyone',
    external_search_indexing = true
where message_permission is distinct from 'everyone'
   or external_search_indexing is distinct from true;

commit;
