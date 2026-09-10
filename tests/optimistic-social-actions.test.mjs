import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

function functionSource(source, name, nextName) {
  const start = source.indexOf(`async function ${name}`);
  const end = source.indexOf(`\n${nextName}`, start);
  assert.ok(start >= 0 && end > start, `${name} source was not found`);
  return source.slice(start, end);
}

test('Profile Follow updates button and counts before awaiting the API', async () => {
  const source = await read('src/app.js');
  const block = functionSource(source, 'toggleProfileFollow', 'function renderProfile');

  const optimisticUpdate = block.indexOf('setProfileFollowState(profileId, following');
  const mutation = block.indexOf('await socialMutation');
  assert.ok(optimisticUpdate >= 0 && optimisticUpdate < mutation);
  assert.match(block, /nextFollowerCount/);
  assert.match(block, /currentMember\.following_count/);
  assert.match(block, /setProfileFollowState\(profileId, wasFollowing/);
  assert.doesNotMatch(block, /loadDiscoverableProfile/);
  assert.doesNotMatch(block, /button\.disabled = true/);
});

test('Profile Follow ignores stale hydration and reconciles quietly', async () => {
  const source = await read('src/app.js');

  assert.match(source, /let profileFollowStateRequest = 0/);
  assert.match(source, /requestId !== profileFollowStateRequest \|\| error/);
  assert.match(source, /button\.dataset\.pending === 'true'/);
  assert.match(source, /reconcileVisibleProfileFollowerCount\(profileId, mutationVersion\)/);
  assert.match(source, /mutationVersion === profileFollowMutationVersion/);
});

test('Like, repost and save use immediate shared-card state with rollback', async () => {
  const source = await read('src/app.js');
  const like = functionSource(source, 'toggleLike', 'async function toggleRepost');
  const repost = functionSource(source, 'toggleRepost', 'async function toggleSave');
  const save = functionSource(source, 'toggleSave', 'function conversationPath');

  for (const [block, action] of [[like, 'like'], [repost, 'repost'], [save, 'save']]) {
    assert.ok(block.indexOf(`setPostInteractionState(postId, '${action}'`) < block.indexOf('await '));
    assert.match(block, /dataset\.pending === 'true'/);
    assert.doesNotMatch(block, /button\.disabled = true/);
  }

  assert.match(like, /setPostInteractionState\(postId, 'like', active/);
  assert.match(repost, /setPostInteractionState\(postId, 'repost', active/);
  assert.match(save, /setPostInteractionState\(postId, 'save', active/);
  assert.doesNotMatch(repost, /loadStream/);
  assert.doesNotMatch(save, /loadSavedSauti/);
});

test('Optimistic action controls remain accessible and ship with a fresh cache marker', async () => {
  const [source, html, sw] = await Promise.all([
    read('src/app.js'),
    read('app/index.html'),
    read('sw.js'),
  ]);

  assert.match(source, /setAttribute\('aria-pressed', String\(active\)\)/);
  assert.match(source, /setAttribute\('aria-busy', String\(pending\)\)/);
  assert.match(html, /app\.css\?v=20260909-home-loading/);
  assert.match(html, /app\.js\?v=20260909-authsession4/);
  assert.match(sw, /sautilink-shell-v47/);
});
