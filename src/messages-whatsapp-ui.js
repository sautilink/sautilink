const messagesSurface = document.getElementById('messages-surface');
let messagesWhatsAppUiInitialized = false;
let messagesReturnView = 'stream';

function ensureMessagesWhatsAppStyles() {
  const styles = [
    ['data-messages-whatsapp-style', '/app/assets/messages-whatsapp.css?v=20260914-messagesui1'],
    ['data-messages-composer-style', '/app/assets/messages-composer.css?v=20260914-messagesui1'],
    ['data-messages-header-polish-style', '/app/assets/messages-header-polish.css?v=20260921-messagesui9'],
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

function createNewChatButton(searchInput) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'messages-wa-new-chat';
  button.setAttribute('aria-label', 'Search conversations');
  button.title = 'Search conversations';
  button.textContent = '+';
  button.addEventListener('click', () => {
    searchInput?.focus({ preventScroll: false });
    searchInput?.select?.();
  });
  return button;
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
  toolbarActions.append(createNewChatButton(searchInput));
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
    if (messagesSurface.hidden) rememberMessagesOrigin();
  }).observe(messagesSurface, {
    attributes: true,
    attributeFilter: ['hidden'],
  });
}

startMessagesWhatsAppUiWhenVisible();
