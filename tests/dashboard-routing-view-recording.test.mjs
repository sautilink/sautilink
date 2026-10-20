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

test('Dashboard deep links wait for persisted auth restoration instead of forcing a signed-out screen', async () => {
  const source = await read('src/app.js');
  const transformed = transformPostViewMetricsSource('/repo/src/app.js', source);
  const routeStart = transformed.indexOf('const professionalDashboardRoute = professionalDashboardRouteKind(window.location.pathname);');
  assert.notEqual(routeStart, -1);
  const routeBlock = transformed.slice(routeStart, routeStart + 520);

  assert.match(routeBlock, /if \(currentMember\?\.username\) \{/);
  assert.match(routeBlock, /if \(openProfessionalDashboardRoute\(professionalDashboardRoute\)\) return;/);
  assert.match(routeBlock, /if \(!currentMember\) return;/);
  assert.doesNotMatch(routeBlock, /showSignedOut\('login'\)/);
});

test('Worker, static rewrites and service worker all recognize Dashboard deep links', async () => {
  const [router, redirects, serviceWorker, productionBuilder] = await Promise.all([
    read('src/asset-router.js'),
    read('_redirects'),
    read('sw.js'),
    read('scripts/build-production-release.mjs'),
  ]);

  assert.match(router, /const CLEAN_DASHBOARD_ROUTE = \/\^\\\/dashboard/);
  assert.match(router, /CLEAN_DASHBOARD_ROUTE\.test\(url\.pathname\)/);
  assert.match(router, /CLEAN_ROUTE_PREFIX[\s\S]*dashboard/);
  assert.match(redirects, /\/dashboard \/app\/ 200/);
  assert.match(redirects, /\/dashboard\/\* \/app\/ 200/);
  assert.match(serviceWorker, /notifications\|dashboard/);
  assert.match(serviceWorker, /fetch\(event\.request, \{ cache: "no-store" \}\)/);
  assert.match(productionBuilder, /APP_JS_FEATURE_RELEASE = '20260919-mobilesettings1'/);
  assert.match(productionBuilder, /app\.js\?v=\$\{APP_JS_RELEASE\}&feature=\$\{APP_JS_FEATURE_RELEASE\}/);
});

test('analytics view RPCs dedupe with unique constraints while viewer rows stay unreadable', async () => {
  const [postViews, dashboardViews, hardening] = await Promise.all([
    read('supabase/migrations/20260914041500_enable_post_view_metrics.sql'),
    read('supabase/migrations/20260918122500_enable_profile_performance_dashboard.sql'),
    read('supabase/migrations/20260918145500_harden_analytics_view_recording_rpc.sql'),
  ]);

  assert.match(postViews, /primary key \(post_id, viewer_id\)/);
  assert.match(dashboardViews, /primary key \(profile_id, viewer_id, viewed_on\)/);
  assert.match(hardening, /revoke select on table public\.social_post_views from authenticated/);
  assert.match(hardening, /revoke select on table public\.social_profile_views from authenticated/);
  assert.match(hardening, /insert into public\.social_post_views[\s\S]*when unique_violation then[\s\S]*return false/);
  assert.match(hardening, /insert into public\.social_profile_views[\s\S]*when unique_violation then[\s\S]*return false/);
  assert.match(hardening, /security invoker/g);
});

test('post views remain meaningful unique views rather than raw impressions', async () => {
  const runtime = await read('src/post-view-metrics.js');
  assert.match(runtime, /MEANINGFUL_VIEW_MS = 1000/);
  assert.match(runtime, /VIEW_THRESHOLD = 0\.5/);
  assert.match(runtime, /authorId === memberId/);
  assert.match(runtime, /rpc\('record_social_post_view'/);
});
