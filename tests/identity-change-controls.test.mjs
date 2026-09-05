import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('base identity migration retains display-name, username, review-history and RLS boundaries', async () => {
  const sql = await read('supabase/migrations/20260903003000_enable_identity_change_controls.sql');

  assert.match(sql, /add column if not exists is_verified boolean not null default false/i);
  assert.match(sql, /revoke update \(is_verified\).*authenticated/i);
  assert.match(sql, /social_identity_change_events/);
  assert.match(sql, /social_identity_change_requests/);
  assert.match(sql, /changed_at > now\(\) - interval '14 days'/i);
  assert.match(sql, /changed_at > now\(\) - interval '30 days'/i);
  assert.match(sql, /DISPLAY_NAME_CHANGE_LIMIT/);
  assert.match(sql, /DISPLAY_NAME_REQUEST_PENDING/);
  assert.match(sql, /USERNAME_CHANGE_LIMIT/);
  assert.match(sql, /security definer/i);
  assert.match(sql, /set search_path = ''/i);
  assert.match(sql, /private\.phase29_staff_role\(\)/);
  assert.match(sql, /review_social_identity_request/);
});

test('member identity API exposes current quotas and changes identity only through the guarded RPC', async () => {
  const api = await read('src/account-controls-api.js');

  assert.match(api, /\/api\/account\/identity/);
  assert.match(api, /rpc\/change_social_identity/);
  assert.match(api, /social_identity_change_events/);
  assert.match(api, /changes_remaining_14_days/);
  assert.match(api, /changes_remaining_month/);
  assert.match(api, /changes_remaining_30_days/);
  assert.match(api, /locked_permanently/);
  assert.match(api, /requires_review: false/);
  assert.match(api, /VERIFIED_DISPLAY_NAME_MONTHLY_LIMIT/);
  assert.match(api, /USERNAME_LOCKED_VERIFIED/);
  assert.match(api, /DISPLAY_NAME_CHANGE_LIMIT/);
  assert.match(api, /USERNAME_CHANGE_LIMIT/);
});

test('profile editor includes name controls and permanently disables locked usernames', async () => {
  const html = await read('app/index.html');
  const source = await read('src/app.js');
  const verifiedControls = await read('src/verified-identity-controls.js');

  for (const marker of [
    'id="profile-name-form"',
    'id="profile-name-input"',
    'id="profile-username-form"',
    'id="profile-username-input"',
    'id="profile-verified-badge"',
    'id="moderation-identity-panel"',
  ]) assert.ok(html.includes(marker), `missing identity UI marker: ${marker}`);

  assert.match(source, /loadIdentityControls/);
  assert.match(source, /submitIdentityChange/);
  assert.match(verifiedControls, /Verified accounts can change their display name twice per month/);
  assert.match(verifiedControls, /Username is permanently locked after verification/);
  assert.match(verifiedControls, /usernameInput\.disabled = true/);
  assert.match(verifiedControls, /verified-username-locked/);
});

test('legacy verified display-name review tooling remains readable for historical moderation records', async () => {
  const api = await read('src/moderation-api.js');
  const source = await read('src/app.js');
  const currentPolicy = await read('supabase/migrations/20260905161000_verified_name_monthly_and_permanent_username_lock.sql');

  assert.match(api, /\/api\/moderation\/identity-requests/);
  assert.match(api, /rpc\/identity_change_requests_for_staff/);
  assert.match(api, /rpc\/review_social_identity_request/);
  assert.match(source, /loadModerationIdentityRequests/);
  assert.match(source, /decideModerationIdentityRequest/);
  assert.match(currentPolicy, /status = 'cancelled'/i);
});

test('clean social routes are canonical while legacy app paths remain readable', async () => {
  const source = await read('src/app.js');
  const router = await read('src/asset-router.js');
  const config = await read('wrangler.production.jsonc');
  const workflow = await read('.github/workflows/phase32-production.yml');

  assert.match(source, /return `\/u\/\$\{encodeURIComponent\(username\)\}`/);
  assert.match(source, /'\/messages'/);
  assert.match(source, /'\/sautify'/);
  assert.match(source, /'\/home'/);
  assert.ok(source.includes("pathname.match(/^(?:\\/app)?\\/u\\/"));
  assert.ok(source.includes("pathname.match(/^(?:\\/post|\\/app\\/sauti)"));
  assert.match(router, /CLEAN_AUTH_ROUTE/);
  assert.match(router, /CLEAN_POST_ROUTE/);
  assert.match(router, /CLEAN_PROFILE_ROUTE/);
  assert.match(router, /CLEAN_ROUTE_PREFIX/);
  assert.match(router, /return fetch\(request\)/);

  for (const route of [
    'sautilink.com/login*',
    'sautilink.com/signup*',
    'sautilink.com/home*',
    'sautilink.com/messages*',
    'sautilink.com/sautify*',
    'sautilink.com/u/*',
    'sautilink.com/post/*',
  ]) assert.ok(config.includes(route), `missing clean production route: ${route}`);

  assert.doesNotMatch(config, /"pattern"\s*:\s*"(?:www\.)?sautilink\.com\/\*"/);
  assert.match(workflow, /https:\/\/sautilink\.com\/login/);
  assert.match(workflow, /https:\/\/sautilink\.com\/signup/);
  assert.match(workflow, /https:\/\/sautilink\.com\/home/);
  assert.match(workflow, /data-sautilink-entry=\"account-choice\"/);
});

test('service worker recognizes clean social routes and rotates its cache', async () => {
  const sw = await read('sw.js');
  const cacheVersion = Number(sw.match(/sautilink-shell-v([0-9]+)/)?.[1] || 0);
  assert.ok(cacheVersion >= 29, `expected unified backend cache v29+, got v${cacheVersion}`);
  assert.match(sw, /login\|signup\|home\|discover/);
  assert.match(sw, /\/messages/);
  assert.match(sw, /\/sautify/);
  assert.match(sw, /\/post/);
});
