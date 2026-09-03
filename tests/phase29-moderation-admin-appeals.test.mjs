import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { handleModerationRequest } from '../src/moderation-api.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Phase 29 exposes appeals and moderation surfaces without redesigning the app shell', async () => {
  const html = await read('app/index.html');
  const css = await read('app/assets/app.css');

  for (const id of [
    'appeals-surface',
    'appeals-list',
    'appeal-dialog',
    'moderation-surface',
    'moderation-nav-button',
    'moderation-report-list',
    'moderation-report-detail',
    'moderation-appeal-list',
    'moderation-audit-list',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }

  const phase = Number(html.match(/name="sautilink-release-generation" content="([0-9]+)"/)?.[1] || 0);
  const cssVersion = Number(html.match(/app\.css\?v=(\d+)/)?.[1] || 0);
  const jsVersion = Number(html.match(/app\.js\?v=(\d+)/)?.[1] || 0);
  assert.ok(phase >= 29);
  assert.ok(cssVersion >= 29);
  assert.ok(jsVersion >= 29);
  assert.match(css, /moderation-workspace/);
  assert.match(css, /appeal-card-live/);
});

test('Phase 29 moderation and appeal Worker boundaries require authentication', async () => {
  const cases = [
    ['GET', 'https://test.sautilink.com/api/moderation/session'],
    ['GET', 'https://test.sautilink.com/api/moderation/reports'],
    ['GET', 'https://test.sautilink.com/api/moderation/appeals'],
    ['GET', 'https://test.sautilink.com/api/moderation/audit'],
    ['GET', 'https://test.sautilink.com/api/appeals'],
    ['POST', 'https://test.sautilink.com/api/appeals'],
  ];

  for (const [method, url] of cases) {
    const response = await handleModerationRequest(new Request(url, { method }), {});
    assert.equal(response.status, 401);
    const payload = await response.json();
    assert.equal(payload.error.code, 'AUTH_REQUIRED');
  }
});

test('Phase 29 Worker enforces server-owned roles, bounded queues and idempotent decisions', async () => {
  const source = await read('src/moderation-api.js');

  for (const marker of [
    'moderation_staff_self',
    'senior_reviewer',
    'auditor',
    'MODERATION_ACCESS_REQUIRED',
    'MODERATION_READ_ONLY',
    'SENIOR_REVIEW_REQUIRED',
    'request_id',
    'idempotent',
    'boundedInt',
    'Math.min(max',
    "const limit = boundedInt(url.searchParams.get('limit'), 30, 1, 50)",
    '/api/moderation/session',
    '/api/appeals',
  ]) {
    assert.ok(source.includes(marker), `missing Phase 29 Worker marker: ${marker}`);
  }

  assert.doesNotMatch(source, /service_role|sb_secret_|SUPABASE_SECRET/i);
  assert.doesNotMatch(source, /reporter_id/);
});

test('Phase 29 migration defines least-privilege moderation, appeals, enforcement and immutable audit', async () => {
  const sql = await read('supabase/migrations/20260902112000_enable_phase29_moderation_admin_appeals.sql');

  for (const marker of [
    'create table if not exists private.moderation_staff',
    'private.phase29_staff_role',
    'create view public.moderation_staff_self',
    'security_invoker = true',
    'create table if not exists public.social_moderation_actions',
    'create table if not exists public.social_moderation_appeals',
    'create table if not exists public.social_moderation_audit',
    'social_reports_select_staff_phase29',
    'context_snapshot',
    'target_owner_id',
    'social_posts_moderation_state_allowed',
    'social_post_comments_moderation_state_allowed',
    'validate_phase29_action_insert',
    'validate_phase29_appeal_insert',
    'validate_phase29_appeal_update',
    'apply_phase29_moderation_action',
    'notify_phase29_moderation_target',
    'audit_phase29_action',
    'audit_phase29_report_update',
    'audit_phase29_appeal_change',
    "report.target_type = 'post'",
    "report.target_type = 'comment'",
  ]) {
    assert.ok(sql.includes(marker), `migration missing Phase 29 marker: ${marker}`);
  }

  assert.match(sql, /grant select \([\s\S]*context_snapshot[\s\S]*\) on public\.social_reports to authenticated/i);
  assert.doesNotMatch(
    sql.match(/grant select \([\s\S]*?\) on public\.social_reports to authenticated/i)?.[0] || '',
    /reporter_id/i,
  );
  assert.match(sql, /revoke all on table private\.moderation_staff from public, anon, authenticated/i);
  assert.match(sql, /grant select on table public\.moderation_staff_self to authenticated/i);
  assert.doesNotMatch(sql, /grant (insert|update|delete)[^;]*private\.moderation_staff/i);
  assert.match(sql, /request_id uuid not null/);
  assert.match(sql, /constraint social_moderation_actions_request_unique unique \(request_id\)/i);
  assert.match(sql, /new\.action_type = 'content_removed' and staff_role_value <> 'senior_reviewer'/i);
  assert.match(sql, /new\.action_type in \('appeal_upheld', 'appeal_reversed'\)[\s\S]*staff_role_value <> 'senior_reviewer'/i);
  assert.match(sql, /notification_type[\s\S]*'safety'/i);

  for (const fn of [
    'private.phase29_staff_role\\(\\)',
    'private.audit_phase29_action\\(\\)',
    'private.audit_phase29_report_update\\(\\)',
    'private.audit_phase29_appeal_change\\(\\)',
    'private.notify_phase29_moderation_target\\(\\)',
  ]) {
    assert.match(
      sql,
      new RegExp(`security definer[\\s\\S]*set search_path = ''[\\s\\S]*revoke all on function ${fn} from public, anon, authenticated`, 'i'),
    );
  }

  assert.doesNotMatch(sql, /disable row level security/i);
});

test('Phase 29 browser keeps moderation staff-only and member appeals distinct', async () => {
  const source = await read('src/app.js');

  for (const marker of [
    'syncModerationAccess',
    'currentModerationRole',
    'moderation-nav-button',
    'loadAppeals',
    'openAppealDialog',
    'loadModerationReports',
    'loadModerationAppeals',
    'loadModerationAudit',
    'claimModerationReport',
    'decideModerationReport',
    'claimModerationAppeal',
    'decideModerationAppeal',
    'Senior reviewer',
    'Auditor',
    '/appeals',
    '/moderation',
    'updated a moderation decision affecting your content',
  ]) {
    assert.ok(source.includes(marker), `browser missing Phase 29 marker: ${marker}`);
  }

  assert.match(source, /nav\.hidden = !currentModerationRole/);
  assert.match(source, /currentModerationRole === 'senior_reviewer'/);
  assert.doesNotMatch(source, /innerHTML\s*=/);
  assert.doesNotMatch(source, /service_role|sb_secret_/i);
});

test('Phase 29 uses independent rate-limit namespaces and rotates shell cache', async () => {
  const wrangler = JSON.parse(await read('wrangler.social-staging.jsonc'));
  const bindings = wrangler.env.test.ratelimits || [];
  const appeal = bindings.find((item) => item.name === 'SAFETY_APPEAL_LIMITER');
  const moderation = bindings.find((item) => item.name === 'MODERATION_ACTION_LIMITER');

  assert.deepEqual(appeal?.simple, { limit: 20, period: 60 });
  assert.equal(appeal?.namespace_id, '2901');
  assert.deepEqual(moderation?.simple, { limit: 120, period: 60 });
  assert.equal(moderation?.namespace_id, '2902');

  const namespaces = bindings.map((item) => item.namespace_id);
  assert.equal(new Set(namespaces).size, namespaces.length);

  const sw = await read('sw.js');
  const version = Number(sw.match(/sautilink-shell-v(\d+)/)?.[1] || 0);
  assert.ok(version >= 18, `service worker cache regressed below Phase 29: ${version}`);
});

test('Phase 29 covers moderation foreign keys flagged by the staging advisor', async () => {
  const sql = await read('supabase/migrations/20260902122500_add_phase29_moderation_fk_indexes.sql');
  for (const marker of [
    'social_reports_phase29_target_owner_idx',
    'social_moderation_actions_phase29_appeal_idx',
    'social_moderation_appeals_phase29_appellant_idx',
    'social_moderation_appeals_phase29_assigned_idx',
    'social_moderation_audit_phase29_report_idx',
    'social_moderation_audit_phase29_action_idx',
    'social_moderation_audit_phase29_appeal_idx',
    'social_moderation_audit_phase29_actor_idx',
  ]) {
    assert.ok(sql.includes(marker), `missing Phase 29 FK index: ${marker}`);
  }
});
