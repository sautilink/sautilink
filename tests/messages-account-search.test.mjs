import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const source = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const searchFunctions = source.slice(
  source.indexOf('function filterMessageInbox() {'),
  source.indexOf('function renderMessageInboxItem(row, peer) {'),
);

function makeSearch({ usernameRows = [], nameRows = [], conversations = [] } = {}) {
  const calls = [];
  const list = {
    items: conversations,
    querySelectorAll(selector) {
      if (selector === '[data-conversation-id]') return this.items.filter((item) => 'conversationId' in item.dataset);
      if (selector === '[data-message-account-id]') return this.items.filter((item) => 'messageAccountId' in item.dataset);
      return [];
    },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    append(item) { item.remove = () => { this.items = this.items.filter((candidate) => candidate !== item); }; this.items.push(item); },
  };
  const input = { value: '' };
  const empty = { hidden: true };
  const inbox = { hidden: false };
  const byId = (id) => ({ 'messages-inbox-list': list, 'messages-search': input, 'messages-empty': empty, 'messages-inbox': inbox })[id];
  const supabase = {
    from(table) {
      assert.equal(table, 'social_profiles');
      const query = {
        select() { return this; },
        eq(field, value) { calls.push(['eq', field, value]); return this; },
        neq(field, value) { calls.push(['neq', field, value]); return this; },
        ilike(field, value) { this.field = field; calls.push(['ilike', field, value]); return this; },
        order() { return this; },
        limit() { return Promise.resolve({ data: this.field === 'username' ? usernameRows : nameRows, error: null }); },
      };
      return query;
    },
  };
  const context = {
    byId, supabase, currentMemberId: 'self', messagesRequest: 7,
    messagesSearchRequest: 0, messagesSearchTimer: null,
    window: { clearTimeout() {}, setTimeout() { return 1; } },
    renderMessageInboxItem(row, peer) {
      return { dataset: { conversationId: row.conversation_id, peerId: peer.id },
        querySelector() { return { remove() {} }; } };
    },
  };
  runInNewContext(`${searchFunctions}\nglobalThis.search = { filterMessageInbox, searchMessageAccounts };`, context);
  return { list, input, empty, inbox, calls, context };
}

test('search keeps matching chats and adds only new discoverable account results to the same list', async () => {
  const oldChat = { dataset: { conversationId: 'chat-1', peerId: 'alice', messageSearch: 'Alice @alice' }, hidden: false };
  const match = { id: 'bob', username: 'bobby', display_name: 'Bob' };
  const search = makeSearch({ conversations: [oldChat], usernameRows: [{ id: 'alice', username: 'alice' }, match], nameRows: [match] });
  search.input.value = 'bo';
  search.context.search.filterMessageInbox();
  assert.equal(oldChat.hidden, true);
  await search.context.search.searchMessageAccounts('bo', 1, 7);
  assert.equal(search.list.items.length, 2);
  assert.equal(search.list.items[1].dataset.messageAccountId, 'bob');
  assert.equal(search.calls.filter(([method, field, value]) => method === 'eq' && field === 'is_discoverable' && value === true).length, 2);
  assert.ok(search.calls.some(([method, field, value]) => method === 'ilike' && field === 'display_name' && value === '%bo%'));

  search.input.value = '';
  search.context.search.filterMessageInbox();
  assert.equal(oldChat.hidden, false);
  assert.equal(search.list.items.length, 1);
});

test('late account results cannot reappear after the search changes or the inbox is left', async () => {
  const search = makeSearch({ usernameRows: [{ id: 'other', username: 'other' }] });
  search.input.value = 'other';
  search.context.search.filterMessageInbox();
  search.input.value = 'next';
  search.context.search.filterMessageInbox();
  await search.context.search.searchMessageAccounts('other', 1, 7);
  assert.equal(search.list.items.length, 0);
  search.context.messagesRequest += 1;
  await search.context.search.searchMessageAccounts('next', 2, 7);
  assert.equal(search.list.items.length, 0);
});

test('account result activation uses the existing conversation opener and keeps search copy', async () => {
  const html = await readFile(new URL('../app/index.html', import.meta.url), 'utf8');
  const whatsapp = await readFile(new URL('../src/messages-whatsapp-ui.js', import.meta.url), 'utf8');
  assert.match(source, /openDirectConversation\(account\.dataset\.messageAccountId, account\.dataset\.username\)/);
  assert.match(whatsapp, /searchInput\.placeholder = 'Search or start new chat'/);
  assert.match(html, /id="messages-inbox-list"/);
});
