const messagesSurface = document.getElementById('messages-surface');
let messagesWhatsAppUiInitialized = false;

function ensureMessagesWhatsAppStyles() {
  if (document.querySelector('link[data-messages-whatsapp-style]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/app/assets/messages-whatsapp.css?v=20260910-wa1';
  link.dataset.messagesWhatsappStyle = 'true';
  document.head.append(link);
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

function createNewChatButton(usernameInput) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'messages-wa-new-chat';
  button.setAttribute('aria-label', 'Start a new conversation');
  button.title = 'New conversation';
  button.textContent = '+';
  button.addEventListener('click', () => {
    usernameInput?.focus({ preventScroll: false });
    usernameInput?.select?.();
  });
  return button;
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
  messagesSurface.dataset.messagesUi = 'whatsapp-inspired';

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
  sidebar.setAttribute('aria-label', 'Chats');

  const stage = document.createElement('section');
  stage.className = 'messages-wa-stage';
  stage.setAttribute('aria-label', 'Conversation');

  const toolbarTitle = toolbar.querySelector('h2');
  if (toolbarTitle) toolbarTitle.textContent = 'Chats';
  const usernameInput = document.getElementById('message-new-username');
  if (usernameInput) usernameInput.placeholder = 'Username';
  const searchInput = document.getElementById('messages-search');
  if (searchInput) searchInput.placeholder = 'Search or start new chat';

  const toolbarActions = document.createElement('div');
  toolbarActions.className = 'messages-wa-toolbar-actions';
  toolbarActions.append(createNewChatButton(usernameInput));
  toolbar.append(toolbarActions);

  sidebar.append(toolbar, newForm, search);
  if (loading) sidebar.append(loading);
  if (error) sidebar.append(error);
  sidebar.append(inbox);

  stage.append(createMessagesPlaceholder(), thread);
  shell.append(sidebar, stage);
  messagesSurface.append(shell);

  const back = document.getElementById('message-thread-back');
  if (back) {
    back.textContent = '‹';
    back.setAttribute('aria-label', 'Back to chats');
    back.title = 'Back to chats';
  }

  const messageBody = document.getElementById('message-body');
  if (messageBody) {
    messageBody.rows = 1;
    messageBody.placeholder = 'Message';
  }

  const send = document.getElementById('message-send');
  if (send) {
    send.setAttribute('aria-label', 'Send message');
    send.title = 'Send message';
  }

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

startMessagesWhatsAppUiWhenVisible();
