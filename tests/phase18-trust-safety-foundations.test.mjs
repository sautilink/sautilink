import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { handleTrustSafetyRequest } from '../src/trust-safety-api.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Phase 18 exposes member safety controls without redesigning the app shell', async () => {
  const html = await read('app/index.html');
  const css = await read('app/assets/app.css');

  for (const id of [
    'profile-report-button',
    'profile-block-button',
    'report-dialog',
    'report-form',
    'report-reason',
    'report-details',
    'request-account-deletion',
    'cancel-account-deletion',
    'account-deletion-status',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }

  assert.match(html, /name="sautilink-release-generation" content="31"/);
  const cssVersion = Number(html.match(/app\.css\?v=(\d+)/)?.[1] || 0);
  const jsVersion = Number(html.match(/app\.js\?v=(\d+)/)?.[1] || 0);
  assert.ok(cssVersion >= 18, `app CSS version regressed below Phase 18: ${cssVersion}`);
  assert.equal(jsVersion, cssVersion, 'app CSS and JS cache-busting versions must stay synchronized');
  assert.match(css, /\.profile-safety-button/);
  assert.match(css, /\.account-deletion-card/);
  assert.match(css, /\.report-dialog/);
});

test('all Phase 18 Worker safety endpoints require authentication', async () => {
  const cases = [
    new Request('https://test.sautilink.com/api/safety/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target_type: 'profile',
        target_id: '18000000-0000-4000-8000-000000000010',
        reason: 'spam',
      }),
    }),
    new Request('https://test.sautilink.com/api/safety/block/someone', { method: 'GET' }),
    new Request('https://test.sautilink.com/api/safety/block/someone', { method: 'POST' }),
    new Request('https://test.sautilink.com/api/safety/block/someone', { method: 'DELETE' }),
    new Request('https://test.sautilink.com/api/safety/deletion-request', { method: 'GET' }),
    new Request('https://test.sautilink.com/api/safety/deletion-request', { method: 'POST' }),
    new Request('https://test.sautilink.com/api/safety/deletion-request', { method: 'DELETE' }),
  ];

  for (const request of cases) {
    const response = await handleTrustSafetyRequest(request, {});
    assert.equal(response.status, 401);
    const payload = await response.json();
    assert.equal(payload.error.code, 'AUTH_REQUIRED');
  }
});

test('Phase 18 Worker uses the publishable session boundary and constrained inputs', async () => {
  const worker = await read('src/trust-safety-api.js');

  assert.match(worker, /auth\/v1\/user/);
  assert.match(worker, /apikey: SUPABASE_PUBLISHABLE_KEY/);
  assert.match(worker, /REPORT_TARGETS = new Set/);
  for (const target of ["'profile'", "'post'", "'comment'"]) {
    assert.ok(worker.includes(target), `Phase 18 report target regressed: ${target}`);
  }
  assert.match(worker, /REPORT_REASONS/);
  assert.match(worker, /details\.length > 2000/);
  assert.match(worker, /SAFETY_REPORT_LIMITER/);
  assert.match(worker, /SAFETY_BLOCK_LIMITER/);
  assert.match(worker, /SAFETY_DELETION_LIMITER/);
  assert.match(worker, /social_blocks/);
  assert.match(worker, /social_reports/);
  assert.match(worker, /social_account_deletion_requests/);
  assert.doesNotMatch(worker, /service_role|sb_secret_|SUPABASE_SECRET/i);
});

test('Phase 18 database migration evolves existing report and block primitives securely', async () => {
  const migration = await read('supabase/migrations/20260901133800_enable_phase18_trust_safety_foundations.sql');
  const auditIndex = await read('supabase/migrations/20260901133834_index_phase18_report_status_audit.sql');

  assert.match(migration, /'comment'::text/);
  assert.match(migration, /social_reports_active_target_unique/);
  assert.match(migration, /status_updated_at/);
  assert.match(migration, /reviewed_at/);
  assert.match(migration, /resolved_at/);
  assert.match(migration, /moderation_note/);
  assert.match(migration, /create table if not exists private\.social_report_status_audit/i);
  assert.match(migration, /private\.audit_social_report_status/);
  assert.match(migration, /private\.enforce_social_block_insert/);
  assert.match(migration, /delete from public\.social_follows/);
  assert.match(migration, /social_profiles_select_phase18_authenticated/);
  assert.match(migration, /social_post_reactions_insert_phase18/);
  assert.match(migration, /social_post_comments_insert_phase18/);
  assert.match(migration, /social_reposts_insert_phase18/);
  assert.match(migration, /create table public\.social_account_deletion_requests/);
  assert.match(migration, /force row level security/);
  assert.match(migration, /grant select, insert, update on table public\.social_account_deletion_requests to authenticated/i);
  assert.match(migration, /INVALID_DELETION_REQUEST_TRANSITION/);
  assert.match(migration, /set is_discoverable = false/);
  assert.match(migration, /set is_discoverable = new\.restore_discoverable/);

  for (const fn of [
    'private.audit_social_report_status\\(\\)',
    'private.enforce_social_block_insert\\(\\)',
  ]) {
    assert.match(migration, new RegExp(`security definer[\\s\\S]*set search_path = ''[\\s\\S]*revoke all on function ${fn} from public, anon, authenticated`, 'i'));
  }

  assert.doesNotMatch(migration, /grant select[^;]*social_reports[^;]*authenticated/i);
  assert.match(auditIndex, /social_report_status_audit_report_id_idx/);
});

test('Phase 18 synthetic SQL protects reporters, blocks and deletion requests', async () => {
  const sql = await read('supabase/tests/phase18_trust_safety_rls.sql');

  for (const marker of [
    'DUPLICATE_ACTIVE_REPORT_ALLOWED',
    'SELF_REPORT_ALLOWED',
    'REPORTER_REPORT_READ_ALLOWED',
    'REPORTER_MODERATION_UPDATE_ALLOWED',
    'DELETION_REQUEST_DID_NOT_HIDE_PROFILE',
    'DELETION_CANCEL_DID_NOT_RESTORE_PROFILE',
    'MEMBER_COMPLETED_OWN_DELETION',
    'BLOCK_DID_NOT_REMOVE_FOLLOWS',
    'BLOCKER_CANNOT_REACH_UNBLOCK_PROFILE',
    'BLOCKED_LIKE_ALLOWED',
    'BLOCKED_COMMENT_ALLOWED',
    'BLOCKED_REPOST_ALLOWED',
    'BLOCKED_USER_CAN_READ_BLOCKER_PROFILE',
    'BLOCKED_FOLLOW_ALLOWED',
    'CROSS_USER_DELETION_REQUEST_VISIBLE',
    'MODERATION_STATUS_AUDIT_MISSING',
  ]) {
    assert.match(sql, new RegExp(marker));
  }

  assert.match(sql, /example\.invalid/);
  assert.match(sql, /begin;[\s\S]*rollback;/i);
});

test('Phase 18 app wires reports, blocks and deletion requests to live safety routes', async () => {
  const source = await read('src/app.js');
  const bundle = await read('app/assets/app.js');
  const router = await read('src/asset-router.js');

  assert.match(source, /\/api\/safety\/report/);
  assert.match(source, /\/api\/safety\/block\//);
  assert.match(source, /\/api\/safety\/deletion-request/);
  assert.match(source, /data\.reportPost|dataset\.reportPost/);
  assert.match(source, /dataset\.reportComment/);
  assert.match(source, /toggleProfileBlock/);
  assert.match(source, /loadDeletionRequestState/);
  assert.match(source, /Report submitted to SautiLink/);
  assert.match(source, /Deletion requested/);
  assert.doesNotMatch(source, /service_role|sb_secret_/i);

  for (const marker of [
    '/api/safety/report',
    '/api/safety/block/',
    '/api/safety/deletion-request',
    'Report submitted to SautiLink.',
  ]) {
    assert.ok(bundle.includes(marker), `generated app bundle is missing Phase 18 marker: ${marker}`);
  }

  assert.match(router, /handleTrustSafetyRequest/);
  assert.match(router, /url\.pathname\.startsWith\('\/api\/safety\/'\)/);
});

test('Cloudflare staging keeps prior limits and adds unique Phase 18 safety namespaces', async () => {
  const wrangler = JSON.parse(await read('wrangler.jsonc'));
  const bindings = wrangler.env.test.ratelimits || [];
  const byName = (name) => bindings.find((item) => item.name === name);

  assert.deepEqual(byName('SAFETY_REPORT_LIMITER')?.simple, { limit: 10, period: 60 });
  assert.deepEqual(byName('SAFETY_BLOCK_LIMITER')?.simple, { limit: 20, period: 60 });
  assert.deepEqual(byName('SAFETY_DELETION_LIMITER')?.simple, { limit: 10, period: 60 });
  assert.ok(byName('SOCIAL_FOLLOW_LIMITER'));
  assert.ok(byName('SOCIAL_LIKE_LIMITER'));

  const namespaces = bindings.map((item) => item.namespace_id);
  assert.equal(new Set(namespaces).size, namespaces.length);
});

test('Phase 18 rotates the service worker cache beyond Phase 17', async () => {
  const sw = await read('sw.js');
  const cacheVersion = Number(sw.match(/sautilink-shell-v(\d+)/)?.[1] || 0);
  assert.ok(cacheVersion >= 8);
});


test('Phase 18 leaves no temporary deployment or bundle-sync workflows in the PR', async () => {
  for (const path of [
    '.github/workflows/phase18-bundle-sync.yml',
    '.github/workflows/phase18-staging-deploy.yml',
  ]) {
    await assert.rejects(
      read(path),
      (error) => error?.code === 'ENOENT',
      `temporary workflow must be removed before Phase 18 approval: ${path}`,
    );
  }
});
