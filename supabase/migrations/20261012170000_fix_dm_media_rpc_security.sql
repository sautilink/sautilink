-- Phase A: Media messages are inserted only by this guarded RPC.
-- Authenticated callers have INSERT permission only for *text* DM columns.
-- Keep message_kind ungrantable to ordinary users; this function validates an
-- owned, ready, unexpired attachment and the existing DM insert trigger checks
-- conversation membership, recipient permission, blocks and rate limits.
begin;
alter function public.send_dm_media_message_phase35(uuid, uuid, text)
  security definer;
revoke all on function public.send_dm_media_message_phase35(uuid, uuid, text)
  from public, anon;
grant execute on function public.send_dm_media_message_phase35(uuid, uuid, text)
  to authenticated;
commit;
