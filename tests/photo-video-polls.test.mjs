import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { handlePollRequest } from '../src/polls-api.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('composer presents Photo, reels-style Video and a live Poll control', async () => {
  const source = await read('src/composer-formats.js');
  const build = JSON.parse(await read('package.json'));

  assert.match(source, /replaceToolLabel\(photoButton, 'Photo'\)/);
  assert.match(source, /document\.createTextNode\('Video'\)/);
  assert.match(source, /M4 9h16M7 4l3 5M13 4l3 5/);
  assert.match(source, /document\.createTextNode\('Poll'\)/);
  assert.match(source, /Ask your question above\. Add 2–4 choices below\./);
  assert.match(source, /POST_VIDEO_LIMIT_SECONDS = 180/);
  assert.match(source, /POST_VIDEO_MAX_BYTES = 250 \* 1024 \* 1024/);
  assert.match(source, /promptVideoTrim/);
  assert.match(source, /supportedMp4RecorderType/);
  assert.match(source, /Use clip/);
  assert.match(source, /preparePostComposerFiles/);
  assert.match(source, /Select a clip up to 3 minutes/);
  assert.match(source, /maximum 3:00/);
  assert.match(build.scripts['build:app'], /composer-formats\.js/);
});

test('post MP4 uploads enforce the 180-second inspected duration before storage', async () => {
  const source = await read('src/sauti-media-api.js');
  const policy = await read('src/post-media-policy.js');
  assert.match(policy, /POST_VIDEO_DURATION_MS = 180_000/);
  assert.match(source, /MAX_VIDEO_DURATION_MS = POST_VIDEO_DURATION_MS/);
  assert.match(source, /inspectMp4Bytes\(bytes\)/);
  assert.match(source, /durationMs > MAX_VIDEO_DURATION_MS/);
  assert.match(source, /deleteMediaRow\(session, id\)/);
  assert.doesNotMatch(source, /SHORT_VIDEO_DURATION_MS/);
});

test('post uploads allow250MiB video and5MiB images with bounded chunk delivery', async () => {
  const source = await read('src/sauti-media-api.js');
  const policy = await read('src/post-media-policy.js');
  const migration = await read('supabase/migrations/20261023043819_expand_post_media_policy.sql');
  assert.match(policy, /POST_VIDEO_LIMIT = 250 \* 1024 \* 1024/);
  assert.match(policy, /POST_IMAGE_LIMIT = 5 \* 1024 \* 1024/);
  assert.match(source, /Videos must be 250 MiB or smaller/);
  assert.match(source, /mediaChunkContract/);
  assert.match(source, /boundedMediaUploadBody/);
  assert.match(migration, /size_bytes between 1 and 262144000/i);
  assert.match(migration, /new\.media_kind <> 'image' or new\.size_bytes <= 5242880/i);
});

test('poll API covers creation, batch reads and one-vote submission routes', async () => {
  const source = await read('src/polls-api.js');
  const router = await read('src/asset-router.js');

  for (const term of [
    'social_post_polls',
    'social_post_poll_options',
    'social_post_poll_votes',
    '/api/polls/create',
    '/api/sauti/polls',
    '/api/sauti/polls/vote',
    'Only the post author can add this poll',
    'You have already voted in this poll',
  ]) assert.match(source, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  assert.match(router, /handleSautiWithOptionalPoll/);
  assert.match(router, /poll_options/);
  assert.match(router, /handlePollRequest/);

  const response = await handlePollRequest(new Request('https://sautilink.com/api/sauti/polls?post_ids=invalid'));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, data: { polls: [] } });
});

test('poll database contract is RLS-backed and keeps voter identity private', async () => {
  const migration = await read('supabase/migrations/20260905123500_enable_live_post_polls.sql');

  for (const term of [
    'enable row level security',
    'revoke all on table public.social_post_poll_votes from anon, authenticated',
    'grant select, insert on table public.social_post_poll_votes to authenticated',
    'voter_id = (select auth.uid())',
    'primary key (post_id, voter_id)',
    'social_post_poll_votes_option_post_fk',
    'private.increment_social_poll_vote_counts',
    'security definer',
    'revoke all on function private.increment_social_poll_vote_counts() from public, anon, authenticated',
  ]) assert.match(migration, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));

  assert.doesNotMatch(migration, /disable row level security|service_role/i);
});

test('public product files do not disclose deferred infrastructure plans', async () => {
  const files = await Promise.all([
    read('src/composer-formats.js'),
    read('src/polls-api.js'),
    read('src/asset-router.js'),
    read('app/assets/composer-formats.css'),
  ]);
  const combined = files.join('\n');
  assert.doesNotMatch(combined, /\bVPS\b|6\s*hours|6hrs|long[- ]form video/i);
});
