import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { handleProfileMediaRequest, inspectImageBytes } from '../src/profile-media-api.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Phase 15 profile UI exposes image-only owner media controls behind readiness', async () => {
  const html = await read('app/index.html');
  const source = await read('src/app.js');

  for (const id of [
    'profile-header-image',
    'profile-avatar-image',
    'profile-media-panel',
    'profile-media-status',
    'profile-avatar-upload-button',
    'profile-avatar-remove-button',
    'profile-header-upload-button',
    'profile-header-remove-button',
    'profile-avatar-file',
    'profile-header-file',
  ]) assert.match(html, new RegExp(`id="${id}"`));

  const phase = Number(html.match(/name="sautilink-release-generation" content="([0-9]+)"/)?.[1] || 0);
  assert.ok(phase >= 15, `app milestone regressed below Phase 15: ${phase}`);
  assert.match(html, /accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(html, /app\.css\?v=\d+/);
  assert.match(html, /app\.js\?v=\d+/);
  assert.match(source, /profileMediaReady/);
  assert.match(source, /\/api\/profile-media\/status/);
  assert.match(source, /\/api\/profile-media\/upload/);
  assert.match(source, /\/api\/profile-media\/remove/);
  assert.match(source, /Authorization: `Bearer \$\{session\.access_token\}`/);
});

test('profile media status fails closed until an R2 binding exists', async () => {
  const response = await handleProfileMediaRequest(
    new Request('https://test.sautilink.com/api/profile-media/status'),
    {},
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload, { ok: true, data: { ready: false } });
});

test('server-side image inspection recognizes bounded PNG dimensions', () => {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, 512, false);
  view.setUint32(20, 512, false);

  assert.deepEqual(inspectImageBytes(bytes), {
    contentType: 'image/png',
    width: 512,
    height: 512,
  });
});

test('Worker profile media boundary uses publishable auth and no privileged Supabase key', async () => {
  const worker = await read('src/profile-media-api.js');
  assert.match(worker, /auth\/v1\/user/);
  assert.match(worker, /apikey: SUPABASE_PUBLISHABLE_KEY/);
  assert.match(worker, /\.from|rest\/v1\/social_profiles/);
  assert.match(worker, /profiles\/\$\{session\.user\.id\}\/\$\{slot\}\/\$\{crypto\.randomUUID\(\)\}/);
  assert.match(worker, /image\/jpeg/);
  assert.match(worker, /image\/png/);
  assert.match(worker, /image\/webp/);
  assert.doesNotMatch(worker, /service_role|sb_secret_|SUPABASE_SECRET/i);
});

test('Phase 15 migration keeps metadata writes owner-scoped and slot-scoped', async () => {
  const migration = await read('supabase/migrations/20260831193800_enable_profile_media_metadata.sql');
  const sqlTest = await read('supabase/tests/phase15_profile_media_rls.sql');

  assert.match(migration, /grant update \([\s\S]*avatar_key,[\s\S]*header_key[\s\S]*\) on table public\.social_profiles to authenticated/i);
  assert.match(migration, /\/avatar\//);
  assert.match(migration, /\/header\//);
  assert.doesNotMatch(migration, /grant update on table public\.social_profiles to authenticated/i);
  assert.match(sqlTest, /CROSS_USER_PROFILE_MEDIA_UPDATE_ALLOWED/);
  assert.match(sqlTest, /INVALID_AVATAR_SLOT_KEY_ALLOWED/);
  assert.match(sqlTest, /begin;[\s\S]*rollback;/i);
});

test('Phase 15 rotates the service-worker shell cache', async () => {
  const sw = await read('sw.js');
  assert.match(sw, /sautilink-shell-v\d+/);
});
