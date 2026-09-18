import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transformPostViewMetricsSource } from '../scripts/post-view-metrics-source-transform.mjs';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Professional Dashboard has canonical browser routes without replacing the existing dashboard implementation', async () => {
  const source = await read('src/app.js');
  const transformed = transformPostViewMetricsSource('/repo/src/app.js', source);

  assert.match(transformed, /function professionalDashboardRouteKind/);
  assert.match(transformed, /normalized === '\/dashboard'/);
  assert.match(transformed, /normalized === '\/dashboard\/tools'/);
  assert.match(transformed, /moneti\[sz\]ation/);
  assert.match(transformed, /return '\/dashboard\/tools\/monetisation'/);
  assert.match(transformed, /target\.closest\('#profile-dashboard-button'\)/);
  assert.match(transformed, /window\.history\.pushState\(\{\}, '', path\)/);
  assert.match(transformed, /window\.history\.replaceState\(\{\}, '', canonicalPath\)/);
  assert.match(transformed, /showMemberSurface\('profile', \{ syncUrl: false \}\)/);
  assert.match(transformed, /const professionalDashboardRoute = professionalDashboardRouteKind\(window\.location\.pathname\)/);
});

test('Worker, static rewrites and service worker all recognize Dashboard deep links', async () => {
  const [router, redirects, serviceWorker] = await Promise.all([
    read('src/asset-router.js'),
    read('_redirects'),
    read('sw.js'),
  ]);

  assert.match(router, /const CLEAN_DASHBOARD_ROUTE = \/\^\\\/dashboard/);
  assert.match(router, /CLEAN_DASHBOARD_ROUTE\.test\(url\.pathname\)/);
  assert.match(router, /CLEAN_ROUTE_PREFIX[\s\S]*dashboard/);
  assert.match(redirects, /\/dashboard \/app\/ 200/);
  assert.match(redirects, /\/dashboard\/\* \/app\/ 200/);
  assert.match(serviceWorker, /notifications\|dashboard/);
  assert.match(serviceWorker, /fetch\(event\.request, \{ cache: "no-store" \}\)/);
});

test('analytics view RPCs can use ON CONFLICT without exposing viewer identity rows', async () => {
  const [postViews, dashboardViews, permissionFix] = await Promise.all([
    read('supabase/migrations/20260914041500_enable_post_view_metrics.sql'),
    read('supabase/migrations/20260918122500_enable_profile_performance_dashboard.sql'),
    read('supabase/migrations/20260918144500_fix_analytics_view_recording_permissions.sql'),
  ]);

  assert.match(postViews, /on conflict \(post_id, viewer_id\) do nothing/);
  assert.match(dashboardViews, /on conflict \(profile_id, viewer_id, viewed_on\) do nothing/);
  assert.match(permissionFix, /grant select, insert on table public\.social_post_views to authenticated/);
  assert.match(permissionFix, /grant select, insert on table public\.social_profile_views to authenticated/);
  assert.doesNotMatch(permissionFix, /create policy[\s\S]*for select/i);
});

test('post views remain meaningful unique views rather than raw impressions', async () => {
  const runtime = await read('src/post-view-metrics.js');
  assert.match(runtime, /MEANINGFUL_VIEW_MS = 1000/);
  assert.match(runtime, /VIEW_THRESHOLD = 0\.5/);
  assert.match(runtime, /authorId === memberId/);
  assert.match(runtime, /rpc\('record_social_post_view'/);
});
