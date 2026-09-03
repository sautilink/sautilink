begin;

do $phase24$
declare
  insert_columns text[];
begin
  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relname='social_saved_posts'
      and c.relrowsecurity
      and c.relforcerowsecurity
  ) then
    raise exception 'PHASE24_SAVED_RLS_NOT_FORCED';
  end if;

  if exists (
    select 1
    from information_schema.role_table_grants
    where table_schema='public'
      and table_name='social_saved_posts'
      and grantee='anon'
  ) then
    raise exception 'PHASE24_ANON_SAVED_PRIVILEGE_PRESENT';
  end if;

  if not has_table_privilege('authenticated','public.social_saved_posts','SELECT')
     or not has_table_privilege('authenticated','public.social_saved_posts','DELETE') then
    raise exception 'PHASE24_REQUIRED_SAVED_PRIVILEGE_MISSING';
  end if;

  if has_table_privilege('authenticated','public.social_saved_posts','UPDATE') then
    raise exception 'PHASE24_BROWSER_SAVED_UPDATE_ALLOWED';
  end if;

  select array_agg(column_name order by column_name)
    into insert_columns
  from information_schema.column_privileges
  where table_schema='public'
    and table_name='social_saved_posts'
    and grantee='authenticated'
    and privilege_type='INSERT';

  if insert_columns is distinct from array['post_id','user_id']::text[] then
    raise exception 'PHASE24_SAVED_INSERT_COLUMNS_UNEXPECTED';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public'
      and tablename='social_saved_posts'
      and policyname='social_saved_posts_select_own_phase24'
  ) then
    raise exception 'PHASE24_SAVED_SELECT_POLICY_MISSING';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public'
      and tablename='social_saved_posts'
      and policyname='social_saved_posts_insert_own_phase24'
  ) then
    raise exception 'PHASE24_SAVED_INSERT_POLICY_MISSING';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public'
      and tablename='social_saved_posts'
      and policyname='social_saved_posts_delete_own_phase24'
  ) then
    raise exception 'PHASE24_SAVED_DELETE_POLICY_MISSING';
  end if;
end;
$phase24$;

rollback;
