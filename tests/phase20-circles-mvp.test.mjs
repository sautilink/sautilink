import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Phase 20 activates Circles in the existing app shell', async () => {
  const html = await read('app/index.html');
  const css = await read('app/assets/app.css');

  for (const marker of [
    'data-member-view="circles"',
    'id="circles-surface"',
    'id="circle-create-form"',
    'id="circle-detail"',
    'id="circle-primary-action"',
    'id="circle-requests"',
  ]) {
    assert.ok(html.includes(marker), `missing Phase 20 app marker: ${marker}`);
  }

  const phase = Number(html.match(/name="sautilink-release-generation" content="([0-9]+)"/)?.[1] || 0);
  assert.ok(phase >= 20, `app milestone regressed below Phase 20: ${phase}`);

  assert.match(css, /\.circles-surface/);
  assert.match(css, /\.circle-card/);
  assert.match(css, /\.circle-detail-card/);
  assert.match(css, /\.circle-requests/);
});

test('Phase 20 Circles migration enforces private, approval and open membership boundaries', async () => {
  const base = await read('supabase/migrations/20260901161000_enable_phase20_circles_mvp.sql');
  const recursionFix = await read('supabase/migrations/20260901162000_fix_phase20_circle_policy_recursion.sql');
  const securityFix = await read('supabase/migrations/20260901163000_fix_phase20_circle_approval_security.sql');
  const reentryFix = await read('supabase/migrations/20260901164000_allow_phase20_circle_request_reentry.sql');
  const sql = [base, recursionFix, securityFix, reentryFix].join('\n');

  assert.match(base, /array\['open', 'approval', 'private'\]/i);
  assert.match(base, /create table public\.social_circle_join_requests/i);
  assert.match(base, /alter table public\.social_circles force row level security/i);
  assert.match(base, /alter table public\.social_circle_members force row level security/i);
  assert.match(base, /alter table public\.social_circle_join_requests force row level security/i);
  assert.match(base, /revoke all on table public\.social_circles from public, anon, authenticated/i);
  assert.match(base, /grant update \(name, description, join_policy\) on table public\.social_circles to authenticated/i);
  assert.doesNotMatch(base, /grant update \([^)]*owner_id/i);
  assert.doesNotMatch(base, /grant update \([^)]*slug/i);

  assert.match(securityFix, /create schema if not exists policy_private/i);
  assert.match(securityFix, /security definer/i);
  assert.match(securityFix, /grant usage on schema policy_private to authenticated/i);
  assert.match(securityFix, /grant execute on function policy_private\.can_insert_phase20_circle_member/i);
  assert.match(securityFix, /actor is null or actor <> circle_owner/i);
  assert.match(sql, /delete from public\.social_circle_members membership/i);
  assert.match(reentryFix, /cleanup_phase20_circle_request_after_leave/i);
});

test('Phase 20 browser source supports Circle list, detail and membership actions without privileged keys', async () => {
  const source = await read('src/app.js');
  const router = await read('src/asset-router.js');

  for (const marker of [
    'loadCircles',
    'loadCircleDetail',
    'handleCirclePrimaryAction',
    'decideCircleRequest',
    "from('social_circles')",
    "from('social_circle_members')",
    "from('social_circle_join_requests')",
    '/app/sautify',
  ]) {
    assert.ok(source.includes(marker), `source missing Phase 20 marker: ${marker}`);
  }

  assert.doesNotMatch(source, /service_role|sb_secret_/i);
  assert.match(router, /CIRCLE_ROUTE/);
  assert.match(router, /sautify\|circles/);
});

test('Phase 20 generated browser bundle and service worker move forward together', async () => {
  const bundle = await read('app/assets/app.js');
  const sw = await read('sw.js');

  assert.ok(bundle.includes('social_circles'), 'generated app bundle is missing Circles data source');
  assert.ok(bundle.includes('/app/sautify'), 'generated app bundle is missing Sautify route');
  const version = Number(sw.match(/sautilink-shell-v([0-9]+)/)?.[1] || 0);
  assert.ok(version >= 10, `service worker cache regressed below Phase 20: ${version}`);
});
