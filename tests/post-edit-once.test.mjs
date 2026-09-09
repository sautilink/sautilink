import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('database permits exactly one author text edit without changing feed order fields', async () => {
  const migration = await read('supabase/migrations/20260909152500_enable_one_time_post_edits.sql');

  assert.match(migration, /add column if not exists edited_at timestamptz/);
  assert.match(migration, /add column if not exists edit_count smallint not null default 0/);
  assert.match(migration, /check \(edit_count between 0 and 1\)/);
  assert.match(migration, /select \*\s+into v_post[\s\S]*for update;/);
  assert.match(migration, /v_post\.author_id <> v_user_id/);
  assert.match(migration, /v_post\.edit_count >= 1/);
  assert.match(migration, /body = v_body,[\s\S]*edited_at = clock_timestamp\(\),[\s\S]*updated_at = clock_timestamp\(\),[\s\S]*edit_count = 1/);
  assert.doesNotMatch(migration, /set[\s\S]{0,240}created_at\s*=/i);
  assert.match(migration, /grant execute on function public\.edit_social_post_once\(uuid, text\) to authenticated, service_role/);
});

test('PATCH edit API accepts text only and delegates to the atomic RPC', async () => {
  const api = await read('src/sauti-posts-api.js');
  const start = api.indexOf('async function editSauti');
  const end = api.indexOf('async function deleteSauti');
  const edit = api.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(api, /postId && request\.method === 'PATCH'/);
  assert.match(edit, /keys\.length !== 1 \|\| keys\[0\] !== 'body'/);
  assert.match(edit, /rpc\/edit_social_post_once/);
  assert.match(edit, /POST_ALREADY_EDITED/);
  assert.doesNotMatch(edit, /social_post_media/);
  assert.doesNotMatch(edit, /SAUTI_MEDIA/);
});

test('post editor implementation remains author-scoped and text-only while startup hotfix isolates it', async () => {
  const ui = await read('src/post-edit.js');
  const css = await read('app/assets/post-edit.css');

  assert.match(ui, /metadata\?\.author_id !== userId/);
  assert.match(ui, /You can edit this post once\. Attached media stays unchanged\./);
  assert.match(ui, /method: 'PATCH'/);
  assert.match(ui, /JSON\.stringify\(\{ body \}\)/);
  assert.match(ui, /postEditCards\(postId\)\.forEach/);
  assert.match(ui, /markPostEdited/);
  assert.doesNotMatch(ui, /location\.reload/);
  assert.doesNotMatch(ui, /sauti-media\/upload/);
  assert.match(css, /\.post-edit-dialog/);
});

test('post editor is not globally injected into startup bundles during bootstrap hotfix', async () => {
  const [builder, productionBuilder, packageJson] = await Promise.all([
    read('scripts/build-app.mjs'),
    read('scripts/build-production-release.mjs'),
    read('package.json'),
  ]);

  assert.doesNotMatch(builder, /src\/post-edit\.js/);
  assert.doesNotMatch(productionBuilder, /resolve\(workerSource, 'post-edit\.js'\)/);
  assert.doesNotMatch(packageJson, /--inject:\.\/src\/post-edit\.js/);
});

test('Home stream position remains based on created_at rather than edit timestamps', async () => {
  const streamMigration = await read('supabase/migrations/20260906221500_restore_home_stream_top_level_posts.sql');
  assert.match(streamMigration, /post\.created_at as event_at/);
  assert.doesNotMatch(streamMigration, /post\.updated_at as event_at/);
  assert.doesNotMatch(streamMigration, /post\.edited_at as event_at/);
});
