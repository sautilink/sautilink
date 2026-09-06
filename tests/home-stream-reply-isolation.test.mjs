import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationPath = new URL('../supabase/migrations/20260906221500_restore_home_stream_top_level_posts.sql', import.meta.url);
const profileActivityPath = new URL('../supabase/migrations/20260905173000_enable_profile_activity_phase33.sql', import.meta.url);

async function read(path) {
  return readFile(path, 'utf8');
}

test('Home stream includes top-level posts only and excludes replies and Sautify posts', async () => {
  const source = await read(migrationPath);

  assert.match(source, /create or replace view public\.social_stream_events/);
  assert.match(source, /where post\.parent_post_id is null/);
  assert.match(source, /and post\.circle_id is null/);
  assert.match(source, /and post\.visibility in \('public', 'followers'\)/);
  assert.doesNotMatch(source, /from public\.social_reposts/);
});

test('Replies remain available through the existing profile Replies activity surface', async () => {
  const source = await read(profileActivityPath);

  assert.match(source, /where v_tab = 'replies'/);
  assert.match(source, /and p\.reply_to_post_id is not null/);
  assert.match(source, /'replies', true/);
});
