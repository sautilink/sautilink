import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const source = await readFile(new URL('../src/member-comment-sheet.js', import.meta.url), 'utf8');

// Exercise the real controller against a small native-dialog/history model.
// Native close and history events are queued, as they are in the browser.
function harness({ auth = false, hidden = false, modal = true, modalFailure = false, historyFailure = false, viewport = true } = {}) {
  const observers = [];
  const nativeEvents = [];
  const historyEvents = [];
  const loads = [];
  const toggles = [];
  const scrolls = [];
  let closeCalls = 0;
  let document;

  class EventTarget {
    constructor() { this.listeners = new Map(); }
    addEventListener(type, listener, options = false) {
      const capture = typeof options === 'boolean' ? options : Boolean(options.capture);
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push({ listener, capture });
    }
    removeEventListener(type, listener) {
      this.listeners.set(type, (this.listeners.get(type) || []).filter(entry => entry.listener !== listener));
    }
    dispatchEvent(event) {
      event.target ||= this;
      const entries = [...(this.listeners.get(event.type) || [])].sort((a, b) => Number(b.capture) - Number(a.capture));
      for (const { listener } of entries) {
        listener(event);
        if (event.immediateStopped) break;
      }
      return !event.defaultPrevented;
    }
    fire(type, values = {}) {
      const event = {
        type, target: this, defaultPrevented: false, immediateStopped: false,
        preventDefault() { this.defaultPrevented = true; },
        stopImmediatePropagation() { this.immediateStopped = true; },
        ...values,
      };
      this.dispatchEvent(event);
      return event;
    }
  }

  class Element extends EventTarget {
    constructor(tag) {
      super();
      this.tagName = tag.toUpperCase(); this.children = []; this.parentNode = null;
      this.attributes = new Map(); this.value = ''; this.disabled = false;
      this.style = { values: new Map(), setProperty(name, value) { this.values.set(name, value); }, getPropertyValue(name) { return this.values.get(name) || ''; } };
      this.classList = {
        contains: name => this.className.split(/\s+/).includes(name),
        add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
        remove: (...names) => { this.className = this.className.split(/\s+/).filter(name => !names.includes(name)).join(' '); },
      };
      if (this.tagName === 'DIALOG' && !modal) this.showModal = undefined;
    }
    get id() { return this.getAttribute('id') || ''; } set id(value) { this.setAttribute('id', value); }
    get className() { return this.getAttribute('class') || ''; } set className(value) { this.setAttribute('class', value); }
    get hidden() { return this.attributes.has('hidden'); } set hidden(value) { value ? this.setAttribute('hidden', '') : this.removeAttribute('hidden'); }
    get open() { return this.attributes.has('open'); }
    get isConnected() { return this === document.body || Boolean(this.parentNode?.isConnected); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    removeAttribute(name) { this.attributes.delete(name); }
    append(...nodes) { for (const node of nodes) { node.remove(); node.parentNode = this; this.children.push(node); } }
    remove() { if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; }
    before(node) {
      node.remove(); const parent = this.parentNode;
      parent.children.splice(parent.children.indexOf(this), 0, node); node.parentNode = parent;
    }
    replaceWith(node) {
      node.remove(); const parent = this.parentNode;
      parent.children.splice(parent.children.indexOf(this), 1, node); node.parentNode = parent; this.parentNode = null;
    }
    all() { return [this, ...this.children.flatMap(node => node.all())]; }
    closest(selector) {
      assert.equal(selector, '[hidden]');
      for (let node = this; node; node = node.parentNode) if (node.hidden) return node;
      return null;
    }
    querySelector(selector) {
      if (selector.startsWith('#')) return this.all().find(node => node.id === selector.slice(1)) || null;
      if (selector === '.conversation-toolbar') return this.all().find(node => node.classList.contains('conversation-toolbar')) || null;
      if (selector === '[data-comment-menu-toggle][aria-expanded="true"]') {
        return this.all().find(node => node.getAttribute('data-comment-menu-toggle') !== null && node.getAttribute('aria-expanded') === 'true') || null;
      }
      throw new Error(`Unexpected selector: ${selector}`);
    }
    querySelectorAll(selector) {
      assert.equal(selector, '[data-comment-menu-panel]:not([hidden])');
      return this.all().filter(node => node.getAttribute('data-comment-menu-panel') !== null && !node.hidden);
    }
    focus(options) { document.activeElement = this; this.focusOptions = options; }
    showModal() {
      if (modalFailure) throw new Error('Dialog is not available');
      this.setAttribute('open', '');
    }
    close() {
      if (!this.open) return;
      this.removeAttribute('open');
      nativeEvents.push(() => this.fire('close'));
    }
    getBoundingClientRect() { return this.bounds || { left: 0, right: 390, top: 400, bottom: 844, width: 390, height: 444 }; }
    setPointerCapture() {}
  }

  document = new EventTarget();
  document.body = new Element('body');
  document.createElement = tag => new Element(tag);
  document.createComment = () => new Element('#comment');
  document.getElementById = id => document.body.all().find(node => node.id === id) || null;
  if (auth) document.body.classList.add('auth-entry');
  const member = new Element('main'); member.id = 'member-view'; member.hidden = hidden;
  const trigger = new Element('button'); trigger.id = 'comments-trigger';
  const surface = new Element('section'); surface.id = 'conversation-surface'; surface.hidden = true;
  const toolbar = new Element('header'); toolbar.className = 'conversation-toolbar';
  const thread = new Element('section'); thread.id = 'conversation-thread';
  const menu = new Element('button'); menu.setAttribute('data-comment-menu-toggle', ''); menu.setAttribute('aria-expanded', 'false'); thread.append(menu);
  const form = new Element('form'); form.id = 'conversation-reply-form';
  const textarea = new Element('textarea'); textarea.id = 'conversation-reply-body'; textarea.value = 'My existing comment draft'; form.append(textarea);
  surface.append(toolbar, thread, form); member.append(trigger, surface); document.body.append(member); document.activeElement = trigger;
  document.addEventListener('sautilink:comment-sheet-toggle', event => toggles.push(event.detail.open));

  const window = new EventTarget();
  window.innerHeight = 844; window.scrollX = 3; window.scrollY = 377;
  window.scrollTo = (x, y) => { scrolls.push([x, y]); window.scrollX = x; window.scrollY = y; };
  const setLocation = (path) => {
    const url = new URL(path, 'https://sautilink.test');
    window.location = { pathname: url.pathname, search: url.search, hash: url.hash };
  };
  const path = () => `${window.location.pathname}${window.location.search}${window.location.hash}`;
  setLocation('/videos/posted-video?source=home#sound');
  const initialState = { sautilinkShortVideos: { returnPath: '/home?feed=following', pushed: true }, saved: 'keep me' };
  const entries = [{ url: path(), state: initialState }];
  let entryIndex = 0;
  window.history = {
    get state() { return entries[entryIndex].state; },
    get length() { return entries.length; },
    pushState(state, _title, url) {
      if (historyFailure) throw new Error('History disabled');
      entries.splice(entryIndex + 1); entries.push({ state, url }); entryIndex++; setLocation(url);
    },
    replaceState(state, _title, url) { entries[entryIndex] = { state, url }; setLocation(url); },
    back() {
      if (entryIndex === 0) return;
      historyEvents.push(() => { entryIndex--; setLocation(entries[entryIndex].url); return window.fire('popstate', { state: window.history.state }); });
    },
  };
  if (viewport) { window.visualViewport = new EventTarget(); window.visualViewport.height = 844; window.visualViewport.offsetTop = 0; }
  class MutationObserver {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(target, options) { this.target = target; this.options = options; }
  }
  class CustomEvent { constructor(type, { detail }) { this.type = type; this.detail = detail; } }
  const context = { window, document, MutationObserver, CustomEvent };
  runInNewContext(`${source.replace('export function createMemberCommentSheet', 'function createMemberCommentSheet')}\nthis.createSheet = createMemberCommentSheet;`, context);
  const api = context.createSheet({ load: id => loads.push(id), onClose: () => { closeCalls++; } });
  return {
    api, window, document, member, trigger, surface, toolbar, thread, menu, form, textarea, loads, toggles, scrolls, entries,
    dialog: document.getElementById('member-comment-sheet'),
    get closeCalls() { return closeCalls; },
    flushNative() { while (nativeEvents.length) nativeEvents.shift()(); },
    flushHistory() { const events = []; while (historyEvents.length) events.push(historyEvents.shift()()); return events; },
    mutate() { for (const observer of observers) observer.callback(); },
    path,
  };
}

test('comments reuse the actual thread and composer, preserving draft values and feature listeners', () => {
  const h = harness();
  const originalOrder = [...h.member.children];
  let threadClicks = 0;
  let formSubmits = 0;
  h.thread.addEventListener('click', () => threadClicks++);
  h.form.addEventListener('submit', () => formSubmits++);
  assert.equal(h.api.open('post-1', h.trigger), true);
  assert.equal(h.api.isOpen, true);
  assert.equal(h.api.postId, 'post-1');
  assert.equal(h.surface.parentNode, h.dialog);
  assert.equal(h.document.getElementById('conversation-thread'), h.thread);
  assert.equal(h.document.getElementById('conversation-reply-form'), h.form);
  assert.equal(h.textarea.value, 'My existing comment draft');
  assert.equal(h.dialog.open, true);
  assert.equal(h.dialog.getAttribute('aria-label'), 'Comments');
  assert.equal(h.document.activeElement.getAttribute('aria-label'), 'Close comments');
  h.thread.fire('click'); h.form.fire('submit');
  assert.equal(threadClicks, 1); assert.equal(formSubmits, 1);
  assert.deepEqual(h.loads, ['post-1']);

  h.api.close(); h.flushHistory(); h.flushNative();
  assert.deepEqual(h.member.children, originalOrder);
  assert.equal(h.surface.hidden, true);
  assert.equal(h.textarea.value, 'My existing comment draft');
  assert.equal(h.api.isOpen, false); assert.equal(h.api.postId, '');
  assert.equal(h.document.activeElement, h.trigger);
  assert.deepEqual(h.scrolls, [[3, 377]]);
  assert.equal(h.closeCalls, 1, 'the owning app receives one cancellation/draft callback');
  assert.deepEqual(h.toggles, [true, false]);
});

test('opening comments preserves the video URL and existing route state; Back only dismisses the sheet', () => {
  const h = harness();
  const originalUrl = h.path();
  const originalState = h.window.history.state;
  let routeReloads = 0;
  h.window.addEventListener('popstate', () => routeReloads++);
  h.api.open('post-1');
  assert.equal(h.path(), originalUrl);
  assert.equal(h.window.history.length, 2);
  assert.deepEqual(h.window.history.state.sautilinkShortVideos, originalState.sautilinkShortVideos);
  assert.equal(h.window.history.state.saved, 'keep me');
  h.window.history.back();
  const [back] = h.flushHistory(); h.flushNative();
  assert.equal(h.api.isOpen, false);
  assert.equal(h.window.history.state, originalState);
  assert.equal(h.path(), originalUrl);
  assert.equal(back.immediateStopped, true);
  assert.equal(routeReloads, 0, 'background feed and active video are not reloaded');
  assert.equal(h.closeCalls, 1);
});

test('close button consumes its queued Back event without reloading the underlying route', () => {
  const h = harness();
  let routeReloads = 0;
  h.window.addEventListener('popstate', () => routeReloads++);
  h.api.open('post-1');
  h.document.activeElement.fire('click');
  assert.equal(h.api.isOpen, false);
  h.flushNative(); h.flushHistory();
  assert.equal(routeReloads, 0);
  assert.equal(h.closeCalls, 1);
});

test('navigation to another route closes comments without swallowing that route or restoring old focus/scroll', () => {
  const h = harness();
  let routeChanges = 0;
  h.window.addEventListener('popstate', () => routeChanges++);
  h.api.open('post-1');
  h.window.history.replaceState({ destination: 'settings' }, '', '/settings');
  const event = h.window.fire('popstate', { state: h.window.history.state });
  assert.equal(h.api.isOpen, false);
  assert.equal(event.immediateStopped, false);
  assert.equal(routeChanges, 1);
  assert.equal(h.path(), '/settings');
  assert.deepEqual(h.scrolls, []);
  assert.notEqual(h.document.activeElement, h.trigger);
});

test('native cancel, deliberate backdrop click and downward grip drag each dismiss once', () => {
  for (const kind of ['cancel', 'backdrop', 'grip']) {
    const h = harness(); h.api.open('post-1');
    if (kind === 'cancel') assert.equal(h.dialog.fire('cancel').defaultPrevented, true);
    if (kind === 'backdrop') {
      // Dragging out from inside must not count as a backdrop click.
      h.dialog.fire('pointerdown', { target: h.surface, clientX: 100, clientY: 500 });
      h.dialog.fire('click', { clientX: 100, clientY: 200 });
      assert.equal(h.api.isOpen, true);
      h.dialog.fire('pointerdown', { clientX: 100, clientY: 200 });
      h.dialog.fire('click', { clientX: 100, clientY: 200 });
    }
    if (kind === 'grip') {
      const grip = h.dialog.children[0];
      grip.fire('pointerdown', { pointerId: 7, clientY: 400 });
      grip.fire('pointerup', { pointerId: 7, clientY: 430 });
      assert.equal(h.api.isOpen, true, 'small movements do not dismiss');
      grip.fire('pointerdown', { pointerId: 7, clientY: 400 });
      grip.fire('pointerup', { pointerId: 7, clientY: 480 });
    }
    h.flushNative(); h.flushHistory();
    assert.equal(h.api.isOpen, false, kind);
    assert.equal(h.closeCalls, 1, kind);
    assert.equal(h.document.activeElement, h.trigger, kind);
  }
});

test('an open comment options menu consumes Escape before the native sheet cancel', () => {
  const h = harness(); h.api.open('post-1');
  h.menu.setAttribute('aria-expanded', 'true');
  const menuEscape = h.dialog.fire('keydown', { key: 'Escape' });
  assert.equal(menuEscape.defaultPrevented, true);
  assert.equal(menuEscape.immediateStopped, false, 'the canonical document menu handler still runs');
  assert.equal(h.api.isOpen, true);
  h.menu.setAttribute('aria-expanded', 'false');
  const sheetEscape = h.dialog.fire('keydown', { key: 'Escape' });
  assert.equal(sheetEscape.defaultPrevented, false, 'the browser may issue its normal dialog cancel');
  h.dialog.fire('cancel'); h.flushNative(); h.flushHistory();
  assert.equal(h.closeCalls, 1);
});

test('keyboard viewport resize adjusts the available sheet area and removes listeners after closing', () => {
  const h = harness(); h.api.open('post-1');
  assert.equal(h.dialog.style.getPropertyValue('--comment-sheet-available-height'), '844px');
  const viewport = h.window.visualViewport;
  viewport.height = 430; viewport.offsetTop = 34; viewport.fire('resize');
  assert.equal(h.dialog.style.getPropertyValue('--comment-sheet-available-height'), '430px');
  assert.equal(h.dialog.style.getPropertyValue('--comment-sheet-keyboard-offset'), '380px');
  viewport.offsetTop = 0; viewport.fire('scroll');
  assert.equal(h.dialog.style.getPropertyValue('--comment-sheet-keyboard-offset'), '414px');
  h.api.close(); h.flushNative(); h.flushHistory();
  viewport.height = 844; viewport.fire('resize');
  assert.equal(h.dialog.style.getPropertyValue('--comment-sheet-available-height'), '430px');
  assert.equal(viewport.listeners.get('resize').length, 0);
  assert.equal(viewport.listeners.get('scroll').length, 0);
  assert.equal(h.window.listeners.get('resize').length, 0);
  const fallback = harness({ viewport: false }); fallback.api.open('post-2');
  assert.equal(fallback.dialog.style.getPropertyValue('--comment-sheet-available-height'), '844px');
  assert.equal(fallback.dialog.style.getPropertyValue('--comment-sheet-keyboard-offset'), '0px');
});

test('auth and hidden member states cannot open comments and immediately dismiss an existing sheet', () => {
  for (const config of [{ auth: true }, { hidden: true }]) {
    const h = harness(config);
    assert.equal(h.api.open('post-1'), false);
    assert.deepEqual(h.loads, []); assert.deepEqual(h.toggles, []);
    assert.equal(h.window.history.length, 1);
    assert.equal(h.surface.parentNode, h.member);
  }
  for (const leave of [h => { h.member.hidden = true; }, h => { h.document.body.classList.add('auth-entry'); }]) {
    const h = harness(); h.api.open('post-1'); leave(h); h.mutate(); h.flushNative();
    assert.equal(h.api.isOpen, false);
    assert.equal(h.closeCalls, 1);
    assert.equal(h.window.history.state.sautilinkCommentSheet, undefined);
    assert.deepEqual(h.scrolls, [], 'auth transition never jumps back into member content');
    assert.notEqual(h.document.activeElement, h.trigger);
  }
});

test('unsupported or failed native dialogs leave the canonical surface untouched; disabled history still permits a sheet', () => {
  for (const config of [{ modal: false }, { modalFailure: true }]) {
    const h = harness(config); const originalOrder = [...h.member.children];
    assert.equal(h.api.open('post-1'), false);
    assert.deepEqual(h.member.children, originalOrder);
    assert.equal(h.surface.hidden, true);
    assert.deepEqual(h.loads, []); assert.equal(h.closeCalls, 0);
    assert.equal(h.window.history.length, 1);
  }
  const h = harness({ historyFailure: true });
  assert.equal(h.api.open('post-1'), true);
  assert.equal(h.window.history.length, 1);
  h.api.close(); h.flushNative();
  assert.equal(h.api.isOpen, false); assert.equal(h.closeCalls, 1);
  assert.equal(h.document.activeElement, h.trigger);
});

test('a queued native close event from the previous sheet cannot dismiss a newly opened thread', () => {
  const h = harness();
  h.api.open('post-1');
  h.api.close({ history: false, restoreFocus: false });
  h.api.open('post-2');
  h.flushNative();
  assert.equal(h.api.isOpen, true);
  assert.equal(h.api.postId, 'post-2');
  assert.equal(h.dialog.open, true);
  assert.deepEqual(h.loads, ['post-1', 'post-2']);
  assert.equal(h.closeCalls, 1);
});

test('switching thread while comments are open retains one dismissible modal history entry', () => {
  const h = harness();
  h.api.open('post-1'); h.api.open('post-2'); h.flushNative();
  assert.equal(h.api.postId, 'post-2');
  assert.equal(h.window.history.length, 2, 'one base page plus one open-sheet history entry');
  h.window.history.back(); h.flushHistory(); h.flushNative();
  assert.equal(h.api.isOpen, false);
  assert.equal(h.window.history.state.sautilinkCommentSheet, undefined);
  assert.equal(h.window.history.state.saved, 'keep me');
});

test('immediate reopen waits for the previous queued history Back and survives the old native close event', () => {
  const h = harness();
  let routeReloads = 0;
  h.window.addEventListener('popstate', () => routeReloads++);
  h.api.open('post-1'); h.api.close();
  assert.equal(h.api.open('post-2', h.trigger), true);
  h.flushHistory(); h.flushNative();
  assert.equal(h.api.isOpen, true);
  assert.equal(h.api.postId, 'post-2');
  assert.equal(h.dialog.open, true);
  assert.equal(h.window.history.length, 2);
  assert.equal(routeReloads, 0);
  assert.deepEqual(h.loads, ['post-1', 'post-2']);
  assert.equal(h.closeCalls, 1);
  h.api.close(); h.flushHistory(); h.flushNative();
  assert.equal(h.api.isOpen, false);
  assert.equal(h.closeCalls, 2);
  assert.equal(h.api.close(), false, 'repeated dismissal cannot cancel app work again');
});

test('external native close restores the source surface and removes only its own history entry', () => {
  const h = harness(); h.api.open('post-1');
  h.dialog.close(); h.flushNative(); h.flushHistory();
  assert.equal(h.api.isOpen, false);
  assert.equal(h.surface.parentNode, h.member);
  assert.equal(h.window.history.state.sautilinkCommentSheet, undefined);
  assert.equal(h.window.history.state.saved, 'keep me');
  assert.equal(h.closeCalls, 1);
});

test('comment options near the bottom stay within the independently scrolling thread', () => {
  const h = harness(); h.api.open('post-1');
  h.thread.bounds = { top: 450, bottom: 760, height: 310 };
  const panel = h.document.createElement('div');
  panel.setAttribute('data-comment-menu-panel', '');
  panel.bounds = { top: 800, bottom: 900, height: 100 };
  h.thread.append(panel);
  h.dialog.fire('click', { target: h.menu });
  assert.equal(panel.style.getPropertyValue('--comment-menu-offset-y'), '-146px');
  assert.equal(panel.style.getPropertyValue('--comment-menu-max-height'), '298px');
  assert.equal(h.api.isOpen, true);
});
