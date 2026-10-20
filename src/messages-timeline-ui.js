// Presentation state belongs to the visible feed, never to a conversation request.
const timelines = new WeakMap();
const fingerprints = new WeakMap();
const BOTTOM_DISTANCE = 140;

function messageFingerprint(message, contextKey) {
  const reply = message.reply;
  return JSON.stringify([
    contextKey, message.id, message.sender_id, message.body, message.message_kind,
    message.sent_at, message.edited_at, message.deleted_at, message.reply_to_message_id,
    reply && [reply.id, reply.sender_id, reply.body, reply.message_kind, reply.deleted_at],
  ]);
}

function capturePosition(state) {
  const { feed } = state;
  const viewportTop = feed.getBoundingClientRect().top + (feed.clientTop || 0);
  const anchors = [];
  for (const [id, node] of state.rows) {
    const bounds = node.getBoundingClientRect();
    if (node.parentNode === feed && bounds.bottom > viewportTop) {
      anchors.push({ id, offset: bounds.top - viewportTop });
    }
  }
  // Map insertion order need not match display order after an older window arrives.
  anchors.sort((a, b) => a.offset - b.offset);
  return {
    bottom: feed.scrollHeight - feed.scrollTop - feed.clientHeight < BOTTOM_DISTANCE,
    scrollTop: feed.scrollTop,
    anchors,
  };
}

function restorePosition(state, position) {
  const { feed } = state;
  if (position.bottom) {
    feed.scrollTop = feed.scrollHeight;
  } else {
    const anchor = position.anchors.find(({ id }) => state.rows.get(id)?.parentNode === feed);
    if (anchor) {
      const viewportTop = feed.getBoundingClientRect().top + (feed.clientTop || 0);
      const offset = state.rows.get(anchor.id).getBoundingClientRect().top - viewportTop;
      feed.scrollTop += offset - anchor.offset;
    } else {
      feed.scrollTop = position.scrollTop;
    }
  }
  state.position = capturePosition(state);
}

function createTimeline(feed) {
  const state = { feed, rows: new Map(), separators: new Map(), position: null, observer: null };
  // Native anchoring and our message anchor must not both compensate the same resize.
  state.previousOverflowAnchor = feed.style.overflowAnchor;
  feed.style.overflowAnchor = 'none';
  state.onScroll = () => { state.position = capturePosition(state); };
  state.onResize = () => {
    if (!feed.isConnected || feed.clientHeight <= 0 || !state.position) return;
    // A notification jump or reader scroll may happen before its scroll event runs.
    if (Math.abs(feed.scrollTop - state.position.scrollTop) > 1) {
      state.position = capturePosition(state);
      return;
    }
    restorePosition(state, state.position);
  };
  const ResizeObserverClass = feed.ownerDocument.defaultView?.ResizeObserver;
  if (ResizeObserverClass) {
    state.observer = new ResizeObserverClass(state.onResize);
    state.observer.observe(feed);
  }
  feed.addEventListener('scroll', state.onScroll, { passive: true });
  // These also cover browsers without ResizeObserver and late attachment hydration.
  feed.addEventListener('load', state.onResize, true);
  feed.addEventListener('loadedmetadata', state.onResize, true);
  timelines.set(feed, state);
  return state;
}

/** Keep an existing message DOM node unless its server-visible content changed. */
export function reconcileDmTimeline(feed, messages, {
  renderMessage, dayKey, dayLabel, formatTime, contextKey = '',
}) {
  const state = timelines.get(feed) || createTimeline(feed);
  // Capture after the request completes: the reader may have moved while it loaded.
  const position = capturePosition(state);
  const wanted = [];
  const nextRows = new Map();
  const nextSeparators = new Map();
  const dayOccurrences = new Map();
  let previousDay = '';

  for (const message of messages) {
    const id = String(message.id);
    if (nextRows.has(id)) continue;
    const day = dayKey(message.sent_at);
    if (day && day !== previousDay) {
      const occurrence = dayOccurrences.get(day) || 0;
      dayOccurrences.set(day, occurrence + 1);
      const key = `${day}:${occurrence}`;
      const separator = state.separators.get(key) || feed.ownerDocument.createElement('div');
      separator.className = 'dm-day-separator';
      const label = dayLabel(message.sent_at);
      if (separator.textContent !== label) separator.textContent = label;
      nextSeparators.set(key, separator);
      wanted.push(separator);
    }
    previousDay = day;

    const fingerprint = messageFingerprint(message, contextKey);
    let card = state.rows.get(id);
    const editing = card?.querySelector('.dm-message-edit-form');
    if (!card || (fingerprints.get(card) !== fingerprint && (!editing || message.deleted_at))) {
      const previousCard = card;
      card = renderMessage(message);
      fingerprints.set(card, fingerprint);
      if (previousCard) state.observer?.unobserve(previousCard);
      state.observer?.observe(card);
    }
    // A changed row with an open edit is deliberately retried on the next reconciliation.
    const time = card.querySelector('.dm-message-meta time');
    if (time && formatTime) {
      const label = formatTime(message.sent_at);
      if (label != null && time.textContent !== label) time.textContent = label;
    }
    nextRows.set(id, card);
    wanted.push(card);
  }

  const wantedNodes = new Set(wanted);
  for (const node of Array.from(feed.children)) {
    if (!wantedNodes.has(node)) {
      state.observer?.unobserve(node);
      node.remove();
    }
  }
  for (let index = 0; index < wanted.length; index += 1) {
    const node = wanted[index];
    if (feed.children[index] !== node) {
      // moveBefore preserves focus/media state on browsers that support atomic moves.
      if (node.parentNode === feed && typeof feed.moveBefore === 'function') {
        feed.moveBefore(node, feed.children[index] || null);
      } else {
        feed.insertBefore(node, feed.children[index] || null);
      }
    }
  }
  state.rows = nextRows;
  state.separators = nextSeparators;
  restorePosition(state, position);
}

/** Call before clearing/switching the conversation, and when the Messages view closes. */
export function disposeDmTimeline(feed) {
  const state = timelines.get(feed);
  if (!state) return;
  state.observer?.disconnect();
  feed.removeEventListener('scroll', state.onScroll);
  feed.removeEventListener('load', state.onResize, true);
  feed.removeEventListener('loadedmetadata', state.onResize, true);
  feed.style.overflowAnchor = state.previousOverflowAnchor;
  timelines.delete(feed);
}
