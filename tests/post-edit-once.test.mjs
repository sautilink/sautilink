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

test('post editor is a separate production asset loaded for author cards after app startup', async () => {
  const [builder, productionBuilder, previewBuilder, packageJson, app, profile] = await Promise.all([
    read('scripts/build-app.mjs'),
    read('scripts/build-production-release.mjs'),
    read('scripts/stage-preview-site.mjs'),
    read('package.json'),
    read('src/app.js'),
    read('src/profile-activity.js'),
  ]);

  assert.match(builder, /entryPoints: \[resolve\(projectRoot, 'src\/post-edit\.js'\)\]/);
  assert.match(productionBuilder, /entryPoints: \[resolve\(workerSource, 'post-edit\.js'\)\]/);
  assert.doesNotMatch(packageJson, /--inject:\.\/src\/post-edit\.js/);
  assert.match(app, /if \(post\.author_id === currentMemberId && !post\.parent_post_id\) void loadPostEditor\(\)/);
  assert.match(app, /import\(new URL\('\/app\/assets\/post-edit\.js\?v=/);
  assert.match(app, /editor\.handlePostEditClick\(button\)/);
  assert.match(app, /__sautilinkPostEditUserId = \(\) => currentMemberId/);
  assert.match(profile, /__sautilinkLoadPostEditor\?\.\(\)/);
  assert.match(profile, /edit\.dataset\.postEdit = String\(item\.id\)/);
  assert.match(previewBuilder, /rm\(resolve\(stageRoot, 'app\/assets\/post-edit\.js'\), \{ force: true \}\)/);
});

test('captionless own posts show disabled Edit; posts with a caption can open it', async () => {
  const ui = await read('src/post-edit.js');
  const source = ui.match(/function createPostEditMenuButton\([\s\S]*?\r?\n}\r?\n\r?\nfunction decorateEditableCard/)?.[0]
    .replace(/\r?\n\r?\nfunction decorateEditableCard$/, '');
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

test('own post Edit is present in the Home menu before the lazy editor finishes loading', async () => {
  const app = await read('src/app.js');
  const source = app.match(/function createHomePostHeadActions\([\s\S]*?\r?\n}\r?\n\r?\nlet postEditorPromise/)?.[0]
    .replace(/\r?\n\r?\nlet postEditorPromise$/, '');
  assert.ok(source);
  class Node {
    constructor() { this.children = []; this.dataset = {}; this.classList = { toggle() {} }; }
    append(...children) { this.children.push(...children); }
    setAttribute() {}
    querySelector(selector) {
      if (selector === '[data-home-post-action="copy-link"]') {
        return this.children.find((child) => child.dataset.homePostAction === 'copy-link') || null;
      }
      return null;
    }
    insertBefore(child, reference) {
      const index = this.children.indexOf(reference);
      this.children.splice(index < 0 ? this.children.length : index, 0, child);
    }
  }
  const create = runInNewContext(`${source}\ncreateHomePostHeadActions`, {
    currentMemberId: 'member',
    document: { createElement: () => new Node() },
    homePostMoreIcon: () => new Node(),
    homePostMenuItem: (action) => {
      const node = new Node();
      node.dataset.homePostAction = action;
      return node;
    },
  });
  const editFor = (post) => {
    const controls = create({}, post, 'member');
    const shell = controls.children.find((child) => child.dataset.homePostMenu !== undefined);
    return shell.children[1].children.find((child) => child.dataset.postEdit);
  };
  assert.equal(editFor({ id: 'post', author_id: 'member', body: 'Caption', edit_count: 0 })?.disabled, false);
  assert.equal(editFor({ id: 'post', author_id: 'member', body: '', edit_count: 0 })?.disabled, true);
  assert.equal(editFor({ id: 'post', author_id: 'member', body: 'Caption', edit_count: 1 }), undefined);
  assert.equal(editFor({ id: 'post', author_id: 'other', body: 'Caption', edit_count: 0 }), undefined);
  assert.equal(editFor({ id: 'post', author_id: 'member', parent_post_id: 'parent', body: 'Caption', edit_count: 0 }), undefined);
});

test('an immediate Edit click loads post state and refuses an already edited post', async () => {
  const ui = await read('src/post-edit.js');
  const source = ui.match(/export async function handlePostEditClick\([\s\S]*?\r?\n}\r?\n\r?\nensurePostEditStyles/)?.[0]
    .replace(/^export /, '')
    .replace(/\r?\n\r?\nensurePostEditStyles$/, '');
  assert.ok(source);
  const metadata = new Map();
  const calls = { fetched: 0, opened: 0, marked: 0 };
  const card = { dataset: { postId: 'post' } };
  const button = {
    dataset: { postEdit: 'post' },
    isConnected: true,
    disabled: false,
    closest: (selector) => selector === '.sauti-card, .profile-activity-card' ? card : null,
  };
  const click = runInNewContext(`${source}\nhandlePostEditClick`, {
    postEditMeta: metadata,
    postEditCurrentUserId: async () => 'member',
    fetchPostEditMetadata: async () => {
      calls.fetched += 1;
      metadata.set('post', { author_id: 'member', body: 'Caption', edit_count: 0 });
    },
    postEditCards: () => [card],
    markPostEdited: () => { calls.marked += 1; },
    openPostEdit: () => { calls.opened += 1; },
    document: { getElementById: () => null },
    window: { setTimeout() {} },
  });
  await click(button);
  assert.deepEqual(calls, { fetched: 1, opened: 1, marked: 0 });
  assert.equal(button.disabled, false);

  metadata.set('post', { author_id: 'member', body: 'Caption', edit_count: 1 });
  await click(button);
  assert.deepEqual(calls, { fetched: 1, opened: 1, marked: 1 });
});

test('Home stream position remains based on created_at rather than edit timestamps', async () => {
  const streamMigration = await read('supabase/migrations/20260906221500_restore_home_stream_top_level_posts.sql');
  assert.match(streamMigration, /post\.created_at as event_at/);
  assert.doesNotMatch(streamMigration, /post\.updated_at as event_at/);
  assert.doesNotMatch(streamMigration, /post\.edited_at as event_at/);
});
