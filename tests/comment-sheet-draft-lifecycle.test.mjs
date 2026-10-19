import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const functions = [
  'threadDraftKey', 'readThreadDraft', 'writeThreadDraft',
  'conversationPostById', 'conversationItemById', 'conversationAuthorLabel',
  'setConversationReplyTarget', 'ensureThreadReplyRequestId',
  'persistThreadReplyDraft', 'restoreThreadReplyDraft', 'updateConversationReplyState',
  'loadConversation', 'submitThreadReply', 'deleteThreadComment',
];

function actualFunction(name) {
  const start = app.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  const end = app.indexOf('\n}', start) + 2;
  assert.ok(start >= 0 && end > start, `actual ${name} function must exist`);
  return app.slice(start, end);
}

const sheetInitializer = app.indexOf('memberCommentSheet = createMemberCommentSheet({');
const onCloseStart = app.indexOf('onClose:', sheetInitializer) + 'onClose:'.length;
const onCloseEnd = app.indexOf('\n  },', onCloseStart) + 4;
assert.ok(sheetInitializer >= 0 && onCloseEnd > onCloseStart, 'actual sheet close callback must exist');
const actualCloseCallback = app.slice(onCloseStart, onCloseEnd).trim();

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const B_REPLY = '33333333-3333-4333-8333-333333333333';
const REQUEST_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REQUEST_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function harness({ online = true } = {}) {
  const values = new Map();
  const writes = [];
  const nodes = new Map();
  const mutations = [];
  const reads = [];
  const toasts = [];
  const renders = [];
  const routeWrites = [];
  let nextReadGate = null;
  const posts = new Map([
    [A, { id: A, author_id: 'author-a', body: 'Post A' }],
    [B, { id: B, author_id: 'author-b', body: 'Post B' }],
    [B_REPLY, { id: B_REPLY, root_post_id: B, parent_post_id: B, author_id: 'author-b', body: 'A reply to B' }],
  ]);
  function node(id) {
    if (!nodes.has(id)) {
      const attributes = new Map();
      nodes.set(id, {
        id, value: '', textContent: '', hidden: false, disabled: false, dataset: {},
        classList: { add() {}, remove() {} },
        setAttribute: (name, value) => attributes.set(name, String(value)),
        getAttribute: name => attributes.get(name) ?? null,
        removeAttribute: name => attributes.delete(name),
        replaceChildren() {}, querySelector: () => null,
      });
    }
    return nodes.get(id);
  }
  const context = {
    currentMemberId: 'member-1', currentMember: { id: 'member-1' },
    THREAD_DRAFT_PREFIX: 'test-thread-draft:', THREAD_POST_SELECT: '*',
    threadReplyRequestId: REQUEST_A, sautiConversationRequest: 0,
    activeSautiConversation: null,
    memberCommentSheet: { isOpen: true, postId: A },
    conversationSurface: node('conversation-surface'),
    byId: node,
    navigator: { onLine: online },
    crypto: { randomUUID: () => 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
    canCurrentMemberComment: () => true,
    commentRestrictionNotice: () => '',
    authorFromPost: post => ({ display_name: `Author ${post.author_id}` }),
    setMessage(target, message, kind = '') { target.textContent = message; target.kind = kind; target.hidden = !message; },
    showToast: message => toasts.push(message),
    conversationPath: id => `/post/${id}`,
    fullPostPath: id => `/post/${id}?view=post`,
    readConversationRoute: () => null,
    renderConversationThread() { renders.push(context.activeSautiConversation.rootId); },
    hydrateDirectPosts: async rows => rows.map(post => ({ post, authorFollowsViewer: true })),
    socialMutation(path, options) {
      return new Promise((resolve, reject) => mutations.push({ path, options, resolve, reject }));
    },
    supabase: {
      from(table) {
        assert.equal(table, 'social_posts');
        let column;
        let value;
        const query = {
          select() { return query; },
          eq(name, expected) { column = name; value = expected; return query; },
          order() { return query; },
          async maybeSingle() {
            reads.push(['single', value]);
            const wait = nextReadGate; nextReadGate = null;
            if (wait) await wait;
            return { data: posts.get(value) || null, error: null };
          },
          async limit() { reads.push(['replies', value]); return { data: [...posts.values()].filter(post => post[column] === value), error: null }; },
        };
        return query;
      },
    },
    window: {
      confirm: () => true,
      location: { pathname: `/videos/${A}`, search: '?source=home', hash: '#sound' },
      localStorage: {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => { writes.push([key, JSON.parse(value)]); values.set(key, value); },
        removeItem: key => { writes.push([key, null]); values.delete(key); },
      },
      history: { replaceState: (...args) => routeWrites.push(args) },
      setTimeout: callback => { callback(); },
    },
  };
  runInNewContext(`${functions.map(actualFunction).join('\n\n')}\nthis.actualLoad = loadConversation; this.actualSubmit = submitThreadReply; this.actualDelete = deleteThreadComment; this.actualPersist = persistThreadReplyDraft; this.actualRestore = restoreThreadReplyDraft; this.actualClose = (${actualCloseCallback});`, context);

  function draft(root, body, request = REQUEST_A, target = root) {
    values.set(`test-thread-draft:member-1:${root}`, JSON.stringify({ body, targetId: target, clientRequestId: request }));
  }
  const readDraft = root => JSON.parse(values.get(`test-thread-draft:member-1:${root}`) || 'null');
  function activate(root, body, request = REQUEST_A) {
    const rootItem = { post: posts.get(root), authorFollowsViewer: true };
    context.activeSautiConversation = { rootId: root, focusId: root, replyTargetId: root, canReply: true, rootItem, replyItems: [], postMap: new Map([[root, rootItem]]), expandedReplies: new Set() };
    context.memberCommentSheet.isOpen = true;
    context.memberCommentSheet.postId = root;
    context.conversationSurface.hidden = false;
    context.threadReplyRequestId = request;
    node('conversation-reply-body').value = body;
    node('conversation-reply-compose').hidden = false;
    node('conversation-reply-submit').textContent = 'Comment';
    node('conversation-reply-submit').disabled = !body.trim();
  }
  function close() {
    context.actualClose();
    context.memberCommentSheet.isOpen = false;
    context.conversationSurface.hidden = true;
  }
  activate(A, 'Comment for A');
  return {
    context, node, mutations, reads, toasts, renders, routeWrites, writes, draft, readDraft, activate, close,
    load: id => context.actualLoad(id), submit: () => context.actualSubmit(), persist: () => context.actualPersist(),
    deleteComment: (id, button) => context.actualDelete(id, button),
    holdNextRead() { let release; nextReadGate = new Promise(resolve => { release = resolve; }); return release; },
  };
}

test('loading another post restores its own saved reply draft without copying the previous textarea into it', async () => {
  const h = harness();
  h.persist();
  h.draft(B, 'Existing draft specifically for B', REQUEST_B, B_REPLY);
  await h.load(B);
  assert.equal(h.context.activeSautiConversation.rootId, B);
  assert.equal(h.context.activeSautiConversation.replyTargetId, B_REPLY);
  assert.equal(h.node('conversation-reply-body').value, 'Existing draft specifically for B');
  assert.equal(h.context.threadReplyRequestId, REQUEST_B);
  assert.equal(h.readDraft(A).body, 'Comment for A');
  assert.equal(h.readDraft(B).body, 'Existing draft specifically for B');
  assert.ok(h.writes.filter(([key, value]) => key.endsWith(B) && value).every(([, value]) => value.body !== 'Comment for A'));
});

test('a post without a saved draft starts empty while the previous post draft stays stored separately', async () => {
  const h = harness(); h.persist();
  await h.load(B);
  assert.equal(h.node('conversation-reply-body').value, '');
  assert.equal(h.readDraft(B), null);
  assert.equal(h.readDraft(A).body, 'Comment for A');
  assert.equal(h.node('conversation-reply-submit').disabled, true);
});

test('a successful pending send after closing comments cannot rewrite the Short Video URL or reload hidden comments', async () => {
  const h = harness();
  const pending = h.submit();
  assert.equal(h.mutations.length, 1);
  h.close();
  const readsBefore = h.reads.length;
  h.mutations[0].resolve({ ok: true }); await pending;
  assert.deepEqual(h.routeWrites, []);
  assert.equal(h.reads.length, readsBefore);
  assert.equal(h.context.memberCommentSheet.isOpen, false);
  assert.equal(h.readDraft(A), null, 'only the submitted draft is cleared after successful delivery');
});

test('a pending send for A cannot clear the new B textarea, storage, reply target or composer state', async () => {
  const h = harness(); const pending = h.submit();
  h.close();
  h.draft(B, 'Do not lose this new B draft', REQUEST_B, B_REPLY);
  h.context.memberCommentSheet.isOpen = true; h.context.memberCommentSheet.postId = B;
  await h.load(B);
  const readsBefore = h.reads.length;
  const button = h.node('conversation-reply-submit');
  button.textContent = 'B composer'; button.setAttribute('aria-busy', 'true');
  h.mutations[0].resolve({ ok: true }); await pending;
  assert.equal(h.node('conversation-reply-body').value, 'Do not lose this new B draft');
  assert.equal(h.readDraft(B).body, 'Do not lose this new B draft');
  assert.equal(h.context.activeSautiConversation.rootId, B);
  assert.equal(h.context.activeSautiConversation.replyTargetId, B_REPLY);
  assert.equal(h.context.threadReplyRequestId, REQUEST_B);
  assert.equal(button.textContent, 'B composer');
  assert.equal(button.getAttribute('aria-busy'), 'true');
  assert.equal(h.reads.length, readsBefore);
  assert.deepEqual(h.routeWrites, []);
  assert.equal(h.readDraft(A), null);
});

test('an error from a previously closed thread cannot replace the current thread message or composer state', async () => {
  const h = harness(); const pending = h.submit();
  h.close(); h.activate(B, 'My B draft', REQUEST_B); h.persist();
  const message = h.node('conversation-reply-message'); message.textContent = 'Message belonging to B';
  const button = h.node('conversation-reply-submit'); button.textContent = 'B ready';
  h.mutations[0].reject(new Error('A failed while B was open')); await pending;
  assert.equal(message.textContent, 'Message belonging to B');
  assert.equal(button.textContent, 'B ready');
  assert.equal(h.node('conversation-reply-body').value, 'My B draft');
  assert.equal(h.readDraft(A).body, 'Comment for A', 'failed delivery retains its original draft');
  assert.equal(h.readDraft(B).body, 'My B draft');
  assert.deepEqual(h.routeWrites, []);
});

test('normal successful comment delivery keeps the Short Video route while refreshing its actual comment thread', async () => {
  const h = harness(); const pending = h.submit();
  const mutation = h.mutations[0];
  assert.equal(mutation.path, `/api/social/posts/${A}/comments`);
  assert.equal(mutation.options.method, 'POST');
  assert.equal(mutation.options.body.body, 'Comment for A');
  assert.equal(mutation.options.body.client_request_id, REQUEST_A);
  mutation.resolve({ ok: true }); await pending;
  assert.deepEqual(h.routeWrites, []);
  assert.ok(h.reads.some(([kind, id]) => kind === 'single' && id === A));
  assert.equal(h.node('conversation-reply-body').value, '');
  assert.equal(h.readDraft(A), null);
  assert.equal(h.node('conversation-reply-submit').getAttribute('aria-busy'), null);
  assert.ok(h.toasts.includes('Comment shared.'));
});

test('typing a new draft while an earlier send is pending preserves that newer content after delivery', async () => {
  const h = harness(); const pending = h.submit();
  h.node('conversation-reply-body').value = 'A newer thought for this same post'; h.persist();
  h.mutations[0].resolve({ ok: true }); await pending;
  assert.equal(h.node('conversation-reply-body').value, 'A newer thought for this same post');
  assert.equal(h.readDraft(A).body, 'A newer thought for this same post');
  assert.deepEqual(h.routeWrites, []);
});

test('offline comments stay as a per-post draft and never attempt a mutation', async () => {
  const h = harness({ online: false }); await h.submit();
  assert.deepEqual(h.mutations, []);
  assert.equal(h.readDraft(A).body, 'Comment for A');
  assert.equal(h.node('conversation-reply-body').value, 'Comment for A');
  assert.equal(h.node('conversation-reply-submit').textContent, 'Save draft');
  assert.match(h.node('conversation-reply-message').textContent, /saved on this device/);
});

test('another submit while the original request is pending cannot send the same comment twice', async () => {
  const h = harness(); const first = h.submit(); const second = h.submit();
  assert.equal(h.mutations.length, 1);
  assert.equal(h.node('conversation-reply-submit').disabled, true);
  h.mutations[0].resolve({ ok: true }); await Promise.all([first, second]);
  assert.equal(h.mutations.length, 1);
  assert.equal(h.readDraft(A), null);
});

test('the existing full-page comments route still refreshes its root after successful delivery', async () => {
  const h = harness();
  h.context.memberCommentSheet.isOpen = false;
  h.context.window.location.pathname = `/post/${A}`;
  h.context.window.location.search = ''; h.context.window.location.hash = '';
  const pending = h.submit(); h.mutations[0].resolve({ ok: true }); await pending;
  assert.equal(h.routeWrites.length, 1);
  assert.equal(h.routeWrites[0][2], `/post/${A}`);
  assert.ok(h.reads.some(([kind, id]) => kind === 'single' && id === A));
  assert.equal(h.node('conversation-reply-body').value, '');
  assert.equal(h.readDraft(A), null);
});

test('closing during a new thread load cannot resave stale textarea content over either stored draft', async () => {
  const h = harness();
  h.draft(A, 'Keep the saved A draft', REQUEST_A);
  h.draft(B, 'Keep the saved B draft', REQUEST_B);
  h.node('conversation-reply-body').value = 'Stale textarea from before loading';
  const release = h.holdNextRead(); const loading = h.load(B);
  assert.equal(h.node('conversation-reply-compose').hidden, true);
  h.close(); release(); await loading;
  assert.equal(h.readDraft(A).body, 'Keep the saved A draft');
  assert.equal(h.readDraft(B).body, 'Keep the saved B draft');
  assert.equal(h.context.activeSautiConversation.rootId, A, 'cancelled request cannot install a hidden B thread');
  assert.deepEqual(h.renders, []);
  assert.deepEqual(h.routeWrites, []);
});

test('comment deletion finishing after close or a thread switch cannot reload an obsolete thread', async () => {
  for (const switchThread of [false, true]) {
    const h = harness();
    const button = { disabled: false, closest: () => ({ dataset: { rootPostId: A } }) };
    const deletion = h.deleteComment('comment/1', button);
    assert.equal(h.mutations[0].path, '/api/social/comments/comment%2F1');
    assert.equal(h.mutations[0].options.method, 'DELETE');
    h.close();
    if (switchThread) { h.activate(B, 'Draft for B', REQUEST_B); h.persist(); }
    h.mutations[0].resolve({ ok: true }); await deletion;
    assert.deepEqual(h.reads, []);
    assert.deepEqual(h.routeWrites, []);
    assert.deepEqual(h.toasts, []);
    if (switchThread) {
      assert.equal(h.context.activeSautiConversation.rootId, B);
      assert.equal(h.node('conversation-reply-body').value, 'Draft for B');
      assert.equal(h.readDraft(B).body, 'Draft for B');
    }
  }
});

test('a stale deletion error cannot change the new thread or show an unrelated failure', async () => {
  const h = harness();
  const button = { disabled: false, closest: () => ({ dataset: { rootPostId: A } }) };
  const deletion = h.deleteComment('comment-1', button);
  h.close(); h.activate(B, 'Draft for B', REQUEST_B); h.persist();
  h.mutations[0].reject(new Error('Previous deletion failed')); await deletion;
  assert.equal(h.context.activeSautiConversation.rootId, B);
  assert.equal(h.readDraft(B).body, 'Draft for B');
  assert.deepEqual(h.toasts, []);
  assert.deepEqual(h.reads, []);
});

test('normal deletion still refreshes the current thread and cancellation does not send a request', async () => {
  const h = harness();
  const button = { disabled: false, closest: () => ({ dataset: { rootPostId: A } }) };
  const deletion = h.deleteComment('comment-1', button);
  h.mutations[0].resolve({ ok: true }); await deletion;
  assert.ok(h.reads.some(([kind, id]) => kind === 'single' && id === A));
  assert.ok(h.toasts.includes('Comment deleted.'));
  assert.deepEqual(h.routeWrites, []);
  const cancelled = harness(); cancelled.context.window.confirm = () => false;
  const untouched = { disabled: false, closest: () => ({ dataset: { rootPostId: A } }) };
  await cancelled.deleteComment('comment-2', untouched);
  assert.equal(untouched.disabled, false);
  assert.deepEqual(cancelled.mutations, []);
});
