-- Server-side FCM delivery for SautiLink Android notifications.
-- Creates a private queue fed by social notification + DM inserts, dispatches through
-- a Supabase Edge Function, and retries transient failures with pg_cron/pg_net.

begin;

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema extensions;

create table if not exists public.push_delivery_queue (
  id uuid primary key default gen_random_uuid(),
  dispatch_key uuid not null default gen_random_uuid(),
  recipient_id uuid not null references auth.users(id) on delete cascade,
  source_type text not null,
  source_id text not null,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  claimed_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  constraint push_delivery_queue_source_type_check
    check (source_type in ('social_notification', 'dm_message')),
  constraint push_delivery_queue_status_check
    check (status in ('pending', 'processing', 'delivered', 'no_tokens', 'failed', 'skipped')),
  constraint push_delivery_queue_source_unique unique (source_type, source_id, recipient_id),
  constraint push_delivery_queue_attempt_count_check check (attempt_count between 0 and 100)
);

alter table public.push_delivery_queue enable row level security;
alter table public.push_delivery_queue force row level security;

revoke all on table public.push_delivery_queue from public, anon, authenticated;
grant select, insert, update, delete on table public.push_delivery_queue to service_role;

create index if not exists push_delivery_queue_retry_idx
  on public.push_delivery_queue (status, next_attempt_at, created_at)
  where status in ('pending', 'failed', 'processing');

create index if not exists push_delivery_queue_recipient_created_idx
  on public.push_delivery_queue (recipient_id, created_at desc);

create or replace function private.dispatch_push_delivery_v1(
  p_queue_id uuid,
  p_dispatch_key uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $dispatch_push$
begin
  if p_queue_id is null or p_dispatch_key is null then
    return;
  end if;

  perform net.http_post(
    url := 'https://rggpyiterdbbugluejcs.supabase.co/functions/v1/sautilink-push-dispatch',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'queue_id', p_queue_id::text,
      'dispatch_key', p_dispatch_key::text
    ),
    timeout_milliseconds := 8000
  );
end;
$dispatch_push$;

revoke all on function private.dispatch_push_delivery_v1(uuid, uuid)
  from public, anon, authenticated;

create or replace function private.enqueue_push_delivery_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $enqueue_push$
declare
  target_recipient uuid;
  target_source_type text;
  target_source_id text;
  queued_id uuid;
  queued_dispatch_key uuid;
begin
  if tg_table_name = 'social_notifications' then
    if new.notification_type not in ('follow', 'like', 'reply', 'mention', 'reshare') then
      return new;
    end if;

    target_recipient := new.recipient_id;
    target_source_type := 'social_notification';
    target_source_id := new.id::text;
  elsif tg_table_name = 'dm_messages' then
    select case
      when conversation.member_one_id = new.sender_id then conversation.member_two_id
      else conversation.member_one_id
    end
      into target_recipient
    from public.dm_conversations conversation
    where conversation.id = new.conversation_id
      and new.sender_id in (conversation.member_one_id, conversation.member_two_id);

    if target_recipient is null or target_recipient = new.sender_id then
      return new;
    end if;

    target_source_type := 'dm_message';
    target_source_id := new.id::text;
  else
    return new;
  end if;

  if target_recipient is null then
    return new;
  end if;

  insert into public.push_delivery_queue (
    recipient_id,
    source_type,
    source_id,
    status,
    attempt_count,
    next_attempt_at
  ) values (
    target_recipient,
    target_source_type,
    target_source_id,
    'pending',
    0,
    now()
  )
  on conflict (source_type, source_id, recipient_id) do nothing
  returning id, dispatch_key into queued_id, queued_dispatch_key;

  if queued_id is not null then
    perform private.dispatch_push_delivery_v1(queued_id, queued_dispatch_key);
  end if;

  return new;
end;
$enqueue_push$;

revoke all on function private.enqueue_push_delivery_v1()
  from public, anon, authenticated;

drop trigger if exists push_delivery_social_notification_v1 on public.social_notifications;
create trigger push_delivery_social_notification_v1
after insert on public.social_notifications
for each row execute function private.enqueue_push_delivery_v1();

drop trigger if exists push_delivery_dm_message_v1 on public.dm_messages;
create trigger push_delivery_dm_message_v1
after insert on public.dm_messages
for each row execute function private.enqueue_push_delivery_v1();

create or replace function private.retry_push_delivery_queue_v1()
returns void
language plpgsql
security definer
set search_path = ''
as $retry_push$
declare
  queued record;
begin
  for queued in
    select q.id, q.dispatch_key
    from public.push_delivery_queue q
    where q.attempt_count < 5
      and q.next_attempt_at <= now()
      and (
        q.status in ('pending', 'failed')
        or (q.status = 'processing' and q.claimed_at < now() - interval '2 minutes')
      )
    order by q.created_at
    limit 25
  loop
    perform private.dispatch_push_delivery_v1(queued.id, queued.dispatch_key);
  end loop;
end;
$retry_push$;

revoke all on function private.retry_push_delivery_queue_v1()
  from public, anon, authenticated;

-- Replace any previous copy of the retry job so the migration is safe to re-run.
do $schedule$
declare
  existing_job_id bigint;
begin
  select jobid into existing_job_id
  from cron.job
  where jobname = 'sautilink-push-retry-v1'
  limit 1;

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'sautilink-push-retry-v1',
    '* * * * *',
    'select private.retry_push_delivery_queue_v1();'
  );
end;
$schedule$;

comment on table public.push_delivery_queue is
  'Private server-owned queue for Android FCM delivery. Clients cannot read or mutate it.';

commit;
