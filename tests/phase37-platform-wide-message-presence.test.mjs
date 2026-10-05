import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Phase 37 stores recent member activity privately and exposes only authorized coarse status', async () => {
  const migration = await read('supabase/migrations/20261005214500_enable_platform_wide_message_presence.sql');

  for (const marker of [
    'private.member_activity_phase37',
    'public.can_view_member_activity_topic_phase37',
    'public.touch_member_activity_phase37',
    'public.dm_peer_recent_activity_phase37',
    "'member-activity:'",
    "interval '5 days'",
    'social_member_preferences',
    'social_blocks',
    "realtime.messages.extension = 'presence'",
  ]) {
    assert.ok(migration.includes(marker), `Platform presence migration missing ${marker}`);
  }

  assert.match(migration, /revoke all on table private\.member_activity_phase37 from public, anon, authenticated/i);
  assert.match(migration, /security definer[\s\S]*set search_path = ''/i);
  assert.match(migration, /old\.activity_status is true and new\.activity_status is not true/i);
  assert.doesNotMatch(migration, /grant\s+(?:select|insert|update|delete|all)[\s\S]*member_activity_phase37[\s\S]*authenticated/i);
});

test('Phase 37 publishes platform-wide Presence while typing remains conversation realtime', async () => {
  const app = await read('src/app.js');
  const durable = await read('src/messages-durable-realtime.js');

  for (const marker of [
    'MEMBER_ACTIVITY_HEARTBEAT_MS',
    'member-activity:',
    'touch_member_activity_phase37',
    'dm_peer_recent_activity_phase37',
    'syncMemberActivityPresence',
    'startDmPeerActivityPresence',
    'channel.track',
    'channel.untrack',
    'globalPresenceTransport',
    'renderGlobalDmPeerActivity',
    'Active recently',
  ]) {
    assert.ok(app.includes(marker), `Platform presence client missing ${marker}`);
  }

  assert.match(app, /document\.addEventListener\('visibilitychange'[\s\S]*syncMemberActivityVisibility/);
  assert.match(app, /if \(dmPeerActivityOnline\)[\s\S]*Online[\s\S]*else if \(dmPeerActivityRecent\)[\s\S]*Active recently/);
  assert.match(durable, /__sautilinkRenderDmPeerActivity/);
  assert.match(durable, /durablePeerTyping[\s\S]*Typing…[\s\S]*globalRenderer/);
  assert.doesNotMatch(app, /Last seen at|Last seen \d|Active \d+[mh]/i);
});

test('Phase 37 privacy preference immediately tears down global activity presence', async () => {
  const app = await read('src/app.js');

  assert.match(app, /column === 'activity_status'[\s\S]*syncMemberActivityPresence/);
  assert.match(app, /column === 'activity_status'[\s\S]*stopMemberActivityPresence\(\{ clearRecent: true \}\)/);
  assert.match(app, /showSignedOut[\s\S]*stopDmPeerActivityPresence\(\)[\s\S]*stopMemberActivityPresence\(\)/);
  assert.match(app, /syncMessageThreadSafety[\s\S]*if \(blocked\) void stopDmPeerActivityPresence\(\)/);
});
