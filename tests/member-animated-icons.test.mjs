import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { transformMessagesReplySource } from '../scripts/messages-reply-source-transform.mjs';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const source = await read('app/assets/member-animated-icons.js');
const animationFiles = (await readdir(new URL('../app/assets/animated-icons/', import.meta.url)))
  .filter((name) => name.endsWith('.json'));
const animations = new Map(await Promise.all(animationFiles.map(async (name) => [name, JSON.parse(await read(`app/assets/animated-icons/${name}`))])));

// This DOM harness runs the actual presentation script. Mutation callbacks and
// bubbling are shared with the production send function below, so the tests
// exercise the integration rather than a second implementation of icon state.
function harness({ reduced = false, auth = false, hidden = false, runtimeAvailable = true } = {}) {
  const observers = new Set();
  const players = [];
  const requests = [];
  const frames = [];
  const timers = new Map();
  const mediaListeners = new Set();
  const microtasks = [];
  const enqueueMicrotask = (callback) => microtasks.push(callback);
  let clock = 0;
  let timerId = 0;
  let mutationQueued = false;

  function notify(target, record) {
    for (const observer of observers) {
      if (observer.targets.some(([root, options]) => {
        if (root !== target && (!options.subtree || !root.contains(target))) return false;
        if (record.type === 'attributes') return options.attributes && (!options.attributeFilter || options.attributeFilter.includes(record.attributeName));
        if (record.type === 'characterData') return options.characterData;
        return options.childList;
      })) observer.records.push({ target, ...record });
    }
    if (mutationQueued) return;
    mutationQueued = true;
    enqueueMicrotask(() => {
      mutationQueued = false;
      for (const observer of observers) {
        const records = observer.takeRecords();
        if (records.length) observer.callback(records, observer);
      }
    });
  }

  function selectorParts(selector) {
    const parts = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i <= selector.length; i++) {
      if ('(['.includes(selector[i])) depth++;
      if (')]'.includes(selector[i])) depth--;
      if (i === selector.length || (selector[i] === ',' && depth === 0)) {
        parts.push(selector.slice(start, i).trim());
        start = i + 1;
      }
    }
    return parts;
  }

  class Element {
    constructor(tag = 'div') {
      this.tagName = tag.toUpperCase();
      this.localName = tag.toLowerCase();
      this.nodeType = 1;
      this.parentNode = null;
      this.children = [];
      this.attributes = new Map();
      this.listeners = new Map();
      this._text = '';
      this.value = '';
      this.style = { setProperty(name, value) { this[name] = value; }, removeProperty(name) { delete this[name]; } };
      this.dataset = new Proxy({}, {
        get: (_object, key) => this.getAttribute(`data-${String(key).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`) ?? undefined,
        set: (_object, key, value) => { this.setAttribute(`data-${String(key).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, value); return true; },
        deleteProperty: (_object, key) => { this.removeAttribute(`data-${String(key).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`); return true; },
      });
      this.classList = {
        contains: (name) => this.className.split(/\s+/).includes(name),
        add: (...names) => this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '),
        remove: (...names) => this.className = this.className.split(/\s+/).filter((name) => !names.includes(name)).join(' '),
        toggle: (name, force) => {
          const enabled = force ?? !this.classList.contains(name);
          if (enabled) this.classList.add(name); else this.classList.remove(name);
          return enabled;
        },
      };
    }
    get id() { return this.getAttribute('id') || ''; }
    set id(value) { this.setAttribute('id', value); }
    get className() { return this.getAttribute('class') || ''; }
    set className(value) { this.setAttribute('class', value); }
    get hidden() { return this.hasAttribute('hidden'); }
    set hidden(value) { if (value) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); }
    get disabled() { return this.hasAttribute('disabled'); }
    set disabled(value) { if (value) this.setAttribute('disabled', ''); else this.removeAttribute('disabled'); }
    get isConnected() { return document.contains(this); }
    get parentElement() { return this.parentNode instanceof Element ? this.parentNode : null; }
    get childNodes() { return this.children; }
    get childElementCount() { return this.children.length; }
    get firstElementChild() { return this.children[0] || null; }
    get ownerDocument() { return document; }
    get offsetWidth() { return this.closest('[hidden]') ? 0 : 32; }
    get offsetHeight() { return this.closest('[hidden]') ? 0 : 32; }
    get textContent() { return this._text + this.children.map((child) => child.textContent).join(''); }
    set textContent(value) {
      const removedNodes = [...this.children];
      this.children.forEach((child) => child.parentNode = null);
      this.children = [];
      this._text = String(value);
      notify(this, { type: 'childList', addedNodes: [], removedNodes });
    }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    hasAttribute(name) { return this.attributes.has(name); }
    setAttribute(name, value) {
      const next = String(value);
      const oldValue = this.getAttribute(name);
      this.attributes.set(name, next);
      notify(this, { type: 'attributes', attributeName: name, oldValue });
    }
    removeAttribute(name) {
      if (!this.attributes.has(name)) return;
      const oldValue = this.getAttribute(name);
      this.attributes.delete(name);
      notify(this, { type: 'attributes', attributeName: name, oldValue });
    }
    contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
    append(...nodes) { nodes.forEach((node) => this.insertBefore(node, null)); }
    prepend(...nodes) { nodes.reverse().forEach((node) => this.insertBefore(node, this.children[0] || null)); }
    insertBefore(node, before) {
      node.remove();
      node.parentNode = this;
      const index = before ? this.children.indexOf(before) : this.children.length;
      this.children.splice(index, 0, node);
      notify(this, { type: 'childList', addedNodes: [node], removedNodes: [] });
      return node;
    }
    remove() {
      const parent = this.parentNode;
      if (!parent) return;
      parent.children.splice(parent.children.indexOf(this), 1);
      this.parentNode = null;
      notify(parent, { type: 'childList', addedNodes: [], removedNodes: [this] });
    }
    after(node) {
      const next = this.parentNode.children[this.parentNode.children.indexOf(this) + 1] || null;
      this.parentNode.insertBefore(node, next);
    }
    replaceChildren(...nodes) { this.textContent = ''; this.append(...nodes); }
    matches(selector) {
      return selectorParts(selector).some((part) => {
        part = part.replace(/:scope\s*>\s*/, '');
        const not = [...part.matchAll(/:not\(([^)]+)\)/g)].map((match) => match[1]);
        if (not.some((excluded) => this.matches(excluded))) return false;
        part = part.replace(/:not\([^)]+\)/g, '');
        const compound = part.split(/\s+(?![^\[]*\])/).filter(Boolean);
        if (compound.length > 1) {
          const last = compound.pop();
          if (!this.matches(last)) return false;
          const direct = compound.at(-1) === '>';
          if (direct) compound.pop();
          const ancestor = compound.join(' ');
          return direct ? Boolean(this.parentElement?.matches(ancestor)) : Boolean(this.parentElement?.closest(ancestor));
        }
        const tag = part.match(/^[a-z][\w-]*/i)?.[0];
        if (tag && this.localName !== tag.toLowerCase()) return false;
        for (const [, name] of part.matchAll(/#([\w-]+)/g)) if (this.id !== name) return false;
        for (const [, name] of part.matchAll(/\.([\w-]+)/g)) if (!this.classList.contains(name)) return false;
        for (const [, name, raw] of part.matchAll(/\[([\w-]+)(?:\s*=\s*([^\]]+))?\]/g)) {
          if (!this.hasAttribute(name)) return false;
          if (raw !== undefined && this.getAttribute(name) !== raw.trim().replace(/^['"]|['"]$/g, '')) return false;
        }
        return true;
      });
    }
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
    querySelectorAll(selector) {
      const direct = selector.startsWith(':scope > ');
      const result = [];
      for (const child of this.children) {
        if (child.matches(selector)) result.push(child);
        if (!direct) result.push(...child.querySelectorAll(selector));
      }
      return [...new Set(result)];
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    getBoundingClientRect() { return { top: 10, bottom: 42, left: 10, right: 42, width: 32, height: 32 }; }
    getClientRects() { return this.closest('[hidden]') ? [] : [this.getBoundingClientRect()]; }
    addEventListener(type, callback, options = {}) {
      const events = this.listeners.get(type) || [];
      events.push({ callback, capture: options === true || options.capture === true, once: options.once === true });
      this.listeners.set(type, events);
    }
    removeEventListener(type, callback) { this.listeners.set(type, (this.listeners.get(type) || []).filter((event) => event.callback !== callback)); }
    dispatchEvent(event) {
      event.target ||= this;
      const path = [];
      for (let target = this; target; target = target.parentNode) path.push(target);
      const call = (target, capture) => {
        event.currentTarget = target;
        for (const handler of [...target.listeners.get(event.type) || []]) {
          if (handler.capture !== capture) continue;
          handler.callback.call(target, event);
          if (handler.once) target.removeEventListener(event.type, handler.callback);
          if (event.immediatePropagationStopped) break;
        }
      };
      [...path].reverse().forEach((target) => call(target, true));
      for (const target of path) {
        call(target, false);
        if (event.propagationStopped || (!event.bubbles && target === this)) break;
      }
      return !event.defaultPrevented;
    }
  }

  class Event {
    constructor(type, init = {}) { this.type = type; this.bubbles = init.bubbles ?? true; Object.assign(this, init); }
    preventDefault() { this.defaultPrevented = true; }
    stopPropagation() { this.propagationStopped = true; }
    stopImmediatePropagation() { this.immediatePropagationStopped = true; this.propagationStopped = true; }
  }
  const document = new Element('document');
  document.nodeType = 9;
  document.readyState = 'complete';
  document.visibilityState = 'visible';
  document.hidden = false;
  document.documentElement = new Element('html');
  document.head = new Element('head');
  document.body = new Element('body');
  document.append(document.documentElement);
  document.documentElement.append(document.head, document.body);
  document.createElement = (tag) => new Element(tag);
  document.createElementNS = (_namespace, tag) => new Element(tag);
  document.getElementById = (id) => document.querySelector(`#${id}`);
  if (auth) document.body.classList.add('auth-entry');
  const node = (tag, attrs = {}, parent = document.body) => {
    const element = new Element(tag);
    Object.entries(attrs).forEach(([name, value]) => element.setAttribute(name, value));
    parent.append(element);
    return element;
  };
  const member = node('section', { id: 'member-view' });
  member.hidden = hidden;
  const rail = node('aside', { class: 'primary-rail' });
  const nav = node('nav', { class: 'app-nav' }, rail);
  const feed = node('div', { id: 'stream-feed' }, member);
  const card = node('article', { class: 'sauti-card', 'data-post-id': 'post-123' }, feed);
  const action = (kind, parent = card) => {
    const button = node('button', { 'data-sauti-action': kind, 'aria-pressed': 'false', 'data-active': 'false', class: 'sauti-action' }, parent);
    node('svg', { 'aria-hidden': 'true' }, button);
    const label = node('span', { class: 'sauti-action-label' }, button);
    label.textContent = kind === 'like' ? 'Like' : 'Save';
    if (kind === 'like') node('span', { 'data-count-for': kind }, button).textContent = '17';
    return button;
  };
  const like = action('like');
  const save = action('save');
  const bell = node('button', { 'data-member-view': 'notifications', class: 'nav-item', 'aria-label': 'Notifications' }, nav);
  node('svg', { 'aria-hidden': 'true' }, bell);
  const badge = node('span', { 'data-notification-badge': '', hidden: '' }, bell);
  badge.textContent = '0';
  const surface = node('section', { id: 'messages-surface' }, member);
  const thread = node('section', { id: 'message-thread' }, surface);
  const composer = node('form', { id: 'message-composer' }, thread);
  const body = node('textarea', { id: 'message-body' }, composer);
  node('b', { id: 'message-body-count' }, composer).textContent = '0';
  const mic = node('button', { id: 'message-voice-button', 'aria-label': 'Record voice note' }, composer);
  node('svg', { 'aria-hidden': 'true' }, mic);
  const send = node('button', { id: 'message-send', 'aria-label': 'Send message', 'data-messages-send-icon': 'paper-plane', type: 'submit' }, composer);
  node('svg', { 'aria-hidden': 'true' }, send);
  const error = node('p', { id: 'message-composer-message' }, composer);
  const preview = node('div', { id: 'message-attachment-preview', hidden: '' }, composer);

  const media = {
    matches: reduced,
    addEventListener(_type, callback) { mediaListeners.add(callback); },
    removeEventListener(_type, callback) { mediaListeners.delete(callback); },
    addListener(callback) { mediaListeners.add(callback); },
    removeListener(callback) { mediaListeners.delete(callback); },
  };
  const window = new Element('window');
  document.parentNode = window;
  window.document = document;
  window.matchMedia = () => media;
  window.innerWidth = 1280;
  window.innerHeight = 900;
  window.location = { pathname: '/home', href: 'https://sautilink.com/home' };
  window.requestAnimationFrame = (callback) => { frames.push(callback); return frames.length; };
  window.cancelAnimationFrame = () => {};
  window.setTimeout = (callback, ms = 0) => { timers.set(++timerId, { callback, at: clock + ms }); return timerId; };
  window.clearTimeout = (id) => timers.delete(id);
  window.queueMicrotask = enqueueMicrotask;
  const lottie = { loadAnimation(options) {
    const listeners = new Map();
    const player = {
      options,
      calls: [],
      currentFrame: 0,
      firstFrame: options.animationData.ip,
      totalFrames: options.animationData.op - options.animationData.ip,
      loop: options.loop,
      isLoaded: false,
      addEventListener(type, callback) { listeners.set(type, [...listeners.get(type) || [], callback]); },
      removeEventListener(type, callback) { listeners.set(type, (listeners.get(type) || []).filter((listener) => listener !== callback)); },
      goToAndStop(frame) { this.currentFrame = frame; this.calls.push(['stop', frame]); },
      goToAndPlay(frame) { this.currentFrame = frame; this.calls.push(['play', frame]); },
      // Match lottie-web's adjustSegment(): these public fields change after
      // every segment, and currentFrame becomes relative to firstFrame.
      playSegments(segment) {
        this.firstFrame = Math.min(...segment);
        this.totalFrames = Math.abs(segment[1] - segment[0]);
        this.currentFrame = segment[1] > segment[0] ? .001 : this.totalFrames - .001;
        this.calls.push(['segments', Array.from(segment)]);
      },
      resetSegments(force) {
        this.calls.push(['reset', force]);
        if (force) {
          this.firstFrame = options.animationData.ip;
          this.totalFrames = options.animationData.op - options.animationData.ip;
          this.currentFrame = .001;
        }
      },
      setSegment(start, end) { this.firstFrame = start; this.totalFrames = end - start; },
      play() { this.calls.push(['play']); },
      pause() { this.calls.push(['pause']); },
      stop() { this.calls.push(['stop']); },
      setDirection(direction) { this.calls.push(['direction', direction]); },
      setSpeed(speed) { this.calls.push(['speed', speed]); },
      destroy() { this.calls.push(['destroy']); this.destroyed = true; },
      emit(type) { (listeners.get(type) || []).forEach((callback) => callback()); },
    };
    players.push(player);
    node('svg', { 'data-rendered-animation': 'true' }, options.container);
    enqueueMicrotask(() => { player.isLoaded = true; player.emit('DOMLoaded'); });
    return player;
  } };
  if (runtimeAvailable) window.lottie = lottie;
  const context = {
    window, document, Element, HTMLElement: Element, SVGElement: Element, Event, CustomEvent: Event,
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3, DOCUMENT_NODE: 9 },
    queueMicrotask: enqueueMicrotask, structuredClone, URL, performance: { now: () => clock },
    setTimeout: window.setTimeout, clearTimeout: window.clearTimeout,
    requestAnimationFrame: window.requestAnimationFrame, cancelAnimationFrame: window.cancelAnimationFrame,
    getComputedStyle: (element) => ({ display: element.hidden ? 'none' : 'block', visibility: 'visible', color: 'rgb(0, 0, 0)' }),
    fetch: async (url, options) => {
      requests.push({ url: String(url), options });
      assert.match(String(url), /^\/app\/assets\/animated-icons\/[\w-]+\.json(?:\?.*)?$/, 'presentation may only request its self-hosted animation data');
      return { ok: true, json: async () => structuredClone(animations.get(String(url).split('/').at(-1).split('?')[0])) };
    },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; this.targets = []; this.records = []; observers.add(this); }
      observe(target, options) { this.targets.push([target, options]); }
      disconnect() { this.targets = []; this.records = []; }
      takeRecords() { return this.records.splice(0); }
    },
    IntersectionObserver: class {
      constructor(callback) { this.callback = callback; }
      observe(target) { enqueueMicrotask(() => this.callback([{ target, isIntersecting: true, intersectionRatio: 1 }], this)); }
      unobserve() {}
      disconnect() {}
    },
  };
  window.getComputedStyle = context.getComputedStyle;
  async function flush(advance = 0) {
    clock += advance;
    for (let turn = 0; turn < 20; turn++) {
      await Promise.resolve();
      let delivered = 0;
      while (microtasks.length) {
        if (++delivered > 200) throw new Error('presentation mutations must settle without a MutationObserver feedback loop');
        microtasks.shift()();
      }
      frames.splice(0).forEach((callback) => callback(clock));
      for (const [id, timer] of timers) {
        if (timer.at <= clock) { timers.delete(id); timer.callback(); }
      }
    }
  }
  function playerFor(button) { return players.findLast((player) => button.contains(player.options.container) && !player.destroyed); }
  const start = () => runInNewContext(source, context);
  return { context, document, window, node, Event, member, rail, nav, feed, card, like, save, bell, badge, mic, send, composer, body, error, preview, requests, players, playerFor, media, mediaListeners, start, flush };
}

test('member icon assets are compact vector animations with a bundled permissive license', async () => {
  assert.ok(animationFiles.length >= 10);
  for (const [name, animation] of animations) {
    assert.equal(animation.w, 32, name);
    assert.equal(animation.h, 32, name);
    assert.ok(animation.op > animation.ip, `${name} has a real timeline`);
    assert.ok(animation.layers.length > 0, `${name} has vector content`);
    assert.ok((animation.assets || []).every((asset) => !asset.p && !asset.u), `${name} cannot fetch raster assets`);
    assert.ok((await read(`app/assets/animated-icons/${name}`)).length < 10_000, `${name} stays small`);
  }
  assert.match(await read('app/assets/animated-icons/LICENSE'), /MIT License/);
});

test('animated icons do not modify account entry or request animation assets before membership opens', async () => {
  const state = harness({ auth: true, hidden: true, runtimeAvailable: false });
  const nativeIcons = state.document.querySelectorAll('svg');
  state.start();
  await state.flush();
  state.member.hidden = false;
  await state.flush();
  assert.deepEqual(state.requests, []);
  assert.equal(state.players.length, 0);
  assert.equal(state.document.querySelectorAll('script').length, 0);
  assert.deepEqual(state.document.querySelectorAll('svg'), nativeIcons);
  assert.equal(state.document.querySelectorAll('.sl-animated-icon').length, 0);
  state.document.body.classList.remove('auth-entry');
  await state.flush();
  const runtime = state.document.querySelector('script');
  assert.equal(runtime.src, '/assets/vendor/lottie-web/lottie_light.min.js');
  assert.ok(state.requests.length > 0, 'local icon data starts loading only after member visibility is allowed');
  runtime.dispatchEvent(new state.Event('error'));
  await state.flush();
  assert.deepEqual(state.document.querySelectorAll('svg'), nativeIcons, 'a failed player load preserves every native icon');
  assert.equal(state.document.querySelectorAll('.sl-animated-fallback').length, 0);
});

test('reduced motion retains native icons without loading the renderer or animation data', async () => {
  const state = harness({ reduced: true, runtimeAvailable: false });
  const native = state.like.querySelector('svg');
  state.start();
  await state.flush();
  state.like.dispatchEvent(new state.Event('click'));
  state.mic.classList.add('recording');
  await state.flush();
  assert.deepEqual(state.requests, []);
  assert.equal(state.players.length, 0);
  assert.equal(state.document.querySelectorAll('script').length, 0);
  assert.equal(state.like.querySelector('svg'), native);
});

const plays = (player) => player.calls.filter(([kind]) => kind === 'segments' || kind === 'play');

test('enhancement preserves the original post button, click handler, label, and count through state updates', async () => {
  const state = harness();
  const { like } = state;
  const native = like.querySelector('svg');
  const label = like.querySelector('.sauti-action-label');
  const count = like.querySelector('[data-count-for]');
  let clicks = 0;
  like.addEventListener('click', () => {
    clicks++;
    like.setAttribute('aria-pressed', 'true');
    like.dataset.active = 'true';
    count.textContent = '18';
  });
  state.start();
  await state.flush();
  const player = state.playerFor(like);
  assert.ok(player, 'a visible member button receives the actual animation renderer');
  assert.equal(plays(player).length, 0, 'initially loaded reaction state does not celebrate a new action');
  const host = like.querySelector('.sl-animated-icon');
  assert.equal(host.getAttribute('aria-hidden'), 'true');
  like.dispatchEvent(new state.Event('click'));
  await state.flush();
  assert.equal(clicks, 1);
  assert.equal(state.card.querySelector('[data-sauti-action="like"]'), like);
  assert.ok(like.contains(native), 'the original native icon remains available as a fallback');
  assert.equal(like.querySelector('.sauti-action-label'), label);
  assert.equal(like.querySelector('[data-count-for]'), count);
  assert.equal(count.textContent, '18');
  assert.equal(like.getAttribute('aria-pressed'), 'true');
  assert.ok(plays(player).length > 0);
  player.currentFrame = player.totalFrames - 1;
  player.emit('complete');
  like.setAttribute('aria-pressed', 'false');
  like.dataset.active = 'false';
  await state.flush();
  assert.ok(plays(player).at(-1)[1][0] > plays(player).at(-1)[1][1], 'server rollback reverses the selected animation');
});

test('unread notifications animate once per increase and do not replay on unrelated rendering', async () => {
  const state = harness();
  state.start();
  await state.flush();
  const player = state.playerFor(state.bell);
  assert.ok(player);
  const initial = plays(player).length;
  state.badge.textContent = '2';
  state.badge.hidden = false;
  await state.flush();
  assert.equal(plays(player).length, initial + 1);
  state.like.setAttribute('aria-label', 'Like this post');
  state.badge.textContent = '2';
  await state.flush();
  assert.equal(plays(player).length, initial + 1);
  state.badge.textContent = '1';
  await state.flush();
  assert.equal(plays(player).length, initial + 1, 'marking notifications read does not ring the bell again');
});

test('repeated navigation playback retains the original frame range after Lottie changes its segment bounds', async () => {
  const state = harness();
  const home = state.node('button', { 'data-member-view': 'stream', class: 'nav-item' }, state.nav);
  state.node('svg', { 'aria-hidden': 'true' }, home);
  state.start();
  await state.flush();
  const player = state.playerFor(home);
  assert.ok(player);
  const last = animations.get('home.json').op - 1;
  for (let replay = 0; replay < 4; replay++) {
    home.dispatchEvent(new state.Event('pointerover'));
    await state.flush();
    assert.deepEqual(plays(player).at(-1), ['segments', [0, last]], 'each hover must use the original full animation range');
    player.emit('complete');
    assert.deepEqual(plays(player).at(-1), ['segments', [last, 0]], 'return animation must use the same endpoints');
    player.emit('complete');
  }
});

test('interrupting a reaction segment uses the absolute displayed frame before reversing again', async () => {
  const state = harness();
  state.start();
  await state.flush();
  const player = state.playerFor(state.like);
  const toggle = async (active) => {
    state.like.setAttribute('aria-pressed', String(active));
    state.like.dataset.active = String(active);
    await state.flush();
  };
  await toggle(true);
  player.currentFrame = 4;
  await toggle(false);
  assert.deepEqual(plays(player).at(-1), ['segments', [4, 0]]);
  player.currentFrame = 2;
  await toggle(true);
  assert.deepEqual(plays(player).at(-1), ['segments', [2, 9]]);
  assert.equal(player.firstFrame, 2);
  player.currentFrame = 4;
  await toggle(false);
  assert.deepEqual(plays(player).at(-1), ['segments', [6, 0]], 'relative frame 4 in a segment beginning at 2 is displayed frame 6');
});

test('the mic loops only after recording actually starts and stops when the feature removes recording state', async () => {
  const state = harness();
  state.start();
  await state.flush();
  state.mic.dispatchEvent(new state.Event('click'));
  await state.flush();
  assert.notEqual(state.playerFor(state.mic)?.loop, true, 'a rejected permission prompt cannot imply an active recording');
  state.mic.classList.add('recording');
  await state.flush();
  const recordingPlayer = state.playerFor(state.mic);
  assert.ok(recordingPlayer);
  assert.equal(recordingPlayer.loop, true);
  assert.ok(plays(recordingPlayer).length > 0);
  state.mic.classList.remove('recording');
  await state.flush();
  const idlePlayer = state.playerFor(state.mic);
  assert.notEqual(idlePlayer?.loop, true);
  assert.ok(recordingPlayer.destroyed || recordingPlayer.calls.some(([kind]) => kind === 'pause' || kind === 'stop'));
});

test('removed nodes, live reduced motion, and account entry destroy their animation players', async () => {
  const state = harness();
  state.start();
  await state.flush();
  const removed = state.playerFor(state.like);
  assert.ok(removed);
  state.card.remove();
  await state.flush();
  assert.equal(removed.destroyed, true);
  const remaining = state.players.filter((player) => !player.destroyed);
  assert.ok(remaining.length > 0);
  const requestCount = state.requests.length;
  state.media.matches = true;
  state.mediaListeners.forEach((callback) => callback({ matches: true }));
  await state.flush();
  assert.ok(remaining.every((player) => player.destroyed), 'changing the system preference stops existing animation players');
  assert.equal(state.document.querySelectorAll('.sl-animated-icon').length, 0);
  assert.equal(state.requests.length, requestCount);
  state.media.matches = false;
  state.mediaListeners.forEach((callback) => callback({ matches: false }));
  await state.flush();
  const restored = state.players.filter((player) => !player.destroyed);
  assert.ok(restored.length > 0);
  state.document.body.classList.add('auth-entry');
  await state.flush();
  assert.ok(restored.every((player) => player.destroyed));
  assert.equal(state.document.querySelectorAll('.sl-animated-icon').length, 0);
});

test('real production message sending animates success only and preserves its icon and submit handler on failure', async () => {
  const app = transformMessagesReplySource('/repo/src/app.js', await read('src/app.js'));
  const sendSource = app.slice(app.indexOf('async function sendDirectMessage()'), app.indexOf('async function editDirectMessage('));
  const stateSource = app.slice(app.indexOf('function updateMessageComposerState()'), app.indexOf('async function syncMessageThreadSafety('));
  const messageSource = app.slice(app.indexOf('function setMessage('), app.indexOf('function normalizeVerificationBadgeType('));
  assert.ok(sendSource.includes('dataset.sending'));
  for (const successful of [false, true]) {
    const state = harness();
    const native = state.send.querySelector('svg');
    let finishInsert;
    let insertPayload;
    const inserted = new Promise((resolve) => finishInsert = resolve);
    const context = {
      ...state.context,
      byId: (id) => state.document.getElementById(id),
      activeConversation: { id: 'conversation-123' },
      currentMemberId: 'member-123',
      supabase: { from(table) {
        assert.equal(table, 'dm_messages');
        return { insert(payload) { insertPayload = payload; return inserted; } };
      } },
      broadcastDmTyping: async () => {},
      syncActiveMessageThreadRealtime: async () => {},
    };
    const send = runInNewContext(`${messageSource}\n${stateSource}\n${sendSource}\nsendDirectMessage;`, context);
    let handlerCalls = 0;
    let delivery;
    state.composer.addEventListener('submit', (event) => {
      handlerCalls++;
      event.preventDefault();
      delivery = send();
    });
    state.body.value = 'A real message';
    state.start();
    await state.flush();
    const player = state.playerFor(state.send);
    assert.ok(player);
    const before = plays(player).length;
    state.composer.dispatchEvent(new state.Event('submit'));
    await state.flush();
    assert.equal(state.send.getAttribute('aria-busy'), 'true');
    assert.equal(plays(player).length, before, 'an in-flight send is not a confirmed delivery');
    assert.deepEqual(JSON.parse(JSON.stringify(insertPayload)), {
      conversation_id: 'conversation-123', sender_id: 'member-123', body: 'A real message',
    });
    finishInsert(successful ? { error: null } : { error: { message: 'DM_RECIPIENT_RESTRICTED' } });
    await delivery;
    await state.flush();
    assert.equal(handlerCalls, 1);
    assert.ok(state.send.contains(native));
    assert.equal(state.send.getAttribute('aria-label'), 'Send message');
    assert.equal(state.send.getAttribute('aria-busy'), null);
    if (successful) {
      assert.equal(state.body.value, '');
      assert.equal(state.error.textContent, '');
      assert.equal(plays(player).length, before + 1);
    } else {
      assert.equal(state.body.value, 'A real message');
      assert.match(state.error.textContent, /message privacy settings/);
      assert.equal(plays(player).length, before, 'a rejected message cannot trigger the sent animation');
    }
  }
});
