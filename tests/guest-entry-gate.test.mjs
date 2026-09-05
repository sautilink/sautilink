import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('site root shows the existing account choice instead of auto-redirecting to login', async () => {
  const root = await read('index.html');

  assert.match(root, /data-sautilink-entry="account-choice"/);
  assert.match(root, /Continue to SautiLink/);
  assert.match(root, /href="\/login"/);
  assert.match(root, /href="\/signup"/);
  assert.doesNotMatch(root, /http-equiv="refresh"/i);
  assert.doesNotMatch(root, /url=\/login/i);
  assert.match(root, /rel="canonical" href="https:\/\/sautilink\.com\/"/);
});

test('signed-out profile teaser exposes only promotional identity and preserves the destination', async () => {
  const gate = await read('src/guest-entry-gate.js');
  const usernameLogin = await read('src/username-login.js');
  const css = await read('app/assets/guest-entry-gate.css');

  assert.match(gate, /select: 'username,display_name,is_verified,verification_badge_type,followers_count'/);
  assert.doesNotMatch(gate, /select: '[^']*bio/);
  assert.match(gate, /Join SautiLink to see the full profile/);
  assert.match(gate, /bio, posts and full content/);
  assert.match(gate, /\/login\?next=/);
  assert.match(gate, /\/signup\?next=/);
  assert.match(gate, /sautilink\.auth\.return-target/);
  assert.match(gate, /window\.location\.replace\(destination\)/);
  assert.match(usernameLogin, /consumeGuestReturnTarget\(\) \|\| '\/home'/);
  assert.match(css, /guest-profile-gate/);
  assert.match(css, /html\[data-theme="light"\]/);
  assert.doesNotMatch(css, /(linear|radial|conic)-gradient\(/i);
});

test('database gate keeps only discoverable profile teaser columns readable to anon', async () => {
  const sql = await read('supabase/migrations/20260905134500_gate_guest_social_content.sql');

  assert.match(sql, /revoke select on table public\.social_profiles from anon/i);
  assert.match(sql, /grant select \([\s\S]*username[\s\S]*display_name[\s\S]*is_verified[\s\S]*verification_badge_type[\s\S]*followers_count[\s\S]*\) on table public\.social_profiles to anon/i);
  assert.doesNotMatch(sql.match(/grant select \([\s\S]*?\) on table public\.social_profiles to anon/i)?.[0] || '', /\bbio\b/i);

  for (const table of [
    'social_posts',
    'social_post_comments',
    'social_post_media',
    'social_post_polls',
    'social_post_poll_options',
    'social_reposts',
    'social_stream_events',
  ]) {
    assert.match(sql, new RegExp(`revoke select on table public\\.${table} from anon`, 'i'));
  }

  assert.match(sql, /drop policy if exists social_posts_select_phase29_anon/i);
  assert.match(sql, /drop policy if exists social_post_comments_select_phase29_anon/i);
  assert.match(sql, /drop policy if exists social_post_media_select_phase27_anon/i);
});

test('production gate verifies apex and www roots without changing login or signup surfaces', async () => {
  const workflow = await read('.github/workflows/phase32-production.yml');
  const appHtml = await read('app/index.html');

  assert.match(workflow, /https:\/\/sautilink\.com\/\?release=/);
  assert.match(workflow, /https:\/\/www\.sautilink\.com\/\?release=/);
  assert.match(workflow, /data-sautilink-entry=\"account-choice\"/);
  assert.match(workflow, /! grep -Fq 'url=\/login'/);
  assert.match(appHtml, /id="login-form"/);
  assert.match(appHtml, /id="signup-form"/);
});
