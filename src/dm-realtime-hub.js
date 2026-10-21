import { DurableObject } from 'cloudflare:workers';

const REALTIME_PROTOCOL = 'sautilink-dm-v1';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_EVENT_BYTES = 1024;
const MIN_EVENT_INTERVAL_MS = 120;
const AUTHORIZATION_LEASE_MS = 30_000;
const RECENT_PRESENCE_MS = AUTHORIZATION_LEASE_MS;
const REVOCATION_KEY = 'authorization-revoked-at';

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
  } catch { return null; }
}

function authorizedSession(state, now = Date.now()) {
  return state && [state.conversationId, state.userId, state.peerId].every(
    (id) => typeof id === 'string' && UUID_PATTERN.test(id),
  ) && state.userId !== state.peerId && Number.isSafeInteger(state.connectedAt) &&
    Number.isSafeInteger(state.authorizationCheckedAt) && state.authorizationCheckedAt > 0 &&
    state.authorizationCheckedAt <= state.connectedAt && state.connectedAt <= now &&
    Number.isSafeInteger(state.authorizationExpiresAt) &&
    state.authorizationExpiresAt > now &&
    state.authorizationExpiresAt <= state.authorizationCheckedAt + AUTHORIZATION_LEASE_MS;
}

function lastSeenKey(userId) {
  return 'last-seen:' + userId;
}

function recentLastSeen(value, now = Date.now()) {
  // Old bare timestamps have no authorization deadline and must never become visible.
  if (!value || typeof value !== 'object' || !Number.isSafeInteger(value.at) ||
      !Number.isSafeInteger(value.authorizationExpiresAt)) return 0;
  const age = now - value.at;
  return value.at > 0 && age >= 0 && age <= RECENT_PRESENCE_MS &&
    value.authorizationExpiresAt > now &&
    value.authorizationExpiresAt <= value.at + AUTHORIZATION_LEASE_MS ? value.at : 0;
}

export class DmRealtimeHub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.authorizationGeneration = 0;
  }

  sockets(exclude = null) {
    return this.ctx.getWebSockets().filter((socket) => socket !== exclude && socket.readyState === 1);
  }

  sessions(exclude = null, now = Date.now()) {
    return this.sockets(exclude)
      .map((socket) => ({ socket, state: attachmentOf(socket) }))
      .filter(({ state }) => authorizedSession(state, now));
  }

  userHasOpenSocket(userId, exclude = null) {
    return this.sessions(exclude).some(({ state }) => state.userId === userId);
  }

  closeUnauthorized(socket) {
    // Clear the old client's visible presence before closing. No private timestamp is sent.
    safeSend(socket, { type: 'typing', typing: false, transport: 'durable-object', at: Date.now() });
    safeSend(socket, { type: 'presence', peer_online: false, peer_last_seen_at: null,
      transport: 'durable-object', at: Date.now() });
    try {
      socket.serializeAttachment({ authorizationExpiresAt: 0 });
      socket.close(1008, 'Realtime authorization must be renewed');
    } catch { /* Runtime owns socket cleanup. */ }
  }

  async noteLastSeen(session, at = Date.now()) {
    if (!authorizedSession(session, at)) return;
    await this.ctx.storage.put(lastSeenKey(session.userId),
      { at, authorizationExpiresAt: session.authorizationExpiresAt });
  }

  async storedRecentLastSeen(userId, now = Date.now()) {
    if (!UUID_PATTERN.test(String(userId || ''))) return 0;
    const key = lastSeenKey(userId);
    const stored = await this.ctx.storage.get(key);
    const at = recentLastSeen(stored, Math.max(now, Date.now()));
    if (stored !== undefined && !at) await this.ctx.storage.delete(key);
    return at;
  }

  async reconcileAuthorization(exclude = null) {
    const now = Date.now();
    for (const socket of this.sockets(exclude)) {
      if (!authorizedSession(attachmentOf(socket), now)) this.closeUnauthorized(socket);
    }
    // At most the two participant timestamps live in this per-conversation Object.
    // Alarms remove expired records even after all sockets have closed/hibernated.
    const stored = await this.ctx.storage.list({ prefix: 'last-seen:' });
    const deadlines = this.sessions(exclude, now).map(({ state }) => state.authorizationExpiresAt);
    for (const [key, value] of stored) {
      if (!recentLastSeen(value, now)) await this.ctx.storage.delete(key);
      else deadlines.push(value.authorizationExpiresAt);
    }
    if (deadlines.length) await this.ctx.storage.setAlarm(Math.min(...deadlines));
    else await this.ctx.storage.deleteAlarm();
  }

  async broadcastPresence(exclude = null) {
    await this.reconcileAuthorization(exclude);
    for (const session of this.sessions(exclude)) {
      if (!authorizedSession(attachmentOf(session.socket))) continue;
      const peerOnline = this.sessions(exclude).some(({ state }) =>
        state.userId === session.state.peerId && state.peerId === session.state.userId &&
        state.conversationId === session.state.conversationId);
      const peerLastSeenAt = peerOnline ? 0 : await this.storedRecentLastSeen(session.state.peerId);
      // Storage awaits can straddle the deadline. Never publish under the old lease.
      if (!authorizedSession(attachmentOf(session.socket))) {
        this.closeUnauthorized(session.socket);
        continue;
      }
      safeSend(session.socket, {
        type: 'presence', peer_online: peerOnline,
        peer_last_seen_at: peerLastSeenAt || null, transport: 'durable-object', at: Date.now(),
      });
    }
  }

  broadcastTyping(senderSocket, typing) {
    const sender = attachmentOf(senderSocket);
    if (!authorizedSession(sender)) return;
    for (const { socket, state } of this.sessions(senderSocket)) {
      if (state.userId !== sender.peerId || state.peerId !== sender.userId ||
          state.conversationId !== sender.conversationId) continue;
      safeSend(socket, { type: 'typing', typing: Boolean(typing),
        transport: 'durable-object', at: Date.now() });
    }
  }

  async fetch(request) {
    const path = new URL(request.url).pathname;
    const conversationId = String(request.headers.get('X-Sauti-Conversation-ID') || '').toLowerCase();
    const userId = String(request.headers.get('X-Sauti-User-ID') || '').toLowerCase();
    const peerId = String(request.headers.get('X-Sauti-Peer-ID') || '').toLowerCase();
    if (![conversationId, userId, peerId].every((id) => UUID_PATTERN.test(id)) || userId === peerId) {
      return new Response('Invalid realtime session', { status: 400 });
    }

    if (path === '/revoke' && request.method === 'POST') {
      // Only the authenticated participant RPC in the parent Worker can send this internal request.
      this.authorizationGeneration++;
      for (const socket of this.sockets()) this.closeUnauthorized(socket);
      await this.ctx.storage.put(REVOCATION_KEY, Date.now());
      await this.ctx.storage.delete([lastSeenKey(userId), lastSeenKey(peerId)]);
      await this.reconcileAuthorization();
      return new Response(null, { status: 204 });
    }
    if (path !== '/connect') return new Response('Not found', { status: 404 });
    if (request.method !== 'GET' || String(request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
      return new Response('WebSocket required', { status: 426 });
    }
    if (String(request.headers.get('Sec-WebSocket-Protocol') || '') !== REALTIME_PROTOCOL) {
      return new Response('Protocol required', { status: 400 });
    }
    const now = Date.now();
    const authorizationCheckedAt = Number(request.headers.get('X-Sauti-Authorization-Checked-At'));
    const authorizationExpiresAt = Number(request.headers.get('X-Sauti-Authorization-Expires-At'));
    if (!Number.isSafeInteger(authorizationCheckedAt) || authorizationCheckedAt <= 0 ||
        authorizationCheckedAt > now || !Number.isSafeInteger(authorizationExpiresAt) ||
        authorizationExpiresAt <= now || authorizationExpiresAt > authorizationCheckedAt + AUTHORIZATION_LEASE_MS) {
      return new Response('Authorization expired', { status: 401 });
    }
    const generation = this.authorizationGeneration;
    const revokedAt = await this.ctx.storage.get(REVOCATION_KEY);
    if (generation !== this.authorizationGeneration ||
        (Number.isSafeInteger(revokedAt) && authorizationCheckedAt <= revokedAt) ||
        authorizationExpiresAt <= Date.now()) return new Response('Authorization expired', { status: 401 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    const session = { conversationId, userId, peerId, connectedAt: now,
      authorizationCheckedAt, authorizationExpiresAt, lastEventAt: 0 };
    // IDs and bounded deadlines only. Credentials never enter attachments or durable storage.
    server.serializeAttachment(session);
    await this.noteLastSeen(session, now);
    if (generation !== this.authorizationGeneration) {
      this.closeUnauthorized(server);
      await this.ctx.storage.delete([lastSeenKey(userId), lastSeenKey(peerId)]);
    }
    await this.reconcileAuthorization();
    if (authorizedSession(attachmentOf(server))) {
      safeSend(server, { type: 'ready', transport: 'durable-object', at: now });
      await this.broadcastPresence();
    }
    return new Response(null, { status: 101, webSocket: client,
      headers: { 'Sec-WebSocket-Protocol': REALTIME_PROTOCOL } });
  }

  async webSocketMessage(socket, message) {
    if (socket.readyState !== 1) return;
    const session = attachmentOf(socket);
    if (!authorizedSession(session)) {
      this.closeUnauthorized(socket);
      await this.reconcileAuthorization();
      return;
    }
    if (typeof message !== 'string' || message.length > MAX_EVENT_BYTES) return;
    const now = Date.now();
    if (now - Number(session.lastEventAt || 0) < MIN_EVENT_INTERVAL_MS) return;
    let payload;
    try { payload = JSON.parse(message); } catch { return; }
    if (!payload || typeof payload !== 'object') return;
    if (payload.type !== 'ping' && !(payload.type === 'typing' && typeof payload.typing === 'boolean')) return;
    // Rebuild the attachment with an explicit allowlist, including after hibernation.
    socket.serializeAttachment({ conversationId: session.conversationId, userId: session.userId,
      peerId: session.peerId, connectedAt: session.connectedAt,
      authorizationCheckedAt: session.authorizationCheckedAt,
      authorizationExpiresAt: session.authorizationExpiresAt, lastEventAt: now });
    // Reserve the interval before storage awaits; floods cannot bypass the rate gate
    // or force a storage scan for malformed/oversized/unrecognized events.
    await this.reconcileAuthorization();
    if (!authorizedSession(attachmentOf(socket))) return;
    if (payload.type === 'typing' && typeof payload.typing === 'boolean') {
      this.broadcastTyping(socket, payload.typing);
    } else if (payload.type === 'ping') {
      safeSend(socket, { type: 'pong', at: now, transport: 'durable-object' });
    }
  }

  async finishSocket(socket) {
    const session = attachmentOf(socket);
    this.broadcastTyping(socket, false);
    if (authorizedSession(session) && !this.userHasOpenSocket(session.userId, socket)) {
      await this.noteLastSeen(session);
    }
    await this.broadcastPresence(socket);
  }

  async webSocketClose(socket, code) {
    // Complete the hibernating socket's close handshake before storage awaits.
    // This is harmless when the runtime already replied, and also works on
    // runtimes that leave the socket half-open until the handler acknowledges it.
    // Do not reflect client-provided reasons or reserved/control close codes.
    const replyCode = Number.isInteger(code) && (code === 1000 || (code >= 3000 && code <= 4999)) ? code : 1000;
    try { socket.close(replyCode, ''); } catch { /* Already disconnected; still reconcile presence. */ }
    await this.finishSocket(socket);
  }
  async webSocketError(socket) { await this.finishSocket(socket); }
  async alarm() { await this.broadcastPresence(); }
}
