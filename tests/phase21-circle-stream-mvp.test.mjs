import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { handleSautiRequest } from '../src/sauti-posts-api.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Phase 21 adds Circle Stream inside the accepted Circles surface', async () => {
  const html = await read('app/index.html');
  const css = await read('app/assets/app.css');

  for (const marker of [
    'id="circle-stream"',
    'id="circle-sauti-composer"',
    'id="circle-sauti-body"',
    'id="circle-sauti-submit"',
    'id="circle-stream-feed"',
    'id="circle-stream-locked"',
    'id="circle-stream-retry"',
  ]) {
    assert.ok(html.includes(marker), `missing Phase 21 UI marker: ${marker}`);
  }

  const phase = Number(html.match(/name="sautilink-release-generation" content="([0-9]+)"/)?.[1] || 0);
  assert.ok(phase >= 21, `app milestone regressed below Phase 21: ${phase}`);

  const cssVersion = Number(html.match(/app\.css\?v=(\d+)/)?.[1] || 0);
  const jsVersion = Number(html.match(/app\.js\?v=(\d+)/)?.[1] || 0);
  assert.ok(cssVersion >= 21, `app CSS version regressed below Phase 21: ${cssVersion}`);
  assert.equal(jsVersion, cssVersion);

  assert.match(css, /\.circle-stream/);
  assert.match(css, /\.circle-sauti-composer/);
  assert.match(css, /\.circle-stream-locked/);
});

test('Phase 21 database contract keeps Circle content member-only and out of Home Stream', async () => {
  const sql = await read('supabase/migrations/20260901170000_enable_phase21_circle_stream_mvp.sql');

  assert.match(sql, /social_posts_select_phase21_authenticated/i);
  assert.match(sql, /social_posts_insert_phase21_own/i);
  assert.match(sql, /visibility = 'circle'/i);
  assert.match(sql, /public\.social_circle_members membership/i);
  assert.match(sql, /membership\.member_id = \(select auth\.uid\(\)\)/i);
  assert.match(sql, /post\.circle_id is null/i);
  assert.match(sql, /join public\.social_posts post on post\.id = repost\.post_id/i);
  assert.match(sql, /target_circle is not null/i);
  assert.match(sql, /revoke all on function private\.sync_phase19_notification\(\) from public, anon, authenticated/i);
});

test('Phase 21 browser source reads, writes and interacts within Circle Stream without privileged keys', async () => {
  const source = await read('src/app.js');

  for (const marker of [
    'loadCircleStream',
    'shareCircleSauti',
    'circleStreamAllowed',
    "eq('circle_id', circleId)",
    "eq('visibility', 'circle')",
    'circle-stream-feed',
    'handleSautiFeedClick',
    'handleSautiFeedSubmit',
  ]) {
    assert.ok(source.includes(marker), `source missing Phase 21 marker: ${marker}`);
  }

  assert.match(source, /JSON\.stringify\(\{ body, circle_id: circle\.id, reply_access: replyAccess \}\)/);
  assert.doesNotMatch(source, /innerHTML\s*=/);
  assert.doesNotMatch(source, /service_role|sb_secret_|SUPABASE_SECRET/i);
});

test('Sauti Worker accepts Circle scope but keeps identity and visibility server-owned', async () => {
  const worker = await read('src/sauti-posts-api.js');

  assert.match(worker, /const requestedCircle =/);
  assert.match(worker, /INVALID_CIRCLE/);
  assert.match(worker, /author_id: session\.user\.id/);
  assert.match(worker, /const requestedVisibility = requestedCircle \? 'circle' : audienceVisibility\(payload\?\.visibility\)/);
  assert.match(worker, /visibility: requestedVisibility/);
  assert.match(worker, /circle_id: requestedCircle \|\| null/);
  assert.match(worker, /post_status: 'published'/);
  assert.doesNotMatch(worker, /service_role|sb_secret_|SUPABASE_SECRET/i);

  const unauthenticated = await handleSautiRequest(
    new Request('https://test.sautilink.com/api/sauti', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        body: 'Circle scoped',
        circle_id: '11111111-2222-4333-8444-555555555555',
      }),
    }),
    {},
  );
  assert.equal(unauthenticated.status, 401);
  assert.equal((await unauthenticated.json()).error.code, 'AUTH_REQUIRED');
});

test('Phase 21 rotates the shell cache beyond Phase 20', async () => {
  const sw = await read('sw.js');
  const version = Number(sw.match(/sautilink-shell-v([0-9]+)/)?.[1] || 0);
  assert.ok(version >= 11, `service worker cache regressed below Phase 21: ${version}`);
});
