import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { notificationPostDestination } from '../src/notification-destinations.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const rootId = 'c0e90bc0-ff49-48ae-8cf9-ea70db2f36be';
const replyId = '30ed9546-e291-4f53-9a2f-b19d781ea683';
const post = { id: rootId, root_post_id: null, parent_post_id: null };
const comment = { id: replyId, root_post_id: rootId, parent_post_id: rootId };

test('post interactions open the original post rather than comments', () => {
  for (const type of ['like', 'reshare', 'quote']) {
    assert.equal(notificationPostDestination({ notification_type: type }, post), `/post/${rootId}?view=post`);
    assert.equal(notificationPostDestination({ notification_type: type }, comment), `/post/${rootId}?view=post`);
  }
  assert.equal(notificationPostDestination({ notification_type: 'mention' }, post), `/post/${rootId}?view=post`);
});

test('comment interactions focus the exact comment and retain a distinct post destination', () => {
  for (const type of ['reply', 'mention', 'safety']) {
    assert.equal(notificationPostDestination({ notification_type: type }, comment), `/post/${replyId}?from=notification`);
  }
  assert.equal(notificationPostDestination({ notification_type: 'reply' }, post), `/post/${rootId}`);
  assert.equal(notificationPostDestination({ notification_type: 'mention' }, null), '');
});

test('the notification route, comment highlight and post link are wired into the browser UI', async () => {
  const [source, html, css, push] = await Promise.all([
    read('src/app.js'), read('app/index.html'), read('app/assets/conversation-replies-ui.css'),
    read('supabase/functions/sautilink-push-dispatch/index.ts'),
  ]);
  assert.match(source, /item\.dataset\.notificationRoute = notificationPostDestination\(notification, post\)/);
  assert.match(source, /conversationRoute\.viewPost[\s\S]*loadSharedSautiTarget\(conversationRoute\.postId\)/);
  assert.match(source, /threadPosts\.push\(target\)/);
  assert.match(source, /target\.parent_post_id && readConversationRoute\(\)\?\.fromNotification/);
  assert.match(source, /viewPost\.href = fullPostPath\(rootId\)/);
  assert.match(html, /id="conversation-view-post"[^>]*hidden>View full post<\/a>/);
  assert.match(css, /#conversation-thread \.thread-focused \{[^}]*box-shadow: inset 3px 0 0 var\(--app-accent\)/s);
  assert.match(push, /type === "reply"[\s\S]*\?from=notification/);
  assert.match(push, /\?view=post/);
});
