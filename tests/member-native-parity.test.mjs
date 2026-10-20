import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const source = await read('app/assets/member-native-parity.js');
const css = await read('app/assets/member-native-parity.css');

function harness({ signedIn = true } = {}) {
  let writes = 0;
  const frames = new Map();
  let frameId = 0;
  const observers = [];
  const listeners = new Map();
  class Element {
    constructor(tag = 'div', className = '', id = '') {
      this.tagName = tag; this.className = className; this.id = id;
      this.children = []; this.parentNode = null; this.dataset = {}; this.attributes = new Map();
      this.hidden = false; this.disabled = false; this.copy = '';
      this.classList = { contains: (name) => this.className.split(' ').includes(name) };
    }
    get isConnected() { return this === document.body || Boolean(this.parentNode?.isConnected); }
    get nextSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1] || null; }
    get nextElementSibling() { return this.nextSibling; }
    get textContent() { return this.copy + this.children.map((child) => child.textContent).join(''); }
    set textContent(value) { this.copy = value; this.children = []; writes += 1; }
    setAttribute(name, value) { this.attributes.set(name, value); writes += 1; }
    getAttribute(name) { return this.attributes.get(name) || null; }
    contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
    insertBefore(node, before) {
      if (node === before) return;
      const focused = node.contains(document.activeElement);
      if (node.parentNode) node.parentNode.children = node.parentNode.children.filter((child) => child !== node);
      const index = before ? this.children.indexOf(before) : this.children.length;
      assert.notEqual(index, -1);
      this.children.splice(index, 0, node); node.parentNode = this; writes += 1;
      if (focused) document.activeElement = document.body;
    }
    append(...nodes) { nodes.forEach((node) => this.insertBefore(node, null)); }
    replaceChildren(...nodes) { this.children.forEach((child) => { child.parentNode = null; }); this.children = []; this.copy = ''; this.append(...nodes); }
    focus() { document.activeElement = this; }
    descendants() { return this.children.flatMap((child) => [child, ...child.descendants()]); }
    querySelectorAll(selector) {
      const pieces = selector.split(' ');
      if (pieces.length > 1) {
        const first = this.querySelector(pieces.shift());
        return first ? first.querySelectorAll(pieces.join(' ')) : [];
      }
      return this.descendants().filter((node) => selector[0] === '#'
        ? node.id === selector.slice(1) : selector[0] === '.'
          ? node.className.split(' ').includes(selector.slice(1))
          : selector === 'button[type="submit"]' ? node.tagName === 'button' && node.getAttribute('type') === 'submit'
            : node.tagName === selector);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  }
  const document = {
    readyState: 'complete', activeElement: null,
    createElement: (tag) => new Element(tag), createElementNS: (_namespace, tag) => new Element(tag),
    getElementById: (id) => document.body.id === id ? document.body : document.body.querySelector(`#${id}`),
    querySelector: (selector) => document.body.querySelector(selector),
    querySelectorAll: (selector) => document.body.querySelectorAll(selector),
  };
  document.body = new Element('body');
  document.activeElement = document.body;
  const make = (tag, className = '', id = '', parent = document.body) => {
    const element = new Element(tag, className, id); parent.append(element); return element;
  };
  const member = make('main', '', 'member-view'); member.hidden = !signedIn;
  const stream = make('section', '', 'stream-surface', member);
  const saved = make('section', '', 'saved-surface', member);
  const rooms = make('section', '', 'circles-surface', member);
  const conversation = make('section', '', 'conversation-surface', member);
  function addPost(surface = stream) {
    const card = make('article', 'sauti-card', '', surface);
    const head = make('div', 'sauti-card-head', '', card);
    const avatar = make('div', 'sauti-card-avatar', '', head);
    const identity = make('div', 'sauti-card-identity', '', head);
    const name = make('span', 'verified-name', '', identity); name.textContent = 'Neema Joseph With A Long Display Name';
    const handle = make('a', '', '', identity); handle.textContent = '@neemaj'; handle.setAttribute('href', '/u/neemaj');
    handle.onclick = () => 'Original profile';
    const actions = make('div', 'sauti-card-head-actions', '', head);
    const follow = make('button', 'sauti-head-follow following', '', actions); follow.textContent = 'Following'; follow.onclick = () => 'Original Following';
    const more = make('button', 'sauti-head-more', '', actions); more.onclick = () => 'Original More';
    const time = make('time', '', '', head); time.textContent = '25m'; time.setAttribute('datetime', '2026-10-20T03:00:00Z'); time.setAttribute('title', 'Original timestamp');
    const edited = make('span', 'sauti-edited-label', '', head); edited.textContent = 'Edited';
    return { card, head, avatar, identity, name, handle, actions, follow, more, time, edited };
  }
  const post = addPost();
  const discover = make('section', '', 'discover-surface', member);
  const form = make('form', '', 'discover-form', discover);
  const submit = make('button', '', '', form); submit.setAttribute('type', 'submit'); submit.textContent = 'Search';
  const list = make('div', '', 'discover-profile-list', discover);
  const person = make('article', 'discover-profile-row', '', list);
  const personAvatar = make('span', 'discover-profile-avatar', '', person);
  const personCopy = make('div', 'discover-profile-copy', '', person);
  const personText = make('p', '', '', personCopy); personText.textContent = 'Original member bio';
  const open = make('a', 'discover-profile-open', 'existing-profile-link', person);
  open.setAttribute('href', '/u/qa_member'); open.onclick = () => 'Original profile link';
  const notifications = make('div', '', 'notifications-list', member);
  const notice = make('button', 'notification-item unread', '', notifications); notice.dataset.notificationType = 'like';
  const noticeAvatar = make('span', 'notification-avatar', '', notice);
  const photo = make('img', 'profile-avatar-photo', '', noticeAvatar); photo.setAttribute('src', '/original-avatar');
  const noticeCopy = make('span', 'notification-copy', '', notice);
  const originalNotice = make('p', '', '', noticeCopy); originalNotice.textContent = '@member liked your post.';
  const time = make('time', '', '', noticeCopy); time.textContent = '2h';
  const profile = make('section', '', 'profile-surface', member);
  const card = make('article', '', 'profile-card', profile);
  const main = make('div', 'profile-main', '', card);
  const top = make('div', 'profile-topline', '', main);
  const originalAvatar = make('span', 'profile-avatar', '', top);
  const topActions = make('div', 'profile-actions', '', top);
  const follow = make('button', '', 'profile-follow-button', topActions); follow.hidden = true;
  const message = make('button', '', 'profile-message-button', topActions); message.disabled = true;
  const overflow = make('button', '', 'profile-more-button', topActions); overflow.onclick = () => 'Original overflow';
  const heading = make('div', 'profile-heading', '', main);
  const bio = make('p', '', 'profile-bio', main); bio.textContent = 'Original profile bio';
  const stats = make('div', 'profile-social-stats', '', main);
  const owner = make('div', '', 'profile-owner-dashboard-actions', profile); owner.hidden = true;
  const edit = make('button', '', 'profile-edit-button', owner); edit.onclick = () => 'Original Edit';
  const dashboard = make('button', '', 'profile-dashboard-button', owner); dashboard.onclick = () => 'Original Dashboard';
  const activity = make('div', '', 'profile-activity-shell', profile);
  const privacy = make('button', '', 'profile-activity-privacy-toggle', activity); privacy.hidden = true;
  const window = { addEventListener(type, callback) { const calls = listeners.get(type) || []; calls.push(callback); listeners.set(type, calls); } };
  class MutationObserver {
    constructor(callback) { this.callback = callback; this.targets = new Set(); observers.push(this); }
    observe(node) { this.targets.add(node); }
    disconnect() { this.targets.clear(); }
    notify() { if (this.targets.size) this.callback(); }
  }
  const context = { window, document, MutationObserver,
    requestAnimationFrame(callback) { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame(id) { frames.delete(id); },
  };
  const execute = () => runInNewContext(source, context);
  execute();
  const flush = () => { const current = [...frames.values()]; frames.clear(); current.forEach((callback) => callback()); };
  const refresh = () => { window.__sautilinkMemberNativeParity.refresh(); flush(); };
  const event = (type) => listeners.get(type)?.forEach((callback) => callback());
  return { document, window, make, member, stream, saved, rooms, conversation, addPost, post, discover, notifications, personAvatar, personCopy, personText, open, submit,
    notice, noticeAvatar, originalNotice, noticeCopy, photo, time, profile, main, heading, bio, stats,
    originalAvatar, follow, message, overflow, owner, edit, dashboard, activity, privacy,
    observers, frames, listeners, execute, flush, refresh, event, get writes() { return writes; } };
}

test('post metadata retains original timestamp, Edited marker, profile focus and Following/More controls in the same header', () => {
  const h = harness(); const p = h.post; p.handle.focus(); h.flush();
  const metadata = p.identity.querySelector('.native-post-metadata');
  assert.deepEqual(metadata.children, [p.handle, p.time, p.edited]);
  assert.equal(p.identity.children[0], p.name);
  assert.equal(p.head.querySelector('time'), p.time, 'post-edit descendant timestamp lookup still resolves the original node');
  assert.equal(p.time.getAttribute('datetime'), '2026-10-20T03:00:00Z');
  assert.equal(p.time.getAttribute('title'), 'Original timestamp');
  assert.equal(p.edited.textContent, 'Edited');
  assert.equal(p.handle.getAttribute('href'), '/u/neemaj');
  assert.equal(p.handle.onclick(), 'Original profile');
  assert.equal(h.document.activeElement, p.handle);
  assert.equal(p.actions.parentNode, p.head);
  assert.equal(p.follow.onclick(), 'Original Following');
  assert.equal(p.more.onclick(), 'Original More');
  assert.equal(p.avatar.parentNode, p.head);
  assert.match(css, /\.sauti-card-identity\s*\{[^}]*flex: 1 1 0%;[^}]*width: 0;/);
  assert.match(css, /\.native-post-metadata\s*\{[^}]*flex-wrap: wrap;/);
});

test('shared feed observers arrange late cards and edit markers without feedback writes or changing hidden/auth routes', () => {
  const h = harness(); h.flush();
  const observer = h.observers[1];
  for (const surface of [h.stream, h.saved, h.rooms, h.conversation]) {
    assert.ok(observer.targets.has(surface));
    const p = h.addPost(surface); observer.notify(); h.flush();
    assert.equal(p.time.parentNode.className, 'native-post-metadata');
    const replacement = h.make('span', 'sauti-edited-label', '', p.head); replacement.textContent = 'Edited after refresh';
    p.edited.parentNode.children = p.edited.parentNode.children.filter((node) => node !== p.edited);
    p.edited.parentNode = null;
    observer.notify(); h.flush();
    assert.equal(replacement.parentNode, p.time.parentNode);
    assert.equal(replacement.textContent, 'Edited after refresh');
  }
  const writes = h.writes;
  for (let index = 0; index < 40; index += 1) { observer.notify(); h.flush(); }
  assert.equal(h.writes, writes);
  h.member.hidden = true; h.observers[0].notify();
  const signedOutPost = h.addPost(h.rooms); h.refresh();
  assert.equal(signedOutPost.time.parentNode, signedOutPost.head);
  assert.equal(observer.targets.size, 0);
});

test('Discover uses the original Search and profile actions, retains focus and accessible names', () => {
  const h = harness();
  const action = h.open.onclick;
  h.open.focus();
  h.flush();
  assert.equal(h.open.parentNode, h.personCopy);
  assert.equal(h.open.onclick, action);
  assert.equal(h.open.onclick(), 'Original profile link');
  assert.equal(h.open.getAttribute('href'), '/u/qa_member');
  assert.equal(h.document.activeElement, h.open);
  assert.equal(h.submit.textContent, 'Search');
  assert.equal(h.submit.querySelector('svg').dataset.slIconName, 'arrow-right-0-2');
  assert.equal(h.personText.textContent, 'Original member bio');
});

test('notification decoration never replaces notification text, avatars, time or real action nodes', () => {
  const h = harness(); h.flush();
  const mark = h.noticeAvatar.querySelector('.native-notification-event');
  assert.equal(mark.getAttribute('aria-hidden'), 'true');
  assert.equal(mark.dataset.eventIcon, 'heart');
  assert.equal(h.originalNotice.parentNode, h.noticeCopy);
  assert.equal(h.originalNotice.textContent, '@member liked your post.');
  assert.equal(h.photo.parentNode, h.noticeAvatar);
  assert.equal(h.photo.getAttribute('src'), '/original-avatar');
  assert.equal(h.time.parentNode, h.noticeCopy);
  h.notice.dataset.notificationType = 'safety'; h.refresh();
  assert.equal(h.noticeAvatar.querySelector('.native-notification-event'), mark);
  assert.equal(mark.dataset.eventIcon, 'shield-check');
  assert.equal(h.originalNotice.textContent, '@member liked your post.');
});

test('profile layout retains Edit, Dashboard, Follow, Message and activity privacy feature gates', () => {
  const h = harness(); h.edit.focus(); h.flush();
  assert.equal(h.stats.nextElementSibling, h.bio);
  assert.equal(h.owner.parentNode, h.main);
  assert.equal(h.owner.hidden, true);
  assert.equal(h.edit.onclick(), 'Original Edit');
  assert.equal(h.dashboard.onclick(), 'Original Dashboard');
  assert.equal(h.document.activeElement, h.edit, 'moving a row must retain the focused descendant in browsers without moveBefore');
  assert.equal(h.follow.parentNode.className, 'native-profile-public-actions');
  assert.equal(h.follow.parentNode, h.message.parentNode);
  assert.equal(h.follow.hidden, true);
  assert.equal(h.message.disabled, true);
  assert.equal(h.overflow.onclick(), 'Original overflow');
  assert.equal(h.privacy.parentNode, h.activity);
  assert.equal(h.privacy.hidden, true);
  assert.equal(h.originalAvatar.isConnected, true);
  assert.equal(h.bio.textContent, 'Original profile bio');
});

test('repeated content observers stay inert after initial presentation and do not duplicate runtime listeners', () => {
  const h = harness(); h.flush();
  const writes = h.writes;
  for (let index = 0; index < 40; index += 1) {
    h.observers[1].notify(); h.flush();
  }
  assert.equal(h.writes, writes);
  assert.equal(h.noticeAvatar.querySelectorAll('.native-notification-event').length, 1);
  h.execute();
  assert.equal(h.observers.length, 2);
  assert.equal(h.listeners.get('pagehide').length, 1);
});

test('auth surfaces are never modified; content observers disconnect on signout and pagehide and resume on pageshow', () => {
  const h = harness({ signedIn: false });
  const initial = h.writes;
  h.refresh();
  assert.equal(h.writes, initial);
  assert.equal(h.observers.length, 1);
  h.member.hidden = false; h.observers[0].notify(); h.flush();
  assert.equal(h.observers.length, 2);
  assert.ok(h.observers[1].targets.size > 0);
  const presented = h.writes;
  h.member.hidden = true; h.observers[0].notify();
  assert.equal(h.observers[1].targets.size, 0);
  h.refresh(); assert.equal(h.writes, presented);
  h.member.hidden = false; h.observers[0].notify(); h.flush();
  h.window.__sautilinkMemberNativeParity.refresh();
  assert.equal(h.frames.size, 1);
  h.event('pagehide');
  assert.equal(h.frames.size, 0);
  assert.ok(h.observers.every((observer) => observer.targets.size === 0));
  h.event('pageshow'); h.flush();
  assert.ok(h.observers.at(-1).targets.size > 0);
  assert.equal(h.writes, presented);
});

test('every new decorative icon resolves to the existing licensed catalog, including neutral unknown events', async () => {
  const h = harness();
  const manifest = JSON.parse(await read('app/assets/huge-icons/manifest.json'));
  const catalog = new Set(manifest.icons.map(({ name }) => name));
  h.flush();
  for (const type of ['follow', 'like', 'reply', 'mention', 'reshare', 'circle', 'message', 'safety', 'unknown']) {
    h.notice.dataset.notificationType = type; h.refresh();
    const svg = h.noticeAvatar.querySelector('.native-notification-event').querySelector('svg');
    assert.ok(catalog.has(svg.dataset.slIconName), type);
    assert.equal(svg.getAttribute('aria-hidden'), 'true');
  }
  assert.ok(catalog.has(h.submit.querySelector('svg').dataset.slIconName));
});

test('all parity styles are member scoped and leave auth, chat layouts, composer and video controls unchanged', () => {
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').split('{').slice(0, -1)
    .map((part) => part.split('}').pop().trim()).filter((selector) => selector && !selector.startsWith('@'));
  for (const selector of rules) {
    assert.ok(selector.includes('body:not(.auth-entry):has(#member-view:not([hidden]))'), selector);
  }
  assert.doesNotMatch(css, /#auth-view|#messages-surface|#circle-detail|\.composer-|\.sauti-video-|\.sauti-short-/);
  assert.doesNotMatch(source, /fetch\(|supabase|XMLHttpRequest|WebSocket|localStorage|sessionStorage|history\.|location\./);
  assert.match(css, /#home-feed-tabs \.home-feed-tab\s*\{[^}]*min-height: 46px/);
  assert.match(css, /sauti-card-avatar\s*\{[^}]*width: 44px/);
  assert.match(css, /#profile-card \.profile-verified-badge\s*\{[^}]*width: 22px;[^}]*height: 26px/);
  assert.match(css, /#profile-card :is\(\.profile-verified-badge, \.profile-professional-category\)::after\s*\{[^}]*min-width: 44px;[^}]*min-height: 44px/);
  assert.match(css, /#profile-card \.profile-verified-badge :is\([^)]*\)\s*\{[^}]*width: 18px; height: 18px/);
  assert.match(css, /#profile-card :is\(\.profile-edit-button, \.profile-follow-button, \.profile-dashboard-button\)\s*\{[^}]*display: inline-flex;[^}]*min-height: 48px;[^}]*white-space: normal;/);
  assert.match(css, /#profile-card :is\(\.profile-edit-button, \.profile-follow-button, \.profile-dashboard-button\) svg\s*\{[^}]*width: 20px;[^}]*max-width: 20px; height: 20px; flex: 0 0 20px;/);
  assert.match(css, /\.sauti-card-body, \.sauti-caption\)[^{]*\{[^}]*font-size: 15px;[^}]*line-height: 21px/);
  assert.match(css, /#appeals-list \.appeal-card-live\s*\{[^}]*background: var\(--ios-surface\)/);
  assert.match(css, /#notifications-list \.notification-item\[data-circle-slug\]\s*\{[^}]*grid-template-columns: 50px minmax\(0, 1fr\) auto/);
  assert.match(css, /#notifications-list \.notification-item\[data-circle-slug\]::after\s*\{[^}]*grid-column: 3; grid-row: 1;/);
  for (const id of ['#discover-surface', '#saved-surface', '#notifications-surface', '#profile-surface', '#settings-surface', '#appeals-surface', '#professional-dashboard-surface']) assert.ok(css.includes(id));
  for (const id of ['#profile-surface', '#circles-surface', '#conversation-surface']) {
    assert.ok(rules.some((selector) => selector.includes(id) && selector.endsWith(' .sauti-card')), `${id} keeps shared post-card parity`);
  }
});
