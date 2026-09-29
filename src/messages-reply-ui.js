const messagesReplySurface = document.getElementById('messages-surface');
const messagesReplyThread = document.getElementById('message-thread');
const messagesReplyFeed = document.getElementById('message-thread-feed');
const messagesReplyComposer = document.getElementById('message-composer');
const messagesReplyBody = document.getElementById('message-body');

const MESSAGE_REPLY_SWIPE_TRIGGER = 52;
const MESSAGE_REPLY_SWIPE_MAX = 76;
let messageReplyGesture = null;
let messageReplyPreview = null;
let messageReplyMutationTimer = 0;

function ensureMessagesReplyStyles() {
  if (document.querySelector('link[data-messages-reply-style]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/app/assets/messages-reply.css?v=20260929-reply1';
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
  delete messagesReplyComposer.dataset.replyToMessageId;
  messagesReplyComposer.classList.remove('has-message-reply');
  const preview = messageReplyPreview || document.getElementById('message-reply-preview');
  if (preview) {
    preview.hidden = true;
    const author = preview.querySelector('[data-message-reply-author]');
    const body = preview.querySelector('[data-message-reply-body]');
    if (author) author.textContent = '';
    if (body) body.textContent = '';
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
}

function moveReplySwipe(event) {
  const gesture = messageReplyGesture;
  if (!gesture || event.pointerId !== gesture.pointerId) return;
  const dx = event.clientX - gesture.startX;
  const dy = event.clientY - gesture.startY;
  gesture.deltaX = dx;

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
  messageReplyGesture = null;
  const shouldReply = !cancelled
    && gesture.swiping
    && gesture.deltaX <= -MESSAGE_REPLY_SWIPE_TRIGGER;
  resetReplySwipe(gesture.card);
  if (shouldReply) setMessageReply(gesture.card);
}

function handleReplyAction(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;

  const reply = target.closest('[data-reply-dm-message]');
  if (reply) {
    const card = reply.closest('.dm-message[data-message-id]');
    if (card) setMessageReply(card);
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

  new MutationObserver(reconcileReplyAfterThreadRender).observe(messagesReplyFeed, {
    childList: true,
    subtree: false,
  });

  new MutationObserver(() => {
    if (messagesReplySurface.hidden || messagesReplyThread?.hidden) clearMessageReply();
    clearReplyForMediaCompose();
  }).observe(messagesReplySurface, {
    attributes: true,
    subtree: true,
    attributeFilter: ['hidden'],
  });

  window.addEventListener('popstate', () => clearMessageReply());
}

window.__sautilinkClearMessageReply = clearMessageReply;
initializeMessagesReplyUi();
