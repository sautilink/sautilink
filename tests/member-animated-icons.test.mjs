import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { transformMessagesReplySource } from '../scripts/messages-reply-source-transform.mjs';
import { excludedIconSelector, glyphIcons, glyphSignature, iconRules, textIconRules } from '../src/member-icon-map.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const source = await read('app/assets/member-animated-icons.js');
const hugeRuntime = await read('app/assets/huge-icons/runtime.js');
const hugeManifest = JSON.parse(await read('app/assets/huge-icons/manifest.json'));

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
  const intersections = new Set();
  const enqueueMicrotask = (callback) => microtasks.push(callback);
  let clock = 0;
  let timerId = 0;
  let mutationQueued = false;
  let context;

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

  class AttributeMap extends Map {
    *[Symbol.iterator]() { for (const [name, value] of super.entries()) yield { name, value }; }
    item(index) { return [...this][index] || null; }
  }
  class Style {
    values = new Map();
    setProperty(name, value) { this.values.set(name, String(value)); }
    getPropertyValue(name) { return this.values.get(name) || ''; }
    removeProperty(name) { this.values.delete(name); }
    *[Symbol.iterator]() { yield* this.values.keys(); }
    get cssText() { return [...this.values].map(([name,value]) => `${name}: ${value};`).join(' '); }
    set cssText(value) { this.values.clear(); for (const declaration of value.split(';')) { const index=declaration.indexOf(':'); if(index>0)this.setProperty(declaration.slice(0,index).trim(),declaration.slice(index+1).trim()); } }
  }
  class Element {
    constructor(tag = 'div') {
      this.tagName = tag.toUpperCase();
      this.localName = tag.toLowerCase();
      this.nodeType = 1;
      this.parentNode = null;
      this.children = [];
      this.attributes = new AttributeMap();
      this.listeners = new Map();
      this._text = '';
      this.value = '';
      this.style = new Style();
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
    get childElementCount() { return this.children.filter(child => child.nodeType === 1).length; }
    get firstElementChild() { return this.children.find(child => child.nodeType === 1) || null; }
    get firstChild() { return this.children[0] || null; }
    get nextSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1] || null; }
    get ownerDocument() { return document; }
    get offsetWidth() { return this.closest('[hidden]') ? 0 : 32; }
    get offsetHeight() { return this.closest('[hidden]') ? 0 : 32; }
    get textContent() { return this._text + this.children.map((child) => child.textContent).join(''); }
    set textContent(value) {
      const removedNodes = [...this.children];
      this.children.forEach((child) => child.parentNode = null);
      this.children = [];
      this._text = '';
      if (String(value)) { const child=new TextNode(value); child.parentNode=this; this.children.push(child); }
      notify(this, { type: 'childList', addedNodes: [...this.children], removedNodes });
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
    appendChild(node) { return this.insertBefore(node, null); }
    cloneNode(deep = false) {
      const copy = new Element(this.localName);
      for (const { name, value } of this.attributes) copy.setAttribute(name, value);
      copy._text = this._text;
      if (deep) this.children.forEach(child => copy.append(child.cloneNode(true)));
      return copy;
    }
    prepend(...nodes) { nodes.reverse().forEach((node) => this.insertBefore(node, this.children[0] || null)); }
    insertBefore(node, before) {
      node.remove();
      node.parentNode = this;
      const index = before ? this.children.indexOf(before) : this.children.length;
      this.children.splice(index, 0, node);
      notify(this, { type: 'childList', addedNodes: [node], removedNodes: [] });
      if (node.localName === 'script') requests.push({ url: node.src || node.getAttribute('src') });
      if (node.localName === 'script' && runtimeAvailable) enqueueMicrotask(() => {
        runInNewContext(hugeRuntime, context);
        installMotionStub();
        node.dispatchEvent(new Event('load'));
      });
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
    before(node) { this.parentNode.insertBefore(node, this); }
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
        if (part.includes(':first-child') && this.parentElement?.firstElementChild !== this) return false;
        if (part.includes(':last-child') && this.parentElement?.children.at(-1) !== this) return false;
        const tag = part.match(/^[a-z][\w-]*/i)?.[0];
        if (tag && this.localName !== tag.toLowerCase()) return false;
        for (const [, name] of part.matchAll(/#([\w-]+)/g)) if (this.id !== name) return false;
        for (const [, name] of part.matchAll(/\.([\w-]+)/g)) if (!this.classList.contains(name)) return false;
        for (const [, name, operator, raw] of part.matchAll(/\[([\w:-]+)(?:\s*([*^$|~]?=)\s*([^\]]+))?\]/g)) {
          if (!this.hasAttribute(name)) return false;
          if (raw !== undefined) {
            const actual = this.getAttribute(name);
            const expected = raw.trim().replace(/^['"]|['"]$/g, '');
            if (operator === '=' && actual !== expected) return false;
            if (operator === '^=' && !actual.startsWith(expected)) return false;
            if (operator === '$=' && !actual.endsWith(expected)) return false;
            if (operator === '*=' && !actual.includes(expected)) return false;
            if (operator === '~=' && !actual.split(/\s+/).includes(expected)) return false;
          }
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

  class TextNode extends Element {
    constructor(value) { super('#text'); this.nodeType=3; this._value=String(value); }
    get nodeValue() { return this._value; }
    set nodeValue(value) { this._value=String(value); notify(this,{type:'characterData'}); }
    get textContent() { return this.nodeValue; }
    set textContent(value) { this.nodeValue=value; }
    matches() { return false; }
    cloneNode() { return new TextNode(this.nodeValue); }
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
  document.createTextNode = (value) => new TextNode(value);
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
  function installMotionStub() {
    const actual = context.SautiHugeIcons;
    assert.ok(actual?.renderIcon && actual?.catalog, 'the real vendored Huge renderer loaded');
    window.SautiHugeIcons = {
      ...actual,
      play(svg, name, options) {
        const player = {
          svg, name, options, calls: [], destroyed: false,
          start() { this.calls.push(['start']); },
          stop() { this.calls.push(['stop']); },
          destroy() { this.calls.push(['destroy']); this.destroyed = true; },
        };
        players.push(player);
        return player;
      },
    };
  }
  context = {
    window, document, Element, HTMLElement: Element, SVGElement: Element, Event, CustomEvent: Event,
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3, DOCUMENT_NODE: 9 },
    queueMicrotask: enqueueMicrotask, structuredClone, URL, performance: { now: () => clock },
    setTimeout: window.setTimeout, clearTimeout: window.clearTimeout,
    requestAnimationFrame: window.requestAnimationFrame, cancelAnimationFrame: window.cancelAnimationFrame,
    getComputedStyle: (element) => ({ display: element.hidden ? 'none' : 'block', visibility: 'visible', color: 'rgb(0, 0, 0)' }),
    fetch: async () => { throw new Error('Huge icons use one local runtime and cannot fetch remote data'); },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; this.targets = []; this.records = []; observers.add(this); }
      observe(target, options) { this.targets.push([target, options]); }
      disconnect() { this.targets = []; this.records = []; }
      takeRecords() { return this.records.splice(0); }
    },
    IntersectionObserver: class {
      constructor(callback) { this.callback = callback; this.targets = new Set(); intersections.add(this); }
      observe(target) { this.targets.add(target); enqueueMicrotask(() => this.callback([{ target, isIntersecting: true, intersectionRatio: 1 }], this)); }
      unobserve(target) { this.targets.delete(target); }
      disconnect() { this.targets.clear(); }
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
  function playerFor(button) { return players.findLast((player) => button.contains(player.svg) && !player.destroyed); }
  function intersect(button, visible) {
    for (const observer of intersections) for (const target of observer.targets) {
      if (target === button || button.contains(target)) observer.callback([{ target, isIntersecting: visible, intersectionRatio: visible ? 1 : 0 }], observer);
    }
  }
  const start = () => runInNewContext(source, context);
  return { context, document, window, node, Event, member, rail, nav, feed, card, like, save, bell, badge, mic, send, composer, body, error, preview, requests, players, playerFor, media, mediaListeners, start, flush, intersect };
}

// Parse real shell markup into the same minimal DOM used by the runtime tests.
// This checks icon coverage independently of the authored selector/signature map.
function sourceTree(html, state) {
  const root = new state.context.Element('fixture-root');
  const stack = [root];
  const source = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  const voidTags = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
  for (const token of source.matchAll(/<!--[^]*?-->|<\/?([a-z][\w:-]*)\b[^>]*>|[^<]+/gi)) {
    const [text, tag] = token;
    if (text.startsWith('<!--')) continue;
    if (!tag) { stack.at(-1)._text += text; continue; }
    const name = tag.toLowerCase();
    if (text.startsWith('</')) {
      const index = stack.findLastIndex(node => node.localName === name);
      if (index > 0) stack.length = index;
      continue;
    }
    const node = new state.context.Element(name);
    const attributes = text.slice(text.indexOf(tag) + tag.length, text.length - 1);
    for (const [, key, double, single, bare] of attributes.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) node.setAttribute(key, double ?? single ?? bare ?? '');
    stack.at(-1).append(node);
    if (!voidTags.has(name) && !text.endsWith('/>')) stack.push(node);
  }
  return root;
}

test('every native member SVG in the real shell resolves to Huge, with explicit identity and auth exclusions', async () => {
  const state = harness();
  const root = sourceTree(await read('app/index.html'), state);
  const unmapped = [];
  let covered = 0;
  let excluded = 0;
  for (const svg of root.querySelectorAll('svg')) {
    if (svg.matches(excludedIconSelector)) { excluded++; continue; }
    const name = iconRules.find(rule => svg.matches(rule.selector))?.icon || glyphIcons[glyphSignature(svg)];
    if (!name) unmapped.push({ parent: svg.parentElement.id || svg.parentElement.className, geometry: glyphSignature(svg) });
    else covered++;
  }
  assert.ok(covered >= 70, 'coverage includes the entire native member shell, beyond navigation and reactions');
  assert.ok(excluded > 0, 'auth and identity SVGs remain explicitly excluded');
  assert.deepEqual(unmapped, []);
});

test('the production video icon generator maps every playback, audio, fullscreen and PiP glyph', async () => {
  const state = harness();
  const videoSource = await read('src/sautilink-video-player.js');
  const functionSource = videoSource.slice(videoSource.indexOf('function videoIcon('), videoSource.indexOf('function makeVideoControl('));
  const videoIcon = runInNewContext(`const SVG_NS = 'http://www.w3.org/2000/svg';\n${functionSource}\nvideoIcon;`, state.context);
  for (const [original, replacement] of Object.entries({
    play: 'play', pause: 'pause', replay: 'refresh-0-1',
    'volume-muted': 'volume-off', volume: 'volume-high', fullscreen: 'full-screen', pip: 'lucide:picture-in-picture',
  })) assert.equal(glyphIcons[glyphSignature(videoIcon(original))], replacement, original);
});

test('Huge assets preserve pinned upstream geometry, real timelines, and permissive notices', async () => {
  assert.equal(hugeManifest.library, 'huge');
  assert.equal(hugeManifest.repository, 'https://github.com/Avijit07x/animateicons');
  const names = new Set(hugeManifest.icons.map(icon => icon.name));
  const required = new Set([...Object.values(glyphIcons), ...iconRules.map(rule => rule.icon), ...textIconRules.map(rule => rule.icon), 'activity']);
  assert.deepEqual([...required].filter(name => !names.has(name)), [], 'every icon used by member surfaces is bundled locally');
  assert.equal(names.size, required.size, 'unused catalog icons do not add bytes to the public renderer');
  for (const asset of [...hugeManifest.icons, hugeManifest.runtime]) {
    const text = await read(`vendor/animateicons/${asset.file}`);
    assert.equal(createHash('sha256').update(text).digest('hex'), asset.sha256, `${asset.file} remains byte-identical to its pinned package`);
  }
  assert.match(await read('app/assets/huge-icons/LICENSE'), /MIT License/);
  assert.match(await read('app/assets/huge-icons/LICENSE-MOTION.md'), /MIT License/);
  assert.match(await read('app/assets/huge-icons/THIRD_PARTY_NOTICES.md'), /Hugeicons/);
  const state = harness();
  state.start();
  await state.flush();
  const api = state.window.SautiHugeIcons;
  assert.ok(api);
  for (const name of api.names) {
    const icon = api.catalog[name];
    assert.ok(['huge', 'lucide', 'sautilink'].includes(icon.library), `${name} belongs to a declared, self-hosted icon family`);
    assert.ok(icon.children?.length, `${name} has vector content`);
    const nodes = (item) => [item, ...(item.children || []).flatMap(nodes)];
    assert.ok(nodes(icon).some((node) => node.animate && Object.keys(node.animate).some((key) => key !== 'transition')), `${name} has an upstream motion timeline`);
    assert.ok(nodes(icon).every((node) => !['image','foreignObject','script'].includes(node.tag)), `${name} renders only local vectors`);
  }
});

test('Huge loading waits for membership and leaves login and signup SVGs untouched', async () => {
  const state = harness({ auth: true, hidden: true });
  const account = state.node('section', { id: 'auth-view' });
  const authIcon = state.node('svg', { class: 'theme-toggle-sun', 'data-unchanged': 'yes' }, account);
  state.node('path', { d: 'M1 1h2' }, authIcon);
  const original = authIcon.cloneNode(true);
  state.start();
  await state.flush();
  state.member.hidden = false;
  await state.flush();
  assert.deepEqual(state.requests, []);
  assert.equal(state.players.length, 0);
  assert.equal(state.document.querySelectorAll('script').length, 0);
  state.document.body.classList.remove('auth-entry');
  await state.flush();
  assert.equal(state.requests.length, 1, 'all visible icons share one local runtime request');
  assert.match(state.requests[0].url, /^\/app\/assets\/huge-icons\/runtime\.js(?:\?.*)?$/);
  assert.equal(authIcon.getAttribute('data-sl-huge-icon'), null);
  assert.deepEqual([...authIcon.attributes], [...original.attributes]);
  assert.equal(authIcon.querySelector('path').getAttribute('d'), 'M1 1h2');
});

test('a failed Huge runtime load retains the original control icons and does not change actions', async () => {
  const state = harness({ runtimeAvailable: false });
  const native = state.like.querySelector('svg');
  state.node('path', { d: 'M2 3h4' }, native);
  state.start();
  await state.flush();
  state.document.querySelector('script').dispatchEvent(new state.Event('error'));
  await state.flush();
  assert.equal(state.like.querySelector('svg'), native);
  assert.equal(native.querySelector('path').getAttribute('d'), 'M2 3h4');
  assert.equal(native.getAttribute('data-sl-huge-icon'), null);
  assert.equal(state.like.getAttribute('aria-pressed'), 'false');
  assert.equal(state.players.length, 0);
});

const plays = (player) => player?.calls.filter(([kind]) => kind === 'start') || [];
const startedFor = (state, button) => state.players.filter(player => button.contains(player.svg)).reduce((sum, player) => sum + plays(player).length, 0);

test('initial Reduce Motion keeps the Huge icon family static and creates no animation controllers', async () => {
  const state = harness({ reduced: true });
  const native = state.like.querySelector('svg');
  state.start();
  await state.flush();
  assert.equal(state.like.querySelector('svg'), native);
  assert.equal(native.getAttribute('data-sl-huge-icon'), 'heart');
  assert.ok(native.children.length > 0, 'the real Huge renderer provides the static icon geometry');
  state.like.dispatchEvent(new state.Event('pointerover'));
  state.mic.classList.add('recording');
  await state.flush();
  assert.equal(state.players.length, 0);
  assert.equal(state.requests.length, 1, 'Reduce Motion still uses the chosen icon family');
});

test('in-place enhancement preserves post SVG identity, button handlers, selected state, label, and count', async () => {
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
  assert.equal(native.getAttribute('data-sl-huge-icon'), 'heart');
  assert.equal(startedFor(state, like), 0, 'initial state does not celebrate a new action');
  like.dispatchEvent(new state.Event('click'));
  await state.flush();
  assert.equal(clicks, 1);
  assert.equal(state.card.querySelector('[data-sauti-action="like"]'), like);
  assert.equal(like.querySelector('svg'), native, 'the original SVG itself retains identity and classes');
  assert.equal(like.querySelector('.sauti-action-label'), label);
  assert.equal(like.querySelector('[data-count-for]'), count);
  assert.equal(count.textContent, '18');
  assert.equal(like.getAttribute('aria-pressed'), 'true');
  const selectedPlays = startedFor(state, like);
  assert.ok(selectedPlays > 0);
  like.setAttribute('aria-pressed', 'false');
  like.dataset.active = 'false';
  await state.flush();
  assert.equal(like.getAttribute('aria-pressed'), 'false', 'a rejected optimistic state rolls back normally');
  assert.ok(startedFor(state, like) > selectedPlays, 'rollback state receives its matching visual response');
});

test('unread notifications animate once per increase without replaying for unrelated mutations', async () => {
  const state = harness();
  state.start();
  await state.flush();
  const initial = startedFor(state, state.bell);
  state.badge.textContent = '2';
  state.badge.hidden = false;
  await state.flush();
  assert.equal(startedFor(state, state.bell), initial + 1);
  state.like.setAttribute('aria-label', 'Like this post');
  state.badge.textContent = '2';
  await state.flush();
  assert.equal(startedFor(state, state.bell), initial + 1);
  state.badge.textContent = '1';
  await state.flush();
  assert.equal(startedFor(state, state.bell), initial + 1, 'marking a notification read does not ring the bell');
});

test('repeated navigation hover replays the real mapped icon without accumulating controllers', async () => {
  const state = harness();
  const home = state.node('button', { 'data-member-view': 'stream', class: 'nav-item' }, state.nav);
  const original = state.node('svg', { 'aria-hidden': 'true' }, home);
  state.start();
  await state.flush();
  assert.equal(original.getAttribute('data-sl-huge-icon'), 'home-0-1');
  for (let replay = 1; replay <= 4; replay++) {
    home.dispatchEvent(new state.Event('pointerover'));
    await state.flush();
    assert.equal(startedFor(state, home), replay);
    assert.ok(state.players.filter(player => home.contains(player.svg) && !player.destroyed).length <= 1);
  }
});

test('microphone motion follows actual recording state and stops when recording ends', async () => {
  const state = harness();
  state.start();
  await state.flush();
  state.mic.dispatchEvent(new state.Event('click'));
  await state.flush();
  assert.equal(state.mic.querySelector('svg').getAttribute('data-sl-huge-icon'), 'mic-0-1', 'a rejected microphone permission cannot imply a recording waveform');
  const idlePlays = startedFor(state, state.mic);
  await state.flush(2000);
  assert.equal(startedFor(state, state.mic), idlePlays, 'the idle microphone response cannot loop as a recording');
  state.mic.classList.add('recording');
  await state.flush();
  const recordingPlayer = state.playerFor(state.mic);
  assert.ok(recordingPlayer);
  assert.equal(recordingPlayer.name, 'activity');
  assert.ok(plays(recordingPlayer).length > 0);
  state.mic.classList.remove('recording');
  await state.flush();
  assert.ok(recordingPlayer.destroyed || recordingPlayer.calls.some(([kind]) => kind === 'stop'));
});

test('offscreen, removed, reduced-motion, and account-entry transitions stop motion and preserve static state', async () => {
  const state = harness();
  const native = state.like.querySelector('svg');
  state.start();
  await state.flush();
  state.like.setAttribute('aria-pressed', 'true');
  await state.flush();
  const moving = state.playerFor(state.like);
  assert.ok(moving);
  state.intersect(state.like, false);
  await state.flush();
  assert.ok(moving.destroyed || moving.calls.some(([kind]) => kind === 'stop'));
  assert.equal(native.getAttribute('data-sl-huge-icon'), 'heart', 'offscreen controls retain their static Huge geometry');
  state.intersect(state.like, true);
  await state.flush();
  state.like.setAttribute('aria-pressed', 'false');
  await state.flush();
  const restored = state.playerFor(state.like);
  assert.ok(restored);
  state.card.remove();
  await state.flush();
  assert.ok(restored.destroyed);
  state.bell.dispatchEvent(new state.Event('pointerover'));
  await state.flush();
  const remaining = state.players.filter(player => !player.destroyed);
  state.media.matches = true;
  state.mediaListeners.forEach(callback => callback({ matches: true }));
  await state.flush();
  assert.ok(remaining.every(player => player.destroyed || player.calls.some(([kind]) => kind === 'stop')));
  assert.ok(state.bell.querySelector('svg').hasAttribute('data-sl-huge-icon'));
  state.document.body.classList.add('auth-entry');
  await state.flush();
  assert.equal(state.document.querySelectorAll('[data-sl-huge-icon]').length, 0, 'account entry restores original member SVG geometry');
});

test('new member controls are enhanced dynamically while both theme SVGs and their classes survive', async () => {
  const state = harness();
  const theme = state.node('button', { 'data-theme-toggle': '', class: 'theme-toggle', 'aria-label': 'Change appearance' }, state.member);
  const sun = state.node('svg', { class: 'theme-toggle-sun', 'aria-hidden': 'true' }, theme);
  const moon = state.node('svg', { class: 'theme-toggle-moon', 'aria-hidden': 'true' }, theme);
  state.node('circle', { cx: '12', cy: '12', r: '4' }, sun);
  state.node('path', { d: 'M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42' }, sun);
  state.node('path', { d: 'M20.2 15.2A8.4 8.4 0 0 1 8.8 3.8 8.5 8.5 0 1 0 20.2 15.2Z' }, moon);
  state.start();
  await state.flush();
  assert.equal(sun.getAttribute('data-sl-huge-icon'), 'sun-0-1');
  assert.equal(moon.getAttribute('data-sl-huge-icon'), 'moon-0-1');
  assert.equal(theme.querySelectorAll('svg').length, 2);
  assert.ok(sun.classList.contains('theme-toggle-sun'));
  assert.ok(moon.classList.contains('theme-toggle-moon'));
  assert.equal(theme.getAttribute('aria-label'), 'Change appearance');
  const settings = state.node('button', { 'data-settings-section': 'privacy' }, state.member);
  const lock = state.node('svg', { 'aria-hidden': 'true' }, settings);
  await state.flush();
  assert.equal(lock.getAttribute('data-sl-huge-icon'), 'lock-keyhole');
  settings.dispatchEvent(new state.Event('pointerover'));
  await state.flush();
  assert.equal(startedFor(state, settings), 1);
});

test('video playback and audio state keep their original controls and resolve the current action icon', async () => {
  const state = harness();
  const play = state.node('button', { class: 'sauti-video-control play-pause', 'aria-label': 'Play video' }, state.member);
  const playSvg = state.node('svg', { 'aria-hidden': 'true' }, play);
  const audio = state.node('button', { class: 'sauti-video-control audio', 'aria-label': 'Unmute video' }, state.member);
  const audioSvg = state.node('svg', { 'aria-hidden': 'true' }, audio);
  let clicks = 0;
  play.addEventListener('click', () => { clicks++; play.setAttribute('aria-label', 'Pause video'); });
  state.start();
  await state.flush();
  assert.equal(playSvg.getAttribute('data-sl-huge-icon'), 'play');
  assert.equal(audioSvg.getAttribute('data-sl-huge-icon'), 'volume-off');
  play.dispatchEvent(new state.Event('click'));
  audio.setAttribute('aria-label', 'Mute video');
  await state.flush();
  assert.equal(clicks, 1);
  assert.equal(playSvg.getAttribute('data-sl-huge-icon'), 'pause');
  assert.equal(audioSvg.getAttribute('data-sl-huge-icon'), 'volume-high');
  assert.equal(play.querySelector('svg'), playSvg);
  assert.equal(audio.querySelector('svg'), audioSvg);
  play.setAttribute('aria-label', 'Replay video');
  await state.flush();
  assert.equal(playSvg.getAttribute('data-sl-huge-icon'), 'refresh-0-1');
});

test('text and pseudo icons preserve adjacent counts, accessible labels, and original glyphs on account entry', async () => {
  const state = harness();
  const back=state.node('button', { id:'message-thread-back', 'aria-label':'Back to chats, 2 unread messages' }, state.member);
  const chevron=state.node('span', { class:'message-thread-back-chevron', 'aria-hidden':'true' }, back);
  chevron.textContent='‹';
  const count=state.node('span', { class:'message-thread-back-count' }, back);count.textContent='2';
  const messages=state.node('section', { class:'messages-whatsapp-ui' }, state.member);
  const search=state.node('form', { class:'messages-search' }, messages);
  state.node('input', { type:'search', 'aria-label':'Search chats' }, search);
  let clicks=0;back.addEventListener('click',()=>clicks++);
  state.start();
  await state.flush();
  assert.equal(chevron.querySelector('svg')?.getAttribute('data-sl-huge-icon'),'chevron-left');
  assert.equal(chevron.textContent,'');
  assert.equal(back.querySelector('.message-thread-back-count'),count);
  assert.equal(count.textContent,'2');
  assert.equal(back.getAttribute('aria-label'),'Back to chats, 2 unread messages');
  assert.equal(search.querySelector('svg')?.getAttribute('data-sl-huge-icon'),'search');
  assert.equal(search.getAttribute('data-sl-huge-before'),'true');
  back.dispatchEvent(new state.Event('click'));await state.flush();
  assert.equal(clicks,1);
  state.document.body.classList.add('auth-entry');await state.flush();
  assert.equal(chevron.textContent,'‹');
  assert.equal(count.textContent,'2');
  assert.equal(search.getAttribute('data-sl-huge-before'),null);
});

test('failed runtime loading leaves existing text icon glyphs visible', async () => {
  const state=harness({runtimeAvailable:false});
  const close=state.node('button',{class:'messages-appearance-close','aria-label':'Close chat appearance'},state.member);
  close.textContent='×';
  state.start();await state.flush();
  state.document.querySelector('script').dispatchEvent(new state.Event('error'));
  await state.flush();
  assert.equal(close.textContent,'×');
  assert.equal(close.querySelector('svg[data-sl-huge-text]'),null);
});

test('video quality selection moves its decorative check icon with aria-checked state', async () => {
  const state = harness();
  const first = state.node('span', { class:'sauti-video-quality-option', role:'menuitemradio', 'aria-checked':'true' }, state.member);
  first.textContent='Auto';
  const second = state.node('span', { class:'sauti-video-quality-option', role:'menuitemradio', 'aria-checked':'false' }, state.member);
  second.textContent='Original';
  state.start();await state.flush();
  assert.equal(first.querySelector('svg')?.getAttribute('data-sl-huge-icon'),'check');
  assert.equal(Boolean(second.querySelector('svg')),false);
  first.setAttribute('aria-checked','false');
  second.setAttribute('aria-checked','true');
  await state.flush();
  assert.equal(Boolean(first.querySelector('svg')),false);
  assert.equal(first.getAttribute('data-sl-huge-after'),null);
  assert.equal(second.querySelector('svg')?.getAttribute('data-sl-huge-icon'),'check');
  assert.equal(first.textContent,'Auto');
  assert.equal(second.textContent,'Original');
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
    const before = startedFor(state, state.send);
    state.composer.dispatchEvent(new state.Event('submit'));
    await state.flush();
    assert.equal(state.send.getAttribute('aria-busy'), 'true');
    assert.equal(startedFor(state, state.send), before, 'an in-flight send is not a confirmed delivery');
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
      assert.equal(startedFor(state, state.send), before + 1);
    } else {
      assert.equal(state.body.value, 'A real message');
      assert.match(state.error.textContent, /message privacy settings/);
      assert.equal(startedFor(state, state.send), before, 'a rejected message cannot trigger the sent animation');
    }
  }
});
