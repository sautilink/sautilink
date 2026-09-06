import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Home alone receives compact follow and post-menu header controls', async () => {
  const [source, css] = await Promise.all([
    read('src/app.js'),
    read('app/assets/app.css'),
  ]);

  assert.match(source, /function createSautiCard\(item, \{ home = false \} = \{\}\)/);
  assert.match(source, /createSautiCard\(item, \{ home: true \}\)/);
  assert.match(source, /if \(home\) head\.append\(createHomePostHeadActions/);
  assert.match(source, /follow\.dataset\.homeFollow = ''/);
  assert.match(source, /follow\.textContent = following \? 'Following' : 'Follow'/);
  assert.match(source, /upper\.setAttribute\('d', 'M4 8h16'\)/);
  assert.match(source, /lower\.setAttribute\('d', 'M8 16h12'\)/);
  assert.match(css, /\.sauti-card-head-actions[\s\S]*margin-left: auto/);
  assert.match(css, /\.sauti-head-menu[\s\S]*background: var\(--app-panel\)/);
  assert.match(css, /\.sauti-head-follow\.following[\s\S]*color: var\(--app-text\)/);
});

test('follow state hydrates from Supabase and changes optimistically across author cards', async () => {
  const source = await read('src/app.js');

  assert.match(source, /\.from\('social_follows'\)[\s\S]*\.eq\('follower_id', currentMemberId\)[\s\S]*\.in\('followed_id', authorIds\)/);
  assert.match(source, /function setHomeAuthorFollowState\(authorId, following/);
  assert.match(source, /setHomeAuthorFollowState\(authorId, following, \{ pending: true \}\);[\s\S]*await socialMutation/);
  assert.match(source, /\/api\/social\/follow\/\$\{encodeURIComponent\(username\)\}/);
  assert.match(source, /currentMember\.following_count = Math\.max/);
  assert.match(source, /setHomeAuthorFollowState\(authorId, wasFollowing\)/);
});

test('Home menu exposes useful accessible actions and durable feed preferences', async () => {
  const [source, migration] = await Promise.all([
    read('src/app.js'),
    read('supabase/migrations/20260906090000_enable_home_feed_author_interests.sql'),
  ]);

  for (const label of ['View profile', 'Interested', 'Not interested', 'Copy link', 'Report']) {
    assert.match(source, new RegExp(label));
  }
  assert.match(source, /setAttribute\('aria-haspopup', 'menu'\)/);
  assert.match(source, /setAttribute\('role', 'menuitem'\)/);
  assert.match(source, /\.from\('social_feed_author_interests'\)\.upsert/);
  assert.match(source, /prioritizeHomeAuthorCards\(authorId\)/);
  assert.match(source, /\/api\/safety\/mute\/\$\{encodeURIComponent\(username\)\}/);
  assert.match(source, /Posts from @\$\{username\} won’t appear in Home/);
  assert.match(source, /openReportDialog\('post', card\.dataset\.postId/);

  assert.match(migration, /create table if not exists public\.social_feed_author_interests/);
  assert.match(migration, /primary key \(user_id, author_id\)/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /force row level security/);
  assert.match(migration, /to authenticated[\s\S]*using \(\(select auth\.uid\(\)\) = user_id\)/);
  assert.match(migration, /social_feed_author_interests_author_idx/);
});

test('Home header release cache is advanced for immediate browser pickup', async () => {
  const [html, sw] = await Promise.all([read('app/index.html'), read('sw.js')]);
  assert.match(html, /app\.css\?v=20260906-homehead/);
  assert.match(html, /app\.js\?v=20260906-homehead/);
  assert.match(sw, /sautilink-shell-v43/);
});
