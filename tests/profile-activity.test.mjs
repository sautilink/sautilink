import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('profile activity preferences default to private and support public, followers and only-you visibility', async () => {
  const sql = await read('supabase/migrations/20260905173000_enable_profile_activity_phase33.sql');

  assert.match(sql, /social_profile_activity_preferences/);
  assert.match(sql, /likes_visibility text not null default 'private'/i);
  assert.match(sql, /saves_visibility text not null default 'private'/i);
  assert.match(sql, /hashtags_visibility text not null default 'private'/i);
  assert.match(sql, /in \('public', 'followers', 'private'\)/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /revoke all on public\.social_profile_activity_preferences from anon/i);
  assert.match(sql, /social_profile_activity_preferences_select_own/i);
  assert.match(sql, /social_profile_activity_preferences_update_own/i);
});

test('profile pins are owner-controlled, exclude Sautify content and are capped at three posts or replies', async () => {
  const sql = await read('supabase/migrations/20260905173000_enable_profile_activity_phase33.sql');
  const hardening = await read('supabase/migrations/20260905173500_tighten_profile_pin_visibility_phase33.sql');

  assert.match(sql, /create table if not exists public\.social_profile_pins/i);
  assert.match(sql, /position smallint not null check \(position between 1 and 3\)/i);
  assert.match(sql, /v_count >= 3/i);
  assert.match(sql, /PROFILE_PIN_LIMIT/);
  assert.match(sql, /p\.circle_id is null/i);
  assert.match(sql, /p\.author_id = v_user/i);
  assert.match(hardening, /v_viewer <> p_target/i);
  assert.match(hardening, /target\.is_discoverable = true/i);
  assert.match(hardening, /social_blocks/i);
});

test('profile activity RPC keeps post visibility under invoker RLS while private activity candidates are permission-gated', async () => {
  const sql = await read('supabase/migrations/20260905173000_enable_profile_activity_phase33.sql');

  for (const rpc of [
    'profile_activity_state_phase33',
    'profile_activity_feed_phase33',
    'profile_hashtags_phase33',
    'update_profile_activity_preferences_phase33',
    'set_profile_pin_phase33',
  ]) assert.ok(sql.includes(rpc), `missing profile activity RPC: ${rpc}`);

  assert.match(sql, /create or replace function public\.profile_activity_feed_phase33[\s\S]*?security invoker/i);
  assert.match(sql, /create or replace function public\.profile_hashtags_phase33[\s\S]*?security invoker/i);
  assert.match(sql, /create or replace function private\.profile_activity_allowed_phase33[\s\S]*?security definer/i);
  assert.match(sql, /create or replace function private\.profile_activity_candidate_ids_phase33[\s\S]*?security definer/i);
  assert.match(sql, /revoke all on function public\.profile_activity_feed_phase33\(text, text, integer, integer\) from public, anon/i);
  assert.match(sql, /viewer_follows/);
  assert.match(sql, /likes.*private\.profile_activity_allowed_phase33/i);
  assert.match(sql, /saves.*private\.profile_activity_allowed_phase33/i);
  assert.match(sql, /hashtags.*private\.profile_activity_allowed_phase33/i);
});

test('profile activity UI follows the X-style tabs, privacy controls and professional empty states', async () => {
  const source = await read('src/profile-activity.js');
  const css = await read('app/assets/profile-activity.css');

  for (const label of ['Posts', 'Replies', 'Likes', 'Saves', 'Hashtags']) {
    assert.ok(source.includes(label), `missing profile activity tab: ${label}`);
  }

  assert.match(source, /Activity privacy/);
  assert.match(source, /<option value="public">Public<\/option>/);
  assert.match(source, /<option value="followers">Followers<\/option>/);
  assert.match(source, /<option value="private">Only you<\/option>/);
  assert.match(source, /profile_activity_state_phase33/);
  assert.match(source, /profile_activity_feed_phase33/);
  assert.match(source, /profile_hashtags_phase33/);
  assert.match(source, /set_profile_pin_phase33/);
  assert.match(source, /You can pin up to 3 posts or replies/);
  assert.match(source, /You haven’t posted yet\./);
  assert.match(source, /When this account posts, you’ll see it here\./);
  assert.match(source, /Create your first post/);
  assert.match(source, /href="\/home"/);
  assert.match(source, /Visibility on your profile follows your Activity privacy setting/);

  assert.match(css, /\.profile-activity-tabs/);
  assert.match(css, /aria-selected="true"/);
  assert.match(css, /background: var\(--app-accent\)/);
  assert.match(css, /:root\[data-theme="light"\]/);
  assert.match(css, /@media \(max-width: 680px\)/);
});

test('profile activity is bundled into regular and production app builds without changing auth pages', async () => {
  const pkg = await read('package.json');
  const production = await read('scripts/build-production-release.mjs');
  const html = await read('app/index.html');

  assert.match(pkg, /--inject:\.\/src\/profile-activity\.js/);
  assert.match(production, /resolve\(workerSource, 'profile-activity\.js'\)/);
  assert.match(html, /id="login-form"/);
  assert.match(html, /id="signup-form"/);
});
