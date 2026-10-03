import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = await readFile(resolve(import.meta.dirname, '../src/app.js'), 'utf8');
const start = source.indexOf('function dismissTransientMenusOnScroll() {');
const end = source.indexOf('\n}\n', start) + 2;
assert.ok(start >= 0 && end > start, 'scroll dismissal handler exists');
const handler = source.slice(start, end);

test('scroll closes open menus and resets their controls', () => {
  const control = () => ({ expanded: 'true', setAttribute(name, value) {
    if (name === 'aria-expanded') this.expanded = value;
  } });
  const profileButton = control();
  const qualityButton = control();
  const categorySearch = control();
  const profilePopover = { hidden: false };
  const qualityMenu = { hidden: false, closest: () => qualityButton };
  const categoryOptions = { hidden: false };
  const conversationMenu = { open: true };
  const closed = [];

  const document = {
    querySelector(selector) {
      if (selector.startsWith('[data-home-post-menu-toggle]')) return {};
      if (selector.startsWith('.sauti-repost-menu')) return {};
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '.messages-wa-thread-menu[open]') return [conversationMenu];
      if (selector === '.sauti-video-quality-menu:not([hidden])') return [qualityMenu];
      return [];
    },
  };
  const ids = {
    'profile-more-popover': profilePopover,
    'profile-more-button': profileButton,
    'professional-category-options': categoryOptions,
    'professional-category-search': categorySearch,
  };
  runInNewContext(`${handler}\ndismissTransientMenusOnScroll();`, {
    document,
    byId: (id) => ids[id],
    openCommentMenuShell: {},
    closeHomePostMenus: () => closed.push('post'),
    closeCommentMenus: () => closed.push('comment'),
    closeRepostMenus: () => closed.push('repost'),
  });

  assert.deepEqual(closed, ['post', 'comment', 'repost']);
  assert.equal(profilePopover.hidden, true);
  assert.equal(profileButton.expanded, 'false');
  assert.equal(conversationMenu.open, false);
  assert.equal(qualityMenu.hidden, true);
  assert.equal(qualityButton.expanded, 'false');
  assert.equal(categoryOptions.hidden, true);
  assert.equal(categorySearch.expanded, 'false');
});

test('preview option menus also dismiss on scroll gestures', async () => {
  const [hook, app, conversation] = await Promise.all([
    readFile(resolve(import.meta.dirname, '../preview-src/app-shell/useDismissOnScroll.js'), 'utf8'),
    readFile(resolve(import.meta.dirname, '../preview-src/app-shell/App.jsx'), 'utf8'),
    readFile(resolve(import.meta.dirname, '../preview-src/app-shell/ConversationPreview.jsx'), 'utf8'),
  ]);

  assert.match(hook, /addEventListener\('scroll', dismiss, true\)/);
  assert.match(hook, /addEventListener\('touchmove', dismiss/);
  assert.match(hook, /addEventListener\('wheel', dismiss/);
  assert.match(app, /useDismissOnScroll\(actionsOpen, /);
  assert.match(app, /useDismissOnScroll\(controlsOpen, /);
  assert.match(conversation, /useDismissOnScroll\(reshareMenuOpen, /);
});
