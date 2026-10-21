import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';

test('actual push dispatcher resolves Story reactions with live authorization and native-only safe routes', async (t) => {
  const source = await readFile(new URL('../supabase/functions/sautilink-push-dispatch/index.ts', import.meta.url), 'utf8');
  const compiled = await transform(source.replace(/^import \{ buildPushPayload \} from .*;\s*$/m,
    'const buildPushPayload = async () => { throw new Error("Offline test must not send Web Push"); };')
    + '\nexport { buildSocialPayload };\n', { loader: 'ts', format: 'esm', target: 'es2022' });
  const previousFetch = globalThis.fetch;
  const previousDeno = globalThis.Deno;
  let handler;
  const story = 'd1000000-0000-4000-8000-000000000001';
  const actor = 'd2000000-0000-4000-8000-000000000001';
  const recipient = 'd3000000-0000-4000-8000-000000000001';
  const queue = 'd4000000-0000-4000-8000-000000000001';
  const dispatch = 'd5000000-0000-4000-8000-000000000001';
  const calls = [];
  let notification = { id: 12, recipient_id: recipient, actor_id: actor, story_id: story, notification_type: 'story_like' };
  let allowed = true;
  const fixtureFirebase = Buffer.from(JSON.stringify({ project_id: 'offline-fixture', client_email: 'offline@example.test',
    private_key: '-----BEGIN PRIVATE KEY-----OFFLINE-NOT-A-CRYPTOGRAPHIC-KEY' })).toString('base64');
  globalThis.Deno = { env: { get: (name) => ({ SUPABASE_URL: 'https://offline.example.test',
    SUPABASE_SERVICE_ROLE_KEY: 'offline-service-role-fixture', FIREBASE_SERVICE_ACCOUNT_JSON_BASE64: fixtureFirebase }[name]) }, serve: (fn) => { handler = fn; } };
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://offline.example.test', 'all provider/network delivery must remain stubbed');
    calls.push({ path: url.pathname, query: url.search, method: options.method, body: options.body });
    let result;
    if (url.pathname.endsWith('/social_notifications')) result = [notification];
    else if (url.pathname.endsWith('/rpc/stories_push_authorize')) result = allowed;
    else if (url.pathname.endsWith('/social_profiles')) result = [{ username: 'member', display_name: 'Amina' }];
    else if (url.pathname.endsWith('/push_delivery_queue')) result = options.method === 'GET' ? [{
      id: queue, recipient_id: recipient, source_type: 'social_notification', source_id: '12', status: 'pending', attempt_count: 0,
    }] : [];
    else if (url.pathname.endsWith('/push_device_tokens') || url.pathname.endsWith('/web_push_subscriptions')) result = [];
    else throw new Error(`Unexpected offline request: ${url.pathname}`);
    return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const module = await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`);
    await t.test('like/dislike copy and route contain the exact Story id, never post/profile fallback', async () => {
      const liked = await module.buildSocialPayload('12', recipient);
      assert.equal(liked.body, 'Amina liked your story.');
      assert.equal(liked.route, `/stories/${story}`); assert.equal(liked.storyId, story);
      const auth = calls.find((x) => x.path.endsWith('/rpc/stories_push_authorize'));
      assert.deepEqual(JSON.parse(auth.body), { p_story: story, p_actor: actor, p_recipient: recipient, p_notification_id: '12' });
      notification.notification_type = 'story_dislike';
      assert.equal((await module.buildSocialPayload('12', recipient)).body, 'Amina disliked your story.');
    });
    await t.test('expired/deleted/blocked/preferences denial fails closed before actor lookup', async () => {
      allowed = false; calls.length = 0;
      assert.equal(await module.buildSocialPayload('12', recipient), null);
      assert.equal(calls.some((x) => x.path.endsWith('/social_profiles')), false);
      allowed = true; notification.story_id = 'https://evil.test/story'; calls.length = 0;
      assert.equal(await module.buildSocialPayload('12', recipient), null);
      assert.equal(calls.some((x) => x.path.endsWith('/rpc/stories_push_authorize')), false);
      notification.story_id = story;
    });
    await t.test('ordinary post/follow notices keep their established routes and text', async () => {
      notification = { id: 12, recipient_id: recipient, actor_id: actor, notification_type: 'follow' };
      calls.length = 0;
      const follow = await module.buildSocialPayload('12', recipient);
      assert.equal(follow.body, 'Amina followed you.'); assert.equal(follow.route, '/u/member');
      assert.equal(calls.some((x) => x.path.endsWith('/rpc/stories_push_authorize')), false);
    });
    await t.test('Story pushes check native tokens and never query unsupported Web Push subscriptions', async () => {
      notification = { id: 12, recipient_id: recipient, actor_id: actor, story_id: story, notification_type: 'story_like' };
      calls.length = 0;
      const response = await handler(new Request('https://offline.example.test/functions/v1/sautilink-push-dispatch', {
        method: 'POST', body: JSON.stringify({ queue_id: queue, dispatch_key: dispatch }), headers: { 'Content-Type': 'application/json' },
      }));
      assert.equal(response.status, 200); assert.equal((await response.json()).status, 'no_tokens');
      assert.equal(calls.some((x) => x.path.endsWith('/push_device_tokens')), true);
      assert.equal(calls.some((x) => x.path.endsWith('/web_push_subscriptions')), false);
    });
  } finally { globalThis.fetch = previousFetch; globalThis.Deno = previousDeno; }
});
