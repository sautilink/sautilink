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
  runInNewContext(`${actions}\nthis.actions = { toggleProfileActivityMetric };`, context);
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

test('profile card opens the full post and its comment action opens the conversation', async () => {
  const navigation = source.slice(source.indexOf('function profileActivityPostPath('), source.indexOf('function createProfileActivityMetric('));
  const destinations = [];
  const context = { window: { location: { assign: (path) => destinations.push(path) } }, encodeURIComponent };
  runInNewContext(`${navigation}\nthis.navigateProfileActivityCard = navigateProfileActivityCard;`, context);
  const card = { dataset: { postId: 'sample-id' } };

  context.navigateProfileActivityCard(card);
  context.navigateProfileActivityCard(card, { comments: true });
  assert.deepEqual(destinations, ['/post/sample-id?view=post', '/post/sample-id']);
  assert.match(source, /kind === 'reply'\) navigateProfileActivityCard\(card, \{ comments: true \}\)/);
  assert.doesNotMatch(source, /toggleProfileActivityComments\(/);
});

test('rounded reactions layer is scoped to profile cards with usable touch targets', async () => {
  const css = await readFile(new URL('../app/assets/profile-activity.css', import.meta.url), 'utf8');
  assert.match(css, /\.profile-activity-metrics\s*\{[^}]*border-radius: 28px/s);
  assert.match(css, /\.profile-activity-metric\s*\{[^}]*min-height: 40px/s);
  assert.match(css, /\.profile-activity-metric\[hidden\] \{ display: none; \}/);
});
