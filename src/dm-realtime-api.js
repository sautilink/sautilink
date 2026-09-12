const REALTIME_PROTOCOL = 'sautilink-dm-v1';
const AUTH_PROTOCOL_PREFIX = 'sautilink-auth.';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  });
  if (!response.ok) return null;
  const user = await response.json().catch(() => null);
  return user?.id && UUID_PATTERN.test(user.id) ? user : null;
}

async function selectOne(config, token, table, params) {
  const query = new URLSearchParams({ ...params, limit: '1' });
  const response = await fetch(`${config.url}/rest/v1/${table}?${query}`, {
    headers: supabaseHeaders(config, token),
  });
  if (!response.ok) return null;
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function authorizeConversation(config, token, userId, conversationId) {
  const preferences = await selectOne(config, token, 'social_member_preferences', {
    user_id: `eq.${userId}`,
    select: 'activity_status',
  });
  if (!preferences?.activity_status) return { allowed: false, code: 'ACTIVITY_STATUS_DISABLED' };

  const conversation = await selectOne(config, token, 'dm_conversations', {
    id: `eq.${conversationId}`,
    select: 'id,member_one_id,member_two_id',
  });
  if (!conversation) return { allowed: false, code: 'CONVERSATION_UNAVAILABLE' };

  const memberOne = String(conversation.member_one_id || '');
  const memberTwo = String(conversation.member_two_id || '');
  if (userId !== memberOne && userId !== memberTwo) {
    return { allowed: false, code: 'CONVERSATION_UNAVAILABLE' };
  }

  const blockOr = [
    `and(blocker_id.eq.${memberOne},blocked_id.eq.${memberTwo})`,
    `and(blocker_id.eq.${memberTwo},blocked_id.eq.${memberOne})`,
  ].join(',');
  const blocked = await selectOne(config, token, 'social_blocks', {
    select: 'blocker_id,blocked_id',
    or: `(${blockOr})`,
  });
  if (blocked) return { allowed: false, code: 'MESSAGING_BLOCKED' };

  return {
    allowed: true,
    conversation,
    peerId: userId === memberOne ? memberTwo : memberOne,
  };
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

  const token = accessTokenFromProtocols(request);
  const user = await authenticate(config, token);
  if (!user) return apiError(401, 'AUTH_REQUIRED', 'Sign in again before opening realtime messaging.');

  const access = await authorizeConversation(config, token, user.id, conversationId);
  if (!access.allowed) {
    const message = access.code === 'ACTIVITY_STATUS_DISABLED'
      ? 'Activity status is disabled for this account.'
      : 'Realtime messaging is unavailable for this conversation.';
    return apiError(403, access.code, message);
  }

  const stub = durableStub(env.DM_REALTIME_HUB, conversationId);
  if (!stub) return apiError(503, 'REALTIME_NOT_READY', 'Realtime messaging is temporarily unavailable.');

  const headers = new Headers();
  headers.set('Upgrade', 'websocket');
  headers.set('Sec-WebSocket-Protocol', REALTIME_PROTOCOL);
  headers.set('X-Sauti-Conversation-ID', conversationId);
  headers.set('X-Sauti-User-ID', user.id);
  headers.set('X-Sauti-Peer-ID', access.peerId);

  return stub.fetch(new Request('https://durable.internal/connect', {
    method: 'GET',
    headers,
  }));
}
