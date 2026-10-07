import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sql = await readFile(new URL('../supabase/migrations/20261007040548_whatsapp_support_outbound_foundation.sql', import.meta.url), 'utf8');

test('WhatsApp outbound ledger is service-role only and idempotent', () => {
  assert.match(sql, /create table if not exists public\.whatsapp_outbound_messages/);
  assert.match(sql, /request_id uuid not null unique/);
  assert.match(sql, /send_state in \('pending', 'accepted', 'failed', 'uncertain'\)/);
  assert.match(sql, /revoke all on table public\.whatsapp_outbound_messages from public, anon, authenticated/);
  assert.match(sql, /grant select, insert, update, delete on table[\s\S]*whatsapp_outbound_messages[\s\S]*to service_role/);
});

test('WhatsApp support thread state and summary remain server-only', () => {
  assert.match(sql, /create table if not exists public\.whatsapp_support_threads/);
  assert.match(sql, /create view public\.whatsapp_support_thread_summary[\s\S]*security_invoker = true/);
  assert.match(sql, /last_read_inbound_id bigint/);
  assert.match(sql, /support_window_open/);
  assert.match(sql, /interval '24 hours'/);
  assert.match(sql, /revoke all on table public\.whatsapp_support_thread_summary from public, anon, authenticated/);
});

test('WhatsApp support schema never stores provider access credentials', () => {
  assert.doesNotMatch(sql, /access_token|app_secret|verify_token/i);
});
