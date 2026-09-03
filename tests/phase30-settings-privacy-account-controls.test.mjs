import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { handleAccountControlRequest } from '../src/account-controls-api.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Phase 30 exposes live Settings without changing the approved app shell', async () => {
  const html = await read('app/index.html');
  const css = await read('app/assets/app.css');

  for (const id of [
    'settings-surface',
    'profile-settings-button',
    'settings-discoverable',
    'settings-external-indexing',
    'settings-read-receipts',
    'settings-activity-status',
    'settings-dm-access',
    'settings-notify-post',
    'settings-notify-messages',
    'settings-notify-followers',
    'settings-notify-sautify',
    'settings-email-digest',
    'settings-blocked-list',
    'settings-muted-list',
    'settings-export-request',
    'settings-deletion-start',
    'settings-delete-dialog',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), `missing Phase 30 settings control: ${id}`);
  }

  assert.match(html, /data-member-view="settings"/);
  const phase = Number(html.match(/name="sautilink-release-generation" content="([0-9]+)"/)?.[1] || 0);
  const cssVersion = Number(html.match(/app\.css\?v=(\d+)/)?.[1] || 0);
  const jsVersion = Number(html.match(/app\.js\?v=(\d+)/)?.[1] || 0);
  assert.ok(phase >= 30);
  assert.ok(cssVersion >= 30);
  assert.ok(jsVersion >= 30);
  assert.match(css, /Settings, Privacy & Account Controls/);
  assert.match(css, /settings-toggle-row/);
  assert.match(css, /settings-delete-dialog/);
});

test('Phase 30 account export Worker requires authentication and has no elevated key', async () => {
  for (const method of ['GET', 'POST', 'DELETE']) {
    const response = await handleAccountControlRequest(
      new Request('https://test.sautilink.com/api/account/export', { method }),
      {},
    );
    assert.equal(response.status, 401);
    const payload = await response.json();
    assert.equal(payload.error.code, 'AUTH_REQUIRED');
  }

  const source = await read('src/account-controls-api.js');
  for (const marker of [
    'ACCOUNT_CONTROL_LIMITER',
    'social_data_export_requests',
    'request_id',
    'idempotent',
    '/api/account/export',
  ]) {
    assert.ok(source.includes(marker), `account-control Worker missing marker: ${marker}`);
  }
  assert.doesNotMatch(source, /service_role|sb_secret_|SUPABASE_SECRET/i);
});

test('Phase 30 migration keeps settings owner-scoped and enforces DM/privacy behavior', async () => {
  const sql = await read('supabase/migrations/20260902175000_enable_phase30_settings_privacy_account_controls.sql');

  for (const marker of [
    'allow_external_indexing',
    'dm_access',
    'social_member_preferences',
    'social_data_export_requests',
    'scheduled_for',
    "interval '14 days'",
    'suppress_phase30_disabled_notification',
    'social_notifications_select_own_phase30',
    'DM_RECIPIENT_RESTRICTED',
    'phase30_peer_read_at',
    'dm_peer_read_state_phase30',
    'notify_sautify',
    'notify_messages',
  ]) {
    assert.ok(sql.includes(marker), `migration missing Phase 30 marker: ${marker}`);
  }

  assert.match(sql, /alter table public\.social_member_preferences enable row level security/i);
  assert.match(sql, /alter table public\.social_member_preferences force row level security/i);
  assert.match(sql, /alter table public\.social_data_export_requests enable row level security/i);
  assert.match(sql, /alter table public\.social_data_export_requests force row level security/i);
  assert.match(sql, /revoke all on table public\.social_member_preferences from public, anon, authenticated/i);
  assert.match(sql, /grant update \(status\) on table public\.social_data_export_requests to authenticated/i);
  assert.match(sql, /grant update \(status\) on table public\.social_account_deletion_requests to authenticated/i);
  assert.doesNotMatch(sql, /disable row level security/i);
});

test('Phase 30 browser saves real settings, gates read receipts, and protects deletion', async () => {
  const source = await read('src/app.js');
  const safety = await read('src/trust-safety-api.js');
  const router = await read('src/asset-router.js');

  for (const marker of [
    'loadSettings',
    'saveProfileSetting',
    'savePreferenceSetting',
    'settingsApiRequest',
    "signOut({ scope: 'others' })",
    'dm_peer_read_state_phase30',
    'renderPeerReadReceipt',
    'DM_RECIPIENT_RESTRICTED',
    '/api/account/export',
    '/api/safety/deletion-request',
    'openSettingsDeleteDialog',
    '/settings',
  ]) {
    assert.ok(source.includes(marker), `browser missing Phase 30 marker: ${marker}`);
  }

  assert.match(safety, /DELETION_CONFIRMATION_REQUIRED/);
  assert.match(safety, /RECENT_AUTH_REQUIRED/);
  assert.match(safety, /recentlySignedIn/);
  assert.match(router, /SETTINGS_ROUTE/);
  assert.match(router, /CLEAN_MEMBER_ROUTE/);
  assert.match(router, /handleAccountControlRequest/);
  assert.doesNotMatch(source, /innerHTML\s*=/);
  assert.doesNotMatch(source, /service_role|sb_secret_/i);
});

test('Phase 30 uses an independent account-control limiter and rotates shell cache', async () => {
  const wrangler = JSON.parse(await read('wrangler.jsonc'));
  const bindings = wrangler.env.test.ratelimits || [];
  const account = bindings.find((item) => item.name === 'ACCOUNT_CONTROL_LIMITER');

  assert.deepEqual(account?.simple, { limit: 60, period: 60 });
  assert.equal(account?.namespace_id, '3001');

  const namespaces = bindings.map((item) => item.namespace_id);
  assert.equal(new Set(namespaces).size, namespaces.length);

  const sw = await read('sw.js');
  const cacheVersion = Number(sw.match(/sautilink-shell-v(\d+)/)?.[1] || 0);
  assert.ok(cacheVersion >= 21);
});

test('Phase 30 keeps Sautify wording in Settings', async () => {
  const html = await read('app/index.html');
  const preview = await read('preview-src/settings/SettingsPreview.jsx');

  assert.match(html, /Sautify activity/);
  assert.match(preview, /Sautify activity/);
  assert.doesNotMatch(html, />Circle activity</);
  assert.doesNotMatch(preview, /title="Circle activity"/);
});

test('Phase 30 generated types include live settings and privacy contracts', async () => {
  const types = await read('src/types/database.ts');
  for (const marker of [
    'social_member_preferences',
    'social_data_export_requests',
    'allow_external_indexing',
    'dm_access',
    'dm_peer_read_state_phase30',
    'scheduled_for',
  ]) {
    assert.ok(types.includes(marker), `generated types missing Phase 30 marker: ${marker}`);
  }
});
