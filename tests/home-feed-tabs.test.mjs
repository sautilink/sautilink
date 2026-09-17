import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Home exposes three accessible feeds with For You selected by default', async () => {
  const [html, source, css] = await Promise.all([
    read('app/index.html'),
    read('src/app.js'),
    read('app/assets/app.css'),
  ]);

  assert.match(html, /id="home-feed-tabs" role="tablist"/);
  assert.match(html, /data-home-feed-tab="following"/);
  assert.match(html, /<button[^>]*aria-selected="true"[^>]*data-home-feed-tab="for-you"/);
  assert.match(html, /data-home-feed-tab="short-videos"/);
  assert.match(source, /let activeHomeFeed = 'for-you'/);
  assert.match(source, /ArrowLeft.*ArrowRight.*Home.*End/);
  assert.match(css, /\.home-feed-tabs[\s\S]*grid-template-columns: repeat\(3/);
  assert.match(css, /\.home-feed-tab\.active::after/);
});

test('Home feeds are chronological and apply only the requested audience filter', async () => {
  const [source, migration] = await Promise.all([
    read('src/app.js'),
    read('supabase/migrations/20260917155622_simplify_home_feeds.sql'),
  ]);

  assert.match(source, /supabase\.rpc\('social_home_feed'/);
  assert.match(source, /p_mode: HOME_FEED_COPY\[modeAtRequest\]\.rpcMode/);
  assert.match(migration, /security invoker/i);
  assert.match(migration, /social_follows/);
  assert.match(migration, /follow\.follower_id = \(select auth\.uid\(\)\)/);
  assert.match(migration, /follow\.followed_id = post\.author_id/);
  assert.doesNotMatch(migration, /post\.author_id = \(select auth\.uid\(\)\)/);
  assert.match(migration, /order by post\.created_at desc, post\.id desc/);
  assert.match(migration, /parent_post_id is null/);
  assert.match(migration, /grant execute[\s\S]*to authenticated/);
  assert.doesNotMatch(migration, /affinity|interest|reaction|saved|repost/i);
});

test('Short Videos tab filters video posts and opens the existing canonical viewer', async () => {
  const [source, shortVideos, migration] = await Promise.all([
    read('src/app.js'),
    read('src/short-videos-feed.js'),
    read('supabase/migrations/20260917155622_simplify_home_feeds.sql'),
  ]);

  assert.match(source, /sautilink:open-short-videos/);
  assert.match(shortVideos, /addEventListener\('sautilink:open-short-videos'/);
  assert.match(shortVideos, /openFirstShortVideo/);
  assert.match(shortVideos, /availableKeys/);
  assert.match(migration, /p_mode <> 'short_videos'[\s\S]*media_kind = 'video'/);
  assert.doesNotMatch(source, /createShortVideoSlide/);
});

test('Home feed copy is localized in Kiswahili and French', async () => {
  const language = await read('src/language-preference.js');

  assert.match(language, /'For You': 'Kwa Ajili Yako'/);
  assert.match(language, /'Short Videos': 'Video Fupi'/);
  assert.match(language, /'For You': 'Pour vous'/);
  assert.match(language, /'Short Videos': 'Vidéos courtes'/);
});
