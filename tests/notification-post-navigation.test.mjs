import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { notificationPostDestination } from '../src/notification-destinations.js';

const source = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const registration = source.match(
  /byId\('notifications-list'\)\.addEventListener\('click',[\s\S]+?(?=\n\nbyId\('message-new-form'\))/,
)?.[0];
assert.ok(registration, 'The actual notification inbox click handler must be exercised');

const rootId = 'c0e90bc0-ff49-48ae-8cf9-ea70db2f36be';
const replyId = '30ed9546-e291-4f53-9a2f-b19d781ea683';
const rootPost = { id: rootId, root_post_id: null, parent_post_id: null };
const replyPost = { id: replyId, root_post_id: rootId, parent_post_id: rootId };
const flush = () => new Promise((resolve) => setImmediate(resolve));

function inbox({ memberId = 'member-1', dataset = {}, deferredRead = false } = {}) {
  const calls = [];
  let listener;
  let finishRead;
  const readComplete = deferredRead ? new Promise((resolve) => { finishRead = resolve; }) : Promise.resolve();
  const item = { dataset: { notificationId: 'notification-1', ...dataset } };
  const location = {
    href: 'https://sautilink.com/notifications',
    origin: 'https://sautilink.com',
    assign(destination) { calls.push(['assign', destination]); },
  };
  const context = {
    currentMemberId: memberId,
    byId(id) {
      assert.equal(id, 'notifications-list');
      return { addEventListener(type, callback) {
        assert.equal(type, 'click');
        listener = callback;
      } };
    },
    markNotificationRead: async (id, node) => {
      assert.equal(node, item);
      calls.push(['read-start', id]);
      await readComplete;
      calls.push(['read-complete', id]);
    },
    applyLocationRoute: async () => { calls.push(['apply-route', location.href]); },
    circlePath: (slug) => `/rooms/${encodeURIComponent(slug)}`,
    window: {
      location,
      history: { pushState(_state, _title, route) {
        calls.push(['push-state', route]);
        location.href = new URL(route, location.href).href;
      } },
    },
  };
  runInNewContext(registration, context);
  assert.equal(typeof listener, 'function');

  return {
    calls,
    finishRead,
    click({ nested = false, outside = false } = {}) {
      // The target may be an icon/path or text inside the notification row.
      const target = nested ? { parentElement: item } : item;
      target.closest = (selector) => {
        assert.equal(selector, '[data-notification-id]');
        return outside ? null : item;
      };
      listener({ target });
    },
  };
}

test('a like notification opens the full post in the active member shell', async () => {
  const route = notificationPostDestination({ notification_type: 'like' }, rootPost);
  const h = inbox({ dataset: { notificationRoute: route } });
  h.click();
  await flush();
  assert.deepEqual(h.calls, [
    ['read-start', 'notification-1'],
    ['read-complete', 'notification-1'],
    ['push-state', `/post/${rootId}?view=post`],
    ['apply-route', `https://sautilink.com/post/${rootId}?view=post`],
  ]);
});

test('a nested reply-notification target preserves the exact comment and query', async () => {
  const route = notificationPostDestination({ notification_type: 'reply' }, replyPost);
  const h = inbox({ dataset: { notificationRoute: route } });
  h.click({ nested: true });
  await flush();
  assert.deepEqual(h.calls.slice(2), [
    ['push-state', `/post/${replyId}?from=notification`],
    ['apply-route', `https://sautilink.com/post/${replyId}?from=notification`],
  ]);
  assert.equal(h.calls.some(([type]) => type === 'assign'), false);
});

test('marking the notification read finishes before any post navigation', async () => {
  const route = notificationPostDestination({ notification_type: 'like' }, rootPost);
  const h = inbox({ dataset: { notificationRoute: route }, deferredRead: true });
  h.click({ nested: true });
  await flush();
  assert.deepEqual(h.calls, [['read-start', 'notification-1']]);
  h.finishRead();
  await flush();
  assert.deepEqual(h.calls.map(([type]) => type), ['read-start', 'read-complete', 'push-state', 'apply-route']);
});

test('a stale signed-out notification retains the full navigation fallback', async () => {
  const route = notificationPostDestination({ notification_type: 'like' }, rootPost);
  const h = inbox({ memberId: '', dataset: { notificationRoute: route } });
  h.click();
  await flush();
  assert.deepEqual(h.calls, [
    ['read-start', 'notification-1'],
    ['read-complete', 'notification-1'],
    ['assign', route],
  ]);
});

test('circle notifications keep their existing destination and read sequence', async () => {
  const h = inbox({ dataset: { circleSlug: 'community-room' } });
  h.click({ nested: true });
  await flush();
  assert.deepEqual(h.calls, [
    ['read-start', 'notification-1'],
    ['read-complete', 'notification-1'],
    ['assign', '/rooms/community-room'],
  ]);
});

test('post destinations retain priority over a circle fallback on the same row', async () => {
  const route = notificationPostDestination({ notification_type: 'like' }, rootPost);
  const h = inbox({ dataset: { notificationRoute: route, circleSlug: 'community-room' } });
  h.click();
  await flush();
  assert.deepEqual(h.calls.slice(2), [
    ['push-state', route],
    ['apply-route', `https://sautilink.com${route}`],
  ]);
});

test('clicks outside a notification row do not mark read or navigate', async () => {
  const h = inbox();
  h.click({ outside: true });
  await flush();
  assert.deepEqual(h.calls, []);
});
