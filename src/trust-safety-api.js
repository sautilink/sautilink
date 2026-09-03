const SUPABASE_URL = 'https://rggpyiterdbbugluejcs.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_omJ-5Mem-K4vgm6WLXRzJQ_jeGs65ca';

const REPORT_REASONS = new Set(['spam', 'harassment', 'hate', 'impersonation', 'privacy', 'other']);
const REPORT_TARGETS = new Set(['profile', 'post', 'comment', 'message']);

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

  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: supabaseHeaders(auth),
  });
  if (!response.ok) return null;

  const user = await response.json().catch(() => null);
  return user?.id ? { auth, user } : null;
}

function recentlySignedIn(user, maxAgeMs = 24 * 60 * 60 * 1000) {
  const timestamp = Date.parse(String(user?.last_sign_in_at || ''));
  return Number.isFinite(timestamp) && Date.now() - timestamp <= maxAgeMs;
}

async function consumeLimit(binding, key) {
  if (!binding?.limit) return { ready: false, allowed: false };
  const result = await binding.limit({ key });
  return { ready: true, allowed: Boolean(result?.success) };
}

async function requireSessionAndLimit(request, binding, message) {
  const session = await authenticate(request);
  if (!session) return { response: apiError(401, 'AUTH_REQUIRED', 'Sign in before using account safety controls.') };

  const limited = await consumeLimit(binding, session.user.id);
  if (!limited.ready) return { response: apiError(503, 'RATE_LIMIT_NOT_READY', 'Account safety controls are not ready yet.') };
  if (!limited.allowed) return { response: apiError(429, 'RATE_LIMITED', message) };

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
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(normalized)
    ? normalized
    : '';
}

function numericId(value) {
  const normalized = String(value || '').trim();
  return /^[0-9]{1,19}$/.test(normalized) ? normalized : '';
}

function username(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._]{2,29}$/.test(normalized) ? normalized : '';
}

async function resolveProfile(session, handle) {
  const params = new URLSearchParams({
    username: `eq.${handle}`,
    is_discoverable: 'eq.true',
    select: 'id,username,display_name',
    limit: '1',
  });
  const response = await rest(`social_profiles?${params}`, { auth: session.auth });
  if (!response.ok) return null;
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function blockState(request, env, handle) {
  const gate = await requireSessionAndLimit(
    request,
    env.SAFETY_BLOCK_LIMITER,
    'You are checking block controls too quickly. Try again shortly.',
  );
  if (gate.response) return gate.response;

  const target = await resolveProfile(gate.session, handle);
  if (!target) return apiError(404, 'PROFILE_UNAVAILABLE', 'This profile is unavailable.');
  if (target.id === gate.session.user.id) return apiError(400, 'SELF_BLOCK', 'You cannot block yourself.');

  const params = new URLSearchParams({
    blocker_id: `eq.${gate.session.user.id}`,
    blocked_id: `eq.${target.id}`,
    select: 'blocked_id,created_at',
    limit: '1',
  });
  const response = await rest(`social_blocks?${params}`, { auth: gate.session.auth });
  if (!response.ok) return apiError(409, 'BLOCK_STATE_FAILED', 'Block state could not be checked.');

  const rows = await response.json().catch(() => []);
  const row = Array.isArray(rows) ? rows[0] || null : null;
  return json(200, {
    ok: true,
    data: {
      username: target.username,
      display_name: target.display_name,
      blocked_by_you: Boolean(row),
      blocked_at: row?.created_at || null,
    },
  });
}

async function setBlock(request, env, handle, active) {
  const gate = await requireSessionAndLimit(
    request,
    env.SAFETY_BLOCK_LIMITER,
    'You are changing block controls too quickly. Try again shortly.',
  );
  if (gate.response) return gate.response;

  const target = await resolveProfile(gate.session, handle);
  if (!target) return apiError(404, 'PROFILE_UNAVAILABLE', 'This profile is unavailable.');
  if (target.id === gate.session.user.id) return apiError(400, 'SELF_BLOCK', 'You cannot block yourself.');

  if (active) {
    const response = await rest('social_blocks', {
      method: 'POST',
      auth: gate.session.auth,
      prefer: 'return=minimal',
      body: {
        blocker_id: gate.session.user.id,
        blocked_id: target.id,
      },
    });
    if (!response.ok && response.status !== 409) {
      return apiError(409, 'BLOCK_FAILED', 'This member could not be blocked.');
    }
  } else {
    const params = new URLSearchParams({
      blocker_id: `eq.${gate.session.user.id}`,
      blocked_id: `eq.${target.id}`,
    });
    const response = await rest(`social_blocks?${params}`, {
      method: 'DELETE',
      auth: gate.session.auth,
      prefer: 'return=minimal',
    });
    if (!response.ok) return apiError(409, 'UNBLOCK_FAILED', 'This member could not be unblocked.');
  }

  return json(200, {
    ok: true,
    data: {
      username: target.username,
      blocked_by_you: active,
    },
  });
}


async function muteState(request, env, handle) {
  const gate = await requireSessionAndLimit(
    request,
    env.SAFETY_MUTE_LIMITER,
    'You are checking mute controls too quickly. Try again shortly.',
  );
  if (gate.response) return gate.response;

  const target = await resolveProfile(gate.session, handle);
  if (!target) return apiError(404, 'PROFILE_UNAVAILABLE', 'This profile is unavailable.');
  if (target.id === gate.session.user.id) return apiError(400, 'SELF_MUTE', 'You cannot mute yourself.');

  const params = new URLSearchParams({
    muter_id: `eq.${gate.session.user.id}`,
    muted_id: `eq.${target.id}`,
    select: 'muted_id,created_at',
    limit: '1',
  });
  const response = await rest(`social_mutes?${params}`, { auth: gate.session.auth });
  if (!response.ok) return apiError(409, 'MUTE_STATE_FAILED', 'Mute state could not be checked.');

  const rows = await response.json().catch(() => []);
  const row = Array.isArray(rows) ? rows[0] || null : null;
  return json(200, {
    ok: true,
    data: {
      username: target.username,
      display_name: target.display_name,
      muted_by_you: Boolean(row),
      muted_at: row?.created_at || null,
    },
  });
}

async function setMute(request, env, handle, active) {
  const gate = await requireSessionAndLimit(
    request,
    env.SAFETY_MUTE_LIMITER,
    'You are changing mute controls too quickly. Try again shortly.',
  );
  if (gate.response) return gate.response;

  const target = await resolveProfile(gate.session, handle);
  if (!target) return apiError(404, 'PROFILE_UNAVAILABLE', 'This profile is unavailable.');
  if (target.id === gate.session.user.id) return apiError(400, 'SELF_MUTE', 'You cannot mute yourself.');

  if (active) {
    const blockParams = new URLSearchParams({
      blocker_id: `eq.${gate.session.user.id}`,
      blocked_id: `eq.${target.id}`,
      select: 'blocked_id',
      limit: '1',
    });
    const blockResponse = await rest(`social_blocks?${blockParams}`, { auth: gate.session.auth });
    if (!blockResponse.ok) return apiError(409, 'MUTE_STATE_FAILED', 'Mute state could not be checked.');
    const blockRows = await blockResponse.json().catch(() => []);
    if (Array.isArray(blockRows) && blockRows.length) {
      return apiError(409, 'BLOCK_SUPERSEDES_MUTE', 'Unblock this account before using mute.');
    }

    const response = await rest('social_mutes', {
      method: 'POST',
      auth: gate.session.auth,
      prefer: 'return=minimal',
      body: {
        muter_id: gate.session.user.id,
        muted_id: target.id,
      },
    });
    if (!response.ok && response.status !== 409) {
      return apiError(409, 'MUTE_FAILED', 'This member could not be muted.');
    }
  } else {
    const params = new URLSearchParams({
      muter_id: `eq.${gate.session.user.id}`,
      muted_id: `eq.${target.id}`,
    });
    const response = await rest(`social_mutes?${params}`, {
      method: 'DELETE',
      auth: gate.session.auth,
      prefer: 'return=minimal',
    });
    if (!response.ok) return apiError(409, 'UNMUTE_FAILED', 'This member could not be unmuted.');
  }

  return json(200, {
    ok: true,
    data: {
      username: target.username,
      muted_by_you: active,
    },
  });
}

async function createReport(request, env) {
  const gate = await requireSessionAndLimit(
    request,
    env.SAFETY_REPORT_LIMITER,
    'You are sending reports too quickly. Try again shortly.',
  );
  if (gate.response) return gate.response;

  const contentLength = Number(request.headers.get('Content-Length') || '0');
  if (contentLength > 8192) return apiError(413, 'REPORT_TOO_LARGE', 'Report details must be 2,000 characters or fewer.');

  const payload = await request.json().catch(() => null);
  const targetType = String(payload?.target_type || '').trim().toLowerCase();
  const targetId = targetType === 'message' ? numericId(payload?.target_id) : uuid(payload?.target_id);
  const reason = String(payload?.reason || '').trim().toLowerCase();
  const details = String(payload?.details || '').trim();

  if (!REPORT_TARGETS.has(targetType)) return apiError(400, 'INVALID_REPORT_TARGET', 'Choose a supported report target.');
  if (!targetId) return apiError(400, 'INVALID_REPORT_TARGET', 'This report target is unavailable.');
  if (!REPORT_REASONS.has(reason)) return apiError(400, 'INVALID_REPORT_REASON', 'Choose a valid reason for this report.');
  if (details.length > 2000) return apiError(400, 'REPORT_DETAILS_TOO_LONG', 'Report details must be 2,000 characters or fewer.');

  const response = await rest('social_reports', {
    method: 'POST',
    auth: gate.session.auth,
    prefer: 'return=minimal',
    body: {
      reporter_id: gate.session.user.id,
      target_type: targetType,
      target_id: targetId,
      reason,
      details: details || null,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    const providerCode = String(error?.code || '');
    const providerMessage = String(error?.message || '');

    if (response.status === 409 || providerCode === '23505') {
      return apiError(409, 'ALREADY_REPORTED', 'You already have an active report for this item.');
    }
    if (providerMessage.includes('SELF_REPORT_NOT_ALLOWED')) {
      return apiError(400, 'SELF_REPORT', 'You cannot report your own content, message or profile.');
    }
    if (
      providerMessage.includes('REPORT_TARGET_UNAVAILABLE') ||
      providerMessage.includes('REPORT_TARGET_INVALID') ||
      providerCode === '42501'
    ) {
      return apiError(404, 'REPORT_TARGET_UNAVAILABLE', 'This item is unavailable or no longer visible to you.');
    }
    return apiError(409, 'REPORT_FAILED', 'This report could not be submitted.');
  }

  return json(201, {
    ok: true,
    data: {
      target_type: targetType,
      target_id: targetId,
      submitted: true,
    },
  });
}

async function getDeletionRequest(request, env) {
  const gate = await requireSessionAndLimit(
    request,
    env.SAFETY_DELETION_LIMITER,
    'You are checking account deletion controls too quickly. Try again shortly.',
  );
  if (gate.response) return gate.response;

  const params = new URLSearchParams({
    user_id: `eq.${gate.session.user.id}`,
    select: 'user_id,status,requested_at,scheduled_for,cancelled_at,completed_at,restore_discoverable',
    limit: '1',
  });
  const response = await rest(`social_account_deletion_requests?${params}`, { auth: gate.session.auth });
  if (!response.ok) return apiError(409, 'DELETION_STATE_FAILED', 'Account deletion status could not be checked.');

  const rows = await response.json().catch(() => []);
  return json(200, {
    ok: true,
    data: {
      request: Array.isArray(rows) ? rows[0] || null : null,
    },
  });
}

async function saveDeletionRequest(request, env, cancel = false) {
  const gate = await requireSessionAndLimit(
    request,
    env.SAFETY_DELETION_LIMITER,
    'You are changing account deletion controls too quickly. Try again shortly.',
  );
  if (gate.response) return gate.response;

  const readParams = new URLSearchParams({
    user_id: `eq.${gate.session.user.id}`,
    select: 'user_id,status,requested_at,scheduled_for,cancelled_at,completed_at,restore_discoverable',
    limit: '1',
  });
  const readResponse = await rest(`social_account_deletion_requests?${readParams}`, { auth: gate.session.auth });
  if (!readResponse.ok) return apiError(409, 'DELETION_STATE_FAILED', 'Account deletion status could not be checked.');

  const existingRows = await readResponse.json().catch(() => []);
  const existing = Array.isArray(existingRows) ? existingRows[0] || null : null;

  if (cancel) {
    if (!existing || existing.status === 'cancelled') {
      return json(200, { ok: true, data: { request: existing || null } });
    }
    if (existing.status === 'completed') {
      return apiError(409, 'DELETION_ALREADY_COMPLETED', 'This account deletion has already been completed.');
    }

    const params = new URLSearchParams({
      user_id: `eq.${gate.session.user.id}`,
      select: 'user_id,status,requested_at,scheduled_for,cancelled_at,completed_at,restore_discoverable',
    });
    const response = await rest(`social_account_deletion_requests?${params}`, {
      method: 'PATCH',
      auth: gate.session.auth,
      prefer: 'return=representation',
      body: { status: 'cancelled' },
    });
    if (!response.ok) return apiError(409, 'DELETION_CANCEL_FAILED', 'This deletion request could not be cancelled.');

    const rows = await response.json().catch(() => []);
    return json(200, { ok: true, data: { request: Array.isArray(rows) ? rows[0] || null : null } });
  }

  if (existing?.status === 'pending') {
    return json(200, { ok: true, data: { request: existing } });
  }
  if (existing?.status === 'completed') {
    return apiError(409, 'DELETION_ALREADY_COMPLETED', 'This account deletion has already been completed.');
  }

  const payload = await request.json().catch(() => null);
  if (String(payload?.confirmation || '').trim().toUpperCase() !== 'DELETE') {
    return apiError(400, 'DELETION_CONFIRMATION_REQUIRED', 'Type DELETE to confirm this account deletion request.');
  }
  if (!recentlySignedIn(gate.session.user)) {
    return apiError(403, 'RECENT_AUTH_REQUIRED', 'Sign in again before requesting account deletion.');
  }

  if (existing?.status === 'cancelled') {
    const params = new URLSearchParams({
      user_id: `eq.${gate.session.user.id}`,
      select: 'user_id,status,requested_at,scheduled_for,cancelled_at,completed_at,restore_discoverable',
    });
    const response = await rest(`social_account_deletion_requests?${params}`, {
      method: 'PATCH',
      auth: gate.session.auth,
      prefer: 'return=representation',
      body: { status: 'pending' },
    });
    if (!response.ok) return apiError(409, 'DELETION_REQUEST_FAILED', 'Account deletion could not be requested.');

    const rows = await response.json().catch(() => []);
    return json(200, { ok: true, data: { request: Array.isArray(rows) ? rows[0] || null : null } });
  }

  const response = await rest('social_account_deletion_requests?select=user_id,status,requested_at,scheduled_for,cancelled_at,completed_at,restore_discoverable', {
    method: 'POST',
    auth: gate.session.auth,
    prefer: 'return=representation',
    body: { user_id: gate.session.user.id },
  });
  if (!response.ok) return apiError(409, 'DELETION_REQUEST_FAILED', 'Account deletion could not be requested.');

  const rows = await response.json().catch(() => []);
  return json(201, { ok: true, data: { request: Array.isArray(rows) ? rows[0] || null : null } });
}

export async function handleTrustSafetyRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === '/api/safety/report' && request.method === 'POST') {
    return createReport(request, env);
  }

  const muteMatch = path.match(/^\/api\/safety\/mute\/([^/]+)$/);
  if (muteMatch) {
    const handle = username(decodeURIComponent(muteMatch[1]));
    if (!handle) return apiError(400, 'INVALID_USERNAME', 'Enter a valid username.');

    if (request.method === 'GET') return muteState(request, env, handle);
    if (request.method === 'POST') return setMute(request, env, handle, true);
    if (request.method === 'DELETE') return setMute(request, env, handle, false);
  }

  const blockMatch = path.match(/^\/api\/safety\/block\/([^/]+)$/);
  if (blockMatch) {
    const handle = username(decodeURIComponent(blockMatch[1]));
    if (!handle) return apiError(400, 'INVALID_USERNAME', 'Enter a valid username.');

    if (request.method === 'GET') return blockState(request, env, handle);
    if (request.method === 'POST') return setBlock(request, env, handle, true);
    if (request.method === 'DELETE') return setBlock(request, env, handle, false);
  }

  if (path === '/api/safety/deletion-request') {
    if (request.method === 'GET') return getDeletionRequest(request, env);
    if (request.method === 'POST') return saveDeletionRequest(request, env, false);
    if (request.method === 'DELETE') return saveDeletionRequest(request, env, true);
  }

  return null;
}
