const REALTIME_PROTOCOL = 'sautilink-dm-v1';
const AUTH_PROTOCOL_PREFIX = 'sautilink-auth.';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AUTHORIZATION_LEASE_MS = 30_000;

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function apiError(status, code, message) {
  return json(status, { ok: false, error: { code, message } });
}

function realtimeConfig(env) {
  const url = String(env?.DM_REALTIME_SUPABASE_URL || '').replace(/\/$/, '');
  const key = String(env?.DM_REALTIME_SUPABASE_KEY || '');
  return url && key ? { url, key } : null;
}

function parseProtocols(request) {
  return String(request.headers.get('Sec-WebSocket-Protocol') || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function accessTokenFromProtocols(request) {
  const auth = parseProtocols(request).find((value) => value.startsWith(AUTH_PROTOCOL_PREFIX));
  if (!auth) return '';
  const token = auth.slice(AUTH_PROTOCOL_PREFIX.length);
  return /^[A-Za-z0-9._-]{40,4096}$/.test(token) ? token : '';
}

function supabaseHeaders(config, token) {
  return {
    apikey: config.key,
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };
}

async function authenticate(config, token) {
  if (!token) return null;
  const response = await fetch(`${config.url}/auth/v1/user`, {
    headers: supabaseHeaders(config, token),
    redirect: 'error',
  });
  if (!response.ok) return null;
  const user = await response.json().catch(() => null);
  return user?.id && UUID_PATTERN.test(user.id) ? user : null;
}

async function authorizeConversation(config, token, userId, conversationId) {
  // Peer social_member_preferences and peer-owned social_blocks are hidden by RLS.
  // This narrow RPC checks dm_conversations membership, both activity_status choices,
  // bidirectional blocks and the live Auth session without exposing either preference.
  const response = await fetch(`${config.url}/rest/v1/rpc/dm_realtime_authorize_v1`, {
    method: 'POST',
    headers: { ...supabaseHeaders(config, token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_conversation_id: conversationId }),
    redirect: 'error',
  });
  if (!response.ok) return { allowed: false, code: 'CONVERSATION_UNAVAILABLE' };
  const result = await response.json().catch(() => null);
  const identified = result?.conversation_id === conversationId && result?.user_id === userId &&
    UUID_PATTERN.test(String(result?.peer_id || '')) && result.peer_id !== userId;
  if (result?.allowed === true && identified) return { allowed: true, peerId: result.peer_id };
  const code = ['AUTH_REQUIRED', 'CONVERSATION_UNAVAILABLE', 'ACTIVITY_STATUS_DISABLED', 'MESSAGING_BLOCKED']
    .includes(result?.code) ? result.code : 'CONVERSATION_UNAVAILABLE';
  // Only the RPC's already-validated participants may invalidate this conversation's DO.
  return { allowed: false, code,
    peerId: identified && ['ACTIVITY_STATUS_DISABLED', 'MESSAGING_BLOCKED'].includes(code)
      ? result.peer_id : null };
}

function accessTokenExpiry(token, userId) {
  // /auth/v1/user verifies this JWT before these claims are used. Decoding is not authentication.
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return 0;
    const claims = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return claims.sub === userId && UUID_PATTERN.test(String(claims.session_id || '')) &&
      Number.isSafeInteger(claims.exp) && claims.exp > 0 ? claims.exp * 1000 : 0;
  } catch { return 0; }
}

function durableStub(namespace, name) {
  if (!namespace) return null;
  if (typeof namespace.getByName === 'function') return namespace.getByName(name);
  if (typeof namespace.idFromName === 'function' && typeof namespace.get === 'function') {
    return namespace.get(namespace.idFromName(name));
  }
  return null;
}

export async function handleDmRealtimeRequest(request, env) {
  const url = new URL(request.url);

  if (url.pathname === '/api/dm-realtime/status' && request.method === 'GET') {
    return json(200, {
      ok: true,
      data: {
        ready: Boolean(env?.DM_REALTIME_HUB) && Boolean(realtimeConfig(env)),
        transport: 'durable-object-websocket-hibernation',
        protocol: REALTIME_PROTOCOL,
      },
    });
  }

  const match = url.pathname.match(/^\/api\/dm-realtime\/([0-9a-f-]{36})$/i);
  if (!match) return null;
  if (request.method !== 'GET') return apiError(405, 'METHOD_NOT_ALLOWED', 'Use GET to open realtime messaging.');
  if (String(request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
    return apiError(426, 'WEBSOCKET_REQUIRED', 'Open this endpoint as a WebSocket connection.');
  }

  const conversationId = match[1].toLowerCase();
  if (!UUID_PATTERN.test(conversationId)) return apiError(404, 'CONVERSATION_UNAVAILABLE', 'This conversation is unavailable.');
  if (!parseProtocols(request).includes(REALTIME_PROTOCOL)) {
    return apiError(400, 'REALTIME_PROTOCOL_REQUIRED', 'The SautiLink realtime protocol is required.');
  }

  const config = realtimeConfig(env);
  if (!config || !env?.DM_REALTIME_HUB) {
    return apiError(503, 'REALTIME_NOT_READY', 'Realtime messaging is temporarily unavailable.');
  }

  const authorizationStartedAt = Date.now();
  const token = accessTokenFromProtocols(request);
  const user = await authenticate(config, token).catch(() => null);
  if (!user) return apiError(401, 'AUTH_REQUIRED', 'Sign in again before opening realtime messaging.');

  const expiresAt = Math.min(accessTokenExpiry(token, user.id), authorizationStartedAt + AUTHORIZATION_LEASE_MS);
  if (expiresAt <= Date.now()) return apiError(401, 'AUTH_REQUIRED', 'Sign in again before opening realtime messaging.');

  const access = await authorizeConversation(config, token, user.id, conversationId)
    .catch(() => ({ allowed: false, code: 'CONVERSATION_UNAVAILABLE' }));
  if (!access.allowed) {
    if (access.peerId) {
      const deniedStub = durableStub(env.DM_REALTIME_HUB, conversationId);
      if (deniedStub) await deniedStub.fetch(new Request('https://durable.internal/revoke', {
        method: 'POST', headers: { 'X-Sauti-Conversation-ID': conversationId,
          'X-Sauti-User-ID': user.id, 'X-Sauti-Peer-ID': access.peerId },
      })).catch(() => {});
    }
    const message = access.code === 'ACTIVITY_STATUS_DISABLED'
      ? 'Activity status is unavailable for this conversation.'
      : 'Realtime messaging is unavailable for this conversation.';
    return apiError(access.code === 'AUTH_REQUIRED' ? 401 : 403, access.code, message);
  }
  if (expiresAt <= Date.now()) return apiError(401, 'AUTH_REQUIRED', 'Sign in again before opening realtime messaging.');

  const stub = durableStub(env.DM_REALTIME_HUB, conversationId);
  if (!stub) return apiError(503, 'REALTIME_NOT_READY', 'Realtime messaging is temporarily unavailable.');

  const headers = new Headers();
  headers.set('Upgrade', 'websocket');
  headers.set('Sec-WebSocket-Protocol', REALTIME_PROTOCOL);
  headers.set('X-Sauti-Conversation-ID', conversationId);
  headers.set('X-Sauti-User-ID', user.id);
  headers.set('X-Sauti-Peer-ID', access.peerId);
  headers.set('X-Sauti-Authorization-Checked-At', String(authorizationStartedAt));
  headers.set('X-Sauti-Authorization-Expires-At', String(expiresAt));

  return stub.fetch(new Request('https://durable.internal/connect', {
    method: 'GET',
    headers,
  }));
}
