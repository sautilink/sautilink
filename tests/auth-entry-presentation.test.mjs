import assert from 'node:assert/strict';
import test from 'node:test';
import { installAuthEntryPresentation } from '../src/auth-entry-presentation.js';

// DOM doubles supply tree, event and focus primitives only. Panel transitions
// below stand in for the existing auth controller; the presentation module
// itself must never perform them or edit form values.
class Element {
  constructor(root, tag, attributes = {}, text = '') {
    this.root = root;
    this.tag = tag;
    this.attributes = new Map(Object.entries(attributes));
    this.dataset = {};
    this.children = [];
    this.listeners = new Map();
    this.parentNode = null;
    this.hidden = false;
    this.text = text;
    this.type = attributes.type || '';
    this.value = '';
    this.tabIndex = 0;
    for (const [key, value] of Object.entries(attributes)) {
      if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
    }
  }
  get id() { return this.attributes.get('id') || ''; }
  get textContent() { return this.text + this.children.map((child) => child.textContent).join(''); }
  set textContent(value) { this.text = String(value); this.children = []; }
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  removeAttribute(key) { this.attributes.delete(key); }
  append(...items) { items.forEach((item) => { item.parentNode = this; this.children.push(item); }); }
  contains(item) { for (let node = item; node; node = node.parentNode) if (node === this) return true; return false; }
  matches(selector) {
    if (selector.startsWith('.')) return (this.getAttribute('class') || '').split(' ').includes(selector.slice(1));
    if (selector.startsWith('[')) return this.attributes.has(selector.slice(1, -1));
    return this.tag === selector;
  }
  querySelectorAll(selector) {
    const parts = selector.split(' ');
    return this.children.flatMap((child) => [
      ...(child.matches(parts.at(-1)) && (parts.length === 1 || child.parentNode?.matches(parts[0])) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(callback);
  }
  dispatch(type, properties = {}) {
    const event = { type, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...properties };
    for (let node = this; node; node = node.parentNode) {
      event.currentTarget = node;
      for (const callback of node.listeners.get(type) || []) callback(event);
    }
    return event;
  }
  click() { this.dispatch('click'); }
  focus() { this.root.activeElement = this; }
}

function fixture(mode = 'login') {
  const observers = [];
  const root = {
    getElementById(id) {
      const search = (node) => node.id === id ? node : node.children.map(search).find(Boolean);
      return search(this.body) || null;
    },
    defaultView: { MutationObserver: class { constructor(callback) { this.callback = callback; observers.push(this); } observe(node, options) { this.node = node; this.options = options; } } },
  };
  const node = (tag, attrs = {}, text = '') => new Element(root, tag, attrs, text);
  root.body = node('body');
  root.body.dataset.authMode = mode;
  root.activeElement = root.body;
  const view = node('section', { id: 'auth-view' });
  const intro = node('div', { class: 'auth-intro' });
  const title = node('h2', {}, 'Initial title');
  const copy = node('p', {}, 'Initial description');
  intro.append(title, copy);
  const steps = ['details', 'verification', 'profile'].map((step) => node('li', { 'data-auth-step': step }));
  const tabs = node('div', { id: 'auth-tabs' });
  const loginTab = node('button', { id: 'login-tab', 'aria-selected': String(mode === 'login') });
  const signupTab = node('button', { id: 'signup-tab', 'aria-selected': String(mode === 'signup') });
  tabs.append(loginTab, signupTab);
  root.body.append(view);
  view.append(intro, ...steps, tabs);
  const panels = {};
  const createPanel = (id) => {
    const panel = node('section', { id });
    const heading = node('div', { class: 'form-heading' });
    heading.append(node('h2', {}, id));
    panel.append(heading);
    panel.hidden = true;
    view.append(panel);
    panels[id] = panel;
    return panel;
  };
  for (const id of ['login-panel', 'signup-panel', 'verify-panel', 'signup-phone-panel', 'passwordless-panel', 'recovery-panel', 'password-panel', 'onboarding-panel']) createPanel(id);
  const activate = (id) => {
    for (const panel of Object.values(panels)) panel.hidden = panel.id !== id;
    tabs.hidden = !['login-panel', 'signup-panel'].includes(id);
    if (!tabs.hidden) {
      loginTab.setAttribute('aria-selected', String(id === 'login-panel'));
      signupTab.setAttribute('aria-selected', String(id === 'signup-panel'));
    }
  };
  const password = node('input', { id: 'login-password', type: 'password' });
  password.value = 'a password that must stay unchanged';
  const reveal = node('button', { 'data-password-toggle': 'login-password', 'aria-pressed': 'false' }, 'Show');
  panels['login-panel'].append(password, reveal);
  const newPassword = node('input', { id: 'new-password', type: 'password' });
  const newReveal = node('button', { 'data-password-toggle': 'new-password', 'aria-pressed': 'false' }, 'Show');
  panels['password-panel'].append(newPassword, newReveal);
  const otp = node('input', { id: 'signup-verify-code' });
  otp.value = '01234567';
  panels['verify-panel'].append(otp);
  let navigations = 0;
  loginTab.addEventListener('click', () => { navigations++; activate('login-panel'); });
  signupTab.addEventListener('click', () => { navigations++; activate('signup-panel'); });
  activate(`${mode}-panel`);
  return { root, node, view, title, copy, steps, tabs, loginTab, signupTab, panels, password, reveal, newPassword, newReveal, otp, activate, createPanel, observers,
    flush() { observers.forEach((observer) => observer.callback([])); },
    get navigations() { return navigations; },
  };
}

test('initial signup presentation preserves fields, visibility and focus and installs only once', () => {
  const f = fixture('signup');
  const visible = Object.entries(f.panels).filter(([, panel]) => !panel.hidden).map(([id]) => id);
  installAuthEntryPresentation(f.root);
  installAuthEntryPresentation(f.root);
  assert.equal(f.observers.length, 1);
  assert.equal(f.tabs.listeners.get('keydown').length, 1);
  assert.equal(f.title.textContent, 'Create your SautiLink account');
  assert.equal(f.copy.textContent, 'Join SautiLink and set up your account.');
  assert.equal(f.view.dataset.presentationMode, 'signup');
  assert.equal(f.root.body.dataset.authMode, 'signup');
  assert.equal(f.steps[0].getAttribute('aria-current'), 'step');
  assert.equal(f.loginTab.tabIndex, -1);
  assert.equal(f.signupTab.tabIndex, 0);
  assert.equal(f.root.activeElement, f.root.body);
  assert.equal(f.password.value, 'a password that must stay unchanged');
  assert.equal(f.otp.value, '01234567');
  assert.deepEqual(Object.entries(f.panels).filter(([, panel]) => !panel.hidden).map(([id]) => id), visible);
  assert.equal(f.navigations, 0);
});

test('arrow, Home and End keys use the existing tab actions and retain keyboard focus', () => {
  const f = fixture();
  installAuthEntryPresentation(f.root);
  for (const [from, key, to, mode] of [
    [f.loginTab, 'ArrowRight', f.signupTab, 'signup'],
    [f.signupTab, 'ArrowRight', f.loginTab, 'login'],
    [f.loginTab, 'ArrowLeft', f.signupTab, 'signup'],
    [f.signupTab, 'Home', f.loginTab, 'login'],
    [f.loginTab, 'End', f.signupTab, 'signup'],
  ]) {
    const event = from.dispatch('keydown', { key });
    f.flush();
    assert.equal(event.defaultPrevented, true);
    assert.equal(f.root.activeElement, to);
    assert.equal(to.tabIndex, 0);
    assert.equal(f.view.dataset.presentationMode, mode);
    assert.equal(f.panels[`${mode}-panel`].hidden, false);
  }
  const count = f.navigations;
  assert.equal(f.signupTab.dispatch('keydown', { key: 'ArrowLeft', ctrlKey: true }).defaultPrevented, false);
  assert.equal(f.signupTab.dispatch('keydown', { key: 'Tab' }).defaultPrevented, false);
  f.password.dispatch('keydown', { key: 'ArrowRight' });
  assert.equal(f.navigations, count);
});

test('panel changes follow actual visibility, move stranded focus and respect real OTP autofocus', () => {
  const f = fixture();
  installAuthEntryPresentation(f.root);
  f.password.focus();
  f.activate('recovery-panel');
  f.flush();
  assert.equal(f.view.dataset.presentationMode, 'recovery');
  assert.equal(f.title.textContent, 'Get back to your account.');
  assert.equal(f.root.body.dataset.authMode, 'login', 'core-owned state is not rewritten');
  assert.equal(f.root.activeElement, f.panels['recovery-panel'].querySelector('h2'));
  assert.equal(f.root.activeElement.tabIndex, -1);
  assert.ok(f.steps.every((item) => item.getAttribute('aria-current') === null));
  f.activate('verify-panel');
  f.otp.focus();
  f.flush();
  assert.equal(f.root.activeElement, f.otp);
  assert.equal(f.otp.value, '01234567');
  assert.equal(f.steps[1].getAttribute('aria-current'), 'step');
  f.activate('signup-phone-panel');
  f.flush();
  assert.equal(f.view.dataset.presentationMode, 'signupPhone');
  assert.equal(f.steps[1].getAttribute('aria-current'), 'step');
  f.activate('onboarding-panel');
  f.flush();
  assert.equal(f.steps[2].getAttribute('aria-current'), 'step');
});

test('a dynamically inserted phone panel is recognized even when tab and body mode stay on login', () => {
  const f = fixture();
  installAuthEntryPresentation(f.root);
  const panel = f.createPanel('whatsapp-login-panel');
  const phone = f.node('input', { id: 'whatsapp-login-phone', type: 'tel', placeholder: '+2557XXXXXXXX' });
  phone.value = '+254700000000';
  panel.append(phone);
  f.activate('whatsapp-login-panel');
  f.flush();
  assert.equal(f.root.body.dataset.authMode, 'login');
  assert.equal(f.loginTab.getAttribute('aria-selected'), 'true');
  assert.equal(f.view.dataset.presentationMode, 'phone');
  assert.equal(f.title.textContent, 'Sign in with your phone.');
  assert.equal(phone.getAttribute('placeholder'), 'Include country code');
  assert.equal(phone.value, '+254700000000');
  assert.ok(f.steps.every((item) => item.getAttribute('aria-current') === null));
  assert.ok(f.observers[0].options.childList && f.observers[0].options.subtree);
});

test('accessible password action labels follow the original toggle without changing password values', () => {
  const f = fixture();
  installAuthEntryPresentation(f.root);
  assert.equal(f.reveal.getAttribute('aria-label'), 'Show password');
  assert.equal(f.newReveal.getAttribute('aria-label'), 'Show new password');
  f.password.type = 'text';
  f.reveal.textContent = 'Hide';
  f.reveal.setAttribute('aria-pressed', 'true');
  f.newPassword.type = 'text';
  f.flush();
  assert.equal(f.reveal.getAttribute('aria-label'), 'Hide password');
  assert.equal(f.newReveal.getAttribute('aria-label'), 'Hide new password');
  assert.equal(f.reveal.getAttribute('aria-pressed'), 'true');
  assert.equal(f.password.value, 'a password that must stay unchanged');
  f.password.type = 'password';
  f.flush();
  assert.equal(f.reveal.getAttribute('aria-label'), 'Show password');
});

test('hidden account views do not take focus when the member app is active', () => {
  const f = fixture();
  installAuthEntryPresentation(f.root);
  const memberControl = f.node('button');
  f.root.body.append(memberControl);
  memberControl.focus();
  f.view.hidden = true;
  f.activate('recovery-panel');
  f.flush();
  assert.equal(f.root.activeElement, memberControl);
  assert.equal(f.view.dataset.presentationMode, 'login');
  f.view.hidden = false;
  f.flush();
  assert.equal(f.root.activeElement, memberControl);
});

test('pages without the account view need no presentation setup', () => {
  assert.doesNotThrow(() => installAuthEntryPresentation({ getElementById() { return null; } }));
});
