import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { transformMentionNotificationSource } from '../scripts/mention-notification-source-transform.mjs';
import { transformPostMediaSource } from '../scripts/post-media-source-transform.mjs';

const projectRoot = resolve(import.meta.dirname, '..');
const appPath = resolve(projectRoot, 'src/app.js');
const migrationPath = resolve(projectRoot, 'supabase/migrations/20260907171322_enable_mention_notifications.sql');

test('mention notification UI copy covers post, reply and bio without changing source app directly', async () => {
  const source = await readFile(appPath, 'utf8');
  const transformed = transformMentionNotificationSource(
    appPath,
    transformPostMediaSource(appPath, source),
  );

  assert.match(transformed, /tagged you in a post\./);
  assert.match(transformed, /tagged you in a reply\./);
  assert.match(transformed, /tagged you in a bio\./);
  assert.match(transformed, /notification\.notification_type === 'mention'/);
  assert.match(transformed, /item\.dataset\.profileUsername/);
  assert.match(transformed, /post\.parent_post_id/);
});

test('mention migration is server-owned, deduplicated per source and respects safety boundaries', async () => {
  const sql = await readFile(migrationPath, 'utf8');

  assert.match(sql, /extract_social_mention_usernames/);
  assert.match(sql, /limit 20;/i);
  assert.match(sql, /target\.id <> source_actor/);
  assert.match(sql, /social_blocks/);
  assert.match(sql, /notification_type = 'mention'/);
  assert.match(sql, /sync_social_post_mentions_insert_delete/);
  assert.match(sql, /sync_social_post_mentions_update/);
  assert.match(sql, /sync_social_profile_bio_mentions/);
  assert.match(sql, /new\.visibility = 'followers'/);
  assert.match(sql, /new\.visibility = 'circle'/);
  assert.match(sql, /new\.is_discoverable is not true/);
});
