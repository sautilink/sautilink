const messagesReplySurface = document.getElementById('messages-surface');
const messagesReplyThread = document.getElementById('message-thread');
const messagesReplyFeed = document.getElementById('message-thread-feed');
const messagesReplyComposer = document.getElementById('message-composer');
const messagesReplyBody = document.getElementById('message-body');

const MESSAGE_REPLY_SWIPE_TRIGGER = 52;
const MESSAGE_REPLY_SWIPE_MAX = 76;
const MESSAGE_ACTION_HOLD_MS = 500;
let messageReplyGesture = null;
let messageReplyPreview = null;
let messageReplyMutationTimer = 0;
let messageActionHoldTimer = 0;
let messageActionsOpenCard = null;
let messageActionsOpenedAt = 0;
let messageEditForm = null;

function ensureMessagesReplyStyles() {
  if (document.querySelector('link[data-messages-reply-style]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/app/assets/messages-reply.css?v=20261003-edit1';
  link.dataset.messagesReplyStyle = 'true';
  document.head.append(link);
}

function replyTargetCopy(card) {
  const body = card?.querySelector(':scope > p');
  const text = String(body?.textContent || '').trim().replace(/\s+/g, ' ');
  if (text) return text.length > 140 ? `${text.slice(0, 137)}…` : text;
  if (card?.querySelector('.dm-media-photo')) return 'Photo';
  if (card?.querySelector('.dm-media-voice')) return 'Voice message';
  if (card?.querySelector('.dm-media-file')) return 'File';
  return 'Message';
}

function replyTargetAuthor(card) {
  if (card?.dataset.ownMessage === 'true') return 'You';
  return String(document.getElementById('message-thread-name')?.textContent || '').trim() || 'Reply';
}

function createReplyPreview() {
  if (!messagesReplyComposer) return null;
  const existing = document.getElementById('message-reply-preview');
  if (existing) return existing;

  const preview = document.createElement('div');
  preview.id = 'message-reply-preview';
  preview.className = 'message-reply-preview';
  preview.setAttribute('role', 'status');
  preview.setAttribute('aria-live', 'polite');
  preview.hidden = true;

  const copy = document.createElement('div');
  copy.className = 'message-reply-preview-copy';
  const author = document.createElement('strong');
  author.dataset.messageReplyAuthor = '';
  const body = document.createElement('span');
  body.dataset.messageReplyBody = '';
  copy.append(author, body);

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'message-reply-cancel';
  cancel.setAttribute('aria-label', 'Cancel reply');
  cancel.title = 'Cancel reply';
  cancel.textContent = '×';
  cancel.addEventListener('click', () => clearMessageReply({ focus: true }));

  preview.append(copy, cancel);
  messagesReplyComposer.prepend(preview);
  return preview;
}

function clearMessageReply({ focus = false } = {}) {
  if (!messagesReplyComposer) return;
  if (messagesReplyComposer.dataset.replyToMessageId) delete messagesReplyComposer.dataset.replyToMessageId;
  if (messagesReplyComposer.classList.contains('has-message-reply')) {
    messagesReplyComposer.classList.remove('has-message-reply');
  }
  const preview = messageReplyPreview || document.getElementById('message-reply-preview');
  if (preview) {
    if (!preview.hidden) preview.hidden = true;
    const author = preview.querySelector('[data-message-reply-author]');
    const body = preview.querySelector('[data-message-reply-body]');
    if (author?.textContent) author.textContent = '';
    if (body?.textContent) body.textContent = '';
  }
  if (focus && !messagesReplyBody?.disabled) messagesReplyBody?.focus({ preventScroll: true });
}

function setMessageReply(card) {
  if (!messagesReplyComposer || !messagesReplyBody || !(card instanceof Element)) return;
  if (card.classList.contains('deleted')) return;
  const messageId = String(card.dataset.messageId || '');
  if (!/^\d{1,20}$/.test(messageId)) return;

  messageReplyPreview ||= createReplyPreview();
  if (!messageReplyPreview) return;
  messagesReplyComposer.dataset.replyToMessageId = messageId;
  messagesReplyComposer.classList.add('has-message-reply');
  messageReplyPreview.querySelector('[data-message-reply-author]').textContent = replyTargetAuthor(card);
  messageReplyPreview.querySelector('[data-message-reply-body]').textContent = replyTargetCopy(card);
  messageReplyPreview.hidden = false;
  if (!messagesReplyBody.disabled) messagesReplyBody.focus({ preventScroll: true });
}

function resetReplySwipe(card) {
  if (!(card instanceof Element)) return;
  card.classList.remove('reply-swipe-active');
  card.classList.add('reply-swipe-settling');
  card.style.removeProperty('--dm-reply-swipe-x');
  window.setTimeout(() => card.classList.remove('reply-swipe-settling'), 190);
}

function pointerTargetIsInteractive(target) {
  return target instanceof Element && Boolean(target.closest('button, a, input, textarea, audio, video, select, [contenteditable="true"]'));
}

function cancelMessageActionHold() {
  window.clearTimeout(messageActionHoldTimer);
  messageActionHoldTimer = 0;
}

function closeMessageActions() {
  messageActionsOpenCard?.removeAttribute('data-dm-actions-open');
  messageActionsOpenCard = null;
}

function closeMessageEdit({ focus = false } = {}) {
  const card = messageEditForm?.closest('.dm-message');
  messageEditForm?.remove();
  messageEditForm = null;
  if (card) card.classList.remove('editing');
  if (focus && card?.isConnected) card.focus({ preventScroll: true });
}

function openMessageEdit(card) {
  if (!(card instanceof Element) || card.dataset.ownMessage !== 'true'
    || card.dataset.messageKind !== 'text' || card.classList.contains('deleted')) return;
  const messageId = String(card.dataset.messageId || '');
  const body = card.querySelector(':scope > p');
  if (!/^\d{1,20}$/.test(messageId) || !body) return;
  closeMessageEdit();

  const form = document.createElement('form');
  form.className = 'dm-message-edit-form';
  form.dataset.editMessageId = messageId;
  const input = document.createElement('textarea');
  input.maxLength = 4000;
  input.rows = 3;
  input.required = true;
  input.value = body.textContent || '';
  input.setAttribute('aria-label', 'Edit message');
  const actions = document.createElement('div');
  actions.className = 'dm-message-edit-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => closeMessageEdit({ focus: true }));
  const save = document.createElement('button');
  save.type = 'submit';
  save.textContent = 'Save';
  const error = document.createElement('span');
  error.className = 'dm-message-edit-error';
  error.setAttribute('role', 'alert');
  actions.append(cancel, save);
  form.append(input, actions, error);
  card.insertBefore(form, card.querySelector('.dm-message-meta'));
  card.classList.add('editing');
  messageEditForm = form;
  input.focus({ preventScroll: true });
  input.setSelectionRange(input.value.length, input.value.length);
}

async function saveMessageEdit(event) {
  const form = event.target instanceof Element ? event.target.closest('.dm-message-edit-form') : null;
  if (!form) return;
  event.preventDefault();
  if (form !== messageEditForm || form.dataset.saving === 'true') return;
  const card = form.closest('.dm-message');
  if (!card || card.dataset.ownMessage !== 'true' || card.dataset.messageKind !== 'text'
    || card.classList.contains('deleted')) return;
  const body = card.querySelector(':scope > p');
  const input = form.querySelector('textarea');
  const text = String(input?.value || '').trim();
  if (!text || text.length > 4000) {
    form.querySelector('.dm-message-edit-error').textContent = 'Enter 1 to 4000 characters.';
    return;
  }
  if (text === body?.textContent) {
    closeMessageEdit({ focus: true });
    return;
  }
  form.dataset.saving = 'true';
  form.querySelectorAll('button, textarea').forEach((control) => { control.disabled = true; });
  try {
    const updated = await window.__sautilinkEditDirectMessage(card.dataset.messageId, text);
    if (card.isConnected && messageEditForm === form) {
      body.textContent = updated.body;
      const meta = card.querySelector('.dm-message-meta');
      if (meta && !meta.querySelector('.dm-message-edited')) {
        const edited = document.createElement('span');
        edited.className = 'dm-message-edited';
        edited.textContent = 'Edited';
        meta.insertBefore(edited, meta.querySelector('.dm-message-action'));
      }
      closeMessageEdit({ focus: true });
    }
  } catch {
    if (messageEditForm === form) {
      form.querySelector('.dm-message-edit-error').textContent = 'Could not edit this message. Try again.';
    }
  } finally {
    if (messageEditForm === form) {
      delete form.dataset.saving;
      form.querySelectorAll('button, textarea').forEach((control) => { control.disabled = false; });
    }
  }
}

function openMessageActions(card) {
  if (!(card instanceof Element) || card.classList.contains('deleted') || !card.querySelector('.dm-message-action')) return;
  closeMessageActions();
  card.dataset.dmActionsOpen = 'true';
  messageActionsOpenCard = card;
  messageActionsOpenedAt = Date.now();
}

function startReplySwipe(event) {
  if (!messagesReplyFeed || messagesReplyThread?.hidden) return;
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  if (pointerTargetIsInteractive(event.target)) return;
  const card = event.target instanceof Element ? event.target.closest('.dm-message[data-message-id]') : null;
  if (!card || card.classList.contains('deleted')) return;

  messageReplyGesture = {
    pointerId: event.pointerId,
    card,
    startX: event.clientX,
    startY: event.clientY,
    deltaX: 0,
    swiping: false,
  };
  cancelMessageActionHold();
  messageActionHoldTimer = window.setTimeout(() => {
    if (messageReplyGesture?.pointerId === event.pointerId && !messageReplyGesture.swiping && card.isConnected) {
      openMessageActions(card);
    }
    messageActionHoldTimer = 0;
  }, MESSAGE_ACTION_HOLD_MS);
}

function moveReplySwipe(event) {
  const gesture = messageReplyGesture;
  if (!gesture || event.pointerId !== gesture.pointerId) return;
  const dx = event.clientX - gesture.startX;
  const dy = event.clientY - gesture.startY;
  gesture.deltaX = dx;
  if (Math.abs(dx) >= 9 || Math.abs(dy) >= 9) cancelMessageActionHold();

  if (!gesture.swiping) {
    if (Math.abs(dx) < 9 && Math.abs(dy) < 9) return;
    if (dx >= 0 || Math.abs(dy) > Math.abs(dx) * 0.82) {
      messageReplyGesture = null;
      return;
    }
    gesture.swiping = true;
    gesture.card.classList.add('reply-swipe-active');
    try { gesture.card.setPointerCapture?.(event.pointerId); } catch {}
  }

  if (dx >= 0) return;
  event.preventDefault();
  const shift = Math.max(-MESSAGE_REPLY_SWIPE_MAX, dx);
  gesture.card.style.setProperty('--dm-reply-swipe-x', `${shift}px`);
}

function finishReplySwipe(event, cancelled = false) {
  const gesture = messageReplyGesture;
  if (!gesture || event.pointerId !== gesture.pointerId) return;
  cancelMessageActionHold();
  messageReplyGesture = null;
  const shouldReply = !cancelled
    && gesture.swiping
    && gesture.deltaX <= -MESSAGE_REPLY_SWIPE_TRIGGER;
  resetReplySwipe(gesture.card);
  if (shouldReply) {
    closeMessageActions();
    setMessageReply(gesture.card);
  }
}

function handleReplyAction(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;

  if (target.closest('.dm-message-action')) closeMessageActions();
  else if (messageActionsOpenCard && Date.now() - messageActionsOpenedAt > 650) closeMessageActions();

  const reply = target.closest('[data-reply-dm-message]');
  if (reply) {
    const card = reply.closest('.dm-message[data-message-id]');
    if (card) setMessageReply(card);
    return;
  }

  const edit = target.closest('[data-edit-dm-message]');
  if (edit) {
    openMessageEdit(edit.closest('.dm-message[data-message-id]'));
    return;
  }

  const jump = target.closest('[data-jump-to-dm-message]');
  if (!jump || !messagesReplyFeed) return;
  const id = String(jump.dataset.jumpToDmMessage || '');
  if (!/^\d{1,20}$/.test(id)) return;
  const original = messagesReplyFeed.querySelector(`[data-message-id="${CSS.escape(id)}"]`);
  if (!original) return;
  original.scrollIntoView({ behavior: 'smooth', block: 'center' });
  original.classList.remove('dm-reply-target-flash');
  void original.offsetWidth;
  original.classList.add('dm-reply-target-flash');
  window.setTimeout(() => original.classList.remove('dm-reply-target-flash'), 1150);
}

function reconcileReplyAfterThreadRender() {
  window.clearTimeout(messageReplyMutationTimer);
  messageReplyMutationTimer = window.setTimeout(() => {
    if (messageActionsOpenCard && !messageActionsOpenCard.isConnected) closeMessageActions();
    if (messageEditForm && !messageEditForm.isConnected) closeMessageEdit();
    messagesReplyFeed?.querySelectorAll('.dm-message[data-message-id]:not([tabindex])')
      .forEach((card) => {
        card.tabIndex = 0;
        card.setAttribute('aria-keyshortcuts', 'Shift+F10 Enter');
      });
    const activeId = String(messagesReplyComposer?.dataset.replyToMessageId || '');
    if (!activeId || !messagesReplyFeed || messagesReplyThread?.hidden) return;
    const target = messagesReplyFeed.querySelector(`[data-message-id="${CSS.escape(activeId)}"]`);
    if (!target || target.classList.contains('deleted')) clearMessageReply();
  }, 0);
}

function clearReplyForMediaCompose() {
  if (!messagesReplyComposer?.dataset.replyToMessageId) return;
  const attachment = document.getElementById('message-attachment-preview');
  const recording = document.getElementById('message-recording-state');
  if ((attachment && !attachment.hidden) || (recording && !recording.hidden)) clearMessageReply();
}

function initializeMessagesReplyUi() {
  if (!messagesReplySurface || !messagesReplyFeed || !messagesReplyComposer || !messagesReplyBody) return;
  if (messagesReplyComposer.dataset.messagesReplyReady === 'true') return;
  messagesReplyComposer.dataset.messagesReplyReady = 'true';
  ensureMessagesReplyStyles();
  messageReplyPreview = createReplyPreview();

  messagesReplyFeed.addEventListener('pointerdown', startReplySwipe);
  messagesReplyFeed.addEventListener('pointermove', moveReplySwipe, { passive: false });
  messagesReplyFeed.addEventListener('pointerup', (event) => finishReplySwipe(event, false));
  messagesReplyFeed.addEventListener('pointercancel', (event) => finishReplySwipe(event, true));
  messagesReplyFeed.addEventListener('click', handleReplyAction);
  messagesReplyFeed.addEventListener('submit', (event) => { void saveMessageEdit(event); });
  messagesReplyFeed.addEventListener('contextmenu', (event) => {
    const card = event.target instanceof Element ? event.target.closest('.dm-message[data-message-id]') : null;
    if (!card || pointerTargetIsInteractive(event.target)) return;
    event.preventDefault();
    cancelMessageActionHold();
    openMessageActions(card);
  });
  messagesReplyFeed.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && messageEditForm && messageEditForm.contains(event.target)) {
      event.preventDefault();
      closeMessageEdit({ focus: true });
      return;
    }
    if (event.key === 'Escape' && messageActionsOpenCard) {
      const card = messageActionsOpenCard;
      closeMessageActions();
      card.focus({ preventScroll: true });
      return;
    }
    if (!['Enter', ' ', 'F10'].includes(event.key) || (event.key === 'F10' && !event.shiftKey)) return;
    const card = event.target instanceof Element ? event.target.closest('.dm-message[data-message-id]') : null;
    if (!card || event.target !== card) return;
    event.preventDefault();
    openMessageActions(card);
  });
  messagesReplyFeed.addEventListener('scroll', closeMessageActions, { passive: true });
  document.addEventListener('pointerdown', (event) => {
    if (messageActionsOpenCard && !messageActionsOpenCard.contains(event.target)) closeMessageActions();
  });

  new MutationObserver(reconcileReplyAfterThreadRender).observe(messagesReplyFeed, {
    childList: true,
    subtree: false,
  });

  const onVisibilityChange = () => {
    if (messagesReplySurface.hidden || messagesReplyThread?.hidden) {
      clearMessageReply();
      closeMessageActions();
      closeMessageEdit();
      cancelMessageActionHold();
    }
    clearReplyForMediaCompose();
  };
  const visibilityObserver = new MutationObserver(onVisibilityChange);
  for (const element of [
    messagesReplySurface,
    messagesReplyThread,
    document.getElementById('message-attachment-preview'),
    document.getElementById('message-recording-state'),
  ]) {
    if (element) visibilityObserver.observe(element, { attributes: true, attributeFilter: ['hidden'] });
  }

  window.addEventListener('popstate', () => {
    clearMessageReply();
    closeMessageActions();
    closeMessageEdit();
  });
}

window.__sautilinkClearMessageReply = clearMessageReply;
initializeMessagesReplyUi();
