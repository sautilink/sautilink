const messagesSurface = document.getElementById('messages-surface');
let messagesWhatsAppUiInitialized = false;
let messagesReturnView = 'stream';
const MESSAGE_WALLPAPERS = Object.freeze([
  ['classic', 'Classic'], ['linen', 'Linen'], ['sage', 'Sage'], ['sky', 'Sky'],
  ['lavender', 'Lavender'], ['blush', 'Blush'], ['sand', 'Sand'], ['slate', 'Slate'],
  ['midnight', 'Midnight'], ['ocean', 'Ocean'], ['sunset', 'Sunset'], ['dots', 'Dots'],
  ['custom', 'Custom color'],
]);
const MESSAGE_BUBBLES = Object.freeze([
  ['classic', 'Classic'], ['rounded', 'Rounded'], ['compact', 'Compact'],
  ['square', 'Square'], ['outline', 'Outline'],
]);
const MESSAGE_APPEARANCE_PREFIX = 'sautilink.messages.appearance.v1.';
const MESSAGE_APPEARANCE_DEFAULT = Object.freeze({ wallpaper: 'classic', bubble: 'classic', color: '#e9e5df' });
let messagesAppearanceAccount = '';
let messagesAppearance = { ...MESSAGE_APPEARANCE_DEFAULT };
let messagesAppearanceDialog = null;

function messagesAppearanceKey() {
  const account = String(window.__sautilinkMessagesUserId?.() || '');
  return account ? `${MESSAGE_APPEARANCE_PREFIX}${account}` : '';
}

function normalizeMessagesAppearance(value) {
  return {
    wallpaper: MESSAGE_WALLPAPERS.some(([id]) => id === value?.wallpaper) ? value.wallpaper : 'classic',
    bubble: MESSAGE_BUBBLES.some(([id]) => id === value?.bubble) ? value.bubble : 'classic',
    color: /^#[0-9a-fA-F]{6}$/.test(value?.color || '') ? value.color : MESSAGE_APPEARANCE_DEFAULT.color,
  };
}

function syncMessagesAppearanceControls() {
  if (!messagesAppearanceDialog) return;
  messagesAppearanceDialog.querySelectorAll('[data-message-wallpaper]').forEach((button) => {
    const selected = button.dataset.messageWallpaper === messagesAppearance.wallpaper;
    button.setAttribute('aria-pressed', String(selected));
    button.classList.toggle('is-selected', selected);
  });
  messagesAppearanceDialog.querySelectorAll('[data-message-bubble]').forEach((button) => {
    const selected = button.dataset.messageBubble === messagesAppearance.bubble;
    button.setAttribute('aria-pressed', String(selected));
    button.classList.toggle('is-selected', selected);
  });
  const colorInput = messagesAppearanceDialog.querySelector('#messages-custom-color');
  if (colorInput && colorInput.value !== messagesAppearance.color) colorInput.value = messagesAppearance.color;
  const preview = messagesAppearanceDialog.querySelector('.messages-appearance-preview');
  if (preview) {
    preview.dataset.messagesWallpaper = messagesAppearance.wallpaper;
    preview.dataset.messagesBubbles = messagesAppearance.bubble;
    preview.style.setProperty('--messages-custom-color', messagesAppearance.color);
  }
}

function applyMessagesAppearance() {
  if (!messagesSurface) return;
  messagesSurface.dataset.messagesWallpaper = messagesAppearance.wallpaper;
  messagesSurface.dataset.messagesBubbles = messagesAppearance.bubble;
  messagesSurface.style.setProperty('--messages-custom-color', messagesAppearance.color);
  syncMessagesAppearanceControls();
}

function loadMessagesAppearance() {
  const key = messagesAppearanceKey();
  if (key !== messagesAppearanceAccount) {
    messagesAppearanceAccount = key;
    let saved = null;
    try { saved = key ? JSON.parse(window.localStorage.getItem(key) || 'null') : null; } catch { /* Browser storage may be unavailable. */ }
    messagesAppearance = normalizeMessagesAppearance(saved);
  }
  applyMessagesAppearance();
}

function saveMessagesAppearance() {
  applyMessagesAppearance();
  const key = messagesAppearanceKey();
  if (!key) return;
  try { window.localStorage.setItem(key, JSON.stringify(messagesAppearance)); } catch { /* Keep the current view usable. */ }
}

function ensureMessagesWhatsAppStyles() {
  const styles = [
    ['data-messages-whatsapp-style', '/app/assets/messages-whatsapp.css?v=20261009-appearance1'],
    ['data-messages-composer-style', '/app/assets/messages-composer.css?v=20260914-messagesui1'],
    ['data-messages-header-polish-style', '/app/assets/messages-header-polish.css?v=20261009-appearance1'],
    ['data-messages-appearance-style', '/app/assets/messages-appearance.css?v=20261009-appearance1'],
  ];

  for (const [attribute, href] of styles) {
    if (document.querySelector(`link[${attribute}]`)) continue;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.setAttribute(attribute, 'true');
    document.head.append(link);
  }
}

function currentMemberView() {
  const active = document.querySelector('.app-nav [data-member-view].active')
    || document.querySelector('.mobile-nav [data-member-view].active')
    || document.querySelector('[data-member-view][aria-current="page"]');
  return active?.dataset?.memberView || '';
}

function rememberMessagesOrigin(view = currentMemberView()) {
  if (view && view !== 'messages') messagesReturnView = view;
}

function captureMessagesNavigationOrigin(event) {
  const clicked = event.target instanceof Element ? event.target : null;
  if (!clicked) return;

  if (clicked.closest('#profile-message-button')) {
    rememberMessagesOrigin('profile');
    return;
  }

  const target = clicked.closest('[data-member-view]');
  if (!target) return;
  const nextView = target.dataset.memberView || '';
  if (nextView === 'messages') rememberMessagesOrigin();
  else if (nextView) rememberMessagesOrigin(nextView);
}

document.addEventListener('click', captureMessagesNavigationOrigin, true);
rememberMessagesOrigin();

function returnFromMessages() {
  const preferred = document.querySelector(`.app-nav [data-member-view="${messagesReturnView}"]`)
    || document.querySelector(`.mobile-nav [data-member-view="${messagesReturnView}"]`)
    || document.querySelector('.app-nav [data-member-view="stream"]')
    || document.querySelector('.mobile-nav [data-member-view="stream"]');
  if (preferred instanceof HTMLButtonElement && !preferred.disabled) preferred.click();
}

function createMessagesBackButton() {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'messages-wa-app-back';
  button.setAttribute('aria-label', 'Back to previous section');
  button.title = 'Back';

  const chevron = document.createElement('span');
  chevron.className = 'messages-wa-app-back-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.textContent = '‹';

  const label = document.createElement('span');
  label.className = 'messages-wa-app-back-label';
  label.textContent = 'Back';

  button.append(chevron, label);
  button.addEventListener('click', returnFromMessages);
  return button;
}

function createMessagesPlaceholder() {
  const placeholder = document.createElement('section');
  placeholder.className = 'messages-wa-placeholder';
  placeholder.setAttribute('aria-label', 'Choose a conversation');

  const mark = document.createElement('span');
  mark.className = 'messages-wa-placeholder-mark';
  mark.setAttribute('aria-hidden', 'true');

  const title = document.createElement('h3');
  title.textContent = 'SautiLink Messages';

  const copy = document.createElement('p');
  copy.textContent = 'Select a conversation to start messaging privately.';

  const privacy = document.createElement('small');
  privacy.textContent = 'Messages are private to conversation participants and are not end-to-end encrypted.';

  placeholder.append(mark, title, copy, privacy);
  return placeholder;
}

function createMessagesAppearanceDialog() {
  if (messagesAppearanceDialog) return messagesAppearanceDialog;
  const dialog = document.createElement('dialog');
  dialog.className = 'messages-appearance-dialog';
  dialog.setAttribute('aria-labelledby', 'messages-appearance-title');

  const header = document.createElement('header');
  const heading = document.createElement('h2');
  heading.id = 'messages-appearance-title';
  heading.textContent = 'Chat appearance';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'messages-appearance-close';
  close.setAttribute('aria-label', 'Close chat appearance');
  close.textContent = '×';
  close.addEventListener('click', () => dialog.close());
  header.append(heading, close);

  const description = document.createElement('p');
  description.className = 'messages-appearance-description';
  description.textContent = 'Choose a wallpaper and message bubble style. Changes appear in every chat and are saved on this device.';

  const preview = document.createElement('div');
  preview.className = 'messages-appearance-preview';
  preview.setAttribute('aria-hidden', 'true');
  const previewIncoming = document.createElement('span');
  previewIncoming.className = 'messages-preview-bubble incoming';
  previewIncoming.textContent = 'Hello!';
  const previewOutgoing = document.createElement('span');
  previewOutgoing.className = 'messages-preview-bubble own';
  previewOutgoing.textContent = 'Hi there 👋';
  preview.append(previewIncoming, previewOutgoing);

  const wallpaperSection = document.createElement('fieldset');
  wallpaperSection.className = 'messages-appearance-section';
  const wallpaperLegend = document.createElement('legend');
  wallpaperLegend.textContent = 'Wallpaper';
  const wallpaperGrid = document.createElement('div');
  wallpaperGrid.className = 'messages-wallpaper-grid';
  for (const [id, label] of MESSAGE_WALLPAPERS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'messages-wallpaper-option';
    button.dataset.messageWallpaper = id;
    button.setAttribute('aria-pressed', 'false');
    const swatch = document.createElement('span');
    swatch.className = 'messages-wallpaper-swatch';
    swatch.dataset.messagesWallpaper = id;
    swatch.setAttribute('aria-hidden', 'true');
    const caption = document.createElement('span');
    caption.textContent = label;
    button.append(swatch, caption);
    button.addEventListener('click', () => {
      messagesAppearance = { ...messagesAppearance, wallpaper: id };
      saveMessagesAppearance();
    });
    wallpaperGrid.append(button);
  }
  wallpaperSection.append(wallpaperLegend, wallpaperGrid);

  const colorLabel = document.createElement('label');
  colorLabel.className = 'messages-custom-color';
  colorLabel.textContent = 'Pick a custom color';
  const colorInput = document.createElement('input');
  colorInput.id = 'messages-custom-color';
  colorInput.type = 'color';
  colorInput.value = MESSAGE_APPEARANCE_DEFAULT.color;
  colorInput.addEventListener('input', () => {
    messagesAppearance = { ...messagesAppearance, wallpaper: 'custom', color: colorInput.value };
    saveMessagesAppearance();
  });
  colorLabel.append(colorInput);
  wallpaperSection.append(colorLabel);

  const bubbleSection = document.createElement('fieldset');
  bubbleSection.className = 'messages-appearance-section';
  const bubbleLegend = document.createElement('legend');
  bubbleLegend.textContent = 'Bubbles';
  const bubbleGrid = document.createElement('div');
  bubbleGrid.className = 'messages-bubble-grid';
  for (const [id, label] of MESSAGE_BUBBLES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'messages-bubble-option';
    button.dataset.messageBubble = id;
    button.setAttribute('aria-pressed', 'false');
    const sample = document.createElement('span');
    sample.className = 'messages-bubble-sample';
    sample.dataset.messageBubblePreview = id;
    sample.setAttribute('aria-hidden', 'true');
    const caption = document.createElement('span');
    caption.textContent = label;
    button.append(sample, caption);
    button.addEventListener('click', () => {
      messagesAppearance = { ...messagesAppearance, bubble: id };
      saveMessagesAppearance();
    });
    bubbleGrid.append(button);
  }
  bubbleSection.append(bubbleLegend, bubbleGrid);

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'messages-appearance-reset';
  reset.textContent = 'Restore defaults';
  reset.addEventListener('click', () => {
    messagesAppearance = { ...MESSAGE_APPEARANCE_DEFAULT };
    saveMessagesAppearance();
  });
  dialog.append(header, description, preview, wallpaperSection, bubbleSection, reset);
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  messagesSurface.append(dialog);
  messagesAppearanceDialog = dialog;
  syncMessagesAppearanceControls();
  return dialog;
}

function openMessagesAppearance() {
  loadMessagesAppearance();
  const dialog = createMessagesAppearanceDialog();
  if (!dialog.open) dialog.showModal();
}

function navigateFromMessagesMenu(view) {
  const button = document.querySelector(`.mobile-nav [data-member-view="${view}"]`)
    || document.querySelector(`.app-nav [data-member-view="${view}"]`);
  button?.click();
}

function createMessagesMainMenu(searchInput) {
  const wrapper = document.createElement('div');
  wrapper.className = 'messages-wa-main-menu';
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'messages-wa-menu-button';
  trigger.setAttribute('aria-label', 'Messages menu');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', 'messages-wa-menu-items');
  trigger.title = 'Messages menu';
  for (let index = 0; index < 3; index += 1) {
    const line = document.createElement('span');
    line.setAttribute('aria-hidden', 'true');
    trigger.append(line);
  }

  const panel = document.createElement('div');
  panel.id = 'messages-wa-menu-items';
  panel.className = 'messages-wa-menu-items';
  panel.setAttribute('aria-label', 'Messages options');
  panel.hidden = true;
  const closeMenu = () => {
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
  };
  const addItem = (label, action) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', () => { closeMenu(); action(); });
    panel.append(button);
  };
  addItem('New chat', () => { searchInput?.focus(); searchInput?.select?.(); });
  addItem('Chat appearance', openMessagesAppearance);
  const divider = document.createElement('hr');
  panel.append(divider);
  addItem('Profile', () => navigateFromMessagesMenu('profile'));
  addItem('Settings', () => navigateFromMessagesMenu('settings'));
  addItem('Notifications', () => navigateFromMessagesMenu('notifications'));
  addItem('Home', () => navigateFromMessagesMenu('stream'));
  trigger.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    trigger.setAttribute('aria-expanded', String(!panel.hidden));
    if (!panel.hidden) panel.querySelector('button')?.focus();
  });
  document.addEventListener('click', (event) => { if (!wrapper.contains(event.target)) closeMenu(); });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) { closeMenu(); trigger.focus(); }
  });
  wrapper.append(trigger, panel);
  return wrapper;
}

function createMessagesBrandLogo() {
  const logo = document.createElement('img');
  logo.className = 'messages-wa-brand-logo';
  logo.src = '/assets/brand/logo-compact.webp';
  logo.alt = '';
  logo.width = 30;
  logo.height = 22;
  logo.setAttribute('aria-hidden', 'true');
  return logo;
}

function configureMessagesTitle(toolbar) {
  const toolbarTitle = toolbar?.querySelector('h2');
  if (!toolbarTitle) return;

  toolbarTitle.textContent = 'Messages';
  const titleRow = toolbarTitle.parentElement;
  if (!titleRow) return;
  titleRow.classList.add('messages-wa-title-row');
  if (!titleRow.querySelector('.messages-wa-brand-logo')) {
    toolbarTitle.before(createMessagesBrandLogo());
  }
}

function messageUnreadCount() {
  const badgeCounts = Array.from(document.querySelectorAll('[data-message-badge]'), (badge) => {
    const count = Number.parseInt(String(badge.textContent || '').trim(), 10);
    return Number.isFinite(count) ? count : 0;
  });
  const inboxUnread = document.querySelectorAll('#messages-inbox-list .message-inbox-item.unread').length;
  return Math.max(inboxUnread, ...badgeCounts, 0);
}

function syncThreadBackUnreadCount(back) {
  if (!back) return;
  const count = messageUnreadCount();
  const countNode = back.querySelector('.message-thread-back-count');
  if (!countNode) return;
  countNode.textContent = count > 99 ? '99+' : String(count);
  countNode.hidden = count < 1;
  back.setAttribute('aria-label', count > 0
    ? `Back to chats, ${count} unread message${count === 1 ? '' : 's'}`
    : 'Back to chats');
}

function configureThreadBackButton(back) {
  if (!back) return;

  const chevron = document.createElement('span');
  chevron.className = 'message-thread-back-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.textContent = '‹';

  const count = document.createElement('span');
  count.className = 'message-thread-back-count';
  count.hidden = true;

  back.replaceChildren(chevron, count);
  back.title = 'Back to chats';
  syncThreadBackUnreadCount(back);

  document.querySelectorAll('[data-message-badge]').forEach((badge) => {
    new MutationObserver(() => syncThreadBackUnreadCount(back)).observe(badge, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    });
  });

  const list = document.getElementById('messages-inbox-list');
  if (list) {
    new MutationObserver(() => syncThreadBackUnreadCount(back)).observe(list, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: ['class'],
    });
  }
}

function createInboxEndNote(inbox) {
  const list = document.getElementById('messages-inbox-list');
  if (!inbox || !list || inbox.querySelector('.messages-wa-list-end')) return;

  const note = document.createElement('div');
  note.className = 'messages-wa-list-end';
  note.hidden = true;

  const label = document.createElement('span');
  label.textContent = 'No more chats';

  const copy = document.createElement('small');
  copy.textContent = "You're all caught up.";

  note.append(label, copy);
  inbox.append(note);

  const sync = () => {
    note.hidden = !list.querySelector('.message-inbox-item');
  };
  new MutationObserver(sync).observe(list, { childList: true });
  sync();
}

function createMessageSendIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  const outline = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  outline.setAttribute('d', 'M22 2 15 22 11 13 2 9 22 2Z');

  const fold = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  fold.setAttribute('d', 'M22 2 11 13');

  svg.append(outline, fold);
  return svg;
}

function configureMessageSendButton(send) {
  if (!send) return;
  send.dataset.messagesSendIcon = 'paper-plane';
  send.dataset.messagesBrand = 'sautilink';
  send.setAttribute('aria-label', 'Send message');
  send.title = 'Send message';
  send.replaceChildren(createMessageSendIcon());
}

function createConversationMenu(controls) {
  if (!controls || controls.closest('.messages-wa-thread-menu')) return;

  const menu = document.createElement('details');
  menu.className = 'messages-wa-thread-menu';

  const summary = document.createElement('summary');
  summary.setAttribute('aria-label', 'Conversation options');
  summary.title = 'Conversation options';
  summary.textContent = '⋮';

  const appearanceButton = document.createElement('button');
  appearanceButton.type = 'button';
  appearanceButton.className = 'secondary-action';
  appearanceButton.textContent = 'Chat appearance';
  appearanceButton.addEventListener('click', openMessagesAppearance);
  controls.prepend(appearanceButton);
  menu.append(summary, controls);
  controls.addEventListener('click', (event) => {
    if (event.target.closest('button')) menu.open = false;
  });

  const header = document.querySelector('#message-thread .message-thread-header');
  header?.append(menu);
}

function buildMessagesWhatsAppShell() {
  if (!messagesSurface || messagesWhatsAppUiInitialized) return;
  messagesWhatsAppUiInitialized = true;
  ensureMessagesWhatsAppStyles();
  messagesSurface.classList.add('messages-whatsapp-ui');
  messagesSurface.dataset.messagesUi = 'sautilink-reference-refresh';
  loadMessagesAppearance();

  const toolbar = messagesSurface.querySelector('.messages-toolbar');
  const newForm = document.getElementById('message-new-form');
  const search = messagesSurface.querySelector('.messages-search');
  const loading = document.getElementById('messages-loading');
  const error = document.getElementById('messages-error');
  const inbox = document.getElementById('messages-inbox');
  const thread = document.getElementById('message-thread');

  if (!toolbar || !newForm || !search || !inbox || !thread) return;

  const shell = document.createElement('div');
  shell.className = 'messages-wa-shell';

  const sidebar = document.createElement('aside');
  sidebar.className = 'messages-wa-sidebar';
  sidebar.setAttribute('aria-label', 'Messages');

  const stage = document.createElement('section');
  stage.className = 'messages-wa-stage';
  stage.setAttribute('aria-label', 'Conversation');

  configureMessagesTitle(toolbar);
  if (!toolbar.querySelector('.messages-wa-app-back')) toolbar.prepend(createMessagesBackButton());

  newForm.hidden = true;
  newForm.setAttribute('aria-hidden', 'true');

  const searchInput = document.getElementById('messages-search');
  if (searchInput) searchInput.placeholder = 'Search or start new chat';

  const toolbarActions = document.createElement('div');
  toolbarActions.className = 'messages-wa-toolbar-actions';
  toolbarActions.append(createMessagesMainMenu(searchInput));
  toolbar.append(toolbarActions);

  sidebar.append(toolbar, newForm, search);
  if (loading) sidebar.append(loading);
  if (error) sidebar.append(error);
  sidebar.append(inbox);
  createInboxEndNote(inbox);

  stage.append(createMessagesPlaceholder(), thread);
  shell.append(sidebar, stage);
  messagesSurface.append(shell);

  configureThreadBackButton(document.getElementById('message-thread-back'));

  const messageBody = document.getElementById('message-body');
  if (messageBody) {
    messageBody.rows = 1;
    messageBody.placeholder = 'Message';
  }

  configureMessageSendButton(document.getElementById('message-send'));
  createConversationMenu(messagesSurface.querySelector('.message-thread-controls'));
}

function startMessagesWhatsAppUiWhenVisible() {
  if (!messagesSurface) return;
  if (!messagesSurface.hidden) {
    buildMessagesWhatsAppShell();
    return;
  }

  const visibilityObserver = new MutationObserver(() => {
    if (messagesSurface.hidden || messagesWhatsAppUiInitialized) return;
    visibilityObserver.disconnect();
    buildMessagesWhatsAppShell();
  });
  visibilityObserver.observe(messagesSurface, {
    attributes: true,
    attributeFilter: ['hidden'],
  });
}

if (messagesSurface) {
  new MutationObserver(() => {
    if (messagesSurface.hidden) {
      rememberMessagesOrigin();
      if (messagesAppearanceDialog?.open) messagesAppearanceDialog.close();
    } else {
      loadMessagesAppearance();
    }
  }).observe(messagesSurface, {
    attributes: true,
    attributeFilter: ['hidden'],
  });
}

window.addEventListener('storage', (event) => {
  if (event.key !== messagesAppearanceKey()) return;
  messagesAppearanceAccount = '';
  loadMessagesAppearance();
});

startMessagesWhatsAppUiWhenVisible();
