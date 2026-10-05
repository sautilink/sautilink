import { DurableObject } from 'cloudflare:workers';

const REALTIME_PROTOCOL = 'sautilink-dm-v1';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_EVENT_BYTES = 1024;
const MIN_EVENT_INTERVAL_MS = 120;
const RECENT_PRESENCE_MS = 5 * 24 * 60 * 60 * 1000;

function safeSend(socket, payload) {
  try {
    if (socket.readyState === 1) socket.send(JSON.stringify(payload));
  } catch {
    // A closing peer is removed by the runtime; realtime state is best effort.
  }
}

function attachmentOf(socket) {
  try {
    const value = socket.deserializeAttachment();
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

function lastSeenKey(userId) {
  return 'last-seen:' + userId;
}

function recentLastSeen(value, now = Date.now()) {
  const timestamp = Number(value || 0);
  const age = now - timestamp;
  return Number.isFinite(timestamp)
    && timestamp > 0
    && age >= 0
    && age <= RECENT_PRESENCE_MS
    ? timestamp
    : 0;
}

export class DmRealtimeHub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
  }

  sockets(exclude = null) {
    return this.ctx.getWebSockets().filter((socket) => socket !== exclude && socket.readyState === 1);
  }

  sessions(exclude = null) {
    return this.sockets(exclude)
      .map((socket) => ({ socket, state: attachmentOf(socket) }))
      .filter(({ state }) => UUID_PATTERN.test(String(state?.userId || '')));
  }

  userHasOpenSocket(userId, exclude = null) {
    return this.sessions(exclude).some(({ state }) => state.userId === userId);
  }

  async noteLastSeen(userId, at = Date.now()) {
    if (!UUID_PATTERN.test(String(userId || ''))) return;
    await this.ctx.storage.put(lastSeenKey(userId), at);
  }

  async storedRecentLastSeen(userId, now = Date.now()) {
    if (!UUID_PATTERN.test(String(userId || ''))) return 0;
    const stored = await this.ctx.storage.get(lastSeenKey(userId));
    return recentLastSeen(stored, now);
  }

  async broadcastPresence(exclude = null) {
    const sessions = this.sessions(exclude);
    const now = Date.now();

    for (const session of sessions) {
      const peerOnline = sessions.some((candidate) => candidate.state.userId !== session.state.userId);
      const peerLastSeenAt = peerOnline
        ? 0
        : await this.storedRecentLastSeen(session.state.peerId, now);

      safeSend(session.socket, {
        type: 'presence',
        peer_online: peerOnline,
        peer_last_seen_at: peerLastSeenAt || null,
        transport: 'durable-object',
        at: now,
      });
    }
  }

  broadcastTyping(senderSocket, typing) {
    const sender = attachmentOf(senderSocket);
    if (!sender?.userId) return;
    for (const socket of this.sockets(senderSocket)) {
      const target = attachmentOf(socket);
      if (!target?.userId || target.userId === sender.userId) continue;
      safeSend(socket, {
        type: 'typing',
        typing: Boolean(typing),
        transport: 'durable-object',
        at: Date.now(),
      });
    }
  }

  async fetch(request) {
    if (new URL(request.url).pathname !== '/connect') return new Response('Not found', { status: 404 });
    if (String(request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
      return new Response('WebSocket required', { status: 426 });
    }
    if (String(request.headers.get('Sec-WebSocket-Protocol') || '') !== REALTIME_PROTOCOL) {
      return new Response('Protocol required', { status: 400 });
    }

    const conversationId = String(request.headers.get('X-Sauti-Conversation-ID') || '').toLowerCase();
    const userId = String(request.headers.get('X-Sauti-User-ID') || '').toLowerCase();
    const peerId = String(request.headers.get('X-Sauti-Peer-ID') || '').toLowerCase();
    if (![conversationId, userId, peerId].every((value) => UUID_PATTERN.test(value)) || userId === peerId) {
      return new Response('Invalid realtime session', { status: 400 });
    }

    const now = Date.now();
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({
      conversationId,
      userId,
      peerId,
      connectedAt: now,
      lastEventAt: 0,
    });

    // Only a coarse conversation-presence timestamp is persisted here; no message content.
    await this.noteLastSeen(userId, now);

    safeSend(server, {
      type: 'ready',
      transport: 'durable-object',
      at: now,
    });
    await this.broadcastPresence();

    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { 'Sec-WebSocket-Protocol': REALTIME_PROTOCOL },
    });
  }

  async webSocketMessage(socket, message) {
    if (typeof message !== 'string' || message.length > MAX_EVENT_BYTES) return;
    const session = attachmentOf(socket);
    if (!session?.userId) return;

    const now = Date.now();
    if (now - Number(session.lastEventAt || 0) < MIN_EVENT_INTERVAL_MS) return;

    let payload;
    try {
      payload = JSON.parse(message);
    } catch {
      return;
    }
    if (!payload || typeof payload !== 'object') return;

    session.lastEventAt = now;
    socket.serializeAttachment(session);

    if (payload.type === 'typing' && typeof payload.typing === 'boolean') {
      this.broadcastTyping(socket, payload.typing);
      return;
    }
    if (payload.type === 'ping') {
      safeSend(socket, { type: 'pong', at: now, transport: 'durable-object' });
    }
  }

  async webSocketClose(socket) {
    const session = attachmentOf(socket);
    this.broadcastTyping(socket, false);
    if (session?.userId && !this.userHasOpenSocket(session.userId, socket)) {
      await this.noteLastSeen(session.userId);
    }
    await this.broadcastPresence(socket);
  }

  async webSocketError(socket) {
    const session = attachmentOf(socket);
    this.broadcastTyping(socket, false);
    if (session?.userId && !this.userHasOpenSocket(session.userId, socket)) {
      await this.noteLastSeen(session.userId);
    }
    await this.broadcastPresence(socket);
  }
}
