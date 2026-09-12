import { DurableObject } from 'cloudflare:workers';

const REALTIME_PROTOCOL = 'sautilink-dm-v1';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_EVENT_BYTES = 1024;
const MIN_EVENT_INTERVAL_MS = 120;

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

export class DmRealtimeHub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
  }

  sockets(exclude = null) {
    return this.ctx.getWebSockets().filter((socket) => socket !== exclude && socket.readyState === 1);
  }

  broadcastPresence(exclude = null) {
    const sockets = this.sockets(exclude);
    const sessions = sockets
      .map((socket) => ({ socket, state: attachmentOf(socket) }))
      .filter(({ state }) => UUID_PATTERN.test(String(state?.userId || '')));

    for (const session of sessions) {
      const peerOnline = sessions.some((candidate) => candidate.state.userId !== session.state.userId);
      safeSend(session.socket, {
        type: 'presence',
        peer_online: peerOnline,
        transport: 'durable-object',
        at: Date.now(),
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

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({
      conversationId,
      userId,
      peerId,
      connectedAt: Date.now(),
      lastEventAt: 0,
    });

    safeSend(server, {
      type: 'ready',
      transport: 'durable-object',
      at: Date.now(),
    });
    this.broadcastPresence();

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
    this.broadcastTyping(socket, false);
    this.broadcastPresence(socket);
  }

  async webSocketError(socket) {
    this.broadcastTyping(socket, false);
    this.broadcastPresence(socket);
  }
}
