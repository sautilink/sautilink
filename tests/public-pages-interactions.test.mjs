import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const [helpSource, legalSource] = await Promise.all([
  readFile(new URL('../assets/site-pages.js', import.meta.url), 'utf8'),
  readFile(new URL('../assets/legal.js', import.meta.url), 'utf8'),
]);

// These doubles provide events, focus and the DOM properties used by the public
// scripts. They deliberately do not provide filtering, disclosure or theme logic.
class EventTarget {
  listeners = new Map();
  parentNode = null;

  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(callback);
  }

  dispatch(type, properties = {}) {
    const event = {
      type,
      target: this,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      ...properties,
    };
    for (let node = this; node; node = properties.bubbles === false ? null : node.parentNode) {
      event.currentTarget = node;
      for (const callback of node.listeners.get(type) || []) callback(event);
    }
    return event;
  }
}

class Element extends EventTarget {
  constructor(document, tag, attributes = {}, text = '') {
    super();
    this.ownerDocument = document;
    this.tagName = tag.toUpperCase();
    this.attributes = new Map(Object.entries(attributes));
    this.children = [];
    this.dataset = {};
    this.hidden = false;
    this.open = false;
    this.value = '';
    this.tabIndex = 0;
    this.text = text;
    this.scrollCalls = [];
    const classes = new Set((attributes.class || '').split(/\s+/).filter(Boolean));
    this.classList = {
      contains: (name) => classes.has(name),
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      toggle(name, force = !classes.has(name)) {
        if (force) classes.add(name);
        else classes.delete(name);
        return force;
      },
    };
  }

  get id() { return this.getAttribute('id') || ''; }
  get textContent() { return this.text + this.children.map((child) => child.textContent).join(''); }
  set textContent(value) { this.text = String(value); this.children = []; }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }

  append(...children) {
    for (const child of children) {
      child.parentNode = this;
      this.children.push(child);
    }
    return children.at(-1);
  }

  remove() {
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }

  contains(target) {
    for (let node = target; node; node = node.parentNode) if (node === this) return true;
    return false;
  }

  matches(selector) {
    return selector.split(',').some((part) => {
      const exclusions = [...part.matchAll(/:not\(([^)]+)\)/g)].map((match) => match[1]);
      if (exclusions.some((excluded) => this.matches(excluded))) return false;
      part = part.replace(/:not\([^)]+\)/g, '').trim();
      const tag = part.match(/^[a-z][\w-]*/i)?.[0];
      if (tag && this.tagName !== tag.toUpperCase()) return false;
      const classes = [...part.matchAll(/\.([\w-]+)/g)].map((match) => match[1]);
      if (classes.some((name) => !this.classList.contains(name))) return false;
      return [...part.matchAll(/\[([\w-]+)(?:(\^?=)["']?([^\]"']*)["']?)?\]/g)].every(([, name, operator, value]) => {
        if (!this.hasAttribute(name)) return false;
        if (operator === '=') return this.getAttribute(name) === value;
        if (operator === '^=') return this.getAttribute(name).startsWith(value);
        return true;
      });
    });
  }

  closest(selector) {
    for (let node = this; node instanceof Element; node = node.parentNode) {
      if (node.matches(selector)) return node;
    }
    return null;
  }

  querySelectorAll(selector) {
    return this.children.flatMap((child) => [
      ...(child.matches(selector) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }

  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  click() { return this.dispatch('click'); }
  focus() { this.ownerDocument.activeElement = this; this.dispatch('focusin'); }
  scrollIntoView(options) { this.scrollCalls.push({ block: options.block }); }
}

function environment({ hash = '', mobile = false, savedTheme = null, blockedStorage = false } = {}) {
  const document = new EventTarget();
  const node = (tag, attributes, text) => new Element(document, tag, attributes, text);
  document.documentElement = node('html');
  document.documentElement.parentNode = document;
  document.body = document.documentElement.append(node('body', { 'data-public-design': '' }));
  document.activeElement = document.body;
  document.querySelectorAll = (selector) => document.documentElement.querySelectorAll(selector);
  document.querySelector = (selector) => document.querySelectorAll(selector)[0] || null;
  document.getElementById = (id) => {
    const walk = (element) => element.id === id ? element : element.children.map(walk).find(Boolean);
    return walk(document.documentElement) || null;
  };

  const frames = [];
  const window = new EventTarget();
  window.location = { hash };
  window.requestAnimationFrame = (callback) => frames.push(callback);
  window.print = () => {};
  const media = new EventTarget();
  media.matches = mobile;
  window.matchMedia = () => media;
  const observers = [];
  class IntersectionObserver {
    constructor(callback) { this.callback = callback; this.targets = []; observers.push(this); }
    observe(target) { this.targets.push(target); }
    emit(entries) { this.callback(entries); }
  }
  window.IntersectionObserver = IntersectionObserver;
  const storage = new Map(savedTheme ? [['theme', savedTheme]] : []);
  const localStorage = {
    getItem(key) {
      if (blockedStorage) throw new Error('Storage is blocked');
      return storage.get(key) ?? null;
    },
    setItem(key, value) {
      if (blockedStorage) throw new Error('Storage is blocked');
      storage.set(key, value);
    },
  };
  const context = { document, window, localStorage, IntersectionObserver };
  return {
    document, window, node, storage, observers,
    load(source, filename) { runInNewContext(source, context, { filename }); },
    flushFrames() { while (frames.length) frames.shift()(); },
    resizeMobile(matches) { media.matches = matches; media.dispatch('change', { matches }); },
  };
}

function helpPage(options = {}) {
  const env = environment(options);
  const { node, document } = env;
  const search = node('input', { 'data-help-search': '' });
  const clear = node('button', { 'data-faq-clear': '' });
  const count = node('span', { 'data-faq-count': '' });
  const empty = node('p', { 'data-faq-empty': '' });
  const entries = [
    ['overview', 'What is SautiLink?', 'People share posts and conversations.'],
    ['account-access', 'How can I sign in to my account?', 'Use an email code to sign in.'],
    ['account-deletion', 'How do I delete my account?', 'You can cancel deletion during the fourteen day recovery window.'],
    ['rooms', 'What are Rooms?', 'A public or private community space for members.'],
  ];
  const items = entries.map(([id, question, answer]) => {
    const item = node('details', { id, 'data-faq-item': '' });
    item.append(node('summary', {}, question), node('div', {}, answer));
    item.open = (options.initiallyOpen || ['overview']).includes(id);
    return item;
  });
  document.body.append(search, clear, count, empty, ...items);
  env.load(helpSource, 'assets/site-pages.js');
  return {
    ...env, search, clear, count, empty, items,
    enter(value, event = 'input') { search.value = value; search.dispatch(event); },
    visible() { return items.filter((item) => !item.hidden).map((item) => item.id); },
    opened() { return items.filter((item) => item.open).map((item) => item.id); },
  };
}

function legalPage(options = {}) {
  const env = environment(options);
  const { node, document } = env;
  const theme = node('button', { 'data-theme-toggle': '' });
  const themeColor = node('meta', { name: 'theme-color', content: '#060a12' });
  const menu = node('button', { 'data-menu-toggle': '', 'aria-expanded': 'false' });
  const nav = node('div', { 'data-nav-cluster': '' });
  const navLink = nav.append(node('a', { href: '/help' }, 'Help'));
  const outside = node('button', {}, 'Outside navigation');
  const disclosure = node('details', { 'data-toc-disclosure': '' });
  const summary = disclosure.append(node('summary', {}, 'On this page'));
  const sections = ['collection', 'choices'].map((id) => node('section', { id }));
  const links = sections.map((section) => node('a', { 'data-toc-link': '', href: '#' + section.id }, section.id));
  disclosure.append(...links);
  document.body.append(themeColor, theme, nav, menu, outside, disclosure, ...sections);
  env.load(legalSource, 'assets/legal.js');
  return { ...env, theme, themeColor, menu, nav, navLink, outside, disclosure, summary, sections, links };
}

test('Help search finds question text and answer-only text, opens results and announces the count', () => {
  const page = helpPage();
  page.enter('Rooms');
  assert.deepEqual(page.visible(), ['rooms']);
  assert.deepEqual(page.opened(), ['rooms']);
  assert.equal(page.count.textContent, '1 answer for “Rooms”');
  assert.equal(page.empty.hidden, true);

  page.enter('fourteen');
  assert.deepEqual(page.visible(), ['account-deletion']);
  assert.deepEqual(page.opened(), ['account-deletion']);
  assert.equal(page.count.textContent, '1 answer for “fourteen”');

  page.enter('account');
  assert.deepEqual(page.visible(), ['account-access', 'account-deletion']);
  assert.deepEqual(page.opened(), ['account-access', 'account-deletion']);
  assert.equal(page.count.textContent, '2 answers for “account”');
});

test('Help search is case-insensitive and supports multiple terms in any order with extra whitespace', () => {
  const page = helpPage();
  page.enter(' WINDOW \n cancel   FOURTEEN ');
  assert.deepEqual(page.visible(), ['account-deletion']);
  assert.equal(page.items[2].open, true);
  assert.equal(page.clear.hidden, false);
});

test('Clearing repeated searches restores exactly the disclosures open before searching', () => {
  const page = helpPage({ initiallyOpen: ['overview', 'rooms'] });
  page.enter('account');
  page.enter('email');
  page.clear.click();
  assert.equal(page.search.value, '');
  assert.deepEqual(page.visible(), ['overview', 'account-access', 'account-deletion', 'rooms']);
  assert.deepEqual(page.opened(), ['overview', 'rooms']);
  assert.equal(page.count.textContent, '4 answers to help you get started');
  assert.equal(page.clear.hidden, true);
  assert.equal(page.document.activeElement, page.search);
});

test('No-result search exposes the empty state and native search clearing restores all answers', () => {
  const page = helpPage();
  page.enter('nothingmatchesxyz');
  assert.deepEqual(page.visible(), []);
  assert.deepEqual(page.opened(), []);
  assert.equal(page.empty.hidden, false);
  assert.equal(page.count.textContent, '0 answers for “nothingmatchesxyz”');
  page.enter('', 'search');
  assert.equal(page.visible().length, 4);
  assert.deepEqual(page.opened(), ['overview']);
  assert.equal(page.empty.hidden, true);
});

test('Escape clears Help search while retaining keyboard focus in the field', () => {
  const page = helpPage();
  page.search.focus();
  page.enter('account');
  const event = page.search.dispatch('keydown', { key: 'Escape' });
  assert.equal(event.defaultPrevented, true);
  assert.equal(page.search.value, '');
  assert.equal(page.document.activeElement, page.search);
  assert.deepEqual(page.opened(), ['overview']);
});

test('A nested hash-link click reveals a filtered-out answer after clearing the search', () => {
  const page = helpPage();
  page.enter('account');
  const target = page.items[3];
  assert.equal(target.hidden, true);
  const link = page.node('a', { href: '#rooms' });
  const icon = link.append(page.node('span', {}, 'Browse Rooms'));
  page.document.body.append(link);
  icon.click();
  assert.equal(page.search.value, '');
  assert.equal(target.hidden, false);
  assert.equal(target.open, true);
  assert.deepEqual(page.opened(), ['overview', 'rooms']);
  assert.equal(page.visible().length, 4);
  assert.equal(target.scrollCalls.length, 0);
  page.flushFrames();
  assert.deepEqual(target.scrollCalls, [{ block: 'start' }]);
});

test('Initial encoded hashes and later hash changes reveal answers; malformed fragments do not break search', () => {
  const page = helpPage({ hash: '#account%2Ddeletion' });
  assert.equal(page.items[2].open, true);
  page.flushFrames();
  assert.equal(page.items[2].scrollCalls.length, 1);
  page.enter('email');
  page.window.location.hash = '#bad%ZZ';
  assert.doesNotThrow(() => page.window.dispatch('hashchange'));
  assert.equal(page.search.value, 'email');
  page.window.location.hash = '#rooms';
  page.window.dispatch('hashchange');
  assert.equal(page.search.value, '');
  assert.equal(page.items[3].hidden, false);
  assert.equal(page.items[3].open, true);
});

test('Blocked storage still allows theme changes and Escape closes navigation and restores trigger focus', () => {
  const page = legalPage({ blockedStorage: true });
  assert.equal(page.document.documentElement.dataset.theme, 'light');
  assert.equal(page.theme.getAttribute('aria-label'), 'Use dark theme');
  assert.equal(page.themeColor.getAttribute('content'), '#ffffff');
  page.theme.click();
  assert.equal(page.document.documentElement.dataset.theme, 'dark');
  assert.equal(page.theme.getAttribute('aria-pressed'), 'false');
  assert.equal(page.themeColor.getAttribute('content'), '#0b0b0e');

  page.menu.click();
  assert.equal(page.nav.classList.contains('open'), true);
  assert.equal(page.menu.getAttribute('aria-expanded'), 'true');
  page.navLink.focus();
  page.navLink.dispatch('keydown', { key: 'Escape' });
  assert.equal(page.nav.classList.contains('open'), false);
  assert.equal(page.menu.getAttribute('aria-expanded'), 'false');
  assert.equal(page.menu.getAttribute('aria-label'), 'Open navigation');
  assert.equal(page.document.activeElement, page.menu);
});

test('A saved theme is respected and navigation dismisses on links, outside clicks and focus leaving', () => {
  const page = legalPage({ savedTheme: 'dark' });
  assert.equal(page.document.documentElement.dataset.theme, 'dark');
  page.theme.click();
  assert.equal(page.storage.get('theme'), 'light');
  assert.equal(page.theme.getAttribute('aria-pressed'), 'true');
  page.menu.click();
  page.navLink.click();
  assert.equal(page.nav.classList.contains('open'), false);
  page.menu.click();
  page.outside.click();
  assert.equal(page.menu.getAttribute('aria-expanded'), 'false');
  page.menu.click();
  page.outside.focus();
  assert.equal(page.nav.classList.contains('open'), false);
});

test('Contents disclosure responds to viewport changes and exposes exactly one active location', () => {
  const page = legalPage({ mobile: true });
  assert.equal(page.disclosure.open, false);
  assert.equal(page.summary.tabIndex, 0);
  page.disclosure.open = true;
  page.links[0].click();
  assert.equal(page.disclosure.open, false);
  assert.equal(page.links[0].getAttribute('aria-current'), 'location');
  assert.equal(page.links[0].classList.contains('active'), true);

  page.resizeMobile(false);
  assert.equal(page.disclosure.open, true);
  assert.equal(page.summary.tabIndex, -1);
  page.links[1].click();
  assert.equal(page.disclosure.open, true);
  assert.equal(page.links[0].getAttribute('aria-current'), null);
  assert.equal(page.links[0].classList.contains('active'), false);
  assert.equal(page.links[1].getAttribute('aria-current'), 'location');
  page.resizeMobile(true);
  assert.equal(page.disclosure.open, false);
  assert.equal(page.summary.tabIndex, 0);
});

test('Scrolling the document updates the active contents link without leaving stale ARIA markers', () => {
  const page = legalPage();
  assert.equal(page.observers.length, 1);
  assert.deepEqual(page.observers[0].targets, page.sections);
  const observer = page.observers[0];
  observer.emit([{ target: page.sections[0], isIntersecting: true, boundingClientRect: { top: 40 } }]);
  assert.equal(page.links[0].getAttribute('aria-current'), 'location');
  observer.emit([
    { target: page.sections[0], isIntersecting: false, boundingClientRect: { top: -100 } },
    { target: page.sections[1], isIntersecting: true, boundingClientRect: { top: 30 } },
  ]);
  assert.equal(page.links[0].getAttribute('aria-current'), null);
  assert.equal(page.links[0].classList.contains('active'), false);
  assert.equal(page.links[1].getAttribute('aria-current'), 'location');
  assert.equal(page.links[1].classList.contains('active'), true);
});
