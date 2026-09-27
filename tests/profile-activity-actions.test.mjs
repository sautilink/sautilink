import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const source = await readFile(new URL('../src/profile-activity.js', import.meta.url), 'utf8');
const actions = source.slice(
  source.indexOf('async function profileActivitySocialMutation('),
  source.indexOf('function profileActivityEmptyCopy('),
);

function harness(fetch) {
  const count = { textContent: '1' };
  const button = {
    dataset: { active: 'false' },
    attributes: {},
    classList: { toggle() {} },
    setAttribute(name, value) { this.attributes[name] = value; },
    getAttribute(name) { return this.attributes[name]; },
    querySelector(selector) { return selector === '.profile-activity-metric-count' ? count : null; },
  };
  const card = {
    dataset: { postId: 'post-id' },
    querySelector(selector) {
      if (selector === '[data-profile-activity-action="like"]') return button;
      if (selector === '[data-profile-activity-action="repost"]') return button;
      if (selector === '[data-profile-activity-action="reply"] .profile-activity-metric-count') return count;
      return null;
    },
  };
  const statuses = [];
  const context = {
    document: { querySelectorAll: () => [card] },
    fetch,
    crypto: { randomUUID: () => 'request-id' },
    profileActivityAccessToken: () => 'session-token',
    PROFILE_ACTIVITY_SUPABASE_URL: 'https://example.com',
    PROFILE_ACTIVITY_PUBLISHABLE_KEY: 'publishable',
    setProfileActivityStatus: (...args) => statuses.push(args),
    URLSearchParams,
  };
  runInNewContext(`${actions}\nthis.actions = { toggleProfileActivityMetric, submitProfileActivityComment };`, context);
  return { ...context.actions, button, card, count, statuses };
}

test('profile Like toggles in place, sends the authenticated action and rolls back a failed unlike', async () => {
  const requests = [];
  let fail = false;
  const { toggleProfileActivityMetric, button, card, count, statuses } = harness(async (path, options) => {
    requests.push({ path, method: options.method, auth: options.headers.Authorization });
    return { ok: !fail, json: async () => fail ? { error: { message: 'Try later' } } : { ok: true } };
  });

  await toggleProfileActivityMetric(button, card, 'like');
  assert.equal(button.dataset.active, 'true');
  assert.equal(count.textContent, '2');
  assert.deepEqual(requests[0], { path: '/api/social/posts/post-id/like', method: 'POST', auth: 'Bearer session-token' });

  fail = true;
  await toggleProfileActivityMetric(button, card, 'like');
  assert.equal(requests[1].method, 'DELETE');
  assert.equal(button.dataset.active, 'true');
  assert.equal(count.textContent, '2');
  assert.equal(statuses.at(-1)[0], 'Try later');
});

test('inline comment submission keeps a failed draft and reuses its idempotency key on retry', async () => {
  const requests = [];
  let fail = true;
  const { submitProfileActivityComment, card, count } = harness(async (path, options) => {
    requests.push({ path, body: JSON.parse(options.body) });
    return { ok: !fail, json: async () => fail ? { error: { message: 'Try later' } } : { ok: true } };
  });
  const textarea = { value: 'Hello!' };
  const submit = { disabled: false };
  const form = {
    dataset: {},
    elements: { body: textarea },
    closest: () => card,
    querySelector: () => submit,
  };
  await submitProfileActivityComment(form);
  assert.equal(textarea.value, 'Hello!');
  assert.equal(count.textContent, '1');
  assert.equal(form.dataset.requestId, 'request-id');
  assert.equal(submit.disabled, false);

  fail = false;
  await submitProfileActivityComment(form);
  assert.equal(textarea.value, '');
  assert.equal(form.dataset.requestId, undefined);
  assert.equal(count.textContent, '2');
  assert.equal(requests[1].path, '/api/social/posts/post-id/comments');
  assert.equal(requests[0].body.client_request_id, requests[1].body.client_request_id);
});
