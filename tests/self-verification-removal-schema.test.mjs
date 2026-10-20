import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const migrationPath = 'supabase/migrations/20261020195741_enable_self_verification_removal.sql';

test('voluntary removal is an authenticated owner-bound narrow RPC rather than a general badge setter', async () => {
  const sql = await read(migrationPath);
  const helper = sql.slice(sql.indexOf('create or replace function private.remove_my_social_verification_privileged'), sql.indexOf('revoke all on function private.remove_my_social_verification_privileged'));
  const wrapper = sql.slice(sql.indexOf('create or replace function public.remove_my_social_verification'), sql.indexOf('-- Historical case outcome'));
  assert.match(helper, /current_uid uuid := auth\.uid\(\)/);
  assert.match(helper, /if current_uid is null then[\s\S]*?AUTH_REQUIRED/);
  assert.match(helper, /p_confirmation is distinct from 'remove-verification-v1'/);
  assert.match(helper, /where id = current_uid\s+for update/);
  assert.doesNotMatch(helper, /p_user_id|p_username|p_verified|service_role|set_config/);
  assert.match(wrapper, /security invoker/);
  assert.match(wrapper, /from public, anon, authenticated/);
  assert.match(wrapper, /grant execute[\s\S]*to authenticated/);
});

test('username unlock requires a private current transaction pending receipt and replay cannot remove a later verification', async () => {
  const sql = await read(migrationPath);
  assert.match(sql, /alter table private\.social_verification_removal_receipts enable row level security/);
  assert.match(sql, /revoke all on table private\.social_verification_removal_receipts from public, anon, authenticated/);
  assert.match(sql, /receipt\.removal_txid = txid_current\(\)/);
  assert.match(sql, /receipt\.completed_at is null/);
  assert.match(sql, /auth\.uid\(\) = old\.id/);
  assert.match(sql, /receipt\.previous_username_locked_at is not distinct from old\.username_locked_at/);
  assert.match(sql, /new\.username_locked_at := old\.username_locked_at/);
  assert.match(sql, /VERIFICATION_REMOVAL_REPLAY_REJECTED/);
  assert.match(sql, /result_status := 'already_removed'/);
  assert.match(sql, /'member_removal', current_uid/);
  assert.doesNotMatch(sql, /create or replace function private\.change_social_identity_privileged/);
  assert.doesNotMatch(sql, /create or replace function public\.staff_console_verification_action/);
});

test('case retirement preserves history while preventing stale staff approval or reopening', async () => {
  const sql = await read(migrationPath);
  assert.match(sql, /order by item\.id\s+for update/);
  assert.ok(sql.indexOf('order by item.id') < sql.indexOf('select * into profile_row'), 'Cases must lock before the social profile');
  assert.match(sql, /new\.status in \('submitted', 'reviewing', 'action_required', 'approved'\)/);
  assert.match(sql, /new\.id = any \(receipt\.retired_case_ids\)/);
  assert.match(sql, /VERIFICATION_CASE_REAPPLICATION_REQUIRED/);
  assert.match(sql, /set status = 'cancelled'[\s\S]*and status in \('submitted', 'reviewing', 'action_required'\)/);
  assert.match(sql, /'verification_removed', not coalesce\(active_verified, false\) and removed_at is not null/);
  assert.match(sql, /when item\.status = 'rejected' then now\(\) >= reapply_at/);
  assert.doesNotMatch(sql, /update public\.case_records\s+set status = 'approved'/);
});

test('legacy staff setter denies NULL roles while retaining its complete existing behavior', async () => {
  const [sql, original] = await Promise.all([
    read(migrationPath), read('supabase/migrations/20260903104500_enable_verification_badge_types.sql'),
  ]);
  const patched = sql.split('CREATE OR REPLACE FUNCTION private.set_social_verification_privileged_v2')[1]
    .split('AS $function$')[1].split('$function$')[0].trim();
  const baseline = original.split('create or replace function private.set_social_verification_privileged_v2')[1]
    .split('as $verification$')[1].split('$verification$')[0].trim();
  assert.equal(patched, baseline.replace("if staff_role <> 'senior_reviewer' then", "if staff_role is distinct from 'senior_reviewer' then"));
  assert.doesNotMatch(sql, /(?:grant|revoke)[^;]*set_social_verification_privileged_v2/);
});

test('rollback database regression covers access, badge classes, lifecycle and retained identity limits', async () => {
  const sql = await read('supabase/tests/self_verification_removal.sql');
  assert.match(sql, /begin;/);
  assert.match(sql, /rollback;\s*$/);
  for (const assertion of [
    'ANONYMOUS_REMOVAL_EXECUTE_GRANTED', 'VERIFICATION_NOT_ACTIVE',
    'VERIFICATION_REMOVAL_CONFIRMATION_REQUIRED', 'REMOVAL_TARGET_ISOLATION_FAILED',
    'DUPLICATE_OR_MISSING_REMOVAL_AUDIT', 'TEAM_REMOVAL_AUDIT_INVALID',
    'STALE_RETRY_REMOVED_NEW_VERIFICATION', 'COMPLETED_RECEIPT_REUSED_TO_CLEAR_STAFF_LOCK',
    'STALE_APPROVAL_DID_NOT_ROLL_BACK_PROFILE', 'USERNAME_CHANGE_LIMIT',
    'USERNAME_RESERVED', 'USERNAME_LOCKED_VERIFIED', 'VERIFICATION_REAPPLY_COOLDOWN',
    'VERIFICATION_EVIDENCE_REQUIRED', 'FULL_FRESH_REAPPLICATION_NOT_CREATED',
    'FRESH_REVERIFICATION_DID_NOT_RELOCK', 'SYNTHETIC_REMOVAL_SENT_NOTIFICATION',
    'NONSTAFF_FIXTURE_HAS_ROLE', 'VERIFICATION_ADMIN_REQUIRED',
    'SENIOR_REVIEWER_VERIFICATION_BEHAVIOR_CHANGED', 'SENIOR_REVIEWER_AUDIT_CHANGED',
  ]) assert.ok(sql.includes(assertion), assertion);
});
