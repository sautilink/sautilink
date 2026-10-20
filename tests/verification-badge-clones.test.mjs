import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { afterEach, beforeEach } from 'node:test';
import { createInlineVerificationSvg, refreshClonedVerificationSvgs } from '../src/verification-inline-svg.js';

const [drawerSource, shortVideosSource, appSource] = await Promise.all(
  ['mobile-more-drawer.js', 'short-videos-feed.js', 'app.js'].map(async (file) =>
    (await readFile(new URL(`../src/${file}`, import.meta.url), 'utf8')).replaceAll('\r\n', '\n')),
);

// Only the DOM operations used by the real SVG creator and clone functions.
class Element {
  constructor(tagName = 'span') {
    this.tagName = tagName;
    this.attributes = new Map();
    this.childNodes = [];
    this.parentNode = null;
    this.ownText = '';
    this.dataset = new Proxy({}, {
      get: (_, key) => this.getAttribute(`data-${String(key).replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`),
      set: (_, key, value) => {
        this.setAttribute(`data-${String(key).replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`, value);
        return true;
      },
    });
    this.classList = {
      contains: (name) => (this.getAttribute('class') || '').split(/\s+/).includes(name),
      remove: (name) => this.setAttribute('class', (this.getAttribute('class') || '').split(/\s+/).filter((item) => item !== name).join(' ')),
      toggle: (name, enabled) => {
        const names = new Set((this.getAttribute('class') || '').split(/\s+/).filter(Boolean));
        if (enabled ?? !names.has(name)) names.add(name);
        else names.delete(name);
        this.setAttribute('class', [...names].join(' '));
      },
    };
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  get id() { return this.getAttribute('id') || ''; }
  set id(value) { this.setAttribute('id', value); }
  get textContent() { return this.ownText + this.childNodes.map((node) => node.textContent).join(''); }
  set textContent(value) { this.replaceChildren(); this.ownText = String(value); }
  append(...nodes) {
    for (const node of nodes) {
      node.parentNode = this;
      this.childNodes.push(node);
    }
  }
  replaceChildren(...nodes) {
    this.childNodes.forEach((node) => { node.parentNode = null; });
    this.childNodes = [];
    this.ownText = '';
    this.append(...nodes);
  }
  replaceWith(node) {
    if (!this.parentNode) return;
    const parent = this.parentNode;
    parent.childNodes[parent.childNodes.indexOf(this)] = node;
    node.parentNode = parent;
    this.parentNode = null;
  }
  cloneNode(deep = false) {
    const clone = new Element(this.tagName);
    this.attributes.forEach((value, key) => clone.setAttribute(key, value));
    clone.ownText = this.ownText;
    if (deep) clone.append(...this.childNodes.map((node) => node.cloneNode(true)));
    return clone;
  }
  matches(selector) {
    return selector.split(',').some((part) => {
      const chain = part.trim().split(/\s+/);
      const simple = chain.pop();
      const tag = simple.match(/^[\w-]+/)?.[0];
      if (tag && this.tagName !== tag) return false;
      for (const [, name] of simple.matchAll(/\.([\w-]+)/g)) if (!this.classList.contains(name)) return false;
      for (const [, name, value] of simple.matchAll(/\[([^\]=]+)(?:="([^"]*)")?\]/g)) {
        if (this.getAttribute(name) === null || (value !== undefined && this.getAttribute(name) !== value)) return false;
      }
      if (!chain.length) return true;
      for (let ancestor = this.parentNode; ancestor; ancestor = ancestor.parentNode) {
        if (ancestor.matches(chain.join(' '))) return true;
      }
      return false;
    });
  }
  querySelectorAll(selector) {
    return this.childNodes.flatMap((node) => [
      ...(node.matches(selector) ? [node] : []), ...node.querySelectorAll(selector),
    ]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}

let previousDocument;
beforeEach(() => {
  previousDocument = globalThis.document;
  globalThis.document = {
    documentElement: { dataset: { theme: 'light' } },
    createElementNS: (_, tag) => new Element(tag),
  };
});
afterEach(() => {
  if (previousDocument === undefined) delete globalThis.document;
  else globalThis.document = previousDocument;
});

// Execute the actual small callers without booting the app or its services.
function extractFunction(source, name, scope) {
  const match = source.match(new RegExp(`^( *)function ${name}\\(`, 'm'));
  assert.ok(match, `${name} exists`);
  const end = source.indexOf(`\n${match[1]}}`, match.index) + match[1].length + 2;
  return Function(...Object.keys(scope), `${source.slice(match.index, end)}; return ${name};`)(...Object.values(scope));
}

const expectedStops = [
  ['21.00%', '#fa1f56'], ['29.30%', '#fa2255'], ['38.09%', '#fa3c50'], ['45.41%', '#fb4d4d'],
  ['53.71%', '#fa6049'], ['62.50%', '#fb7d42'], ['72.75%', '#fb8f3e'], ['78.12%', '#fb873f'],
];

function badge(type = 'team', theme = 'light') {
  const wrapper = new Element('button');
  wrapper.setAttribute('class', 'verification-badge is-verified');
  wrapper.setAttribute('aria-label', 'Verified SautiLink Team');
  wrapper.setAttribute('aria-haspopup', 'dialog');
  wrapper.setAttribute('data-verification-badge-type', type);
  wrapper.append(createInlineVerificationSvg(type, theme));
  return wrapper;
}

function assertTeamGradient(root) {
  const svg = root.querySelector('svg');
  assert.equal(svg.getAttribute('data-sautilink-verification-vector'), 'team');
  const gradient = svg.querySelector('linearGradient');
  assert.ok(gradient.id, 'each team SVG owns a gradient ID');
  assert.equal(svg.querySelector('path').getAttribute('fill'), `url(#${gradient.id})`, 'fill resolves within its own SVG');
  assert.deepEqual(gradient.querySelectorAll('stop').map((stop) => [stop.getAttribute('offset'), stop.getAttribute('stop-color')]), expectedStops);
  return gradient.id;
}

test('repairing stripped and namespaced team clones keeps every gradient local and unique across repeated refreshes', () => {
  const source = badge();
  const seen = new Set([assertTeamGradient(source)]);
  const copies = Array.from({ length: 3 }, () => source.cloneNode(true));
  copies[0].querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
  copies[1].querySelectorAll('[id]').forEach((node) => { node.id = `menu-page-${node.id}`; });
  assert.equal(copies[0].querySelector('linearGradient').id, '');
  assert.notEqual(copies[1].querySelector('path').getAttribute('fill'), `url(#${copies[1].querySelector('linearGradient').id})`);
  for (let round = 0; round < 3; round += 1) {
    for (const copy of copies) {
      const wrapperAttributes = [...copy.attributes];
      refreshClonedVerificationSvgs(copy);
      const id = assertTeamGradient(copy);
      assert.equal(seen.has(id), false, 'new IDs never reuse a source, sibling or previous refresh ID');
      seen.add(id);
      assert.deepEqual([...copy.attributes], wrapperAttributes, 'account status and accessible wrapper stay intact');
    }
    assertTeamGradient(source);
  }
});

test('refresh preserves light blue and dark white standard artwork even when the document theme differs', () => {
  for (const theme of ['light', 'dark']) {
    const wrapper = badge('standard', theme);
    const attributes = [...wrapper.attributes];
    document.documentElement.dataset.theme = theme === 'light' ? 'dark' : 'light';
    refreshClonedVerificationSvgs(wrapper);
    const svg = wrapper.querySelector('svg');
    const path = svg.querySelector('path');
    assert.equal(svg.getAttribute('data-sautilink-verification-vector'), `standard-${theme}`);
    assert.equal(path.getAttribute('fill'), theme === 'light' ? '#28a9e3' : '#ffffff');
    assert.equal(path.getAttribute('stroke'), theme === 'dark' ? '#30aaf0' : null);
    assert.equal(path.getAttribute('stroke-width'), theme === 'dark' ? '5' : null);
    assert.equal(path.getAttribute('stroke-linejoin'), theme === 'dark' ? 'round' : null);
    assert.equal(svg.querySelector('linearGradient'), null);
    assert.deepEqual([...wrapper.attributes], attributes);
  }
});

test('Short Videos clones repair the stripped gradient without changing the verified source or wrapper', () => {
  const cloneVerificationBadge = extractFunction(shortVideosSource, 'cloneVerificationBadge', { refreshClonedVerificationSvgs });
  const card = new Element('article');
  const head = new Element('div');
  head.setAttribute('class', 'sauti-card-head');
  const source = badge();
  head.append(source);
  card.append(head);
  const clone = cloneVerificationBadge(card);
  assert.notEqual(clone, source);
  assert.deepEqual([...clone.attributes], [...source.attributes]);
  assert.notEqual(assertTeamGradient(clone), assertTeamGradient(source));
  assert.equal(cloneVerificationBadge(new Element('article')), null);
});

test('Menu namespacing repairs gradients while preserving the menu accessibility references', () => {
  const namespaceMenuCloneIds = extractFunction(appSource, 'namespaceMenuCloneIds', { refreshClonedVerificationSvgs });
  const source = badge();
  const menu = new Element('section');
  const clone = source.cloneNode(true);
  clone.id = 'rail-verified-badge';
  clone.setAttribute('aria-describedby', 'verification-help');
  const help = new Element('span');
  help.id = 'verification-help';
  menu.append(clone, help);
  namespaceMenuCloneIds(menu);
  assert.equal(clone.id, 'menu-page-rail-verified-badge');
  assert.equal(clone.getAttribute('aria-describedby'), 'menu-page-verification-help');
  assert.equal(help.id, 'menu-page-verification-help');
  assert.equal(clone.getAttribute('aria-label'), source.getAttribute('aria-label'));
  assert.notEqual(assertTeamGradient(clone), assertTeamGradient(source));
});

test('mobile drawer safe clones and both identity badges retain valid, independent gradients and verified status', () => {
  const replaceWithSafeClones = extractFunction(drawerSource, 'replaceWithSafeClones', { Element, refreshClonedVerificationSvgs });
  const source = badge();
  const sourceName = new Element('strong');
  sourceName.textContent = 'Team';
  sourceName.append(source);
  const target = new Element('strong');
  assert.equal(replaceWithSafeClones(target, sourceName), true);
  const safeId = assertTeamGradient(target);
  assert.notEqual(safeId, assertTeamGradient(source));

  const names = ['drawerAvatar', 'drawerName', 'drawerUsername', 'memberStatus', 'memberStatusIcon', 'memberStatusLabel', 'verificationButton', 'verificationCopy'];
  const nodes = Object.fromEntries(names.map((name) => [name, new Element()]));
  nodes.verificationButton.append(new Element('strong'));
  const sourceAvatar = new Element();
  sourceAvatar.append(new Element('span'));
  const sourceUsername = new Element('small');
  sourceUsername.textContent = '@team';
  const syncIdentity = extractFunction(drawerSource, 'syncIdentity', {
    ...nodes, Element, refreshClonedVerificationSvgs, replaceWithSafeClones,
    memberVerificationBadge: () => source,
    document: { getElementById: (id) => ({ 'rail-name': sourceName, 'rail-avatar': sourceAvatar, 'rail-username': sourceUsername })[id] },
  });
  syncIdentity();
  const ids = [assertTeamGradient(source), safeId, assertTeamGradient(nodes.drawerName), assertTeamGradient(nodes.memberStatusIcon)];
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(nodes.memberStatus.classList.contains('is-verified'), true);
  assert.equal(nodes.memberStatusLabel.textContent, 'Verified SautiLinker');
  for (const parent of [nodes.drawerName, nodes.memberStatusIcon]) {
    assert.deepEqual([...parent.querySelector('.verification-badge').attributes], [...source.attributes]);
  }
});

test('all clone modules import the shared SVG repair implementation', () => {
  for (const source of [drawerSource, shortVideosSource, appSource]) {
    assert.match(source, /import\s*\{[^}]*\brefreshClonedVerificationSvgs\b[^}]*\}\s*from '\.\/verification-inline-svg\.js'/);
  }
});
