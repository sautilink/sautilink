import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { resolve } from 'node:path';

const source = await readFile(process.env.PUBLIC_SELECT_SOURCE ? resolve(process.env.PUBLIC_SELECT_SOURCE) : new URL('../assets/public-select.js', import.meta.url), 'utf8');

// Native form/selection semantics and event propagation are kept in this small
// DOM harness. Tests execute the shipped adapter, including its native setters.
function harness({ auth = false } = {}) {
  const microtasks = [];
  const observers = new Set();
  const mutationRecords = [];
  let mutationQueued = false;
  let document;
  const queue = (callback) => microtasks.push(callback);
  function mutation(target, type = 'childList', attributeName) {
    mutationRecords.push({ target, type, attributeName });
    if (mutationQueued) return;
    mutationQueued = true;
    queue(() => {
      mutationQueued = false;
      const pending = mutationRecords.splice(0);
      for (const observer of observers) observer.callback(pending);
    });
  }
  class Event {
    constructor(type, init = {}) { this.type = type; this.bubbles = init.bubbles || false; Object.assign(this, init); }
    preventDefault() { this.defaultPrevented = true; }
    stopPropagation() { this.propagationStopped = true; }
  }
  class Element {
    constructor(tag) {
      this.tagName = tag.toUpperCase(); this.localName = tag; this.nodeType = 1;
      this.parentNode = null; this.children = []; this.attributes = new Map(); this.listeners = new Map();
      this.style = {}; this._text = ''; this.scrollHeight = 240;
      this.dataset = new Proxy({}, {
        get: (_target, key) => this.getAttribute(`data-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`),
        set: (_target, key, value) => { this.setAttribute(`data-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`, value); return true; },
      });
      this.classList = {
        contains: (name) => this.className.split(/\s+/).includes(name),
        add: (...names) => this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '),
        remove: (...names) => this.className = this.className.split(/\s+/).filter((name) => !names.includes(name)).join(' '),
        toggle: (name, enabled) => enabled ? this.classList.add(name) : this.classList.remove(name),
      };
    }
    get id() { return this.getAttribute('id') || ''; } set id(value) { this.setAttribute('id', value); }
    get name() { return this.getAttribute('name') || ''; } set name(value) { this.setAttribute('name', value); }
    get className() { return this.getAttribute('class') || ''; } set className(value) { this.setAttribute('class', value); }
    get title() { return this.getAttribute('title') || ''; }
    get hidden() { return this.hasAttribute('hidden'); } set hidden(value) { value ? this.setAttribute('hidden', '') : this.removeAttribute('hidden'); }
    get disabled() { return this.hasAttribute('disabled'); } set disabled(value) { value ? this.setAttribute('disabled', '') : this.removeAttribute('disabled'); }
    get required() { return this.hasAttribute('required'); } set required(value) { value ? this.setAttribute('required', '') : this.removeAttribute('required'); }
    get tabIndex() { return Number(this.getAttribute('tabindex') || 0); } set tabIndex(value) { this.setAttribute('tabindex', value); }
    get parentElement() { return this.parentNode?.nodeType === 1 ? this.parentNode : null; }
    get isConnected() { return document.contains(this); }
    get textContent() { return this._text + this.children.map((child) => child.textContent).join(''); }
    set textContent(value) { this._text = String(value); for (const child of this.children) child.parentNode = null; this.children = []; mutation(this); }
    get form() { return this.closest('form'); }
    get validity() { return { valid: !this.required || Boolean(this.value) }; }
    get willValidate() { return ['input', 'select', 'textarea'].includes(this.localName) && !this.disabled && !this.closest('fieldset[disabled]'); }
    get value() { return this._value ?? this.getAttribute('value') ?? ''; } set value(value) { this._value = String(value); }
    get validationMessage() { return this.validity.valid ? '' : 'Please fill out this field.'; }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    hasAttribute(name) { return this.attributes.has(name); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); mutation(this, 'attributes', name); }
    removeAttribute(name) { if (this.attributes.delete(name)) mutation(this, 'attributes', name); }
    contains(node) { return this === node || this.children.some((child) => child.contains(node)); }
    append(...nodes) { for (const node of nodes) { node.remove(); node.parentNode = this; this.children.push(node); mutation(this); } }
    before(node) { const parent = this.parentNode; node.remove(); const index = parent.children.indexOf(this); node.parentNode = parent; parent.children.splice(index, 0, node); mutation(parent); }
    after(node) { const parent = this.parentNode; node.remove(); const index = parent.children.indexOf(this); node.parentNode = parent; parent.children.splice(index + 1, 0, node); mutation(parent); }
    remove() { if (!this.parentNode) return; const parent = this.parentNode; parent.children.splice(parent.children.indexOf(this), 1); this.parentNode = null; mutation(parent); }
    replaceChildren(...nodes) { this.textContent = ''; this.append(...nodes); }
    matches(selector) {
      return selector.split(',').some((part) => {
        part = part.trim();
        const not = [...part.matchAll(/:not\(([^)]+)\)/g)].map((match) => match[1]);
        if (not.some((excluded) => this.matches(excluded))) return false;
        part = part.replace(/:not\([^)]+\)/g, '');
        if (part === ':disabled') return this.disabled || Boolean(this.parentElement?.closest('fieldset[disabled]'));
        const tag = part.match(/^[a-z][\w-]*/i)?.[0];
        if (tag && this.localName !== tag) return false;
        for (const [, id] of part.matchAll(/#([\w-]+)/g)) if (this.id !== id) return false;
        for (const [, name] of part.matchAll(/\.([\w-]+)/g)) if (!this.classList.contains(name)) return false;
        for (const [, name, op, raw] of part.matchAll(/\[([\w-]+)(?:([\^]?=)"?([^\]"]+)"?)?\]/g)) {
          if (!this.hasAttribute(name)) return false;
          if (op === '=' && this.getAttribute(name) !== raw) return false;
          if (op === '^=' && !this.getAttribute(name).startsWith(raw)) return false;
        }
        return true;
      });
    }
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
    querySelectorAll(selector) { return this.children.flatMap((child) => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    cloneNode(deep = false) { const copy = new Element(this.localName); copy.attributes = new Map(this.attributes); copy._text = this._text; if (deep) copy.append(...this.children.map((child) => child.cloneNode(true))); return copy; }
    addEventListener(type, callback, options = {}) { const events = this.listeners.get(type) || []; events.push({ callback, capture: options === true || options.capture === true }); this.listeners.set(type, events); }
    removeEventListener(type, callback) { this.listeners.set(type, (this.listeners.get(type) || []).filter((entry) => entry.callback !== callback)); }
    dispatchEvent(event) {
      event.target ||= this;
      const path = []; for (let node = this; node; node = node.parentNode) path.push(node);
      const call = (target, capture) => { for (const handler of target.listeners.get(event.type) || []) if (handler.capture === capture) handler.callback.call(target, event); };
      for (const target of [...path].reverse()) call(target, true);
      for (const target of path) { call(target, false); if (!event.bubbles || event.propagationStopped) break; }
      return !event.defaultPrevented;
    }
    focus() { document.activeElement = this; this.dispatchEvent(new Event('focus')); this.dispatchEvent(new Event('focusin', { bubbles: true })); }
    click() { if (!this.disabled) this.dispatchEvent(new Event('click', { bubbles: true })); }
    getBoundingClientRect() { return { top: 100, bottom: 144, left: 10, right: 250, width: 240, height: 44 }; }
    getClientRects() { return this.closest('[hidden]') ? [] : [this.getBoundingClientRect()]; }
    scrollIntoView() { this.scrolled = true; }
    showPopover() { this.popoverOpen = true; }
    hidePopover() { this.popoverOpen = false; }
  }
  class Option extends Element {
    constructor() { super('option'); this.selected = false; }
    get value() { return this.getAttribute('value') ?? this.textContent; } set value(value) { this.setAttribute('value', value); }
    get label() { return this.getAttribute('label') || this.textContent; }
  }
  class Select extends Element {
    constructor() { super('select'); this._none = false; }
    get multiple() { return this.hasAttribute('multiple'); }
    get size() { return Number(this.getAttribute('size') || 0); }
    get options() { return this.querySelectorAll('option'); }
    get selectedIndex() { const index = this.options.findIndex((option) => option.selected); return index >= 0 ? index : this._none || !this.options.length ? -1 : 0; }
    set selectedIndex(value) { this.options.forEach((option, index) => option.selected = index === Number(value)); this._none = Number(value) < 0; }
    get selectedOptions() { return this.selectedIndex >= 0 ? [this.options[this.selectedIndex]] : []; }
    get value() { return this.selectedOptions[0]?.value || ''; }
    set value(value) { this.selectedIndex = this.options.findIndex((option) => option.value === String(value)); }
    get labels() { const label = this.closest('label'); return label ? [label] : []; }
  }
  class Form extends Element {
    constructor() { super('form'); }
    get elements() { return this.querySelectorAll('select,input,textarea,button'); }
    checkValidity() { let valid = true; for (const field of this.querySelectorAll('select,input,textarea')) if (!field.disabled && !field.validity.valid) { valid = false; field.dispatchEvent(new Event('invalid')); } return valid; }
    reportValidity() { return Form.prototype.checkValidity.call(this); }
    reset() { this.dispatchEvent(new Event('reset', { bubbles: true })); this.querySelectorAll('select').forEach((select) => select.selectedIndex = 0); }
  }
  document = new Element('document'); document.nodeType = 9; document.readyState = 'complete';
  document.documentElement = new Element('html'); document.documentElement.clientWidth = 390;
  document.body = new Element('body'); document.append(document.documentElement); document.documentElement.append(document.body);
  document.createElement = (tag) => tag === 'select' ? new Select() : tag === 'option' ? new Option() : tag === 'form' ? new Form() : new Element(tag);
  document.createElementNS = (_namespace, tag) => new Element(tag);
  document.getElementById = (id) => document.querySelector(`#${id}`);
  const node = (tag, attrs = {}, parent = document.body) => { const result = document.createElement(tag); for (const [name, value] of Object.entries(attrs)) result.setAttribute(name, value); parent.append(result); return result; };
  if (!auth) document.body.setAttribute('data-public-selects', '');
  const member = node('section', { id: 'member-view' });
  const form = node('form', {}, member);
  const label = node('label', {}, form); node('strong', {}, label).textContent = 'Audience';
  const select = node('select', { id: 'sauti-audience', name: 'audience', 'aria-label': 'Post audience' }, label);
  for (const [value, text] of [['public', 'Public'], ['followers', 'Followers'], ['private', 'Private']]) { const option = node('option', { value }, select); option.textContent = text; }
  const signup = node('section', { id: 'auth-view', 'data-public-select-skip': '' });
  const authSelect = node('select', { id: 'signup-phone-channel' }, signup); node('option', { value: 'sms' }, authSelect).textContent = 'SMS';
  const window = new Element('window'); document.parentNode = window; window.innerHeight = 700; window.HTMLSelectElement = Select;
  const context = { window, document, Event, queueMicrotask: queue, Date, MutationObserver: class { constructor(callback) { this.callback = callback; } observe() { observers.add(this); } } };
  runInNewContext(source, context);
  function flush() { for (let turns = 0; microtasks.length; turns++) { if (turns > 1000) throw new Error('Presentation mutation loop'); microtasks.shift()(); } }
  flush();
  const trigger = () => select.parentElement.querySelector('[role="combobox"]');
  const key = (value, init = {}) => { const event = new Event('keydown', { key: value, bubbles: true, ...init }); trigger().dispatchEvent(event); flush(); return event; };
  return { document, window, node, member, form, select, authSelect, trigger, key, flush, Event };
}

test('native field identity, values and events survive custom pointer and keyboard selection', () => {
  const h = harness();
  const original = h.select;
  const calls = [];
  h.select.addEventListener('input', () => calls.push(['input', h.select.value]));
  h.select.addEventListener('change', () => calls.push(['change', h.select.value]));
  assert.equal(h.select.name, 'audience');
  assert.equal(h.select.form, h.form);
  assert.equal(h.select.getAttribute('aria-hidden'), 'true');
  assert.equal(h.authSelect.getAttribute('data-sl-native-select'), null);
  h.trigger().click(); h.flush();
  assert.equal(h.trigger().getAttribute('aria-expanded'), 'true');
  h.document.querySelectorAll('[role="option"]')[1].click(); h.flush();
  assert.equal(h.select, original);
  assert.equal(h.select.value, 'followers');
  assert.deepEqual(calls, [['input', 'followers'], ['change', 'followers']]);
  assert.equal(h.trigger().getAttribute('aria-label'), 'Post audience: Followers');
  h.key('End'); h.key('Enter');
  assert.equal(h.select.value, 'private');
  h.key('Home'); h.key('Enter');
  assert.equal(h.select.value, 'public');
});

test('silent native assignments, disabled groups, dynamic options and form reset stay synchronized', () => {
  const h = harness();
  h.select.value = 'followers';
  assert.equal(h.trigger().textContent, 'Followers');
  h.select.selectedIndex = 2;
  assert.equal(h.trigger().textContent, 'Private');
  const option = h.node('option', { value: 'circle' }, h.select); option.textContent = 'Circle'; h.flush();
  const group = h.node('optgroup', { label: 'Unavailable', disabled: '' }, h.select);
  const disabled = h.node('option', { value: 'staff' }, group); disabled.textContent = 'Staff'; h.flush();
  h.key('End'); h.key('Enter');
  assert.equal(h.select.value, 'circle', 'End skips the disabled optgroup');
  h.form.reset(); h.flush();
  assert.equal(h.select.value, 'public');
  assert.equal(h.trigger().textContent, 'Public');
  h.select.disabled = true; h.flush();
  assert.equal(h.trigger().disabled, true);
});

test('Escape, outside pointer, tab and typed search preserve focus and cancellation', () => {
  const h = harness();
  h.select.closest('label').querySelector('strong').click(); h.flush();
  assert.equal(h.trigger().getAttribute('aria-expanded'), 'true', 'label activation uses the built-in menu');
  h.key('Escape');
  h.key('f');
  assert.match(h.trigger().getAttribute('aria-activedescendant'), /option-1$/);
  h.key('Escape');
  assert.equal(h.select.value, 'public');
  assert.equal(h.document.activeElement, h.trigger());
  h.key('Enter');
  h.document.body.dispatchEvent(new h.Event('pointerdown', { bubbles: true })); h.flush();
  assert.equal(h.trigger().getAttribute('aria-expanded'), 'false');
  h.key('Enter'); h.key('Tab');
  assert.equal(h.trigger().getAttribute('aria-expanded'), 'false');
  assert.equal(h.document.querySelector('[role="listbox"]'), null);
  h.key('Enter'); h.form.hidden = true; h.flush();
  assert.equal(h.document.querySelector('[role="listbox"]'), null, 'a hidden feature cannot leave an orphan menu');
});

test('public validation is inline while passive readiness checks and auth remain unchanged', () => {
  const h = harness();
  const placeholder = h.node('option', { value: '' }, h.select); placeholder.textContent = 'Choose';
  h.select.required = true; h.select.value = ''; h.flush();
  assert.equal(h.form.checkValidity(), false); h.flush();
  assert.equal(h.document.querySelector('.sl-field-error'), null, 'readiness check does not show errors');
  assert.equal(h.form.reportValidity(), false); h.flush();
  assert.equal(h.document.querySelector('.sl-field-error').textContent, 'Please fill out this field.');
  assert.equal(h.document.activeElement, h.trigger());
  h.select.value = 'followers'; h.select.dispatchEvent(new h.Event('change', { bubbles: true })); h.flush();
  assert.equal(h.document.querySelector('.sl-field-error'), null);
  const preserved = h.select;
  h.document.body.removeAttribute('data-public-selects'); h.window.SautiPublicSelects.refresh(); h.flush();
  assert.equal(h.select, preserved);
  assert.equal(h.select.getAttribute('aria-hidden'), null);
  assert.equal(Object.hasOwn(h.select, 'value'), false);
  assert.equal(Object.hasOwn(h.form, 'checkValidity'), false);
  assert.equal(h.document.querySelector('[role="combobox"]'), null);
  assert.equal(harness({ auth: true }).trigger(), null);
});

test('custom options join their parent modal and preserve required/form metadata', () => {
  const h = harness();
  const modal = h.node('dialog', { open: '' });
  modal.append(h.form); h.flush();
  h.select.required = true; h.flush();
  h.trigger().click(); h.flush();
  const listbox = h.document.querySelector('[role="listbox"]');
  assert.equal(listbox.closest('dialog'), modal);
  assert.equal(listbox.parentElement.popoverOpen, true);
  assert.equal(h.select.required, true);
  assert.equal(h.select.form, h.form);
  assert.ok(Number.parseInt(listbox.parentElement.style.width, 10) <= 366);
  modal.removeAttribute('open'); h.flush();
  assert.equal(h.document.querySelector('[role="listbox"]'), null, 'closing a parent modal also removes its popup');
});

test('feature code can remove or move native fields without restoring stale wrappers', () => {
  const h = harness();
  const movedForm = h.node('form', {}, h.member);
  movedForm.append(h.select); h.flush();
  assert.equal(h.select.form, movedForm);
  assert.equal(h.document.querySelectorAll('[role="combobox"]').length, 1);
  assert.equal(h.form.querySelector('[role="combobox"]'), null);
  h.select.remove(); h.flush();
  assert.equal(h.select.isConnected, false, 'presentation must not resurrect a removed feature field');
  assert.equal(h.document.querySelector('[role="combobox"]'), null);
  assert.equal(Object.hasOwn(h.select, 'value'), false);
});


test('search uses native option codes, ranks exact codes first and preserves IME composition', () => {
  const h = harness();
  for (let i = 0; i < 20; i++) { const o = h.node('option', { value: `C${i}` }, h.select); o.textContent = `Country ${i}`; }
  h.node('option', { value: 'CH' }, h.select).textContent = 'Switzerland';
  h.node('option', { value: 'TZ' }, h.select).textContent = 'Tanzania';
  h.flush(); h.trigger().click(); h.flush();
  const search = h.document.querySelector('.sl-select-search');
  assert.equal(h.document.activeElement, search);
  search.value = 'tz'; search.dispatchEvent(new h.Event('input', { bubbles: true })); h.flush();
  assert.equal(h.document.querySelectorAll('[role="option"]')[0].textContent, 'Tanzania');
  search.dispatchEvent(new h.Event('keydown', { key: 'Enter', isComposing: true, bubbles: true })); h.flush();
  assert.equal(h.select.value, 'public');
  assert.equal(h.trigger().getAttribute('aria-expanded'), 'true');
  search.dispatchEvent(new h.Event('keydown', { key: 'Enter', bubbles: true })); h.flush();
  assert.equal(h.select.value, 'TZ');
});

test('search Tab restores the original trigger before native tab navigation', () => {
  const h = harness();
  h.select.setAttribute('data-public-select-search', '');
  h.trigger().click(); h.flush();
  const search = h.document.querySelector('.sl-select-search');
  search.dispatchEvent(new h.Event('keydown', { key: 'Tab', bubbles: true })); h.flush();
  assert.equal(h.document.activeElement, h.trigger());
  assert.equal(h.document.querySelector('.sl-select-menu'), null);
});

test('validation keeps an earlier invalid text field focused', () => {
  const h = harness();
  const input = h.node('input', { required: '' }, h.form);
  h.select.closest('label').before(input);
  const placeholder = h.node('option', { value: '' }, h.select); placeholder.textContent = 'Choose';
  h.select.required = true; h.select.value = ''; h.flush();
  input.focus();
  assert.equal(h.form.reportValidity(), false); h.flush();
  assert.equal(h.document.activeElement, input);
});

test('associated label text changes refresh the accessible name', () => {
  const h = harness();
  h.select.removeAttribute('aria-label'); h.flush();
  h.select.closest('label').querySelector('strong').textContent = 'Post visibility'; h.flush();
  assert.equal(h.trigger().getAttribute('aria-label'), 'Post visibility: Public');
});

test('explicit refresh reflects batched native option.selected mutations without firing client events', () => {
  const h = harness(); const events = [];
  h.select.addEventListener('change', () => events.push('change'));
  h.select.options.forEach((option, i) => option.selected = i === 2);
  h.window.SautiPublicSelects.refresh(); h.flush();
  assert.equal(h.trigger().textContent, 'Private');
  assert.deepEqual(events, []);
});
