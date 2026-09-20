import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('restricted comments use the author-to-viewer follow direction', async () => {
  const source = await read('src/app.js');

  assert.match(source, /function canCurrentMemberComment\(post, authorFollowsViewer = false\)/);
  assert.match(source, /post\.reply_access === 'following'\) return Boolean\(authorFollowsViewer\)/);
  assert.match(
    source,
    /\.from\('social_follows'\)[\s\S]*\.select\('follower_id'\)[\s\S]*\.in\('follower_id', authorIds\)[\s\S]*\.eq\('followed_id', currentMemberId\)/,
  );
  assert.match(source, /authorFollowsViewer: authorsFollowingViewer\.has\(post\.author_id\)/);
});

test('feed metadata and comment controls explain restrictions professionally', async () => {
  const [source, html, css] = await Promise.all([
    read('src/app.js'),
    read('app/index.html'),
    read('app/assets/app.css'),
  ]);

  const card = source.slice(source.indexOf('function createSautiCard'), source.indexOf('function renderStreamRows'));
  assert.match(card, /`\$\{audienceLabel\} · Limited comments`/);
  assert.doesNotMatch(card, /Comments: \$\{replyAccessLabel/);
  assert.match(card, /canComment \? 'Comment' : 'View comments'/);
  assert.match(card, /restriction\.textContent = commentRestrictionNotice\(post\)/);
  assert.match(css, /\.sauti-comment-restriction/);

  assert.match(html, /id="conversation-reply-restriction"/);
  assert.match(html, /id="conversation-reply-compose"/);
  assert.match(source, /compose\.hidden = !canComment/);
  assert.match(source, /restriction\.textContent = canComment \? '' : commentRestrictionNotice\(post\)/);
});

test('database and API remain the final authority for restricted comments', async () => {
  const [api, migration] = await Promise.all([
    read('src/social-interactions-api.js'),
    read('supabase/migrations/20260901205349_enable_phase25_advanced_sauti_composer.sql'),
  ]);

  assert.match(api, /follower_id: `eq\.\$\{post\.author_id\}`/);
  assert.match(api, /followed_id: `eq\.\$\{session\.user\.id\}`/);
  assert.match(api, /COMMENTS_RESTRICTED/);
  assert.match(migration, /follow\.follower_id = post\.author_id/);
  assert.match(migration, /follow\.followed_id = \(select auth\.uid\(\)\)/);
});
