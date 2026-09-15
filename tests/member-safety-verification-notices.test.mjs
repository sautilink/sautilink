import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('member notice UI is bundled into the production app', async () => {
  const [build, source] = await Promise.all([
    read('scripts/build-app.mjs'),
    read('src/member-notices.js'),
  ]);
  assert.match(build, /src\/member-notices\.js/);
  assert.match(source, /post_removed_author/);
  assert.match(source, /post_removed_reporter/);
  assert.match(source, /verification_approved/);
  assert.match(source, /verification_action_required/);
  assert.match(source, /verification_rejected/);
});

test('author removal notice exposes the reason and an appeal path without exposing reporter identity', async () => {
  const source = await read('src/member-notices.js');
  assert.match(source, /Your post was removed for violating SautiLink rules/);
  assert.match(source, /review the removal reason and appeal this decision/);
  assert.match(source, /permanently banned from SautiLink/);
  assert.match(source, /Why this action was taken/);
  assert.match(source, /action\.reason/);
  assert.match(source, /Appeal this decision/);
  assert.match(source, /\/appeals\?action=/);
  assert.doesNotMatch(source, /reporter_id|reporterId/);
});

test('reporter outcome notice thanks the reporter and states the privacy guarantee', async () => {
  const source = await read('src/member-notices.js');
  assert.match(source, /The post you reported was removed after review/);
  assert.match(source, /Thank you for helping SautiLink/);
  assert.match(source, /We did not tell the post author that you submitted this report/);
});

test('verification approval notice explains the badge and continuing policy obligations', async () => {
  const source = await read('src/member-notices.js');
  assert.match(source, /verified your account information/);
  assert.match(source, /verification checkmark is now visible on your profile/);
  assert.match(source, /verification may be removed if you violate them/);
});

test('push dispatcher sends dedicated safety and verification copy with deep links', async () => {
  const source = await read('supabase/functions/sautilink-push-dispatch/index.ts');
  assert.match(source, /notification_event,moderation_action_id,verification_case_id/);
  assert.match(source, /post_removed_reporter/);
  assert.match(source, /Your identity was not shared with the author/);
  assert.match(source, /verification_approved/);
  assert.match(source, /\/appeals\?action=/);
  assert.match(source, /event: payload\.event/);
  assert.match(source, /urn:ietf:params:oauth:grant-type:jwt-bearer/);
});

test('member notice enhancement never embeds privileged server credentials', async () => {
  const source = await read('src/member-notices.js');
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|FIREBASE_SERVICE_ACCOUNT|sb_secret_/i);
  assert.match(source, /sb_publishable_/);
});
