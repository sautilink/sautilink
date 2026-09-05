import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('verified accounts receive a permanent username lock at the database boundary', async () => {
  const migration = await read('supabase/migrations/20260905161000_verified_name_monthly_and_permanent_username_lock.sql');

  assert.match(migration, /add column if not exists username_locked_at timestamptz/i);
  assert.match(migration, /where is_verified = true\s+and username_locked_at is null/i);
  assert.match(migration, /apply_permanent_username_lock_on_verification/i);
  assert.match(migration, /prevent_locked_social_username_change/i);
  assert.match(migration, /prevent_locked_account_username_change/i);
  assert.match(migration, /USERNAME_LOCKED_VERIFIED/);
  assert.match(migration, /old\.username_locked_at is not null/);
});

test('verified display names change directly twice per calendar month without review', async () => {
  const migration = await read('supabase/migrations/20260905161000_verified_name_monthly_and_permanent_username_lock.sql');

  assert.match(migration, /date_trunc\('month', now\(\)\)/i);
  assert.match(migration, /VERIFIED_DISPLAY_NAME_MONTHLY_LIMIT/);
  assert.match(migration, /if recent_count >= 2 then/i);
  assert.match(migration, /set display_name = normalized_value/i);
  assert.match(migration, /set full_name = normalized_value/i);
  assert.match(migration, /status = 'cancelled'/i);
  assert.match(migration, /create or replace function public\.change_social_identity[\s\S]*?security invoker/i);
  assert.match(migration, /create or replace function private\.change_social_identity_privileged[\s\S]*?security definer/i);
});

test('account identity state exposes monthly name quota and permanent username lock', async () => {
  const api = await read('src/account-controls-api.js');

  assert.match(api, /username_locked_at/);
  assert.match(api, /requires_review: false/);
  assert.match(api, /policy: profile\.is_verified \? 'verified_calendar_month' : 'standard_14_days'/);
  assert.match(api, /changes_remaining_month/);
  assert.match(api, /locked_permanently: usernameLocked/);
  assert.match(api, /VERIFIED_DISPLAY_NAME_MONTHLY_LIMIT/);
  assert.match(api, /USERNAME_LOCKED_VERIFIED/);
});

test('profile editor grays and disables a permanently locked username', async () => {
  const controls = await read('src/verified-identity-controls.js');
  const css = await read('app/assets/verified-identity-controls.css');
  const packageJson = await read('package.json');
  const productionBuild = await read('scripts/build-production-release.mjs');

  assert.match(controls, /locked_permanently/);
  assert.match(controls, /usernameInput\.disabled = true/);
  assert.match(controls, /verified-username-locked/);
  assert.match(controls, /Username is permanently locked after verification\./);
  assert.match(controls, /twice per month/);
  assert.match(css, /\.identity-username-field\.verified-username-locked/);
  assert.match(css, /cursor: not-allowed/);
  assert.match(packageJson, /--inject:\.\/src\/verified-identity-controls\.js/);
  assert.match(productionBuild, /verified-identity-controls\.js/);
});
