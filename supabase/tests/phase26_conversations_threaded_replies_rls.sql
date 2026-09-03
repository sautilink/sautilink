begin;

do $phase26$
declare
  insert_columns text[];
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='social_posts'
      and column_name='parent_post_id'
  ) then raise exception 'PHASE26_PARENT_COLUMN_MISSING'; end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='social_posts'
      and column_name='root_post_id'
  ) then raise exception 'PHASE26_ROOT_COLUMN_MISSING'; end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='social_posts'
      and column_name='audience_owner_id' and is_nullable='NO'
  ) then raise exception 'PHASE26_AUDIENCE_OWNER_MISSING'; end if;

  select array_agg(column_name order by column_name)
  into insert_columns
  from information_schema.column_privileges
  where table_schema='public'
    and table_name='social_posts'
    and grantee='authenticated'
    and privilege_type='INSERT';

  if insert_columns is distinct from array[
    'author_id',
    'body',
    'circle_id',
    'client_request_id',
    'parent_post_id',
    'post_status',
    'quote_post_id',
    'reply_access',
    'visibility'
  ]::text[] then
    raise exception 'PHASE26_POST_INSERT_COLUMNS_UNEXPECTED';
  end if;

  if has_function_privilege('authenticated','private.enforce_phase26_post_insert()','EXECUTE') then
    raise exception 'PHASE26_INSERT_TRIGGER_DIRECT_EXECUTE_ALLOWED';
  end if;

  if has_function_privilege('authenticated','private.sync_phase26_reply_counts()','EXECUTE') then
    raise exception 'PHASE26_COUNT_TRIGGER_DIRECT_EXECUTE_ALLOWED';
  end if;

  if has_table_privilege('authenticated','public.social_post_comments','INSERT') then
    raise exception 'PHASE26_LEGACY_COMMENT_INSERT_ALLOWED';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='social_posts'
      and policyname='social_posts_select_phase26_authenticated'
  ) then raise exception 'PHASE26_AUTH_SELECT_POLICY_MISSING'; end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='social_posts'
      and policyname='social_posts_insert_phase26_own'
  ) then raise exception 'PHASE26_INSERT_POLICY_MISSING'; end if;

  if not exists (
    select 1 from pg_trigger trigger
    join pg_class rel on rel.oid=trigger.tgrelid
    join pg_namespace n on n.oid=rel.relnamespace
    where n.nspname='public' and rel.relname='social_posts'
      and trigger.tgname='phase26_reply_notification'
      and not trigger.tgisinternal
  ) then raise exception 'PHASE26_REPLY_NOTIFICATION_TRIGGER_MISSING'; end if;

  if not exists (
    select 1 from pg_class rel
    join pg_namespace n on n.oid=rel.relnamespace
    where n.nspname='public' and rel.relname='social_stream_events'
      and 'security_invoker=true'=any(rel.reloptions)
  ) then raise exception 'PHASE26_STREAM_NOT_SECURITY_INVOKER'; end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname='public'
      and tablename='social_posts'
      and indexname='social_posts_author_client_request_uidx'
  ) then raise exception 'PHASE26_IDEMPOTENCY_INDEX_MISSING'; end if;
end;
$phase26$;

rollback;
