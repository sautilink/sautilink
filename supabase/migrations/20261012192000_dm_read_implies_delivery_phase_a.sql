-- Phase A receipts: a server-confirmed read is also proof of delivery.
-- Web already writes last_read_at; native also writes explicit delivery ACKs.
-- This migration does not infer any delivery from merely sending a message.
begin;

create or replace function private.dm_mark_delivery_when_read_native_phase_a()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if new.last_read_at is not null
     and new.last_read_at is distinct from old.last_read_at then
    new.last_delivered_at = greatest(
      coalesce(new.last_delivered_at, '-infinity'::timestamptz),
      new.last_read_at
    );
  end if;
  return new;
end;
$fn$;

drop trigger if exists dm_mark_delivery_when_read_native_phase_a
  on public.dm_conversation_states;

create trigger dm_mark_delivery_when_read_native_phase_a
before update of last_read_at on public.dm_conversation_states
for each row
execute function private.dm_mark_delivery_when_read_native_phase_a();

-- Existing read timestamps are positive evidence that delivery already occurred.
update public.dm_conversation_states
set last_delivered_at = greatest(
  coalesce(last_delivered_at, '-infinity'::timestamptz),
  last_read_at
)
where last_read_at is not null
  and (last_delivered_at is null or last_delivered_at < last_read_at);

commit;
