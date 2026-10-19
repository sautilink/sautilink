import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const source = await readFile(new URL('../src/member-builtin-color.js', import.meta.url), 'utf8');

function harness({ auth: initialAuth = false } = {}) {
  let auth = initialAuth;
  let document;
  const microtasks = [];
  const observers = [];
  const changes = [];
  const domMutations = [];
  const dataKey = name => name.replace(/^data-/, '').replace(/-([a-z])/g, (_all, letter) => letter.toUpperCase());
  class Event {
    constructor(type, properties = {}) { this.type = type; this.defaultPrevented = false; Object.assign(this, properties); }
    preventDefault() { this.defaultPrevented = true; }
    stopPropagation() { this.stopped = true; }
  }
  class Element {
    constructor(tag) {
      this.tagName = tag.toUpperCase(); this.children = []; this.parentNode = null; this.attributes = new Map(); this.dataset = {}; this.events = new Map(); this._text = '';
      this.style = new Proxy({}, { set: (style, property, value) => {
        if (style[property] !== value && this.isConnected) domMutations.push({ type: 'attributes', target: this, attributeName: 'style' });
        style[property] = value; return true;
      } });
    }
    get textContent() { return this._text; }
    set textContent(value) {
      const next = String(value);
      // Reassigning even identical non-empty text replaces the text node and
      // produces a childList record in the real DOM.
      if ((next || this._text || this.children.length) && this.isConnected) domMutations.push({ type: 'childList', target: this });
      for (const child of this.children) child.parentNode = null;
      this.children = []; this._text = next;
    }
    get hidden() { return this.hasAttribute('hidden'); }
    set hidden(value) { if (value) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); }
    get disabled() { return this.hasAttribute('disabled'); }
    set disabled(value) { if (value) this.setAttribute('disabled', ''); else this.removeAttribute('disabled'); }
    get tabIndex() { return Number(this.getAttribute('tabindex') || '0'); }
    set tabIndex(value) { this.setAttribute('tabindex', String(value)); }
    get htmlFor() { return this.getAttribute('for') || ''; }
    set htmlFor(value) { this.setAttribute('for', value); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); if (this.isConnected) domMutations.push({ type: 'attributes', target: this, attributeName: name }); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    hasAttribute(name) { return this.attributes.has(name); }
    removeAttribute(name) { if (this.attributes.delete(name) && this.isConnected) domMutations.push({ type: 'attributes', target: this, attributeName: name }); }
    append(...nodes) { for (const node of nodes) { node.parentNode = this; this.children.push(node); } if (nodes.length && this.isConnected) domMutations.push({ type: 'childList', target: this }); }
    after(node) { const siblings = this.parentNode.children; siblings.splice(siblings.indexOf(this) + 1, 0, node); node.parentNode = this.parentNode; if (this.isConnected) domMutations.push({ type: 'childList', target: this.parentNode }); }
    remove() { if (this.parentNode) { if (this.isConnected) domMutations.push({ type: 'childList', target: this.parentNode }); this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); } this.parentNode = null; }
    get isConnected() { return this === document?.body || Boolean(this.parentNode?.isConnected); }
    matches(selector) {
      if (selector === 'fieldset[disabled]') return this.tagName === 'FIELDSET' && this.disabled;
      if (selector.startsWith('[data-')) return Object.hasOwn(this.dataset, dataKey(selector.slice(1, -1)));
      if (selector === '[hidden]') return this.hidden;
      if (selector.startsWith('#')) { const [, id, type] = selector.match(/^#([^\[]+)(?:\[type="([^"]+)"\])?$/) || []; return this.id === id && (!type || this.type === type); }
      if (selector.startsWith('.')) return (this.className || '').split(' ').includes(selector.slice(1));
      return this.tagName === selector.toUpperCase();
    }
    closest(selector) { return this.matches(selector) ? this : this.parentNode?.closest(selector) || null; }
    querySelectorAll(selector) { return this.children.flatMap(child => [...(selector.split(', ').some(item => child.matches(item)) ? [child] : []), ...child.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    addEventListener(type, callback) { if (!this.events.has(type)) this.events.set(type, []); this.events.get(type).push(callback); }
    removeEventListener(type, callback) { this.events.set(type, (this.events.get(type) || []).filter(item => item !== callback)); }
    dispatchEvent(event) { event.target ||= this; for (const callback of this.events.get(event.type) || []) callback(event); if (event.bubbles && !event.stopped) this.parentNode?.dispatchEvent(event); return !event.defaultPrevented; }
    fire(type, options) { const event = new Event(type, options); this.dispatchEvent(event); return event; }
    focus() { document.activeElement = this; }
  }
  class HTMLInputElement extends Element {
    constructor() { super('input'); this._value = ''; }
    get value() { return this._value; }
    set value(value) { this._value = this.type === 'color' ? (/^#[0-9a-f]{6}$/i.test(value) ? String(value).toLowerCase() : '#000000') : String(value); }
  }
  document = { readyState: 'complete', createElement: tag => tag === 'input' ? new HTMLInputElement() : new Element(tag) };
  document.body = new Element('body');
  document.body.classList = { contains: name => name === 'auth-entry' && auth };
  document.querySelectorAll = selector => document.body.querySelectorAll(selector);
  document.getElementById = id => document.body.querySelector(`#${id}`);
  const listeners = new Map();
  document.addEventListener = (event, callback) => { if (!listeners.has(event)) listeners.set(event, []); listeners.get(event).push(callback); };
  const member = new Element('main'); member.id = 'member-view';
  const fieldset = new Element('fieldset');
  const label = new Element('label');
  const input = new HTMLInputElement(); input.type = 'color'; input.id = 'messages-custom-color'; input.name = 'chat-color'; input.value = '#e9e5df';
  input.addEventListener('input', () => changes.push({ type: 'input', value: input.value }));
  input.addEventListener('change', () => changes.push({ type: 'change', value: input.value }));
  label.append(input); fieldset.append(label); member.append(fieldset); document.body.append(member);
  class MutationObserver { constructor(callback) { this.callback = callback; observers.push(this); } observe() {} }
  const window = { HTMLInputElement };
  runInNewContext(source, { window, document, MutationObserver, queueMicrotask: callback => microtasks.push(callback), Event });
  return {
    input, member, fieldset, label, changes, domMutations, document, api: window.SautiMemberColor,
    node: selector => document.body.querySelector(selector),
    setAuth: value => { auth = value; window.SautiMemberColor.refresh(); },
    reset(value) { input._value = value; for (const callback of listeners.get('reset') || []) callback(); while (microtasks.length) microtasks.shift()(); },
    mutate(target, attributeName) { for (const observer of observers) observer.callback([{ target, type: 'attributes', attributeName }]); while (microtasks.length) microtasks.shift()(); },
  };
}

test('custom color palette updates the original native value and existing input/change listeners', () => {
  const h = harness();
  const trigger = h.node('.sl-color-trigger');
  assert.equal(h.input.name, 'chat-color');
  assert.equal(h.input.disabled, false);
  assert.equal(h.input.tabIndex, -1);
  assert.equal(h.input.getAttribute('aria-hidden'), 'true');
  assert.equal(h.label.htmlFor, trigger.id, 'the original label opens the built-in editor');
  trigger.fire('click');
  assert.equal(h.node('.sl-color-panel').hidden, false);
  const swatches = h.node('.sl-color-palette').querySelectorAll('button');
  swatches[1].fire('click');
  assert.equal(h.input.value, '#f4dce4');
  assert.deepEqual(h.changes, [{ type: 'input', value: '#f4dce4' }, { type: 'change', value: '#f4dce4' }]);
  assert.equal(swatches[1].getAttribute('aria-pressed'), 'true');
  assert.equal(h.node('.sl-color-value').textContent, '#F4DCE4');
});

test('valid hex and sliders save through the native input; invalid hex cannot change saved color', () => {
  const h = harness();
  const hex = h.node('.sl-color-hex');
  hex.value = 'ff0088'; hex.fire('change');
  assert.equal(h.input.value, '#ff0088');
  assert.equal(hex.getAttribute('aria-invalid'), null);
  hex.value = 'wrong'; hex.fire('change');
  assert.equal(h.input.value, '#ff0088');
  assert.equal(hex.getAttribute('aria-invalid'), 'true');
  assert.equal(h.node('.sl-color-error').hidden, false);
  const sliders = h.node('.sl-color-sliders').querySelectorAll('input');
  [120, 100, 50].forEach((value, index) => { sliders[index].value = value; });
  sliders[0].fire('input');
  assert.equal(h.input.value, '#00ff00');
  assert.equal(hex.getAttribute('aria-invalid'), null);
  assert.equal(h.node('.sl-color-error').hidden, true);
});

test('programmatic appearance updates and form resets immediately refresh the custom editor', () => {
  const h = harness();
  h.input.value = '#123456';
  assert.equal(h.node('.sl-color-value').textContent, '#123456');
  assert.equal(h.node('.sl-color-hex').value, '#123456');
  assert.equal(h.changes.length, 0, 'presentational synchronization does not save a second time');
  h.reset('#abcdef');
  assert.equal(h.node('.sl-color-value').textContent, '#ABCDEF');
  assert.equal(h.node('.sl-color-hex').value, '#abcdef');
});

test('disabled fields, Escape and auth transitions preserve native control state', () => {
  const h = harness();
  const trigger = h.node('.sl-color-trigger');
  trigger.fire('click');
  const escape = h.node('.sl-color').fire('keydown', { key: 'Escape' });
  assert.equal(escape.defaultPrevented, true);
  assert.equal(escape.stopped, true);
  assert.equal(h.node('.sl-color-panel').hidden, true);
  assert.equal(h.document.activeElement, trigger);
  h.fieldset.disabled = true;
  h.mutate(h.fieldset, 'disabled');
  assert.equal(trigger.disabled, true);
  assert.equal(h.node('.sl-color-hex').disabled, true);
  h.setAuth(true);
  assert.equal(h.node('.sl-color'), null);
  assert.equal(h.input.getAttribute('aria-hidden'), null);
  assert.equal(h.input.getAttribute('tabindex'), null);
  assert.equal(h.label.getAttribute('for'), null);
  assert.equal(Object.hasOwn(h.input, 'value'), false, 'native property descriptor is restored');
  assert.equal(h.input.value, '#e9e5df');
  h.setAuth(false);
  assert.ok(h.node('.sl-color'));
});

test('auth entry never receives a custom color control', () => {
  const h = harness({ auth: true });
  assert.equal(h.node('.sl-color'), null);
  assert.equal(h.input.getAttribute('aria-hidden'), null);
  assert.equal(h.input.getAttribute('tabindex'), null);
});

test('repeated color refreshes produce no DOM mutations after each state settles', () => {
  const h = harness();
  const unchangedRefresh = state => {
    h.domMutations.length = 0;
    for (let index = 0; index < 5; index++) h.api.refresh();
    assert.equal(h.domMutations.length, 0, `${state}: color refresh must not restart another presentation observer`);
  };
  unchangedRefresh('initial color');

  h.input.value = '#123456';
  assert.ok(h.domMutations.length > 0, 'a new color does update the visible editor');
  unchangedRefresh('programmatically changed color');

  h.fieldset.disabled = true;
  h.api.refresh();
  assert.ok(h.domMutations.some(record => record.attributeName === 'disabled'));
  unchangedRefresh('disabled fieldset');

  h.fieldset.hidden = true;
  h.api.refresh();
  assert.equal(h.node('.sl-color').hidden, true);
  unchangedRefresh('hidden control ancestor');

  // Check that the trace models the browser's equal-value attribute and text
  // writes, which caused the cross-observer refresh loop this guards against.
  const output = h.node('.sl-color-value');
  output.textContent = output.textContent;
  output.setAttribute('aria-live', 'polite');
  output.setAttribute('aria-live', 'polite');
  assert.equal(h.domMutations.length, 3);
});
