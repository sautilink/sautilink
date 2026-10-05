import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Phase 36 Durable Object is a hibernating presence and typing hub with bounded recent activity', async () => {
  const hub = await read('src/dm-realtime-hub.js');

  for (const marker of [
    "from 'cloudflare:workers'",
    'extends DurableObject',
    'acceptWebSocket',
    'getWebSockets',
    'serializeAttachment',
    "type: 'presence'",
    "type: 'typing'",
    "type: 'pong'",
    'RECENT_PRESENCE_MS',
    'peer_last_seen_at',
    'this.ctx.storage.put',
    'this.ctx.storage.get',
  ]) assert.ok(hub.includes(marker), `Durable realtime hub missing ${marker}`);

  assert.doesNotMatch(hub, /dm_messages|SAUTI_MEDIA|PROFILE_MEDIA|message_body|service_role|sb_secret_/i);
});

test('Phase 36 realtime API authorizes session, conversation, privacy and blocks before the Durable Object', async () => {
  const api = await read('src/dm-realtime-api.js');

  for (const marker of [
    '/auth/v1/user',
    'dm_conversations',
    'social_blocks',
    'social_member_preferences',
    'activity_status',
    'DM_REALTIME_HUB',
    'ACTIVITY_STATUS_DISABLED',
    'MESSAGING_BLOCKED',
    'Sec-WebSocket-Protocol',
    'X-Sauti-Conversation-ID',
    'X-Sauti-User-ID',
    'X-Sauti-Peer-ID',
  ]) assert.ok(api.includes(marker), `Durable realtime API missing ${marker}`);

  assert.doesNotMatch(api, /service_role|sb_secret_|SUPABASE_SECRET/i);
  assert.doesNotMatch(api, /insert\s*\(|update\s*\(|delete\s*\(/i);
});

test('Phase 36 browser client is additive and leaves Supabase Realtime available as fallback', async () => {
  const client = await read('src/messages-durable-realtime.js');
  const app = await read('src/app.js');
  const transform = await read('scripts/messages-durable-realtime-source-transform.mjs');
  const html = await read('app/index.html');
  const css = await read('app/assets/messages-whatsapp.css');

  for (const marker of [
    'new WebSocket',
    '/api/dm-realtime/',
    "type: 'typing'",
    "payload.type === 'presence'",
    '__sautilinkDmRealtimeContext',
    '__sautilinkDmRealtimeAuthHeaders',
    'scheduleReconnect',
    'Supabase Realtime remains active',
    'DM_REALTIME_RECENT_MS',
    'Active recently',
  ]) assert.ok(client.includes(marker), `Durable realtime client missing ${marker}`);

  assert.match(transform, /__sautilinkDmRealtimeContext/);
  assert.match(transform, /activityStatusEnabled\(\)/);
  assert.match(transform, /activeConversation\?\.blockedByYou/);
  assert.match(app, /\.channel\(/);
  assert.match(app, /broadcastDmTyping/);
  assert.match(app, /startDmConversationRealtime/);
  assert.match(app, /durableDmRealtimeActive/);
  assert.doesNotMatch(app, /typing\.textContent\s*=\s*['"]Typing…['"]/);
  assert.match(html, /message-typing-bubble/);
  assert.match(css, /message-typing-status\[hidden\]/);
  assert.match(css, /@keyframes message-typing-dot/);
  assert.match(css, /prefers-reduced-motion/);
});

test('Phase 36 keeps Worker routing isolated from the existing asset router', async () => {
  const entry = await read('src/worker-entry.js');
  const router = await read('src/asset-router.js');

  assert.match(entry, /handleDmRealtimeRequest/);
  assert.match(entry, /\/api\/dm-realtime\//);
  assert.match(entry, /return router\.fetch\(request, env, ctx\)/);
  assert.match(entry, /export \{ DmRealtimeHub \}/);
  assert.doesNotMatch(router, /cloudflare:workers|DmRealtimeHub/);
});

test('Phase 36 build pipelines bundle the client and preserve same-origin WebSocket CSP', async () => {
  const appBuild = await read('scripts/build-app.mjs');
  const productionBuild = await read('scripts/build-production-release.mjs');
  const stagingEnable = await read('scripts/enable-messages-media-preview.mjs');

  for (const source of [appBuild, productionBuild]) {
    assert.match(source, /messages-durable-realtime\.js/);
    assert.match(source, /transformMessagesDurableRealtimeSource/);
  }
  assert.match(productionBuild, /wss:\/\/sautilink\.com/);
  assert.match(productionBuild, /APP_JS_RELEASE = '20260930-swala-otp2'/);
  assert.match(stagingEnable, /wss:\/\/test\.sautilink\.com/);
});

test('Phase 36 Wrangler configs use SQLite-backed Durable Objects and publishable Supabase auth only', async () => {
  const staging = await read('wrangler.social-staging.jsonc');
  const production = await read('wrangler.production.jsonc');

  for (const config of [staging, production]) {
    assert.match(config, /"name": "DM_REALTIME_HUB"/);
    assert.match(config, /"class_name": "DmRealtimeHub"/);
    assert.match(config, /"type": "durable-object"/);
    assert.match(config, /"storage": "sqlite"/);
    assert.match(config, /"DM_REALTIME_SUPABASE_URL"/);
    assert.match(config, /"DM_REALTIME_SUPABASE_KEY"/);
    assert.doesNotMatch(config, /service_role|sb_secret_|SUPABASE_SECRET/i);
  }

  assert.match(staging, /"main": "src\/worker-entry\.js"/);
  assert.match(production, /"main": "\.\/dist-production-worker\/src\/worker-entry\.js"/);
  assert.match(staging, /"DM_REALTIME_SUPABASE_URL": "https:\/\/rggpyiterdbbugluejcs\.supabase\.co"/);
  assert.match(production, /"DM_REALTIME_SUPABASE_URL": "https:\/\/rggpyiterdbbugluejcs\.supabase\.co"/);
});
