import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transformPostViewMetricsSource } from '../scripts/post-view-metrics-source-transform.mjs';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('post view metrics count meaningful unique non-author views', async () => {
  const [runtime, migration] = await Promise.all([
    read('src/post-view-metrics.js'),
    read('supabase/migrations/20260914041500_enable_post_view_metrics.sql'),
  ]);

  assert.match(runtime, /MEANINGFUL_VIEW_MS = 1000/);
  assert.match(runtime, /VIEW_THRESHOLD = 0\.5/);
  assert.match(runtime, /intersectionRatio >= VIEW_THRESHOLD/);
  assert.match(runtime, /authorId === memberId/);
  assert.match(runtime, /rpc\('record_social_post_view'/);
  assert.match(runtime, /from\('social_post_metrics'\)/);
  assert.match(runtime, /data-sauti-metric/);
  assert.match(runtime, /insertBefore\(metric, saveAction\)/);

  assert.match(migration, /primary key \(post_id, viewer_id\)/i);
  assert.match(migration, /post\.author_id <> \(select auth\.uid\(\)\)/);
  assert.match(migration, /social_post_metrics_select_creator/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /on conflict \(post_id, viewer_id\) do nothing/);
  assert.match(migration, /increment_social_post_view_metric/);
});

test('conversation replies are excluded from post view metrics', async () => {
  const runtime = await read('src/post-view-metrics.js');

  assert.match(runtime, /THREAD_REPLY_SELECTOR = '\.thread-sauti'/);
  assert.match(runtime, /THREAD_CONTAINER_SELECTOR = '#conversation-thread'/);
  assert.match(runtime, /function isConversationReply\(card\)/);
  assert.match(runtime, /card\.matches\(THREAD_REPLY_SELECTOR\)/);
  assert.match(runtime, /card\.closest\(THREAD_CONTAINER_SELECTOR\)/);
  assert.match(runtime, /if \(isConversationReply\(card\)\) \{/);
  assert.match(runtime, /card\.querySelector\(VIEW_METRIC_SELECTOR\)\?\.remove\(\)/);
  assert.match(runtime, /intersectionObserver\.unobserve\(card\)/);
  assert.doesNotMatch(runtime, /conversation-root[^\n]*unobserve/);
});

test('post view metric is wired through both app builders', async () => {
  const [source, normal, production] = await Promise.all([
    read('src/app.js'),
    read('scripts/build-app.mjs'),
    read('scripts/build-production-release.mjs'),
  ]);
  const transformed = transformPostViewMetricsSource('/repo/src/app.js', source);

  assert.match(transformed, /installPostViewMetrics\(\{/);
  assert.match(transformed, /getCurrentMemberId: \(\) => currentMemberId/);

  for (const builder of [normal, production]) {
    assert.match(builder, /transformPostViewMetricsSource/);
    assert.match(builder, /post-view-metrics\.js/);
  }

  assert.match(production, /APP_JS_FEATURE_RELEASE = '\d{8}-[a-z0-9-]+'/);
  assert.match(production, /app\.js\?v=\$\{APP_JS_RELEASE\}&feature=\$\{APP_JS_FEATURE_RELEASE\}/);
});

test('creator metric reuses the 24px post action scale without becoming an action button', async () => {
  const [runtime, actionCss] = await Promise.all([
    read('src/post-view-metrics.js'),
    read('app/assets/post-media-carousel.css'),
  ]);

  assert.match(runtime, /className = 'sauti-action sauti-view-metric'/);
  assert.match(runtime, /pointerEvents = 'none'/);
  assert.doesNotMatch(runtime, /dataset\.sautiAction\s*=/);
  assert.match(actionCss, /\.sauti-action svg\s*\{[^}]*width:\s*24px;[^}]*height:\s*24px;/s);
});
