-- Phase 23 hardening: conversation state rows are server-created.
revoke insert on table public.dm_conversation_states from authenticated;
