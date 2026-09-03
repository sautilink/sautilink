begin;

do $phase25$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema='public'
      and table_name='social_posts'
      and column_name='reply_access'
      and is_nullable='NO'
  ) then
    raise exception 'PHASE25_REPLY_ACCESS_COLUMN_MISSING';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema='public'
      and table_name='social_posts'
      and column_name='quote_post_id'
  ) then
    raise exception 'PHASE25_QUOTE_COLUMN_MISSING';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public'
      and tablename='social_posts'
      and policyname='social_posts_select_phase25_authenticated'
  ) then
    raise exception 'PHASE25_POST_SELECT_POLICY_MISSING';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public'
      and tablename='social_posts'
      and policyname='social_posts_insert_phase25_own'
  ) then
    raise exception 'PHASE25_POST_INSERT_POLICY_MISSING';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public'
      and tablename='social_post_comments'
      and policyname='social_post_comments_insert_phase25_own'
  ) then
    raise exception 'PHASE25_COMMENT_INSERT_POLICY_MISSING';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname='public'
      and tablename='social_post_comments'
      and policyname='social_post_comments_insert_phase18'
  ) then
    raise exception 'PHASE25_LEGACY_PERMISSIVE_COMMENT_POLICY_PRESENT';
  end if;

  if not exists (
    select 1
    from pg_trigger trigger
    join pg_class rel on rel.oid=trigger.tgrelid
    join pg_namespace namespace on namespace.oid=rel.relnamespace
    where namespace.nspname='public'
      and rel.relname='social_posts'
      and trigger.tgname='enforce_phase25_post_insert'
      and not trigger.tgisinternal
  ) then
    raise exception 'PHASE25_QUOTE_TRIGGER_MISSING';
  end if;

  if has_function_privilege('authenticated','private.enforce_phase25_post_insert()','EXECUTE') then
    raise exception 'PHASE25_QUOTE_TRIGGER_DIRECT_EXECUTE_ALLOWED';
  end if;

  if not exists (
    select 1
    from pg_class rel
    join pg_namespace namespace on namespace.oid=rel.relnamespace
    where namespace.nspname='public'
      and rel.relname='social_stream_events'
      and 'security_invoker=true'=any(rel.reloptions)
  ) then
    raise exception 'PHASE25_STREAM_NOT_SECURITY_INVOKER';
  end if;
end;
$phase25$;

rollback;
