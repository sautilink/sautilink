import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Phase 13 profile basics remain live on desktop and mobile', async () => {
  const html = await read('app/index.html');
  for (const id of [
    'profile-surface', 'profile-edit-button', 'profile-form', 'profile-bio-input',
    'profile-location-input', 'profile-website-input', 'profile-discoverable-input',
  ]) assert.match(html, new RegExp(`id="${id}"`));

  assert.equal((html.match(/data-member-view="profile"/g) || []).length, 2);
  assert.match(html, /name="bio" maxlength="500"/);
  assert.match(html, /name="location" type="text" maxlength="100"/);
  assert.match(html, /name="website" type="url" maxlength="2048"/);
  assert.match(html, /name="discoverable" type="checkbox"/);
  const profileForm = html.match(/<form class="profile-form"[\s\S]*?<\/form>/)?.[0] || '';
  assert.doesNotMatch(profileForm, /name="display_name"|name="username"/);
});

test('profile save refreshes auth and writes only the approved owner columns', async () => {
  const source = await read('src/app.js');
  assert.match(source, /supabase\.auth\.getUser\(\)/);
  assert.match(source, /\.from\('social_profiles'\)[\s\S]*?\.update\(updates\)[\s\S]*?\.eq\('id', user\.id\)/);
  assert.match(source, /bio, avatar_key, updated_at, location, website_url, is_discoverable/);
  assert.match(source, /\['http:', 'https:'\]\.includes\(url\.protocol\)/);

  const updateObject = source.match(/return \{\s*bio,[\s\S]*?is_discoverable:[\s\S]*?\};/);
  assert.ok(updateObject, 'expected the bounded profile update object');
  for (const forbidden of ['username', 'display_name', 'avatar_url', 'header_url', 'full_name']) {
    assert.doesNotMatch(updateObject[0], new RegExp(forbidden));
  }
});

test('database grants only four columns and the staging RLS test always rolls back', async () => {
  const migration = await read('supabase/migrations/20260831125154_enable_live_profile_basics.sql');
  const sqlTest = await read('supabase/tests/phase13_live_profile_rls.sql');
  assert.match(migration, /revoke update on table public\.social_profiles from public, anon, authenticated/i);
  assert.match(migration, /grant update \(bio, location, website_url, is_discoverable\)[\s\S]*to authenticated/i);
  assert.doesNotMatch(migration, /grant update on table/i);
  assert.match(sqlTest, /CROSS_USER_PROFILE_UPDATE_ALLOWED/);
  assert.match(sqlTest, /DISPLAY_NAME_UPDATE_ALLOWED/);
  assert.match(sqlTest, /begin;[\s\S]*rollback;/i);
});

test('profile controls keep mobile layouts and accessible touch targets', async () => {
  const css = await read('app/assets/app.css');
  assert.match(css, /\.profile-edit-button\s*\{[^}]*min-height:\s*44px/s);
  assert.match(css, /\.profile-editor-heading \.icon-control\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px/s);
  assert.match(css, /@media \(max-width: 680px\)[\s\S]*\.profile-form-actions\s*\{[^}]*flex-direction:\s*column-reverse/s);
});
