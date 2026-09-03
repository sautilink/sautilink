import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { handleSautiRequest } from '../src/sauti-posts-api.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Phase 16 text composer foundation remains bounded as later media phases evolve', async () => {
  const html = await read('app/index.html');

  for (const id of [
    'sauti-composer',
    'sauti-body',
    'sauti-count',
    'sauti-submit',
    'sauti-message',
    'stream-loading',
    'stream-error',
    'stream-feed',
    'stream-empty',
    'stream-load-more',
  ]) assert.match(html, new RegExp(`id="${id}"`));

  const phase = Number(html.match(/name="sautilink-release-generation" content="([0-9]+)"/)?.[1] || 0);
  assert.ok(phase >= 16, `app milestone regressed below Phase 16: ${phase}`);
  assert.match(html, /id="sauti-body"[\s\S]*?maxlength="500"/);
  assert.match(html, /id="sauti-audience"[\s\S]*?<option value="public">Public<\/option>/);
  assert.match(html, /app\.css\?v=\d+/);
  assert.match(html, /app\.js\?v=\d+/);
});

test('Stream is canonical, chronological, bounded and rendered without innerHTML', async () => {
  const source = await read('src/app.js');

  assert.match(source, /const STREAM_PAGE_SIZE = 20/);
  assert.match(source, /\.from\('social_stream_events'\)/);
  assert.match(source, /\.from\('social_posts'\)/);
  assert.match(source, /\.order\('event_at', \{ ascending: false \}\)/);
  assert.match(source, /\.order\('event_key', \{ ascending: false \}\)/);
  assert.match(source, /\.limit\(STREAM_PAGE_SIZE \+ 1\)/);
  assert.match(source, /event_at\.lt/);
  assert.match(source, /event_key\.lt/);
  assert.match(source, /body\.textContent = String\(post\.body \|\| ''\)/);
  assert.doesNotMatch(source, /innerHTML\s*=/);
});

test('Text Sauti Worker requires authentication before writes', async () => {
  const create = await handleSautiRequest(
    new Request('https://test.sautilink.com/api/sauti', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'hello' }),
    }),
    {},
  );
  assert.equal(create.status, 401);
  assert.equal((await create.json()).error.code, 'AUTH_REQUIRED');

  const remove = await handleSautiRequest(
    new Request('https://test.sautilink.com/api/sauti/11111111-2222-4333-8444-555555555555', {
      method: 'DELETE',
    }),
    {},
  );
  assert.equal(remove.status, 401);
  assert.equal((await remove.json()).error.code, 'AUTH_REQUIRED');
});

test('Worker fixes protected Phase 16 post fields and contains no privileged key', async () => {
  const worker = await read('src/sauti-posts-api.js');

  assert.match(worker, /body\.length > 500/);
  assert.match(worker, /author_id: session\.user\.id/);
  assert.match(worker, /const requestedVisibility = requestedCircle \? 'circle' : audienceVisibility\(payload\?\.visibility\)/);
  assert.match(worker, /visibility: requestedVisibility/);
  assert.match(worker, /post_status: 'published'/);
  assert.match(worker, /circle_id: requestedCircle \|\| null/);
  assert.doesNotMatch(worker, /reply_to_post_id:\s*null/);
  assert.match(worker, /media_count: media\.length/);
  assert.match(worker, /SAUTI_CREATE_LIMITER/);
  assert.match(worker, /SAUTI_DELETE_LIMITER/);
  assert.doesNotMatch(worker, /service_role|sb_secret_|SUPABASE_SECRET/i);
});

test('Phase 16 database contract separates anon visibility and member block checks', async () => {
  const migration = await read('supabase/migrations/20260831204100_enable_phase16_text_sauti.sql');
  const sqlTest = await read('supabase/tests/phase16_text_sauti_rls.sql');

  assert.match(migration, /between 1 and 500/i);
  assert.match(migration, /social_posts_select_phase16_anon/);
  assert.match(migration, /social_posts_select_phase16_authenticated/);
  assert.match(migration, /profile\.is_discoverable = true/);
  assert.match(migration, /social_blocks block/);
  assert.match(migration, /social_posts_insert_phase16_own/);
  assert.match(migration, /visibility = 'public'/);
  assert.match(migration, /circle_id is null/);
  assert.match(migration, /reply_to_post_id is null/);
  assert.doesNotMatch(migration, /create policy social_posts_update/i);
  assert.match(sqlTest, /DISCOVERABLE_PUBLIC_SAUTI_NOT_VISIBLE/);
  assert.match(sqlTest, /HIDDEN_AUTHOR_SAUTI_LEAKED/);
  assert.match(sqlTest, /CROSS_USER_DELETE_ALLOWED/);
  assert.match(sqlTest, /begin;[\s\S]*rollback;/i);
});

test('Cloudflare staging config binds independent Sauti write rate limits', async () => {
  const wrangler = JSON.parse(await read('wrangler.jsonc'));
  const bindings = wrangler.env.test.ratelimits || [];
  const create = bindings.find((item) => item.name === 'SAUTI_CREATE_LIMITER');
  const remove = bindings.find((item) => item.name === 'SAUTI_DELETE_LIMITER');

  assert.deepEqual(create?.simple, { limit: 10, period: 60 });
  assert.deepEqual(remove?.simple, { limit: 20, period: 60 });
  assert.notEqual(create?.namespace_id, remove?.namespace_id);
});

test('Phase 16 rotates the shell cache', async () => {
  const sw = await read('sw.js');
  assert.match(sw, /sautilink-shell-v\d+/);
});
