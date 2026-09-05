const SUPABASE_URL = 'https://rggpyiterdbbugluejcs.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_omJ-5Mem-K4vgm6WLXRzJQ_jeGs65ca';

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

function authorization(request) {
  const value = request.headers.get('Authorization') || '';
  return /^Bearer\s+[^\s]+$/i.test(value) ? value : '';
}

function supabaseHeaders(auth = '') {
  const headers = {
    apikey: SUPABASE_PUBLISHABLE_KEY,
    Accept: 'application/json',
  };
  if (auth) headers.Authorization = auth;
  return headers;
}

async function authenticate(request) {
  const auth = authorization(request);
  if (!auth) return null;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: supabaseHeaders(auth) });
  if (!response.ok) return null;
  const user = await response.json().catch(() => null);
  return user?.id ? { auth, user } : null;
}

async function consumeLimit(binding, key) {
  if (!binding?.limit) return { ready: false, allowed: false };
  const result = await binding.limit({ key });
  return { ready: true, allowed: Boolean(result?.success) };
}

async function requireSession(request, env) {
  const session = await authenticate(request);
  if (!session) return { response: apiError(401, 'AUTH_REQUIRED', 'Sign in before using account controls.') };

  const limited = await consumeLimit(env.ACCOUNT_CONTROL_LIMITER, session.user.id);
  if (!limited.ready) return { response: apiError(503, 'RATE_LIMIT_NOT_READY', 'Account controls are not ready yet.') };
  if (!limited.allowed) return { response: apiError(429, 'RATE_LIMITED', 'Account controls are being requested too quickly. Try again shortly.') };

  return { session };
}

async function rest(path, { method = 'GET', auth = '', body, prefer } = {}) {
  const headers = supabaseHeaders(auth);
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function uuid(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)
    ? normalized
    : '';
}

async function readExport(session) {
  const params = new URLSearchParams({
    user_id: `eq.${session.user.id}`,
    select: 'request_id,status,requested_at,updated_at,completed_at,expires_at,cancelled_at',
    order: 'requested_at.desc',
    limit: '1',
  });
  const response = await rest(`social_data_export_requests?${params}`, { auth: session.auth });
  if (!response.ok) return { error: true };
  const rows = await response.json().catch(() => []);
  return { request: Array.isArray(rows) ? rows[0] || null : null };
}

async function exportState(request, env) {
  const gate = await requireSession(request, env);
  if (gate.response) return gate.response;

  const result = await readExport(gate.session);
  if (result.error) return apiError(409, 'EXPORT_STATE_FAILED', 'Your data export status could not be checked.');
  return json(200, { ok: true, data: result });
}

async function requestExport(request, env) {
  const gate = await requireSession(request, env);
  if (gate.response) return gate.response;

  const current = await readExport(gate.session);
  if (current.error) return apiError(409, 'EXPORT_STATE_FAILED', 'Your data export status could not be checked.');
  if (current.request && ['pending', 'processing', 'ready'].includes(current.request.status)) {
    return json(200, { ok: true, data: { request: current.request, idempotent: true } });
  }

  const payload = await request.json().catch(() => null);
  const requestId = uuid(payload?.request_id);
  if (!requestId) return apiError(400, 'REQUEST_ID_REQUIRED', 'A valid export request id is required.');

  const response = await rest(
    'social_data_export_requests?select=request_id,status,requested_at,updated_at,completed_at,expires_at,cancelled_at',
    {
      method: 'POST',
      auth: gate.session.auth,
      prefer: 'return=representation',
      body: {
        request_id: requestId,
        user_id: gate.session.user.id,
      },
    },
  );

  if (!response.ok) {
    const provider = await response.json().catch(() => null);
    if (String(provider?.code || '') === '23505') {
      const duplicate = await readExport(gate.session);
      if (!duplicate.error && duplicate.request) {
        return json(200, { ok: true, data: { request: duplicate.request, idempotent: true } });
      }
    }
    return apiError(409, 'EXPORT_REQUEST_FAILED', 'Your data export request could not be saved.');
  }

  const rows = await response.json().catch(() => []);
  const row = Array.isArray(rows) ? rows[0] || null : null;
  if (!row) return apiError(409, 'EXPORT_REQUEST_FAILED', 'Your data export request could not be saved.');
  return json(201, { ok: true, data: { request: row, idempotent: false } });
}

async function cancelExport(request, env) {
  const gate = await requireSession(request, env);
  if (gate.response) return gate.response;

  const params = new URLSearchParams({
    user_id: `eq.${gate.session.user.id}`,
    status: 'in.(pending,processing,ready)',
    select: 'request_id,status,requested_at,updated_at,completed_at,expires_at,cancelled_at',
  });

  const response = await rest(`social_data_export_requests?${params}`, {
    method: 'PATCH',
    auth: gate.session.auth,
    prefer: 'return=representation',
    body: { status: 'cancelled' },
  });
  if (!response.ok) return apiError(409, 'EXPORT_CANCEL_FAILED', 'Your data export request could not be cancelled.');

  const rows = await response.json().catch(() => []);
  return json(200, { ok: true, data: { request: Array.isArray(rows) ? rows[0] || null : null } });
}

async function identityState(request, env) {
  const gate = await requireSession(request, env);
  if (gate.response) return gate.response;

  const profileParams = new URLSearchParams({
    id: `eq.${gate.session.user.id}`,
    select: 'id,username,display_name,is_verified,verification_badge_type,username_locked_at',
    limit: '1',
  });
  const eventParams = new URLSearchParams({
    user_id: `eq.${gate.session.user.id}`,
    select: 'change_type,changed_at',
    order: 'changed_at.desc',
    limit: '20',
  });

  const [profileResponse, eventResponse] = await Promise.all([
    rest(`social_profiles?${profileParams}`, { auth: gate.session.auth }),
    rest(`social_identity_change_events?${eventParams}`, { auth: gate.session.auth }),
  ]);

  if (!profileResponse.ok || !eventResponse.ok) {
    return apiError(409, 'IDENTITY_STATE_FAILED', 'Your name and username change status could not be checked.');
  }

  const profileRows = await profileResponse.json().catch(() => []);
  const eventRows = await eventResponse.json().catch(() => []);
  const profile = Array.isArray(profileRows) ? profileRows[0] || null : null;
  if (!profile) return apiError(404, 'PROFILE_UNAVAILABLE', 'Your social profile is unavailable.');

  const usernameLocked = Boolean(profile.username_locked_at || profile.is_verified);
  delete profile.username_locked_at;

  const now = Date.now();
  const currentDate = new Date(now);
  const monthStart = Date.UTC(currentDate.getUTCFullYear(), currentDate.getUTCMonth(), 1);
  const nextMonthStart = Date.UTC(currentDate.getUTCFullYear(), currentDate.getUTCMonth() + 1, 1);
  const events = Array.isArray(eventRows) ? eventRows : [];
  const nameEvents = events.filter((row) =>
    row.change_type === 'display_name' &&
    now - Date.parse(row.changed_at || 0) < 14 * 24 * 60 * 60 * 1000
  );
  const verifiedMonthlyNameEvents = events.filter((row) => {
    const changedAt = Date.parse(row.changed_at || 0);
    return row.change_type === 'display_name' && changedAt >= monthStart && changedAt < nextMonthStart;
  });
  const usernameEvents = events.filter((row) =>
    row.change_type === 'username' &&
    now - Date.parse(row.changed_at || 0) < 30 * 24 * 60 * 60 * 1000
  );
  const oldestNameWindowEvent = nameEvents[nameEvents.length - 1] || null;
  const latestUsernameEvent = usernameEvents[0] || null;
  const verifiedNameLimitReached = profile.is_verified && verifiedMonthlyNameEvents.length >= 2;

  return json(200, {
    ok: true,
    data: {
      profile,
      display_name: {
        requires_review: false,
        policy: profile.is_verified ? 'verified_calendar_month' : 'standard_14_days',
        changes_used_month: profile.is_verified ? verifiedMonthlyNameEvents.length : null,
        changes_remaining_month: profile.is_verified ? Math.max(0, 2 - verifiedMonthlyNameEvents.length) : null,
        changes_used_14_days: profile.is_verified ? null : nameEvents.length,
        changes_remaining_14_days: profile.is_verified ? null : Math.max(0, 2 - nameEvents.length),
        next_change_at: profile.is_verified
          ? verifiedNameLimitReached ? new Date(nextMonthStart).toISOString() : null
          : nameEvents.length >= 2 && oldestNameWindowEvent
            ? new Date(Date.parse(oldestNameWindowEvent.changed_at) + 14 * 24 * 60 * 60 * 1000).toISOString()
            : null,
        pending_request: null,
      },
      username: {
        locked_permanently: usernameLocked,
        changes_used_30_days: usernameLocked ? null : usernameEvents.length,
        changes_remaining_30_days: usernameLocked ? 0 : Math.max(0, 1 - usernameEvents.length),
        next_change_at: usernameLocked
          ? null
          : latestUsernameEvent
            ? new Date(Date.parse(latestUsernameEvent.changed_at) + 30 * 24 * 60 * 60 * 1000).toISOString()
            : null,
      },
    },
  });
}

function identityProviderError(provider) {
  const message = String(provider?.message || provider?.details || '');
  if (message.includes('VERIFIED_DISPLAY_NAME_MONTHLY_LIMIT')) {
    return apiError(409, 'VERIFIED_DISPLAY_NAME_MONTHLY_LIMIT', 'Verified accounts can change their display name up to twice per calendar month.');
  }
  if (message.includes('USERNAME_LOCKED_VERIFIED')) {
    return apiError(409, 'USERNAME_LOCKED_VERIFIED', 'This username is permanently locked because this account has been verified.');
  }
  if (message.includes('DISPLAY_NAME_CHANGE_LIMIT')) {
    return apiError(409, 'DISPLAY_NAME_CHANGE_LIMIT', 'You can change your name up to twice in 14 days.');
  }
  if (message.includes('DISPLAY_NAME_REQUEST_PENDING')) {
    return apiError(409, 'DISPLAY_NAME_REQUEST_PENDING', 'Your verified-account name change request is already waiting for review.');
  }
  if (message.includes('USERNAME_CHANGE_LIMIT')) {
    return apiError(409, 'USERNAME_CHANGE_LIMIT', 'You can change your username once every 30 days.');
  }
  if (message.includes('USERNAME_TAKEN') || String(provider?.code || '') === '23505') {
    return apiError(409, 'USERNAME_TAKEN', 'That username is already taken.');
  }
  if (message.includes('USERNAME_RESERVED')) {
    return apiError(400, 'USERNAME_RESERVED', 'That username is reserved by SautiLink.');
  }
  if (message.includes('USERNAME_INVALID')) {
    return apiError(400, 'USERNAME_INVALID', 'Use 3–30 lowercase letters, numbers, dots or underscores for your username.');
  }
  if (message.includes('DISPLAY_NAME_INVALID')) {
    return apiError(400, 'DISPLAY_NAME_INVALID', 'Your name must be between 1 and 80 characters.');
  }
  return apiError(409, 'IDENTITY_CHANGE_FAILED', 'Your profile identity could not be updated.');
}

async function changeIdentity(request, env) {
  const gate = await requireSession(request, env);
  if (gate.response) return gate.response;

  const contentLength = Number(request.headers.get('Content-Length') || '0');
  if (contentLength > 4096) return apiError(413, 'IDENTITY_REQUEST_TOO_LARGE', 'This identity request is too large.');

  const payload = await request.json().catch(() => null);
  const changeType = String(payload?.field || '').trim().toLowerCase();
  const value = String(payload?.value || '').trim();
  const requestId = uuid(payload?.request_id);

  if (!['display_name', 'username'].includes(changeType)) {
    return apiError(400, 'IDENTITY_FIELD_INVALID', 'Choose name or username.');
  }
  if (!requestId) return apiError(400, 'REQUEST_ID_REQUIRED', 'A valid request id is required.');

  const response = await rest('rpc/change_social_identity', {
    method: 'POST',
    auth: gate.session.auth,
    body: {
      p_change_type: changeType,
      p_value: value,
      p_request_id: requestId,
    },
  });

  if (!response.ok) {
    const provider = await response.json().catch(() => null);
    return identityProviderError(provider);
  }

  const data = await response.json().catch(() => null);
  return json(data?.status === 'pending' ? 202 : 200, { ok: true, data });
}

export async function handleAccountControlRequest(request, env) {
  const path = new URL(request.url).pathname;

  if (path === '/api/account/export') {
    if (request.method === 'GET') return exportState(request, env);
    if (request.method === 'POST') return requestExport(request, env);
    if (request.method === 'DELETE') return cancelExport(request, env);
  }

  if (path === '/api/account/identity') {
    if (request.method === 'GET') return identityState(request, env);
    if (request.method === 'POST') return changeIdentity(request, env);
  }

  return null;
}
