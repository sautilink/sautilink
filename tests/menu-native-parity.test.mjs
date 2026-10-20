import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const source = await read('src/mobile-more-drawer.js');

function menuHarness() {
  let writes = 0;
  class Element {
    constructor(tag = 'div') {
      this.tagName = tag; this.children = []; this.parentNode = null; this.dataset = {};
      this.attributes = new Map(); this.copy = ''; this.hidden = false; this.disabled = false;
      this.classes = new Set(); this.classList = { add: (...items) => { items.forEach((item) => this.classes.add(item)); writes += 1; } };
    }
    set className(value) { this.classes = new Set(value.split(' ')); }
    get className() { return [...this.classes].join(' '); }
    get textContent() { return this.copy + this.children.map((child) => child.textContent).join(''); }
    set textContent(value) { this.copy = value; this.children = []; writes += 1; }
    set innerHTML(value) {
      this.children = []; this.copy = '';
      if (value.includes('<svg')) {
        const svg = new Element('svg');
        svg.dataset.slIconName = value.match(/data-sl-icon-name="([^"]+)"/)?.[1];
        this.append(svg);
      }
    }
    setAttribute(key, value) { this.attributes.set(key, value); writes += 1; }
    getAttribute(key) { return this.attributes.get(key) ?? null; }
    set href(value) { this.setAttribute('href', value); }
    get href() { return this.getAttribute('href'); }
    hasAttribute(key) { return this.attributes.has(key); }
    append(...children) {
      children.forEach((child) => {
        if (child.parentNode) child.parentNode.children = child.parentNode.children.filter((node) => node !== child);
        child.parentNode = this; this.children.push(child);
      });
      writes += 1;
    }
    replaceChildren(...children) { this.children = []; this.copy = ''; this.append(...children); }
    querySelector(selector) {
      if (this.queryMap?.[selector]) return this.queryMap[selector];
      return selector === ':scope > svg' ? this.children.find((child) => child.tagName === 'svg')
        : selector === 'span' ? this.children.find((child) => child.tagName === 'span') : null;
    }
    querySelectorAll(selector) { return this.queryAllMap?.[selector] || []; }
  }
  const makeControl = (label, view = '', href = '') => {
    const control = new Element(href ? 'a' : 'button');
    if (view) control.dataset.memberView = view;
    if (href) control.setAttribute('href', href);
    const svg = new Element('svg');
    svg.dataset.slHugeIcon = view === 'circles' ? 'user-group' : 'user';
    const caption = new Element('span'); caption.textContent = label;
    control.append(svg, caption); control.onclick = () => label;
    return control;
  };
  const profile = makeControl('Profile', 'profile');
  const rooms = makeControl('Rooms', 'circles');
  const moderation = makeControl('Moderation', 'moderation'); moderation.hidden = true;
  const compose = makeControl('Create Post'); compose.setAttribute('data-open-sauti-composer', ''); compose.disabled = true;
  const support = makeControl('WhatsApp Support', '', 'https://wa.me/255629145502');
  support.setAttribute('target', '_blank'); support.setAttribute('rel', 'noopener noreferrer');
  const cloud = makeControl('Cloud Engine', '', 'https://cloudengine.sautilink.com');
  const router = makeControl('Router Setup Gateway', '', 'https://router.sautilink.com');
  const avatar = new Element('span'); avatar.dataset.menuSourceId = 'rail-avatar';
  const identity = new Element('span'); identity.textContent = 'Confirmed Name';
  const signout = makeControl(''); signout.dataset.menuSourceId = 'signout-button';
  const controls = [profile, rooms, moderation, compose, support, cloud, router];
  const rail = new Element();
  rail.queryMap = {
    '[data-member-view="profile"]': profile, '[data-menu-source-id="rail-avatar"]': avatar,
    '.rail-account-copy': identity, '[data-menu-source-id="signout-button"]': signout,
  };
  rail.queryAllMap = {
    '.primary-rail-systems .nav-item': [cloud, router],
    '.nav-item, [data-open-sauti-composer]': controls,
  };
  rail.append(...controls, avatar, identity, signout);
  const prefix = source.slice(0, source.indexOf('function ensureMobileDrawerStylesheet('));
  const helpers = source.slice(source.indexOf('function menuHeading('), source.indexOf('function canonicalViewButton('));
  const enhance = runInNewContext(`${prefix}\n${helpers}\nenhanceNativeMenuClone;`, {
    document: { createElement: (tag) => new Element(tag), createTextNode: (text) => ({ textContent: text }) },
  });
  return { enhance: () => enhance(rail), rail, profile, rooms, moderation, compose, support, cloud, router,
    avatar, identity, signout, get writes() { return writes; } };
}

test('native Menu reuses original feature controls, account identity, permission gates and external links', () => {
  const h = menuHarness();
  const originalAction = h.rooms.onclick;
  h.enhance();
  const grid = h.rail.children.find((child) => child.className === 'menu-native-grid');
  const products = h.rail.children.find((child) => child.className.includes('menu-native-products'));
  assert.ok(grid.children.includes(h.rooms));
  assert.equal(h.rooms.onclick, originalAction);
  assert.equal(h.rooms.dataset.memberView, 'circles');
  assert.equal(h.rooms.children[0].dataset.slIconName, 'user-group');
  assert.equal(h.moderation.hidden, true);
  assert.equal(h.compose.disabled, true);
  assert.ok(grid.children.includes(h.moderation));
  assert.ok(grid.children.includes(h.compose));
  assert.ok(grid.children.includes(h.support));
  assert.equal(h.support.getAttribute('href'), 'https://wa.me/255629145502');
  assert.equal(h.support.getAttribute('rel'), 'noopener noreferrer');
  assert.deepEqual(products.children, [h.cloud, h.router]);
  assert.equal(h.router.getAttribute('href'), 'https://router.sautilink.com');
  assert.match(h.router.textContent, /Router Setup/);
  assert.equal(h.profile.children[0], h.avatar);
  assert.equal(h.profile.children[1], h.identity);
  assert.ok(h.rail.children.includes(h.signout));
  assert.equal(h.signout.dataset.menuSourceId, 'signout-button');
  assert.ok(grid.children.some((control) => control.dataset.menuNativeSection === 'language'));
  assert.ok(grid.children.some((control) => control.getAttribute('href') === '/privacy'));
});

test('already enhanced Menu clones stay inert through repeated observer callbacks', () => {
  const h = menuHarness();
  h.enhance();
  const children = [...h.rail.children];
  const writes = h.writes;
  for (let index = 0; index < 50; index += 1) h.enhance();
  assert.equal(h.writes, writes);
  assert.deepEqual(h.rail.children, children);
});

test('Menu native CSS and matching bundle release are eager on the first paint', async () => {
  const [html, builder] = await Promise.all([read('app/index.html'), read('scripts/build-production-release.mjs')]);
  const menu = html.indexOf('data-menu-native-style');
  assert.ok(menu > html.indexOf('/app/assets/mobile-more-drawer.css'));
  assert.ok(menu > html.indexOf('/app/assets/member-ios-surfaces.css'));
  assert.ok(menu > html.indexOf('/app/assets/rooms-native.css'));
  assert.match(html, /data-menu-native-style[^>]+menu-native\.css\?v=20261020-native1/);
  assert.match(html, /menu=20261020-native1/);
  assert.match(builder, /menu=20261020-native1/);
});

test('Menu keyboard, protected settings and theme actions still delegate to existing controls', () => {
  assert.match(source, /event\.key === 'Escape'/);
  assert.match(source, /event\.key !== 'Tab'/);
  assert.match(source, /canonicalSettingsSectionButton\(section\)/);
  assert.match(source, /canonicalSignoutButton\(\)/);
  assert.match(source, /canonicalThemeButton\(\)\?\.click\(\)/);
  assert.match(source, /moderationSource\.hidden/);
  assert.match(source, /focusedControl && !focusedControl\.isConnected/);
  assert.doesNotMatch(source, /supabase|fetch\(|XMLHttpRequest|WebSocket/);
});

test('Menu labels and profile identity escape the inherited tablet compact rail rules', async () => {
  const css = await read('app/assets/menu-native.css');
  const rule = (selector) => {
    const start = css.indexOf(selector);
    assert.ok(start >= 0, `Missing Menu selector: ${selector}`);
    return css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  };
  const tile = rule('.menu-native-tile {');
  assert.match(tile, /width:\s*100%;/);
  assert.match(tile, /justify-self:\s*stretch;/);
  const label = rule('.menu-native-tile > span:not(.notification-badge):not(.mobile-notification-badge) {');
  const identity = rule('.menu-native-profile > span {');
  for (const visibleSpan of [label, identity]) {
    for (const reset of ['position: static', 'width: auto', 'height: auto', 'margin: 0', 'overflow: visible', 'clip: auto', 'clip-path: none', 'white-space: normal']) {
      assert.ok(visibleSpan.includes(`${reset};`), `Menu span must reset ${reset}`);
    }
  }
  assert.match(rule('.menu-native-profile > .avatar {'), /width:\s*46px;[\s\S]*height:\s*46px;/);
  assert.match(rule('.menu-native-profile > .avatar {'), /position:\s*relative;/);
  assert.match(rule('.menu-native-profile > .avatar {'), /overflow:\s*hidden;/);
  assert.match(rule('.menu-native-profile-chevron {'), /width:\s*22px;[\s\S]*height:\s*22px;/);
});
