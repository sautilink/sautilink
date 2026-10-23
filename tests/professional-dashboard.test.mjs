import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { transformPostViewMetricsSource } from '../scripts/post-view-metrics-source-transform.mjs';
import { postTextPlainText } from '../src/post-text-formatting.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('dashboard top-content captions show plain formatted text, retain literal markers and limit visible copy to 110 characters', async () => {
  const source = await read('src/professional-dashboard.js');
  const start = source.indexOf('function renderTopPosts(');
  const end = source.indexOf('function setStatus(', start);
  assert.ok(start >= 0 && end > start);
  class Element {
    constructor(tag) { this.tagName = tag; this.children = []; this.textContent = ''; }
    append(...nodes) { this.children.push(...nodes); }
    setAttribute() {}
    replaceChildren(...nodes) { this.children = nodes; }
  }
  const list = new Element('div');
  const stats = [];
  const render = runInNewContext(`${source.slice(start, end)}\nrenderTopPosts;`, {
    document: { createElement: (tag) => new Element(tag) },
    byId: (id) => { assert.equal(id, 'professional-top-content-list'); return list; },
    postTextPlainText,
    stat: (label, value) => { stats.push({ label, value }); return new Element('span'); },
    Intl, Date, dashboardPreviewRequests: new Set(), dashboardOwnerId: 'owner',
  });
  const cases = [
    [' **A fresh perspective.** *One* __two__ ~~three~~ ***both*** ', 'A fresh perspective. One two three both'],
    ['**Bold with *italic* and __underline__**', 'Bold with italic and underline'],
    ['Keep **unfinished and @user_name #tag_name', 'Keep **unfinished and @user_name #tag_name'],
    ['2 * 3 * 4 and https://example.com/a_b', '2 * 3 * 4 and https://example.com/a_b'],
    [`**${'x'.repeat(120)}**`, 'x'.repeat(110)],
    ['   ', 'Media post'],
    [undefined, 'Media post'],
  ];
  for (const [body, expected] of cases) {
    const post = { id: 'actual-post', body, created_at: '2026-10-20T12:00:00Z', views: 12, engagement: 3 };
    render([post]);
    assert.equal(list.children.length, 1);
    const card = list.children[0];
    assert.equal(card.className, 'professional-top-post');
    assert.equal(card.children[0].children[1].children[0].textContent, expected);
    assert.equal(card.children[0].children[1].children[1].textContent,
      new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(post.created_at)));
    assert.deepEqual(stats.splice(0), [{ label: 'views', value: 12 }, { label: 'engagements', value: 3 }]);
    assert.equal(post.body, body, 'presentation must not alter the stored caption');
  }
  render([]);
  assert.equal(list.children[0].textContent, 'Publish posts to start seeing content performance here.');
});

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

test('a protected dashboard preview cannot appear after an owner change or dashboard close', async () => {
  const source = await read('src/professional-dashboard.js');
  const start = source.indexOf('function clearDashboardPreviews('), end = source.indexOf('function renderTopPosts(', start);
  for (const close of [false, true]) {
    const state = { member: 'owner', fetches: [], attached: [], created: [] };
    let release;
    const response = new Promise((resolve) => { release = resolve; });
    let fetched;
    const entered = new Promise((resolve) => { fetched = resolve; });
    const context = {
      document: { createElement: () => ({}) },
      dashboardPreviewRequests: new Set(), dashboardPreviewUrls: new Map(),
      dashboardOpen: true, dashboardOwnerId: 'owner', getCurrentMemberId: () => state.member,
      analyticsClient: { auth: { getSession: async () => ({ data: { session: { access_token: 'private-token' } } }) } },
      AbortController, window: { setTimeout: () => 1, clearTimeout() {} },
      URL: { createObjectURL: (blob) => { state.created.push(blob); return 'blob:private-preview'; }, revokeObjectURL() {} },
      fetch: async (url, options) => { state.fetches.push({ url, options }); fetched(); return response; },
    };
    const api = runInNewContext(`${source.slice(start, end)}\n({hydrateDashboardPreview,clearDashboardPreviews});`, context);
    const host = { isConnected: true, replaceChildren: (...children) => state.attached.push(children) };
    const pending = api.hydrateDashboardPreview({ id: 'real-media', media_kind: 'image' }, host, 'owner');
    await entered;
    assert.equal(state.fetches[0].url, '/api/sauti-media/real-media?w=320');
    assert.equal(state.fetches[0].options.headers.Authorization, 'Bearer private-token');
    if (close) {
      context.dashboardOpen = false;
      api.clearDashboardPreviews();
      assert.equal(state.fetches[0].options.signal.aborted, true);
    } else { state.member = 'other-owner'; context.dashboardOwnerId = 'other-owner'; }
    release({ ok: true, blob: async () => ({ type: 'image/jpeg' }) });
    await pending;
    assert.equal(state.created.length, 0);
    assert.equal(state.attached.length, 0);
    assert.equal(context.dashboardPreviewRequests.size, 0);
  }
});
