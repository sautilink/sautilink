import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('plain reposts are removed from the Home stream without changing the repost table or action', async () => {
  const migration = await read('supabase/migrations/20260906192500_move_reposts_to_profile_activity.sql');
  const phase17 = await read('supabase/migrations/20260831211800_enable_phase17_social_interactions.sql');

  assert.match(migration, /create or replace view public\.social_stream_events[\s\S]*?'post'::text as event_type/i);
  const homeView = migration.match(/create or replace view public\.social_stream_events[\s\S]*?from public\.social_posts post;/i)?.[0] || '';
  assert.ok(homeView, 'expected the replacement Home stream view');
  assert.doesNotMatch(homeView, /social_reposts|union all|'repost'::text/i);

  assert.match(phase17, /create table if not exists public\.social_reposts/i);
  assert.match(phase17, /sync_social_repost_counts/i);
});

test('profile activity exposes a dedicated Reposts tab backed by canonical repost rows', async () => {
  const migration = await read('supabase/migrations/20260906192500_move_reposts_to_profile_activity.sql');
  const source = await read('src/profile-activity.js');

  assert.match(migration, /'reposts', true/i);
  assert.match(migration, /create or replace function public\.profile_reposts_feed_phase35/i);
  assert.match(migration, /from public\.social_reposts repost/i);
  assert.match(migration, /repost\.user_id = v_target_id/i);
  assert.match(migration, /p\.circle_id is null/i);
  assert.match(migration, /security invoker/i);
  assert.match(migration, /grant execute on function public\.profile_reposts_feed_phase35\(text, integer, integer\) to authenticated/i);

  assert.match(source, /\['posts', 'reposts', 'replies', 'likes', 'saves', 'hashtags'\]/);
  assert.match(source, /reposts: 'Reposts'/);
  assert.match(source, /safeTab === 'reposts'/);
  assert.match(source, /profile_reposts_feed_phase35/);
  assert.match(source, /You haven’t reposted anything yet\./);
  assert.match(source, /When this account reposts a post, you’ll see it here\./);
});

test('reposts remain separate from profile pinning and activity privacy controls', async () => {
  const source = await read('src/profile-activity.js');

  assert.match(source, /allowPin: tab === 'posts' \|\| tab === 'replies'/);
  assert.doesNotMatch(source, /repostsVisibility|reposts_visibility/i);
  assert.match(source, /Choose who can see your Likes, Saves and Hashtags/);
});
