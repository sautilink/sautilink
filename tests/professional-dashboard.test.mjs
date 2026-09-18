import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transformPostViewMetricsSource } from '../scripts/post-view-metrics-source-transform.mjs';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('profile owner dashboard reuses the canonical Edit profile control and adds Dashboard beside it', async () => {
  const source = await read('src/professional-dashboard.js');
  const css = await read('app/assets/professional-dashboard.css');

  assert.match(source, /getElementById\('profile-edit-button'\)|byId\('profile-edit-button'\)/);
  assert.match(source, /profile-owner-dashboard-actions/);
  assert.match(source, /profile-dashboard-button/);
  assert.match(source, /row\.append\(edit, dashboard\)/);
  assert.match(source, /row\.hidden = !owner/);
  assert.match(css, /grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\)/);
  assert.match(css, /@media \(max-width: 680px\)/);
});

test('dashboard exposes Facebook-style insights, earnings zero and monetisation coming soon without fake values', async () => {
  const source = await read('src/professional-dashboard.js');

  for (const marker of [
    'Insights',
    'Views',
    'Engagement',
    'Net follows',
    'Profile visits',
    'Estimated earnings',
    '$0.00',
    'Monetisation is coming soon',
    'Coming soon',
  ]) assert.match(source, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  assert.match(source, /older values are not estimated/);
  assert.match(source, /statistics have not been replaced with estimates/);
  assert.doesNotMatch(source, /Math\.random|fake|mock/i);
});

test('creator metrics are owner-only, event-driven and privacy preserving', async () => {
  const migration = await read('supabase/migrations/20260918122500_enable_profile_performance_dashboard.sql');

  assert.match(migration, /create table if not exists public\.social_profile_views/);
  assert.match(migration, /primary key \(profile_id, viewer_id, viewed_on\)/);
  assert.match(migration, /profile_id <> \(select auth\.uid\(\)\)/);
  assert.match(migration, /create table if not exists public\.social_creator_daily_metrics/);
  assert.match(migration, /create policy social_creator_daily_metrics_select_owner/);
  assert.match(migration, /using \(user_id = \(select auth\.uid\(\)\)\)/);
  assert.match(migration, /track_social_post_view_daily_metric/);
  assert.match(migration, /track_social_reaction_daily_metric/);
  assert.match(migration, /track_social_repost_daily_metric/);
  assert.match(migration, /track_social_reply_daily_metric/);
  assert.match(migration, /track_social_follow_daily_metric/);
  assert.match(migration, /record_social_profile_view/);
  assert.match(migration, /alter publication supabase_realtime add table public\.social_creator_daily_metrics/);

  assert.doesNotMatch(migration, /insert into public\.social_creator_daily_metrics \(user_id, metric_date, follows_gained\)[\s\S]*select followed_id/);
  assert.match(migration, /profile visits and follow deltas start at analytics launch and are never fabricated/i);
});

test('browser analytics use genuine Supabase rows with realtime plus a bounded polling fallback', async () => {
  const source = await read('src/professional-dashboard.js');

  assert.match(source, /\.from\(ANALYTICS_TABLE\)/);
  assert.match(source, /\.from\('social_post_metrics'\)/);
  assert.match(source, /\.from\('social_posts'\)/);
  assert.match(source, /\.channel\(`creator-dashboard:\$\{userId\}`\)/);
  assert.match(source, /postgres_changes/);
  assert.match(source, /POLL_MS = 15000/);
  assert.match(source, /record_social_profile_view/);
  assert.match(source, /Unique meaningful views of your posts/);
  assert.doesNotMatch(source, /innerHTML\s*=|insertAdjacentHTML|document\.write/);
  assert.doesNotMatch(source, /service_role|sb_secret_|SUPABASE_SERVICE_ROLE_KEY/i);
});

test('production source transform installs the professional dashboard with the existing Supabase client', async () => {
  const input = "import { installPostViewMetrics } from './post-view-metrics.js';\nconst supabase = {};\nlet currentMemberId = '';\n";
  const output = transformPostViewMetricsSource('/repo/src/app.js', input);

  assert.match(output, /import \{ installProfessionalDashboard \} from '\.\/professional-dashboard\.js'/);
  assert.match(output, /installPostViewMetrics\(\{[\s\S]*supabase,[\s\S]*getCurrentMemberId/);
  assert.match(output, /installProfessionalDashboard\(\{[\s\S]*supabase,[\s\S]*getCurrentMemberId/);
});
