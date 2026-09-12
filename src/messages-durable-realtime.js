const DM_REALTIME_PROTOCOL = 'sautilink-dm-v1';
const DM_REALTIME_AUTH_PREFIX = 'sautilink-auth.';
const DM_REALTIME_RECONNECT_MAX_MS = 15000;
const DM_REALTIME_TYPING_STOP_MS = 1400;

let durableSocket = null;
let durableConversationId = '';
let durableReconnectTimer = 0;
let durableReconnectAttempt = 0;
let durableTypingStopTimer = 0;
let durableTypingState = false;
let durableSyncTimer = 0;

function realtimeContext() {
  const provider = window.__sautilinkDmRealtimeContext;
  if (typeof provider !== 'function') return null;
  try {
    const context = provider();
    return context && typeof context === 'object' ? context : null;
  } catch {
    return null;
  }
}

function currentConversationId() {
  const context = realtimeContext();
  return context?.activityEnabled && !context?.blocked ? String(context.conversationId || '') : '';
}

function setTransportState(active) {
  const surface = document.getElementById('messages-surface');
  if (!surface) return;
  if (active) surface.dataset.realtimeTransport = 'durable-object';
  else delete surface.dataset.realtimeTransport;
}

function setPeerPresence(online) {
  const context = realtimeContext();
  if (!context?.activityEnabled || context.blocked || context.conversationId !== durableConversationId) return;
  const activity = document.getElementById('message-thread-activity');
  if (!activity) return;
  activity.textContent = 'Online';
  activity.hidden = !online;
}

function setPeerTyping(typing) {
  const context = realtimeContext();
  if (!context?.activityEnabled || context.blocked || context.conversationId !== durableConversationId) return;
  const node = document.getElementById('message-typing-status');
  if (!node) return;
  node.textContent = 'Typing…';
  node.hidden = !typing;
}

function clearTypingTimer() {
  window.clearTimeout(durableTypingStopTimer);
  durableTypingStopTimer = 0;
}

function durableSocketOpen() {
  return durableSocket?.readyState === WebSocket.OPEN;
}

function sendDurableEvent(payload) {
  if (!durableSocketOpen()) return false;
  try {
    durableSocket.send(JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

function sendTyping(typing) {
  const next = Boolean(typing);
  if (!durableSocketOpen()) return false;
  if (next !== durableTypingState) {
    durableTypingState = next;
    sendDurableEvent({ type: 'typing', typing: next });
  }
  clearTypingTimer();
  if (next) {
    durableTypingStopTimer = window.setTimeout(() => {
      durableTypingState = false;
      sendDurableEvent({ type: 'typing', typing: false });
    }, DM_REALTIME_TYPING_STOP_MS);
  }
  return true;
}

function closeDurableSocket({ clearPresence = false } = {}) {
  window.clearTimeout(durableReconnectTimer);
  durableReconnectTimer = 0;
  clearTypingTimer();
  durableTypingState = false;
  const socket = durableSocket;
  durableSocket = null;
  durableConversationId = '';
  setTransportState(false);
  if (clearPresence) {
    setPeerTyping(false);
    setPeerPresence(false);
  }
  if (socket && socket.readyState < WebSocket.CLOSING) {
    try { socket.close(1000, 'conversation changed'); } catch {}
  }
}

function scheduleReconnect() {
  window.clearTimeout(durableReconnectTimer);
  if (!currentConversationId()) return;
  durableReconnectAttempt = Math.min(durableReconnectAttempt + 1, 5);
  const delay = Math.min(DM_REALTIME_RECONNECT_MAX_MS, 700 * (2 ** durableReconnectAttempt));
  durableReconnectTimer = window.setTimeout(() => void syncDurableRealtime(), delay);
}

function handleDurableMessage(event) {
  let payload;
  try {
    payload = JSON.parse(String(event.data || ''));
  } catch {
    return;
  }
  if (!payload || typeof payload !== 'object') return;
  if (payload.type === 'presence' && typeof payload.peer_online === 'boolean') {
    setPeerPresence(payload.peer_online);
    return;
  }
  if (payload.type === 'typing' && typeof payload.typing === 'boolean') {
    setPeerTyping(payload.typing);
  }
}

async function realtimeAccessToken() {
  const helper = window.__sautilinkDmRealtimeAuthHeaders;
  if (typeof helper !== 'function') return '';
  const headers = await helper().catch(() => ({}));
  const authorization = String(headers?.Authorization || '');
  return authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
}

async function openDurableRealtime(conversationId) {
  const token = await realtimeAccessToken();
  if (!token || currentConversationId() !== conversationId) return;

  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${scheme}//${window.location.host}/api/dm-realtime/${encodeURIComponent(conversationId)}`;
  let socket;
  try {
    socket = new WebSocket(url, [DM_REALTIME_PROTOCOL, `${DM_REALTIME_AUTH_PREFIX}${token}`]);
  } catch {
    scheduleReconnect();
    return;
  }

  durableSocket = socket;
  durableConversationId = conversationId;

  socket.addEventListener('open', () => {
    if (socket !== durableSocket || durableConversationId !== conversationId) return;
    durableReconnectAttempt = 0;
    setTransportState(true);
    sendDurableEvent({ type: 'ping' });
  });

  socket.addEventListener('message', (event) => {
    if (socket !== durableSocket || durableConversationId !== conversationId) return;
    handleDurableMessage(event);
  });

  socket.addEventListener('close', () => {
    if (socket !== durableSocket) return;
    durableSocket = null;
    setTransportState(false);
    clearTypingTimer();
    durableTypingState = false;
    scheduleReconnect();
  });

  socket.addEventListener('error', () => {
    // The close event owns fallback/reconnect behavior. Supabase Realtime remains active.
  });
}

async function syncDurableRealtime() {
  const wanted = currentConversationId();
  if (!wanted) {
    closeDurableSocket();
    return;
  }
  if (
    durableConversationId === wanted
    && durableSocket
    && (durableSocket.readyState === WebSocket.OPEN || durableSocket.readyState === WebSocket.CONNECTING)
  ) return;

  closeDurableSocket();
  await openDurableRealtime(wanted);
}

function queueDurableSync() {
  window.clearTimeout(durableSyncTimer);
  durableSyncTimer = window.setTimeout(() => void syncDurableRealtime(), 60);
}

const messageBody = document.getElementById('message-body');
messageBody?.addEventListener('input', () => {
  if (!durableSocketOpen()) return;
  sendTyping(Boolean(messageBody.value.trim()));
});

window.addEventListener('popstate', queueDurableSync);
window.addEventListener('online', queueDurableSync);
window.addEventListener('pagehide', () => closeDurableSocket());

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) queueDurableSync();
});

if (document.body) {
  new MutationObserver(queueDurableSync).observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['hidden', 'disabled'],
  });
}

queueDurableSync();
