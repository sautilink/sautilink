import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const toData = (name) => name.replace(/^data-/, '').replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

/** Exercise the real install closure, its registered observers and route/timer
 * callbacks. Only expensive slide creation and synchronization are counted
 * seams; this suite does not substitute the production admission/filter logic.
 */
async function harness({ posts = ['a', 'b'], pathname = '/home', more = false } = {}) {
  let source = (await readFile(new URL('../src/short-videos-feed.js', import.meta.url), 'utf8'))
    .replace(/^import .*;\r?\n/gm, '');
  const create = source.indexOf('function createShortVideoSlide(');
  const sync = source.indexOf('function syncSlideFromSource(', create);
  const install = source.indexOf('function installShortVideosFeed(', sync);
  assert.ok(create > 0 && sync > create && install > sync);
  source = source.slice(0, create) + 'function createShortVideoSlide(tile) { return countedCreate(tile); }\n'
    + 'function syncSlideFromSource(slide) { countedSync(slide); }\n' + source.slice(install);
  source = source.slice(0, source.lastIndexOf("\nif (document.readyState === 'loading')"));
  const observers = [], intersections = [], timers = new Map(), frames = [], clones = [], syncs = [];
  let clock = 0, nextTimer = 0, document;

  class Target {
    constructor() { this.listeners = new Map(); }
    addEventListener(type, fn) { this.listeners.set(type, [...(this.listeners.get(type) || []), fn]); }
    removeEventListener(type, fn) { this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== fn)); }
    dispatchEvent(event) {
      event.target ||= this;
      for (const fn of this.listeners.get(event.type) || []) fn(event);
      return !event.defaultPrevented;
    }
  }
  class Event {
    constructor(type, init = {}) { this.type = type; Object.assign(this, init); }
    preventDefault() { this.defaultPrevented = true; }
    stopPropagation() {}
    stopImmediatePropagation() {}
  }
  class Element extends Target {
    constructor(tag = 'div') {
      super(); this.nodeType = 1; this.tagName = tag.toUpperCase(); this.localName = tag;
      this.dataset = {}; this.attributes = new Map(); this.children = []; this.hidden = false;
      this.disabled = false; this.isConnected = true; this.style = {}; this.scrollTop = 0; this.clientHeight = 400;
      this.classes = new Set(); this.clicks = 0;
      this.classList = {
        contains: name => this.classes.has(name),
        add: (...names) => names.forEach(name => this.classes.add(name)),
        remove: (...names) => names.forEach(name => this.classes.delete(name)),
        toggle: (name, force) => { const state = force ?? !this.classes.has(name); if (state) this.classes.add(name); else this.classes.delete(name); return state; },
      };
    }
    set className(value) { this.classes = new Set(value.split(/\s+/).filter(Boolean)); }
    get className() { return [...this.classes].join(' '); }
    get childNodes() { return this.children; }
    get parentNode() { return this.parentElement || null; }
    get offsetHeight() { return 400; }
    get offsetTop() { return Math.max(0, this.parentElement?.children.indexOf(this) || 0) * 400; }
    set innerHTML(value) {
      if (!value.includes('sauti-short-videos-track')) return;
      const close = new Element('button'); close.className = 'sauti-short-close';
      const track = new Element(); track.className = 'sauti-short-videos-track';
      this.append(close, track);
    }
    setAttribute(name, value) {
      if (name === 'id') this.id = String(value);
      else if (name === 'class') this.className = String(value);
      else if (name.startsWith('data-')) this.dataset[toData(name)] = String(value);
      this.attributes.set(name, String(value));
    }
    getAttribute(name) {
      if (name === 'id') return this.id ?? null;
      if (name === 'class') return this.className;
      if (name.startsWith('data-')) return this.dataset[toData(name)] ?? null;
      return this.attributes.get(name) ?? null;
    }
    hasAttribute(name) { return this.getAttribute(name) !== null; }
    removeAttribute(name) { this.attributes.delete(name); if (name.startsWith('data-')) delete this.dataset[toData(name)]; }
    append(...nodes) { for (const node of nodes) { node.remove?.(); this.children.push(node); node.parentElement = this; node.connect?.(this.isConnected); } }
    connect(value) { this.isConnected = value; this.children.forEach(node => node.connect?.(value)); }
    remove() {
      const parent = this.parentElement;
      if (parent) parent.children = parent.children.filter(node => node !== this);
      this.parentElement = null; this.connect(false);
    }
    replaceChildren(...nodes) { for (const node of [...this.children]) node.remove?.(); this.children = []; this.append(...nodes); }
    contains(node) { return node === this || this.children.some(child => child.contains?.(node)); }
    matches(selector) {
      return selector.split(',').some(part => {
        const chunks = part.trim().replace(/\s*>\s*/g, ' ').split(/\s+/);
        const one = (node, pattern) => {
          if (!node || node.nodeType !== 1) return false;
          const tag = pattern.match(/^[a-z]+/i)?.[0];
          if (tag && node.localName !== tag.toLowerCase()) return false;
          for (const id of pattern.matchAll(/#([\w-]+)/g)) if (node.id !== id[1]) return false;
          for (const cls of pattern.matchAll(/\.([\w-]+)/g)) if (!node.classList.contains(cls[1])) return false;
          for (const attr of pattern.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
            const value = node.getAttribute(attr[1]);
            if (value === null || (attr[2] !== undefined && value !== attr[2])) return false;
          }
          return true;
        };
        if (!one(this, chunks.pop())) return false;
        let parent = this.parentElement;
        while (chunks.length) {
          const pattern = chunks.pop();
          while (parent && !one(parent, pattern)) parent = parent.parentElement;
          if (!parent) return false;
          parent = parent.parentElement;
        }
        return true;
      });
    }
    closest(selector) { let node = this; while (node) { if (node.matches?.(selector)) return node; node = node.parentElement; } return null; }
    querySelectorAll(selector) {
      const found = [];
      const visit = node => { for (const child of node.children || []) { if (child.matches?.(selector)) found.push(child); visit(child); } };
      visit(this); return found;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    focus() { document.activeElement = this; }
    click() { if (this.disabled) return; this.clicks++; this.dispatchEvent(new Event('click')); }
    scrollIntoView() {}
  }
  class Media extends Element {
    constructor() { super('video'); this.paused = true; this.currentTime = 0; this.pauseCalls = 0; this.playCalls = 0; this.src = ''; }
    pause() { this.paused = true; this.pauseCalls++; }
    play() { this.paused = false; this.playCalls++; return Promise.resolve(); }
  }
  document = new Target();
  const html = new Element('html'), body = new Element('body'), head = new Element('head'); html.append(head, body);
  Object.assign(document, { readyState: 'loading', visibilityState: 'visible', documentElement: html, body, head,
    createElement: tag => tag === 'video' ? new Media() : new Element(tag),
    getElementById: id => html.querySelector(`#${id}`),
    querySelectorAll: selector => html.querySelectorAll(selector), querySelector: selector => html.querySelector(selector) });
  const member = new Element(); member.id = 'member-view'; body.append(member);
  const feed = new Element(); feed.id = 'stream-feed'; member.append(feed);
  const streamMore = new Element(); streamMore.id = 'stream-more'; streamMore.hidden = !more; member.append(streamMore);
  const loadMore = new Element('button'); loadMore.id = 'stream-load-more'; streamMore.append(loadMore);
  const tab = new Element('button'); tab.dataset.homeFeedTab = 'short-videos'; tab.setAttribute('aria-selected', 'true'); member.append(tab);
  const location = { pathname, search: '', hash: '' };
  const navigate = path => { const url = new URL(path, 'https://sautilink.com'); Object.assign(location, { pathname: url.pathname, search: url.search, hash: url.hash }); };
  const window = new Target();
  Object.assign(window, { location, history: { state: null,
    replaceState(state, _, path) { this.state = state; navigate(path); },
    pushState(state, _, path) { this.state = state; navigate(path); }, back() { navigate('/home'); } },
    setTimeout(fn, delay = 0) { timers.set(++nextTimer, { fn, at: clock + delay, delay }); return nextTimer; },
    clearTimeout(id) { timers.delete(id); }, matchMedia: () => ({ matches: false }) });
  const sourceCards = () => feed.querySelectorAll('.sauti-card');
  function card(postId) { return sourceCards().find(item => item.dataset.postId === postId); }
  function addPost(postId) {
    const post = new Element('article'); post.className = 'sauti-card'; post.dataset.postId = postId;
    const tile = new Element('button'); tile.className = 'sauti-media-tile';
    Object.assign(tile.dataset, { mediaKind: 'video', openMediaId: `media-${postId}`, mediaObjectUrl: `/api/${postId}` });
    tile.append(new Media()); post.append(tile);
    for (const name of ['like', 'comments', 'repost', 'save', 'share']) {
      const action = new Element('button'); action.dataset.sautiAction = name; action.dataset.active = 'false';
      const count = new Element('span'); count.dataset.countFor = name; count.textContent = '0'; action.append(count); post.append(action);
    }
    const follow = new Element('button'); follow.dataset.homeFollow = ''; follow.dataset.following = 'false'; post.append(follow);
    feed.append(post); return post;
  }
  posts.forEach(addPost);
  const countedCreate = tile => {
    clones.push(tile);
    const slide = new Element('article'); slide.className = 'sauti-short-video-slide';
    const source = tile.closest('.sauti-card');
    Object.assign(slide.dataset, { postId: source.dataset.postId, mediaId: tile.dataset.openMediaId,
      shortVideoKey: `${source.dataset.postId}:${tile.dataset.openMediaId}` });
    const frame = new Element(); frame.className = 'sauti-short-video-frame'; frame.append(new Media()); slide.append(frame);
    return slide;
  };
  const countedSync = slide => {
    syncs.push(slide.dataset.postId);
    const source = card(slide.dataset.postId);
    slide.latestState = source ? { like: source.querySelector('[data-sauti-action="like"]').dataset.active,
      count: source.querySelector('[data-count-for="like"]').textContent,
      following: source.querySelector('[data-home-follow]')?.dataset.following,
      url: source.querySelector('.sauti-media-tile').dataset.mediaObjectUrl } : null;
  };
  const scope = { document, window, location, Element, HTMLElement: Element, HTMLMediaElement: Media, HTMLVideoElement: Media,
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 }, CustomEvent: Event, Event, PopStateEvent: Event,
    countedCreate, countedSync, getVideoAutoplayPreference: () => false, VIDEO_AUTOPLAY_EVENT: 'autoplay',
    updateShortsMediaReadiness() {}, refreshClonedVerificationSvgs() {},
    queueMicrotask: fn => fn(), requestAnimationFrame: fn => { frames.push(fn); return frames.length; }, cancelAnimationFrame() {},
    IntersectionObserver: class {
      constructor(callback) { this.callback = callback; this.observed = new Set(); intersections.push(this); }
      observe(node) { this.observed.add(node); } unobserve(node) { this.observed.delete(node); } disconnect() { this.observed.clear(); }
    },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; }
      observe(target, options) { observers.push({ target, options, callback: this.callback }); }
      disconnect() {} takeRecords() { return []; }
    } };
  vm.runInNewContext(source + '\ninstallShortVideosFeed();', scope);
  const root = document.getElementById('sauti-short-videos');
  function notify(target, changes) { for (const observer of observers.filter(item => item.target === target)) observer.callback(changes); }
  function mutation(target, type = 'attributes', attributeName = 'data-active', nodes = {}) {
    return { target, type, attributeName, oldValue: null, addedNodes: [], removedNodes: [], ...nodes };
  }
  return { document, window, root, feed, member, streamMore, loadMore, tab, clones, syncs, timers, intersections, card, addPost, notify, mutation,
    slides: () => root.querySelectorAll('.sauti-short-video-slide'),
    open(postId = '', trigger = tab) { document.dispatchEvent(new Event('sautilink:open-short-videos', { detail: { postId, trigger, returnHomeFeed: 'for-you' } })); },
    close() { navigate('/home'); window.dispatchEvent(new Event('popstate')); },
    navigate(path) { navigate(path); window.dispatchEvent(new Event('sautilink:routechange')); },
    async advance(ms = 200) {
      clock += ms;
      for (let i = 0; i < 30; i++) {
        const ready = [...timers].find(([, value]) => value.at <= clock);
        if (!ready) break;
        timers.delete(ready[0]); ready[1].fn(); await Promise.resolve();
      }
      for (let i = 0; frames.length && i < 30; i++) frames.shift()();
      await Promise.resolve();
    },
  };
}

test('hidden Home never clones or synchronizes Shorts for HUD, icon, action or media-readiness churn', async () => {
  const h = await harness();
  assert.equal(h.clones.length, 0); assert.equal(h.slides().length, 0);
  const tile = h.card('a').querySelector('.sauti-media-tile'), hud = new (h.feed.constructor)('span');
  hud.className = 'sauti-video-time'; tile.append(hud);
  const text = { nodeType: 3, parentElement: hud, nodeValue: '0:01 / 0:08' };
  const icon = new (h.feed.constructor)('svg'); tile.append(icon);
  for (let i = 0; i < 100; i++) h.notify(h.feed, [
    h.mutation(hud, 'childList', undefined, { addedNodes: [text], removedNodes: [{ nodeType: 3 }] }),
    h.mutation(text, 'characterData'), h.mutation(icon, 'attributes', 'aria-label'),
    h.mutation(tile, 'attributes', 'data-media-object-url'), h.mutation(h.card('a').querySelector('[data-sauti-action="like"]')),
  ]);
  await h.advance(2000);
  assert.equal(h.clones.length, 0); assert.equal(h.syncs.length, 0); assert.equal(h.slides().length, 0);
});

test('explicit open builds latest canonical rows once and a close/return retains the same slide and video', async () => {
  const h = await harness();
  h.card('a').querySelector('[data-sauti-action="like"]').dataset.active = 'true';
  h.open('a'); await h.advance();
  assert.equal(h.root.hidden, false); assert.equal(h.clones.length, 2);
  const slide = h.slides()[0], video = slide.querySelector('video');
  assert.equal(slide.latestState.like, 'true');
  h.close(); assert.equal(h.root.hidden, true);
  h.open('a'); await h.advance();
  assert.equal(h.slides()[0], slide); assert.equal(slide.querySelector('video'), video);
  assert.equal(h.clones.length, 2);
});

test('a hidden deep-link search paginates without clones, then opens the target once it is admitted', async () => {
  const h = await harness({ posts: ['a'], pathname: '/videos/target', more: true });
  h.open('target');
  assert.equal(h.loadMore.clicks, 1); assert.equal(h.root.hidden, true); assert.equal(h.clones.length, 0);
  const b = h.addPost('b'); h.notify(h.feed, [h.mutation(h.feed, 'childList', undefined, { addedNodes: [b] })]);
  await h.advance(200);
  assert.equal(h.clones.length, 0, 'intermediate pagination must not construct hidden slides');
  await h.advance(900); assert.ok(h.loadMore.clicks >= 2);
  const target = h.addPost('target'); h.notify(h.feed, [h.mutation(h.feed, 'childList', undefined, { addedNodes: [target] })]);
  await h.advance(200);
  assert.equal(h.root.hidden, false);
  assert.equal(h.slides().filter(slide => slide.dataset.postId === 'target').length, 1);
  assert.equal(h.slides().find(slide => slide.classList.contains('active'))?.dataset.postId, 'target');
});

test('end-of-feed state can finish a missing deep link without requiring another card mutation', async () => {
  const h = await harness({ posts: ['a'], pathname: '/videos/missing', more: true });
  h.open('missing'); assert.equal(h.clones.length, 0);
  h.streamMore.hidden = true; h.notify(h.streamMore, [h.mutation(h.streamMore, 'attributes', 'hidden')]);
  await h.advance();
  assert.equal(h.root.hidden, false); assert.equal(h.slides()[0].dataset.postId, 'a');
});

test('navigation or deselecting the pending trigger prevents late pagination from reopening Shorts', async () => {
  for (const change of ['route', 'selection']) {
    const h = await harness({ posts: [], pathname: '/videos/target', more: true });
    h.open('target');
    if (change === 'route') h.navigate('/messages'); else h.tab.setAttribute('aria-selected', 'false');
    const target = h.addPost('target'); h.notify(h.feed, [h.mutation(h.feed, 'childList', undefined, { addedNodes: [target] })]);
    await h.advance(2000);
    assert.equal(h.root.hidden, true, change); assert.equal(h.clones.length, 0, change);
    assert.equal(h.slides().length, 0, change);
  }
});

test('open source actions and readiness sync only their own slide while HUD and icons do no work', async () => {
  const h = await harness(); h.open('a'); await h.advance(); h.syncs.length = 0;
  const source = h.card('a'), like = source.querySelector('[data-sauti-action="like"]'), count = like.querySelector('[data-count-for]');
  like.dataset.active = 'true'; count.textContent = '9';
  const follow = source.querySelector('[data-home-follow]'); follow.dataset.following = 'true'; follow.disabled = true;
  const tile = source.querySelector('.sauti-media-tile'); tile.dataset.mediaObjectUrl = '/api/ready-a';
  h.notify(h.feed, [h.mutation(like), h.mutation(count, 'characterData'),
    h.mutation(follow, 'attributes', 'data-following'), h.mutation(tile, 'attributes', 'data-media-object-url')]);
  await h.advance();
  assert.ok(h.syncs.length > 0); assert.deepEqual([...new Set(h.syncs)], ['a']);
  const slide = h.slides().find(item => item.dataset.postId === 'a');
  assert.deepEqual(slide.latestState, { like: 'true', count: '9', following: 'true', url: '/api/ready-a' });
  assert.equal(h.clones.length, 2);
  h.syncs.length = 0;
  const hud = new (h.feed.constructor)('span'); hud.className = 'sauti-video-time'; tile.append(hud);
  const svg = new (h.feed.constructor)('svg'); hud.append(svg);
  h.notify(h.feed, [h.mutation(hud, 'childList', undefined, { addedNodes: [{ nodeType: 3, parentElement: hud }], removedNodes: [{ nodeType: 3 }] }),
    h.mutation(svg, 'attributes', 'aria-label')]);
  await h.advance(); assert.equal(h.syncs.length, 0); assert.equal(h.clones.length, 2);
});

test('hidden structural pruning releases stale sources and owner hiding clears slides and pending timers', async () => {
  const h = await harness(); h.open('a'); await h.advance();
  const old = h.slides().find(item => item.dataset.postId === 'a'), video = old.querySelector('video'); video.paused = false;
  h.close(); const source = h.card('a'); source.remove();
  h.notify(h.feed, [h.mutation(h.feed, 'childList', undefined, { removedNodes: [source] })]); await h.advance();
  assert.ok(video.pauseCalls > 0); assert.equal(old.isConnected, false); assert.equal(h.clones.length, 2);
  assert.equal(h.slides().some(slide => slide.dataset.postId === 'a'), false);
  const replacement = h.addPost('a');
  h.notify(h.feed, [h.mutation(h.feed, 'childList', undefined, { addedNodes: [replacement] })]); await h.advance();
  assert.equal(h.clones.length, 2, 'new hidden source never creates a slide');
  h.member.hidden = true; h.notify(h.member, [h.mutation(h.member, 'attributes', 'hidden')]);
  assert.equal(h.slides().length, 0); assert.equal(h.timers.size, 0);
  h.member.hidden = false; h.open('a'); await h.advance();
  assert.notEqual(h.slides().find(slide => slide.dataset.postId === 'a'), old);
  assert.equal(old.isConnected, false);

  const pending = await harness({ posts: [], pathname: '/videos/target', more: true }); pending.open('target');
  assert.ok(pending.timers.size > 0);
  pending.member.hidden = true; pending.notify(pending.member, [pending.mutation(pending.member, 'attributes', 'hidden')]);
  assert.equal(pending.timers.size, 0);
  const late = pending.addPost('target'); pending.notify(pending.feed, [pending.mutation(pending.feed, 'childList', undefined, { addedNodes: [late] })]);
  await pending.advance(2000); assert.equal(pending.root.hidden, true); assert.equal(pending.clones.length, 0);
});

test('an atomic same-key source replacement cannot reuse the prior hidden source identity', async () => {
  const h = await harness(); h.open('a'); await h.advance(); h.close();
  const oldSlide = h.slides().find(slide => slide.dataset.postId === 'a'), oldSource = h.card('a');
  oldSource.remove(); const replacement = h.addPost('a');
  h.notify(h.feed, [h.mutation(h.feed, 'childList', undefined, { removedNodes: [oldSource], addedNodes: [replacement] })]);
  await h.advance();
  assert.equal(oldSlide.isConnected, false, 'post/media keys alone must not retain a different source owner/object');
  assert.equal(h.clones.length, 2, 'hidden replacement prunes without constructing new slides');
  h.open('a'); await h.advance();
  assert.notEqual(h.slides().find(slide => slide.dataset.postId === 'a'), oldSlide);
  assert.equal(h.clones.length, 3);
});

test('standalone action-count text and busy/follow attributes synchronize without a structural rebuild', async () => {
  const h = await harness(); h.open('a'); await h.advance();
  const source = h.card('a'), like = source.querySelector('[data-sauti-action="like"]'), count = like.querySelector('[data-count-for]');
  const follow = source.querySelector('[data-home-follow]');
  for (const change of [
    () => { count.textContent = '12'; return h.mutation({ nodeType: 3, parentElement: count, nodeValue: '12' }, 'characterData'); },
    () => { like.dataset.pending = 'true'; return h.mutation(like, 'attributes', 'data-pending'); },
    () => { like.setAttribute('aria-busy', 'true'); return h.mutation(like, 'attributes', 'aria-busy'); },
    () => { follow.disabled = true; return h.mutation(follow, 'attributes', 'disabled'); },
    () => { follow.dataset.following = 'true'; return h.mutation(follow, 'attributes', 'data-following'); },
  ]) {
    h.syncs.length = 0; h.notify(h.feed, [change()]); await h.advance();
    assert.ok(h.syncs.length > 0); assert.deepEqual([...new Set(h.syncs)], ['a']);
    assert.equal(h.clones.length, 2);
  }
  assert.equal(h.slides().find(slide => slide.dataset.postId === 'a').latestState.count, '12');
});
