import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Phase 35 keeps message media private and bounded in the database contract', async () => {
  const sql = await read('supabase/migrations/20260912044712_enable_messages_media_foundation.sql');

  assert.match(sql, /message_kind in \('text', 'photo', 'file', 'voice'\)/i);
  assert.match(sql, /size_bytes between 1 and 5242880/i);
  assert.match(sql, /duration_ms.*300000/is);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /dm_message_attachments_select_phase35/i);
  assert.match(sql, /message\.deleted_at is null/i);
  assert.match(sql, /dm_message_attachments_insert_phase35/i);
  assert.match(sql, /social_blocks/i);
  assert.match(sql, /send_dm_media_message_phase35/i);
  assert.match(sql, /security invoker/i);
  assert.doesNotMatch(sql, /send_dm_media_message_phase35[\s\S]*security definer/i);
});

test('Phase 35 Worker validates uploads before private R2 storage', async () => {
  const api = await read('src/dm-media-api.js');
  const router = await read('src/asset-router.js');

  for (const marker of [
    'MAX_FILE_BYTES = 5 * 1024 * 1024',
    'MAX_VOICE_DURATION_MS = 5 * 60 * 1000',
    'inspectImageBytes',
    'validDocumentBytes',
    'validVoiceBytes',
    'DM_MEDIA_UPLOAD_LIMITER',
    "env.SAUTI_MEDIA.put",
    '/api/dm-media/upload',
    '/api/dm-media/messages',
    'send_dm_media_message_phase35',
  ]) assert.ok(api.includes(marker), `DM media API missing ${marker}`);

  assert.match(router, /handleDmMediaRequest/);
  assert.match(router, /\/api\/dm-media\//);
  assert.doesNotMatch(api, /service_role|sb_secret_|SUPABASE_SECRET/i);
});

test('Phase 35 media UI extends Messages without replacing plain-text sending', async () => {
  const source = await read('src/messages-media-ui.js');
  const transform = await read('scripts/messages-media-source-transform.mjs');
  const appBuild = await read('scripts/build-app.mjs');
  const productionBuild = await read('scripts/build-production-release.mjs');

  for (const marker of [
    'message-attachment-button',
    'message-voice-button',
    'MediaRecorder',
    "fetch('/api/dm-media/upload'",
    '/api/dm-media/send/',
    '/api/dm-media/messages',
    '5:00',
  ]) assert.ok(source.includes(marker), `Messages media UI missing ${marker}`);

  assert.match(transform, /__sautilinkMessagesAuthorizationHeaders/);
  assert.match(appBuild, /messages-media-ui\.js/);
  assert.match(productionBuild, /messages-media-ui\.js/);
  assert.match(productionBuild, /transformMessagesMediaSource/);
  assert.doesNotMatch(transform, /sendDirectMessage\s*=|function sendDirectMessage/);
});

test('Phase 35 enables microphone only for the SautiLink app and leaves camera blocked', async () => {
  const previewStep = await read('scripts/enable-messages-media-preview.mjs');
  const productionBuild = await read('scripts/build-production-release.mjs');
  const serviceWorker = await read('sw.js');

  for (const source of [previewStep, productionBuild]) {
    assert.match(source, /microphone=\(self\)/);
    assert.match(source, /camera=\(\)/);
    assert.match(source, /media-src 'self' blob:/);
  }

  assert.match(serviceWorker, /sautilink-shell-v50/);
  assert.match(serviceWorker, /fetch\(event\.request\)/);
});

test('Phase 35 deployment bindings reuse private R2 and add a dedicated upload limiter', async () => {
  const staging = await read('wrangler.social-staging.jsonc');
  const production = await read('wrangler.production.jsonc');

  for (const config of [staging, production]) {
    assert.match(config, /"binding": "SAUTI_MEDIA"/);
    assert.match(config, /"name": "DM_MEDIA_UPLOAD_LIMITER"/);
    assert.match(config, /"DM_MEDIA_SUPABASE_URL"/);
    assert.match(config, /"DM_MEDIA_SUPABASE_KEY"/);
  }
  assert.match(production, /sautilink-media-production/);
});
