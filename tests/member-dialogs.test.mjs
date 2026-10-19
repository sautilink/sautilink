import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { transform } from 'esbuild';
import { transformMemberDialogSource } from '../scripts/member-dialog-source-transform.mjs';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const originalApp = await read('src/app.js');
const app = transformMemberDialogSource('/repo/src/app.js', originalApp);
const originalRoom = await read('src/rooms-platform.js');
const room = transformMemberDialogSource('/repo/src/rooms-platform.js', originalRoom);
const presentation = await read('src/member-builtin-dialogs.js');

function feature(name) {
  const start = app.indexOf(`async function ${name}(`);
  assert.ok(start >= 0, name);
  const next = app.indexOf('\n}\n', start) + 2;
  return app.slice(start, next);
}

test('every member native confirmation and prompt becomes an awaited built-in request', async () => {
  assert.equal((app.match(/await window\.SautiMemberDialogs\.confirm\(/g) || []).length, 9);
  assert.equal((app.match(/await window\.SautiMemberDialogs\.prompt\(/g) || []).length, 2);
  assert.equal((room.match(/await window\.SautiMemberDialogs\.confirm\(/g) || []).length, 1);
  assert.doesNotMatch(app + room, /window\.(confirm|prompt)\(/);
  // Parsing the complete production sources catches an await accidentally inserted
  // into a synchronous callback, rather than just checking replacement strings.
  await transform(app, { loader: 'js' });
  await transform(room, { loader: 'js' });
  assert.equal(transformMemberDialogSource('/repo/src/app.js', app), app);
  assert.equal(transformMemberDialogSource('/repo/src/rooms-platform.js', room), room);
  assert.equal(transformMemberDialogSource('/repo/src/whatsapp-otp-auth.js', originalApp), originalApp);
  assert.throws(() => transformMemberDialogSource('/repo/src/app.js', originalApp.replace('Delete this post?', 'Delete this entry?')), /could not uniquely locate/);
});

test('real comment deletion waits for approval and cancellation never disables or deletes', async () => {
  for (const accepted of [false, true]) {
    const mutations = [];
    const refreshed = [];
    const button = { disabled: false, closest: () => ({ dataset: { rootPostId: 'root-7' } }) };
    let answer;
    const context = {
      currentMember: { id: 'member' }, activeSautiConversation: null,
      window: { SautiMemberDialogs: { confirm: () => new Promise(resolve => { answer = resolve; }) } },
      socialMutation: async (...args) => mutations.push(args),
      loadConversation: async id => refreshed.push(id), showToast() {},
    };
    runInNewContext(`${feature('deleteThreadComment')}\nthis.run = deleteThreadComment;`, context);
    const pending = context.run('comment/1', button);
    assert.equal(button.disabled, false);
    assert.equal(mutations.length, 0);
    answer(accepted);
    await pending;
    assert.equal(mutations.length, Number(accepted));
    assert.equal(button.disabled, accepted);
    if (accepted) {
      assert.equal(mutations[0][0], '/api/social/comments/comment%2F1');
      assert.equal(mutations[0][1].method, 'DELETE');
      assert.deepEqual(refreshed, ['root-7']);
    }
  }
});

test('real mute feature preserves unmute without a dialog and cancelled mute makes no request', async () => {
  for (const muted of [false, true]) {
    const requests = [];
    let dialogs = 0;
    const button = { dataset: { username: 'amina', muted: String(muted) }, hidden: false, disabled: false };
    const context = {
      byId: () => button,
      window: { SautiMemberDialogs: { confirm: async () => { dialogs++; return false; } } },
      safetyRequest: async (...args) => requests.push(args), showToast() {},
      loadStream: async () => {}, loadDiscover: async () => {}, loadNotifications: async () => {},
      refreshMessageBadge: async () => {}, loadDiscoverableProfile: async () => {},
    };
    runInNewContext(`${feature('toggleProfileMute')}\nthis.run = toggleProfileMute;`, context);
    await context.run();
    assert.equal(dialogs, Number(!muted));
    assert.equal(requests.length, Number(muted));
    if (muted) assert.equal(requests[0][1].method, 'DELETE');
    else assert.equal(button.disabled, false);
  }
});

test('real review prompts preserve optional-note and required-reason cancellation semantics', async () => {
  for (const result of [null, '  Context from reviewer  ']) {
    const requests = [];
    const context = {
      window: { SautiMemberDialogs: { prompt: async () => result } },
      moderationRequest: async (...args) => requests.push(args),
      showToast() {}, loadModerationIdentityRequests: async () => {},
      loadModerationAppeals: async () => {}, loadModerationAudit: async () => {},
      crypto: { randomUUID: () => 'request-id' },
    };
    runInNewContext(`${feature('decideModerationIdentityRequest')}\n${feature('decideModerationAppeal')}\nthis.review = decideModerationIdentityRequest; this.appeal = decideModerationAppeal;`, context);
    await context.review('name/8', 'approved');
    assert.equal(requests.length, 1);
    assert.equal(requests[0][1].body.note, result?.trim() || '');
    requests.length = 0;
    await context.appeal('appeal/5', 'appeal_reversed');
    assert.equal(requests.length, Number(result !== null));
    if (result) {
      assert.equal(requests[0][0], '/api/moderation/appeals/appeal%2F5/decision');
      assert.equal(requests[0][1].body.reason, result.trim());
      assert.equal(requests[0][1].body.action, 'appeal_reversed');
    }
  }
});

test('real Room removal callback cancels before disabling or sending the original deletion', async () => {
  const start = room.indexOf("      remove.addEventListener('click', async () => {");
  const end = room.indexOf('      controls.append(remove);', start);
  assert.ok(start >= 0 && end > start);
  for (const accepted of [false, true]) {
    let handler;
    let removed = false;
    let scheduled = false;
    const requests = [];
    const remove = { disabled: false, addEventListener: (_event, callback) => { handler = callback; } };
    const context = {
      remove, window: { SautiMemberDialogs: { confirm: async () => accepted } },
      profileLabel: () => 'Amina', profile: {}, room: { id: 'room-1' }, membership: { member_id: 'member-2' },
      roomDelete: async (...args) => requests.push(args), row: { remove: () => { removed = true; } },
      roomToast() {}, roomDetailKey: 'old', scheduleRoomsUi: () => { scheduled = true; },
    };
    runInNewContext(room.slice(start, end), context);
    await handler();
    assert.equal(requests.length, Number(accepted));
    assert.equal(remove.disabled, accepted);
    assert.equal(removed, accepted);
    assert.equal(scheduled, accepted);
    if (accepted) assert.equal(requests[0][1].member_id, 'eq.member-2');
  }
});

function harness({ auth = false, modal = true } = {}) {
  const observers = new Set();
  const windowListeners = new Map();
  const closeEvents = [];
  let document;
  class Element {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.attributes = new Map(); this.events = new Map(); this.dataset = {}; this.hidden = false; this.disabled = false; this.inert = false; this.value = ''; this.textContent = ''; this.parentNode = null; }
    append(...nodes) { for (const node of nodes) { node.parentNode = this; this.children.push(node); } }
    replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    hasAttribute(name) { return this.attributes.has(name); }
    removeAttribute(name) { this.attributes.delete(name); }
    get open() { return this.hasAttribute('open'); }
    showModal() { this.setAttribute('open', ''); this.modal = true; }
    close() { this.removeAttribute('open'); closeEvents.push(() => this.fire('close')); }
    get isConnected() { return this === document.body || Boolean(this.parentNode?.isConnected); }
    closest(selector) { if (selector === '[hidden]') return this.hidden ? this : this.parentNode?.closest(selector); return null; }
    focus() { document.activeElement = this; }
    select() { this.selected = true; }
    addEventListener(event, callback) { if (!this.events.has(event)) this.events.set(event, []); this.events.get(event).push(callback); }
    fire(type, props = {}) { const event = { type, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...props }; for (const handler of this.events.get(type) || []) handler(event); return event; }
    querySelectorAll(selector) { return this.children.flatMap(child => [...(selector.split(', ').some(tag => child.tagName === tag.toUpperCase()) ? [child] : []), ...child.querySelectorAll(selector)]); }
    getBoundingClientRect() { return { left: 10, top: 10, right: 410, bottom: 390 }; }
  }
  if (!modal) Element.prototype.showModal = undefined;
  document = { createElement: tag => new Element(tag), createElementNS: (_ns, tag) => new Element(tag) };
  document.body = new Element('body');
  document.body.classList = { contains: name => name === 'auth-entry' && auth };
  const member = new Element('main'); member.id = 'member-view';
  const trigger = new Element('button');
  const composer = new Element('dialog'); composer.id = 'composer'; composer.setAttribute('open', '');
  member.append(trigger, composer); document.body.append(member); document.activeElement = trigger;
  document.getElementById = id => {
    function find(node) { if (node.id === id) return node; for (const child of node.children) { const match = find(child); if (match) return match; } return null; }
    return find(document.body);
  };
  class MutationObserver {
    constructor(callback) { this.callback = callback; this.connected = false; observers.add(this); }
    observe() { this.connected = true; }
    disconnect() { this.connected = false; }
  }
  const window = { addEventListener: (event, callback) => windowListeners.set(event, callback) };
  runInNewContext(presentation, { window, document, MutationObserver });
  return {
    window, document, member, trigger, composer, api: window.SautiMemberDialogs,
    node: id => document.getElementById(id),
    change: () => { for (const observer of observers) if (observer.connected) observer.callback(); },
    navigate: () => windowListeners.get('popstate')(),
    closeEvents: () => { while (closeEvents.length) closeEvents.shift()(); },
  };
}

test('built-in confirmation is accessible, uses text safely and preserves an underlying composer', async () => {
  const h = harness();
  const pending = h.api.confirm('Delete this post? <img src=x onerror=bad()>');
  const dialog = h.node('member-builtin-dialog');
  assert.equal(dialog.open, true);
  assert.equal(h.composer.open, true, 'a nested feature dialog is not closed');
  assert.equal(dialog.getAttribute('aria-labelledby'), 'member-builtin-dialog-title');
  assert.equal(h.node('member-builtin-dialog-description').textContent, 'Delete this post? <img src=x onerror=bad()>');
  assert.equal(h.document.activeElement.className, 'member-builtin-dialog-cancel', 'Cancel receives safe default focus');
  const escape = dialog.fire('keydown', { key: 'Escape' });
  assert.equal(escape.defaultPrevented, true);
  assert.equal(escape.stopped, true, 'Escape cannot close the underlying composer');
  assert.equal(await pending, false);
  assert.equal(h.document.activeElement, h.trigger);
  assert.equal(h.composer.open, true);
});

test('built-in prompt returns entered content, cancels with null, and survives an old queued close event', async () => {
  const h = harness();
  let pending = h.api.prompt('Review reason:');
  const input = h.node('member-builtin-dialog-input');
  input.value = '  Original note\nkept intact  ';
  h.node('member-builtin-dialog').children[0].fire('submit');
  assert.equal(await pending, '  Original note\nkept intact  ');
  pending = h.api.prompt('Another reason:');
  h.closeEvents();
  assert.equal(h.node('member-builtin-dialog').open, true, 'old close event does not cancel a newly opened request');
  h.node('member-builtin-dialog').fire('cancel');
  assert.equal(await pending, null);
});

test('choice sheet returns only the clicked action and keeps its value separate from labels', async () => {
  const h = harness();
  const pending = h.api.choose('Share this post', [{ value: 'copy', label: 'Copy link', description: 'Copy the original URL', icon: 'copy-0-2' }]);
  const options = h.node('member-builtin-dialog').children[0].children.find(node => node.className === 'member-builtin-dialog-choices');
  options.children[0].fire('click');
  assert.equal(await pending, 'copy');
});

test('auth stays untouched and navigation aborts pending member actions instead of approving them', async () => {
  const auth = harness({ auth: true });
  await assert.rejects(auth.api.confirm('Delete?'), { name: 'AbortError' });
  assert.equal(auth.node('member-builtin-dialog'), null);
  const h = harness();
  const pending = h.api.prompt('Optional review note');
  h.member.hidden = true;
  h.change();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(h.node('member-builtin-dialog').open, false);
  const another = harness();
  const confirm = another.api.confirm('Delete?');
  another.navigate();
  await assert.rejects(confirm, { name: 'AbortError' });
});

test('fallback dialog traps interaction and restores prior inert state', async () => {
  const h = harness({ modal: false });
  const pending = h.api.confirm('Continue?');
  assert.equal(h.member.inert, true);
  h.node('member-builtin-dialog').fire('cancel');
  assert.equal(await pending, false);
  assert.equal(h.member.inert, false);
});
