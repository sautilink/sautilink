import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

// Only the DOM operations used by the actual entity renderer/observer are modeled.
// Every replacement queues a real callback turn, so a self-triggered loop fails.
function domHarness() {
  const observers = [];
  const notify = (target, addedNodes = [], type = 'childList') => {
    for (const observer of observers) {
      if (!observer.root?.contains(target) || !observer.options[type]) continue;
      observer.records.push({ target, addedNodes, type });
    }
  };
  class DomNode {
    constructor(nodeType) { this.nodeType = nodeType; this.childNodes = []; this.parentElement = null; }
    get textContent() { return this.childNodes.map((node) => node.textContent).join(''); }
    set textContent(value) { this.replaceChildren(new TextNode(String(value))); }
    append(...nodes) {
      const added = nodes.flatMap((node) => node.nodeType === 11 ? [...node.childNodes] : [node]);
      added.forEach((node) => { node.parentElement = this instanceof DomElement ? this : null; });
      this.childNodes.push(...added);
      notify(this, added);
    }
    replaceChildren(...nodes) {
      this.childNodes.forEach((node) => { node.parentElement = null; });
      this.childNodes = [];
      this.append(...nodes);
    }
    replaceWith(fragment) {
      const parent = this.parentElement;
      const index = parent.childNodes.indexOf(this);
      const added = fragment.nodeType === 11 ? [...fragment.childNodes] : [fragment];
      added.forEach((node) => { node.parentElement = parent; });
      parent.childNodes.splice(index, 1, ...added);
      this.parentElement = null;
      notify(parent, added);
    }
    contains(node) { return node === this || this.childNodes.some((child) => child.contains(node)); }
    querySelectorAll(selector) {
      return this.childNodes.flatMap((child) => [
        ...(child instanceof DomElement && child.matches(selector) ? [child] : []),
        ...child.querySelectorAll(selector),
      ]);
    }
  }
  class TextNode extends DomNode {
    constructor(value) { super(3); this.value = value; }
    get textContent() { return this.value; }
    set textContent(value) { this.value = String(value); notify(this, [], 'characterData'); }
  }
  class DomElement extends DomNode {
    constructor(tag) {
      super(1); this.tagName = tag.toUpperCase(); this.dataset = {}; this.attributes = {};
      this.className = ''; this.id = '';
      this.classList = { contains: (name) => this.className.split(/\s+/).includes(name) };
    }
    matches(selector) {
      return selector.split(',').some((part) => {
        const simple = part.trim();
        if (simple.startsWith('#')) return this.id === simple.slice(1);
        if (simple.startsWith('.')) return this.classList.contains(simple.slice(1));
        return this.tagName === simple.toUpperCase();
      });
    }
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector); }
    setAttribute(name, value) { this.attributes[name] = value; }
    getAttribute(name) { return this.attributes[name]; }
  }
  const document = new DomNode(9);
  document.documentElement = new DomElement('html');
  document.head = new DomElement('head'); document.body = new DomElement('body');
  document.append(document.documentElement);
  document.documentElement.append(document.head, document.body);
  document.readyState = 'complete';
  document.createElement = (tag) => new DomElement(tag);
  document.createTextNode = (text) => new TextNode(text);
  document.createDocumentFragment = () => new DomNode(11);
  document.getElementById = (id) => document.querySelectorAll(`#${id}`)[0];
  class MutationObserver {
    constructor(callback) { this.callback = callback; this.records = []; observers.push(this); }
    observe(root, options) { this.root = root; this.options = options; }
  }
  const flush = () => {
    let turns = 0;
    while (observers.some((observer) => observer.records.length)) {
      assert.ok(++turns <= 6, 'entity observer must settle without a render loop');
      for (const observer of observers) {
        const records = observer.records.splice(0);
        if (records.length) observer.callback(records);
      }
    }
    return turns;
  };
  return { document, Element: DomElement, Node: { TEXT_NODE: 3 }, MutationObserver, flush };
}

test('actual entity observer restores repainted bio links and settles; profile activity shares safe rendering', async () => {
  const dom = domHarness();
  const oldGlobals = Object.fromEntries(['document', 'Element', 'Node', 'MutationObserver'].map((key) => [key, globalThis[key]]));
  Object.assign(globalThis, dom);
  try {
    const { renderCaptionEntities } = await import('../src/caption-entities.js?dom-regression');
    const bio = document.createElement('p'); bio.id = 'profile-bio';
    const rawBio = 'Follow @cloud_engine and #Habari_Leo; mail help@sautilink.com or https://example.com.';
    bio.textContent = rawBio;
    document.body.append(bio); dom.flush();
    assert.deepEqual(bio.querySelectorAll('a').map((a) => a.textContent), ['@cloud_engine', '#Habari_Leo']);
    assert.equal(bio.textContent, rawBio);
    const firstLink = bio.querySelectorAll('a')[0];
    assert.equal(renderCaptionEntities(bio), false);
    assert.equal(bio.querySelectorAll('a')[0], firstLink);

    // Profile data loaders assign textContent even when the server value is unchanged.
    bio.textContent = rawBio;
    assert.equal(bio.querySelectorAll('a').length, 0);
    assert.ok(dom.flush() <= 2);
    assert.deepEqual(bio.querySelectorAll('a').map((a) => a.href), ['/u/cloud_engine', '/discover?q=%23Habari_Leo']);
    assert.notEqual(bio.querySelectorAll('a')[0], firstLink);

    bio.textContent = 'plain bio'; dom.flush();
    bio.childNodes[0].textContent = 'Now @cloud_engine #Habari_Leo';
    dom.flush();
    assert.equal(bio.querySelectorAll('a').length, 2, 'characterData repaint must also restore entities');

    const source = await readFile(new URL('../src/profile-activity.js', import.meta.url), 'utf8');
    const appendBody = source.slice(source.indexOf('function appendProfileActivityBody('), source.indexOf('function revealProfileActivityMedia('));
    const context = { renderCaptionEntities };
    runInNewContext(`${appendBody}\nthis.appendBody = appendProfileActivityBody;`, context);
    const body = document.createElement('p'); body.className = 'profile-activity-body';
    context.appendBody(body, '**Hello @cloud_engine** #Habari_Leo help@sautilink.com (https://example.com/path?q=a#b).');
    document.body.append(body); dom.flush();
    assert.equal(body.querySelectorAll('strong').length, 1, 'observer must retain applied formatting');
    assert.deepEqual(body.querySelectorAll('a').map((a) => [a.getAttribute('data-caption-entity'), a.textContent, a.href]), [
      ['mention', '@cloud_engine', '/u/cloud_engine'],
      ['hashtag', '#Habari_Leo', '/discover?q=%23Habari_Leo'],
      ['url', 'https://example.com/path?q=a#b', 'https://example.com/path?q=a#b'],
    ]);
    const external = body.querySelectorAll('a').at(-1);
    assert.equal(external.target, '_blank');
    assert.equal(external.rel, 'noopener noreferrer nofollow ugc');
    assert.equal(body.textContent, 'Hello @cloud_engine #Habari_Leo help@sautilink.com (https://example.com/path?q=a#b).');
    assert.equal(renderCaptionEntities(body), false);
    assert.equal(dom.flush(), 0);

    // A nested same-value repaint removes only the link inside the formatted node.
    const strong = body.querySelectorAll('strong')[0];
    strong.textContent = strong.textContent;
    assert.equal(strong.querySelectorAll('a').length, 0);
    dom.flush();
    assert.equal(body.querySelectorAll('a').length, 3);
    assert.equal(body.querySelectorAll('strong')[0], strong, 'nested link repair must preserve the formatted node');
    assert.equal(dom.flush(), 0);

    context.appendBody(body, '**@cloud__engine__** __@foo__ __#Tag__ #__Sauti__');
    dom.flush();
    assert.equal(body.querySelectorAll('strong')[0].textContent, '@cloud__engine__');
    assert.deepEqual(body.querySelectorAll('u').map((node) => node.textContent), ['@foo', '#Tag']);
    assert.deepEqual(body.querySelectorAll('a').map((a) => a.href), [
      '/u/cloud__engine__', '/u/foo', '/discover?q=%23Tag', '/discover?q=%23__Sauti__',
    ], 'formatting must never turn a valid identifier into another profile or tag');
    context.appendBody(body, '__hello @cloud__engine__ world__');
    dom.flush();
    assert.equal(body.querySelectorAll('u')[0].textContent, 'hello @cloud__engine__ world');
    assert.equal(body.querySelectorAll('a')[0].href, '/u/cloud__engine__');

    const preview = document.createElement('p'); preview.className = 'sauti-caption-text';
    preview.dataset.previewCaption = 'Try #Habari_…';
    preview.dataset.fullCaption = 'Try #Habari_Leo today';
    preview.textContent = preview.dataset.previewCaption;
    document.body.append(preview); dom.flush();
    assert.equal(preview.querySelectorAll('a').length, 0, 'a truncated hashtag must not link to the wrong query');
  } finally {
    for (const [key, value] of Object.entries(oldGlobals)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});
