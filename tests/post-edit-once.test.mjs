import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

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
  assert.match(edit, /POST_EDIT_CAPTION_REQUIRED/);
  assert.doesNotMatch(edit, /social_post_media/);
  assert.doesNotMatch(edit, /SAUTI_MEDIA/);
});

test('database refuses edits when the original post has no caption or is a reply', async () => {
  const migration = await read('supabase/migrations/20261003162634_restrict_post_edits_to_existing_captions.sql');
  assert.match(migration, /v_post\.author_id <> v_user_id/);
  assert.match(migration, /v_post\.parent_post_id is not null/);
  assert.match(migration, /btrim\(coalesce\(v_post\.body, ''\)\) = ''/);
  assert.match(migration, /POST_EDIT_CAPTION_REQUIRED/);
  assert.match(migration, /v_post\.edit_count >= 1/);
  assert.match(migration, /set\s+body = v_body/);
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
  assert.match(ui, /media\.insertAdjacentElement\('beforebegin', caption\)/);
  assert.doesNotMatch(ui, /author\.className = 'sauti-caption-author'/);
  assert.doesNotMatch(ui, /location\.reload/);
  assert.doesNotMatch(ui, /sauti-media\/upload/);
  assert.match(css, /\.post-edit-dialog/);
  assert.match(ui, /button\.disabled = !hasCaption/);
  assert.match(ui, /metadata\.parent_post_id/);
  assert.match(css, /\.sauti-head-menu-item\[data-post-edit\]:disabled/);
});

test('post editor is a separate asset loaded for author cards after app startup', async () => {
  const [builder, productionBuilder, packageJson, app, profile] = await Promise.all([
    read('scripts/build-app.mjs'),
    read('scripts/build-production-release.mjs'),
    read('package.json'),
    read('src/app.js'),
    read('src/profile-activity.js'),
  ]);

  assert.match(builder, /entryPoints: \[resolve\(projectRoot, 'src\/post-edit\.js'\)\]/);
  assert.match(productionBuilder, /entryPoints: \[resolve\(workerSource, 'post-edit\.js'\)\]/);
  assert.doesNotMatch(packageJson, /--inject:\.\/src\/post-edit\.js/);
  assert.match(app, /post\.author_id === currentMemberId && !post\.parent_post_id\) void loadPostEditor\(\)/);
  assert.match(app, /import\(new URL\('\/app\/assets\/post-edit\.js\?v=/);
  assert.match(profile, /__sautilinkLoadPostEditor\?\.\(\)/);
});

test('captionless own posts show disabled Edit; posts with a caption can open it', async () => {
  const ui = await read('src/post-edit.js');
  const source = ui.match(/function createPostEditMenuButton\([\s\S]*?\n}\n\nfunction decorateEditableCard/)?.[0]
    .replace(/\n\nfunction decorateEditableCard$/, '');
  assert.ok(source);
  const buttons = runInNewContext(`${source}\n({ menu: createPostEditMenuButton, inline: createPostEditInlineButton })`, {
    document: { createElement: () => ({ dataset: {}, children: [], append(child) { this.children.push(child); }, setAttribute() {} }) },
  });
  for (const type of ['menu', 'inline']) {
    assert.equal(buttons[type]('post-id', false).disabled, true);
    assert.equal(buttons[type]('post-id', true).disabled, false);
  }
  assert.match(ui, /const hasCaption = Boolean\(String\(metadata\.body \|\| ''\)\.trim\(\)\)/);
  assert.match(ui, /metadata\.parent_post_id\) return/);
});

test('Home stream position remains based on created_at rather than edit timestamps', async () => {
  const streamMigration = await read('supabase/migrations/20260906221500_restore_home_stream_top_level_posts.sql');
  assert.match(streamMigration, /post\.created_at as event_at/);
  assert.doesNotMatch(streamMigration, /post\.updated_at as event_at/);
  assert.doesNotMatch(streamMigration, /post\.edited_at as event_at/);
});
