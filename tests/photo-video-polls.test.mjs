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
  assert.match(source, /Add 2 to 4 options/);
  assert.match(source, /SHORT_VIDEO_LIMIT_SECONDS = 30/);
  assert.match(source, /currently limited to \$\{SHORT_VIDEO_LIMIT_SECONDS\} seconds/);
  assert.match(build.scripts['build:app'], /composer-formats\.js/);
});

test('server rejects and cleans short-video uploads beyond 30 seconds before storage', async () => {
  const router = await read('src/asset-router.js');
  assert.match(router, /SHORT_VIDEO_DURATION_MS = 30_000/);
  assert.match(router, /inspectMp4Bytes\(bytes\)/);
  assert.match(router, /VIDEO_TOO_LONG/);
  assert.match(router, /currently limited to 30 seconds/);
  assert.match(router, /method: 'DELETE'/);
  assert.match(router, /handleSautiMediaRequest\(new Request\(cleanupUrl/);
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
