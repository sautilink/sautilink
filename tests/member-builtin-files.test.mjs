import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const source = await readFile(new URL('../src/member-builtin-files.js', import.meta.url), 'utf8');

// Exercise the actual enhancer against native-input identities and event state.
// A file list can only be changed by the simulated browser, never the adapter.
function harness({ auth = false } = {}) {
  const microtasks = [];
  const observers = [];
  let doc;
  class Node {
    constructor(tag) {
      this.tagName = tag.toUpperCase(); this.children = []; this.parentNode = null;
      this.attributes = new Map(); this.listeners = new Map(); this.style = {};
      this.textContent = ''; this.labels = []; this._files = []; this.nativeClicks = 0;
      this.classList = {
        contains: (name) => this.className.split(/\s+/).includes(name),
        add: (name) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), name])].join(' '); },
        remove: (name) => { this.className = this.className.split(/\s+/).filter((item) => item !== name).join(' '); },
      };
    }
    get className() { return this.getAttribute('class') || ''; }
    set className(value) { this.setAttribute('class', value); }
    get id() { return this.getAttribute('id') || ''; }
    set id(value) { this.setAttribute('id', value); }
    get hidden() { return this.attributes.has('hidden'); }
    set hidden(value) { if (value) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); }
    get disabled() { return this.attributes.has('disabled'); }
    set disabled(value) { if (value) this.setAttribute('disabled', ''); else this.removeAttribute('disabled'); }
    get multiple() { return this.attributes.has('multiple'); }
    set multiple(value) { if (value) this.setAttribute('multiple', ''); else this.removeAttribute('multiple'); }
    get accept() { return this.getAttribute('accept') || ''; }
    set accept(value) { this.setAttribute('accept', value); }
    get type() { return this.getAttribute('type') || ''; }
    set type(value) { this.setAttribute('type', value); }
    get files() { return this._files; }
    set files(_value) { throw new Error('The presentation must not assign input.files'); }
    get isConnected() { return this === doc.body || doc.body.contains(this); }
    getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    removeAttribute(name) { this.attributes.delete(name); }
    contains(node) { return this.children.some((child) => child === node || child.contains(node)); }
    append(...nodes) {
      for (const node of nodes) {
        if (node.parentNode) node.parentNode.children.splice(node.parentNode.children.indexOf(node), 1);
        node.parentNode = this; this.children.push(node);
      }
    }
    before(node) {
      const parent = this.parentNode;
      if (node.parentNode) node.parentNode.children.splice(node.parentNode.children.indexOf(node), 1);
      parent.children.splice(parent.children.indexOf(this), 0, node); node.parentNode = parent;
    }
    replaceWith(node) {
      const parent = this.parentNode;
      if (node.parentNode) node.parentNode.children.splice(node.parentNode.children.indexOf(node), 1);
      parent.children.splice(parent.children.indexOf(this), 1, node); node.parentNode = parent; this.parentNode = null;
    }
    remove() { if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; }
    closest(selector) {
      for (let node = this; node; node = node.parentNode) {
        if (selector.split(',').some((part) => {
          part = part.trim();
          return part === '[hidden]' ? node.hidden : part.startsWith('#') && node.id === part.slice(1);
        })) return node;
      }
      return null;
    }
    matches(selector) {
      if (selector !== ':disabled') throw new Error(`Unexpected selector ${selector}`);
      for (let node = this; node; node = node.parentNode) if (node.disabled && (node === this || node.tagName === 'FIELDSET')) return true;
      return false;
    }
    addEventListener(name, callback) {
      if (!this.listeners.has(name)) this.listeners.set(name, new Set());
      this.listeners.get(name).add(callback);
    }
    removeEventListener(name, callback) { this.listeners.get(name)?.delete(callback); }
    emit(name) { for (const callback of this.listeners.get(name) || []) callback({ target: this }); }
    click() { if (!this.disabled) { if (this.type === 'file') this.nativeClicks++; this.emit('click'); } }
  }
  doc = {
    body: new Node('body'), readyState: 'complete', listeners: new Map(),
    createElement: (tag) => new Node(tag), createElementNS: (_namespace, tag) => new Node(tag),
    all() { const visit = (node) => [node, ...node.children.flatMap(visit)]; return visit(this.body); },
    getElementById(id) { return this.all().find((node) => node.id === id) || null; },
    querySelectorAll(selector) {
      assert.equal(selector, 'input[type="file"]');
      return this.all().filter((node) => node.tagName === 'INPUT' && node.type === 'file');
    },
    addEventListener(name, callback) { this.listeners.set(name, callback); },
  };
  const member = new Node('main'); member.id = 'member-view'; doc.body.append(member);
  const authView = new Node('section'); authView.id = 'auth-view'; doc.body.append(authView);
  if (auth) doc.body.classList.add('auth-entry');
  const form = new Node('form'); member.append(form);
  const input = new Node('input'); input.id = 'room-cover-file'; input.type = 'file'; input.accept = 'image/jpeg,image/png,image/webp';
  input.setAttribute('name', 'cover'); input.setAttribute('required', ''); input.setAttribute('capture', 'environment');
  const label = new Node('label'); label.textContent = 'Cover photo'; input.labels = [label]; form.append(input);
  const window = { getComputedStyle: (node) => ({ display: node.style.display || 'inline-block', visibility: node.style.visibility || 'visible' }) };
  runInNewContext(source, {
    window, document: doc, queueMicrotask: (callback) => microtasks.push(callback),
    MutationObserver: class { constructor(callback) { observers.push(callback); } observe() {} },
  });
  const field = () => input.parentNode.classList.contains('sl-file') ? input.parentNode : null;
  const trigger = () => field()?.children.find((node) => node.tagName === 'BUTTON');
  const summary = () => field()?.children.find((node) => node.classList.contains('sl-file-summary'));
  const flush = () => { let count = 0; while (microtasks.length) { assert.ok(count++ < 10, 'bounded refresh queue'); microtasks.shift()(); } };
  return { doc, member, authView, form, input, window, Node, field, trigger, summary, flush, mutate: () => { observers.forEach((callback) => callback()); flush(); } };
}

test('branded upload preserves original file input, form participation and trusted chooser trigger', () => {
  const h = harness();
  assert.equal(h.input.parentNode, h.field());
  assert.equal(h.field().parentNode, h.form);
  assert.equal(h.input.getAttribute('name'), 'cover');
  assert.equal(h.input.getAttribute('required'), '');
  assert.equal(h.input.getAttribute('capture'), 'environment');
  assert.equal(h.input.accept, 'image/jpeg,image/png,image/webp');
  assert.equal(h.trigger().getAttribute('aria-label'), 'Choose photo: Cover photo');
  assert.equal(h.input.getAttribute('tabindex'), '-1');
  h.trigger().click();
  assert.equal(h.input.nativeClicks, 1);
  assert.equal(h.summary().textContent, 'No file chosen');
});

test('actual input change updates filenames and preserves existing feature listeners', () => {
  const h = harness(); let changes = 0;
  h.input.addEventListener('change', () => changes++);
  const files = [{ name: 'Coast <summer>.png', size: 1024 }];
  h.input._files = files; h.input.emit('change');
  assert.equal(h.summary().textContent, 'Coast <summer>.png');
  assert.equal(h.input.files, files);
  assert.equal(changes, 1);
  h.input.multiple = true; h.input.accept = '.pdf,application/pdf'; h.window.SautiMemberFiles.refresh();
  assert.equal(h.trigger().getAttribute('aria-label'), 'Choose files: Cover photo');
  h.input._files = [...files, { name: 'Project.pdf' }]; h.input.emit('change');
  assert.equal(h.summary().textContent, 'Coast <summer>.png, Project.pdf');
});

test('dynamic disabled fieldsets and hidden input state reach the visible trigger', () => {
  const h = harness(); const fieldset = new h.Node('fieldset');
  h.form.append(fieldset); fieldset.append(h.field()); fieldset.disabled = true; h.mutate();
  assert.equal(h.trigger().disabled, true);
  h.trigger().click(); assert.equal(h.input.nativeClicks, 0);
  fieldset.disabled = false; h.mutate(); assert.equal(h.trigger().disabled, false);
  h.input.hidden = true; h.mutate(); assert.equal(h.field().hidden, true);
  h.input.hidden = false; h.mutate(); assert.equal(h.field().hidden, false);
});

test('member-to-auth transition restores native input attributes and selected files', () => {
  const h = harness({ auth: true });
  assert.equal(h.field(), null);
  h.input.setAttribute('tabindex', '3'); h.input.setAttribute('aria-hidden', 'false');
  h.input.classList.add('existing-upload'); const files = [{ name: 'cover.webp' }]; h.input._files = files;
  h.doc.body.classList.remove('auth-entry'); h.mutate(); assert.ok(h.field());
  h.doc.body.classList.add('auth-entry'); h.mutate();
  assert.equal(h.input.parentNode, h.form); assert.equal(h.field(), null);
  assert.equal(h.input.getAttribute('tabindex'), '3'); assert.equal(h.input.getAttribute('aria-hidden'), 'false');
  assert.equal(h.input.className, 'existing-upload'); assert.equal(h.input.files, files);
  h.doc.body.classList.remove('auth-entry'); h.member.hidden = true; h.mutate(); assert.equal(h.field(), null);
});

test('hidden composer inputs and auth inputs remain unchanged while new Room fields are enhanced', () => {
  const h = harness();
  const hidden = new h.Node('input'); hidden.type = 'file'; hidden.hidden = true; h.form.append(hidden);
  const auth = new h.Node('input'); auth.type = 'file'; h.authView.append(auth);
  const dynamic = new h.Node('input'); dynamic.type = 'file'; dynamic.setAttribute('aria-label', 'New Room cover'); h.form.append(dynamic);
  h.mutate();
  assert.equal(hidden.parentNode, h.form); assert.equal(hidden.getAttribute('tabindex'), null);
  assert.equal(auth.parentNode, h.authView); assert.equal(auth.getAttribute('aria-hidden'), null);
  assert.equal(dynamic.parentNode.className, 'sl-file');
  assert.equal(dynamic.parentNode.children[1].getAttribute('aria-label'), 'Choose file: New Room cover');
});

test('form reset refreshes the filename without synthesizing or changing native files', () => {
  const h = harness(); h.input._files = [{ name: 'before.png' }]; h.input.emit('change');
  h.doc.listeners.get('reset')({ target: h.form }); h.input._files = []; h.flush();
  assert.equal(h.summary().textContent, 'No file chosen');
  h.window.SautiMemberFiles.refresh(); assert.equal(h.form.children.length, 1);
});

test('teardown never resurrects a file input removed or moved by the feature renderer', () => {
  const h = harness(); const wrapper = h.field();
  h.input.remove(); h.mutate();
  assert.equal(h.input.parentNode, null);
  assert.equal(wrapper.parentNode, null);
  assert.equal(h.form.children.length, 0);
  const moved = harness(); const previous = moved.field();
  const other = new moved.Node('section'); moved.member.append(other); other.append(moved.input);
  moved.doc.body.classList.add('auth-entry'); moved.mutate();
  assert.equal(moved.input.parentNode, other);
  assert.equal(previous.parentNode, null);
});
