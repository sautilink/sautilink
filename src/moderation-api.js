const SUPABASE_URL = 'https://rggpyiterdbbugluejcs.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_omJ-5Mem-K4vgm6WLXRzJQ_jeGs65ca';

const STAFF_ROLES = new Set(['reviewer', 'senior_reviewer', 'auditor']);
const REVIEW_ROLES = new Set(['reviewer', 'senior_reviewer']);
const REPORT_STATUSES = new Set(['open', 'reviewing', 'resolved', 'dismissed']);
const APPEAL_STATUSES = new Set(['open', 'reviewing', 'upheld', 'reversed']);
const REPORT_ACTIONS = new Set(['dismissed', 'visibility_limited', 'content_removed', 'escalated']);
const APPEAL_ACTIONS = new Set(['appeal_upheld', 'appeal_reversed']);

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

async function consumeLimit(binding, key) {
  if (!binding?.limit) return { ready: false, allowed: false };
  const result = await binding.limit({ key });
  return { ready: true, allowed: Boolean(result?.success) };
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

function integerId(value) {
  const normalized = String(value || '').trim();
  return /^[1-9][0-9]{0,18}$/.test(normalized) ? normalized : '';
}

function uuid(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)
    ? normalized
    : '';
}

function boundedInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

async function requireUser(request, env, limiterName, message) {
  const session = await authenticate(request);
  if (!session) return { response: apiError(401, 'AUTH_REQUIRED', 'Sign in before using this safety workspace.') };

  const limited = await consumeLimit(env[limiterName], session.user.id);
  if (!limited.ready) return { response: apiError(503, 'RATE_LIMIT_NOT_READY', 'This safety workspace is not ready yet.') };
  if (!limited.allowed) return { response: apiError(429, 'RATE_LIMITED', message) };
  return { session };
}

async function readStaffRole(session) {
  const params = new URLSearchParams({
    select: 'staff_role',
    limit: '1',
  });
  const response = await rest(`moderation_staff_self?${params}`, { auth: session.auth });
  if (!response.ok) return '';
  const rows = await response.json().catch(() => []);
  const role = Array.isArray(rows) ? String(rows[0]?.staff_role || '') : '';
  return STAFF_ROLES.has(role) ? role : '';
}

async function requireStaff(request, env, { decision = false } = {}) {
  const gate = await requireUser(
    request,
    env,
    'MODERATION_ACTION_LIMITER',
    'Moderation actions are being requested too quickly. Try again shortly.',
  );
  if (gate.response) return gate;

  const role = await readStaffRole(gate.session);
  if (!role) return { response: apiError(403, 'MODERATION_ACCESS_REQUIRED', 'This account does not have moderation access.') };
  if (decision && !REVIEW_ROLES.has(role)) {
    return { response: apiError(403, 'MODERATION_READ_ONLY', 'This moderation role is read-only.') };
  }
  return { session: gate.session, role };
}

async function moderationSession(request, env) {
  const gate = await requireUser(
    request,
    env,
    'MODERATION_ACTION_LIMITER',
    'Moderation access is being checked too quickly. Try again shortly.',
  );
  if (gate.response) return gate.response;
  const role = await readStaffRole(gate.session);
  return json(200, { ok: true, data: { role: role || null, active: Boolean(role) } });
}

async function listReports(request, env) {
  const gate = await requireStaff(request, env);
  if (gate.response) return gate.response;

  const url = new URL(request.url);
  const status = String(url.searchParams.get('status') || '').toLowerCase();
  const limit = boundedInt(url.searchParams.get('limit'), 30, 1, 50);
  const offset = boundedInt(url.searchParams.get('offset'), 0, 0, 1000);

  const params = new URLSearchParams({
    select: 'id,target_type,target_id,reason,details,report_status,created_at,status_updated_at,reviewed_at,resolved_at,moderation_note,priority,assigned_to,target_owner_id,context_snapshot,policy_version',
    order: 'created_at.asc,id.asc',
    limit: String(limit),
    offset: String(offset),
  });
  if (REPORT_STATUSES.has(status)) params.set('report_status', `eq.${status}`);

  const response = await rest(`social_reports?${params}`, { auth: gate.session.auth });
  if (!response.ok) return apiError(409, 'REPORT_QUEUE_FAILED', 'The moderation report queue could not be loaded.');
  const rows = await response.json().catch(() => []);
  return json(200, { ok: true, data: { role: gate.role, reports: Array.isArray(rows) ? rows : [], limit, offset } });
}

async function claimReport(request, env, reportId) {
  const gate = await requireStaff(request, env, { decision: true });
  if (gate.response) return gate.response;

  const params = new URLSearchParams({
    id: `eq.${reportId}`,
    report_status: 'in.(open,reviewing)',
    or: `(assigned_to.is.null,assigned_to.eq.${gate.session.user.id})`,
    select: 'id,report_status,assigned_to,reviewed_at',
  });
  const response = await rest(`social_reports?${params}`, {
    method: 'PATCH',
    auth: gate.session.auth,
    prefer: 'return=representation',
    body: {
      report_status: 'reviewing',
      assigned_to: gate.session.user.id,
      reviewed_at: new Date().toISOString(),
      status_updated_at: new Date().toISOString(),
    },
  });
  if (!response.ok) return apiError(409, 'REPORT_CLAIM_FAILED', 'This report could not be claimed.');
  const rows = await response.json().catch(() => []);
  if (!Array.isArray(rows) || !rows.length) return apiError(409, 'REPORT_ALREADY_ASSIGNED', 'This report is already assigned or resolved.');
  return json(200, { ok: true, data: { report: rows[0] } });
}

async function insertModerationAction(session, payload) {
  const response = await rest('social_moderation_actions?select=id,report_id,appeal_id,target_type,target_id,target_owner_id,action_type,reason,policy_version,request_id,created_at', {
    method: 'POST',
    auth: session.auth,
    prefer: 'return=representation',
    body: payload,
  });

  if (response.ok) {
    const rows = await response.json().catch(() => []);
    return { ok: true, row: Array.isArray(rows) ? rows[0] || null : null };
  }

  const error = await response.json().catch(() => null);
  const providerCode = String(error?.code || '');
  if (providerCode === '23505' && payload.request_id) {
    const params = new URLSearchParams({
      request_id: `eq.${payload.request_id}`,
      select: 'id,report_id,appeal_id,target_type,target_id,target_owner_id,action_type,reason,policy_version,request_id,created_at',
      limit: '1',
    });
    const existingResponse = await rest(`social_moderation_actions?${params}`, { auth: session.auth });
    if (existingResponse.ok) {
      const rows = await existingResponse.json().catch(() => []);
      const row = Array.isArray(rows) ? rows[0] || null : null;
      if (row) return { ok: true, row, idempotent: true };
    }
  }

  return {
    ok: false,
    providerCode,
    providerMessage: String(error?.message || ''),
  };
}

async function decideReport(request, env, reportId) {
  const gate = await requireStaff(request, env, { decision: true });
  if (gate.response) return gate.response;

  const payload = await request.json().catch(() => null);
  const action = String(payload?.action || '').trim().toLowerCase();
  const reason = String(payload?.reason || '').trim();
  const policyVersion = String(payload?.policy_version || 'safety-v1').trim();
  const requestId = uuid(payload?.request_id);

  if (!REPORT_ACTIONS.has(action)) return apiError(400, 'INVALID_MODERATION_ACTION', 'Choose a supported moderation action.');
  if (action === 'content_removed' && gate.role !== 'senior_reviewer') {
    return apiError(403, 'SENIOR_REVIEW_REQUIRED', 'Content removal requires a senior reviewer.');
  }
  if (!reason || reason.length > 2000) return apiError(400, 'MODERATION_REASON_REQUIRED', 'Add a moderation reason within 2,000 characters.');
  if (!requestId) return apiError(400, 'REQUEST_ID_REQUIRED', 'A valid decision request id is required.');
  if (!policyVersion || policyVersion.length > 64) return apiError(400, 'INVALID_POLICY_VERSION', 'Choose a valid policy version.');

  const result = await insertModerationAction(gate.session, {
    report_id: Number(reportId),
    action_type: action,
    reason,
    policy_version: policyVersion,
    request_id: requestId,
  });

  if (!result.ok) {
    if (result.providerMessage.includes('SENIOR_REVIEW_REQUIRED')) {
      return apiError(403, 'SENIOR_REVIEW_REQUIRED', 'This decision requires a senior reviewer.');
    }
    if (result.providerMessage.includes('ACTION_NOT_SUPPORTED_FOR_TARGET')) {
      return apiError(400, 'ACTION_NOT_SUPPORTED_FOR_TARGET', 'That action is not supported for this report target.');
    }
    if (result.providerMessage.includes('REPORT_UNAVAILABLE')) {
      return apiError(409, 'REPORT_UNAVAILABLE', 'This report has already been decided or is unavailable.');
    }
    return apiError(409, 'MODERATION_DECISION_FAILED', 'This moderation decision could not be saved.');
  }

  return json(200, { ok: true, data: { action: result.row, idempotent: Boolean(result.idempotent) } });
}

async function listStaffAppeals(request, env) {
  const gate = await requireStaff(request, env);
  if (gate.response) return gate.response;

  const url = new URL(request.url);
  const status = String(url.searchParams.get('status') || '').toLowerCase();
  const limit = boundedInt(url.searchParams.get('limit'), 30, 1, 50);
  const offset = boundedInt(url.searchParams.get('offset'), 0, 0, 1000);

  const params = new URLSearchParams({
    select: 'id,action_id,appellant_id,reason,appeal_status,assigned_to,decision_reason,created_at,updated_at,decided_at',
    order: 'created_at.asc,id.asc',
    limit: String(limit),
    offset: String(offset),
  });
  if (APPEAL_STATUSES.has(status)) params.set('appeal_status', `eq.${status}`);

  const response = await rest(`social_moderation_appeals?${params}`, { auth: gate.session.auth });
  if (!response.ok) return apiError(409, 'APPEAL_QUEUE_FAILED', 'The moderation appeal queue could not be loaded.');
  const appeals = await response.json().catch(() => []);
  const appealRows = Array.isArray(appeals) ? appeals : [];

  const actionIds = [...new Set(appealRows.map((row) => row.action_id).filter(Boolean))];
  let actions = [];
  if (actionIds.length) {
    const actionParams = new URLSearchParams({
      id: `in.(${actionIds.join(',')})`,
      select: 'id,report_id,target_type,target_id,target_owner_id,action_type,reason,policy_version,created_at',
    });
    const actionResponse = await rest(`social_moderation_actions?${actionParams}`, { auth: gate.session.auth });
    if (actionResponse.ok) actions = await actionResponse.json().catch(() => []);
  }

  return json(200, {
    ok: true,
    data: {
      role: gate.role,
      appeals: appealRows,
      actions: Array.isArray(actions) ? actions : [],
      limit,
      offset,
    },
  });
}

async function claimAppeal(request, env, appealId) {
  const gate = await requireStaff(request, env, { decision: true });
  if (gate.response) return gate.response;

  const params = new URLSearchParams({
    id: `eq.${appealId}`,
    appeal_status: 'in.(open,reviewing)',
    or: `(assigned_to.is.null,assigned_to.eq.${gate.session.user.id})`,
    select: 'id,appeal_status,assigned_to,updated_at',
  });
  const response = await rest(`social_moderation_appeals?${params}`, {
    method: 'PATCH',
    auth: gate.session.auth,
    prefer: 'return=representation',
    body: {
      appeal_status: 'reviewing',
      assigned_to: gate.session.user.id,
      updated_at: new Date().toISOString(),
    },
  });
  if (!response.ok) return apiError(409, 'APPEAL_CLAIM_FAILED', 'This appeal could not be claimed.');
  const rows = await response.json().catch(() => []);
  if (!Array.isArray(rows) || !rows.length) return apiError(409, 'APPEAL_ALREADY_ASSIGNED', 'This appeal is already assigned or decided.');
  return json(200, { ok: true, data: { appeal: rows[0] } });
}

async function decideAppeal(request, env, appealId) {
  const gate = await requireStaff(request, env, { decision: true });
  if (gate.response) return gate.response;
  if (gate.role !== 'senior_reviewer') return apiError(403, 'SENIOR_REVIEW_REQUIRED', 'Appeal decisions require a senior reviewer.');

  const payload = await request.json().catch(() => null);
  const action = String(payload?.action || '').trim().toLowerCase();
  const reason = String(payload?.reason || '').trim();
  const policyVersion = String(payload?.policy_version || 'safety-v1').trim();
  const requestId = uuid(payload?.request_id);

  if (!APPEAL_ACTIONS.has(action)) return apiError(400, 'INVALID_APPEAL_ACTION', 'Choose uphold or reverse for this appeal.');
  if (!reason || reason.length > 2000) return apiError(400, 'APPEAL_DECISION_REASON_REQUIRED', 'Add an appeal decision reason within 2,000 characters.');
  if (!requestId) return apiError(400, 'REQUEST_ID_REQUIRED', 'A valid decision request id is required.');

  const result = await insertModerationAction(gate.session, {
    appeal_id: Number(appealId),
    action_type: action,
    reason,
    policy_version: policyVersion,
    request_id: requestId,
  });

  if (!result.ok) {
    if (result.providerMessage.includes('APPEAL_UNAVAILABLE')) {
      return apiError(409, 'APPEAL_UNAVAILABLE', 'This appeal has already been decided or is unavailable.');
    }
    return apiError(409, 'APPEAL_DECISION_FAILED', 'This appeal decision could not be saved.');
  }

  return json(200, { ok: true, data: { action: result.row, idempotent: Boolean(result.idempotent) } });
}

async function listAudit(request, env) {
  const gate = await requireStaff(request, env);
  if (gate.response) return gate.response;
  if (!['senior_reviewer', 'auditor'].includes(gate.role)) {
    return apiError(403, 'AUDIT_ACCESS_REQUIRED', 'Audit history requires senior reviewer or auditor access.');
  }

  const url = new URL(request.url);
  const limit = boundedInt(url.searchParams.get('limit'), 50, 1, 100);
  const params = new URLSearchParams({
    select: 'id,event_type,report_id,action_id,appeal_id,actor_id,actor_role,event_payload,created_at',
    order: 'created_at.desc,id.desc',
    limit: String(limit),
  });
  const response = await rest(`social_moderation_audit?${params}`, { auth: gate.session.auth });
  if (!response.ok) return apiError(409, 'AUDIT_LOAD_FAILED', 'Moderation audit history could not be loaded.');
  const rows = await response.json().catch(() => []);
  return json(200, { ok: true, data: { audit: Array.isArray(rows) ? rows : [] } });
}

async function listMemberAppeals(request, env) {
  const gate = await requireUser(
    request,
    env,
    'SAFETY_APPEAL_LIMITER',
    'Appeal controls are being requested too quickly. Try again shortly.',
  );
  if (gate.response) return gate.response;

  const actionParams = new URLSearchParams({
    target_owner_id: `eq.${gate.session.user.id}`,
    action_type: 'in.(visibility_limited,content_removed)',
    select: 'id,report_id,target_type,target_id,target_owner_id,action_type,reason,policy_version,created_at',
    order: 'created_at.desc,id.desc',
    limit: '50',
  });
  const appealParams = new URLSearchParams({
    appellant_id: `eq.${gate.session.user.id}`,
    select: 'id,action_id,reason,appeal_status,decision_reason,created_at,updated_at,decided_at',
    order: 'created_at.desc,id.desc',
    limit: '50',
  });

  const [actionResponse, appealResponse] = await Promise.all([
    rest(`social_moderation_actions?${actionParams}`, { auth: gate.session.auth }),
    rest(`social_moderation_appeals?${appealParams}`, { auth: gate.session.auth }),
  ]);
  if (!actionResponse.ok || !appealResponse.ok) return apiError(409, 'APPEALS_LOAD_FAILED', 'Your moderation decisions could not be loaded.');

  const actions = await actionResponse.json().catch(() => []);
  const appeals = await appealResponse.json().catch(() => []);
  return json(200, {
    ok: true,
    data: {
      actions: Array.isArray(actions) ? actions : [],
      appeals: Array.isArray(appeals) ? appeals : [],
    },
  });
}

async function createMemberAppeal(request, env) {
  const gate = await requireUser(
    request,
    env,
    'SAFETY_APPEAL_LIMITER',
    'Appeals are being submitted too quickly. Try again shortly.',
  );
  if (gate.response) return gate.response;

  const contentLength = Number(request.headers.get('Content-Length') || '0');
  if (contentLength > 8192) return apiError(413, 'APPEAL_TOO_LARGE', 'Appeal details must be 2,000 characters or fewer.');

  const payload = await request.json().catch(() => null);
  const actionId = integerId(payload?.action_id);
  const reason = String(payload?.reason || '').trim();

  if (!actionId) return apiError(400, 'INVALID_ACTION_ID', 'Choose a valid moderation decision to appeal.');
  if (!reason || reason.length > 2000) return apiError(400, 'APPEAL_REASON_REQUIRED', 'Explain the appeal within 2,000 characters.');

  const response = await rest('social_moderation_appeals?select=id,action_id,reason,appeal_status,created_at', {
    method: 'POST',
    auth: gate.session.auth,
    prefer: 'return=representation',
    body: {
      action_id: Number(actionId),
      appellant_id: gate.session.user.id,
      reason,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    const code = String(error?.code || '');
    const message = String(error?.message || '');
    if (code === '23505') return apiError(409, 'ALREADY_APPEALED', 'You already appealed this moderation decision.');
    if (message.includes('APPEAL_ACTION_UNAVAILABLE') || code === '42501') {
      return apiError(404, 'APPEAL_ACTION_UNAVAILABLE', 'This moderation decision is not available to appeal.');
    }
    return apiError(409, 'APPEAL_SUBMIT_FAILED', 'This appeal could not be submitted.');
  }

  const rows = await response.json().catch(() => []);
  return json(201, { ok: true, data: { appeal: Array.isArray(rows) ? rows[0] || null : null } });
}


async function listIdentityRequests(request, env) {
  const gate = await requireStaff(request, env);
  if (gate.response) return gate.response;

  const response = await rest('rpc/identity_change_requests_for_staff', {
    method: 'POST',
    auth: gate.session.auth,
    body: {},
  });
  if (!response.ok) return apiError(409, 'IDENTITY_REQUESTS_LOAD_FAILED', 'Name change requests could not be loaded.');
  const rows = await response.json().catch(() => []);
  return json(200, { ok: true, data: { role: gate.role, requests: Array.isArray(rows) ? rows : [] } });
}

async function decideIdentityRequest(request, env, requestId) {
  const gate = await requireStaff(request, env, { decision: true });
  if (gate.response) return gate.response;

  const payload = await request.json().catch(() => null);
  const decision = String(payload?.decision || '').trim().toLowerCase();
  const note = String(payload?.note || '').trim();
  if (!['approved', 'declined'].includes(decision)) {
    return apiError(400, 'IDENTITY_DECISION_INVALID', 'Choose approve or decline.');
  }
  if (note.length > 1000) {
    return apiError(400, 'IDENTITY_REVIEW_NOTE_TOO_LONG', 'Review notes must be 1,000 characters or fewer.');
  }

  const response = await rest('rpc/review_social_identity_request', {
    method: 'POST',
    auth: gate.session.auth,
    body: {
      p_request_id: requestId,
      p_decision: decision,
      p_note: note || null,
    },
  });

  if (!response.ok) {
    const provider = await response.json().catch(() => null);
    const message = String(provider?.message || provider?.details || '');
    if (message.includes('IDENTITY_REQUEST_UNAVAILABLE')) {
      return apiError(409, 'IDENTITY_REQUEST_UNAVAILABLE', 'This name change request is no longer pending.');
    }
    if (message.includes('MODERATION_REVIEW_REQUIRED')) {
      return apiError(403, 'MODERATION_REVIEW_REQUIRED', 'This moderation role cannot decide name change requests.');
    }
    return apiError(409, 'IDENTITY_DECISION_FAILED', 'This name change decision could not be saved.');
  }

  const data = await response.json().catch(() => null);
  return json(200, { ok: true, data });
}

export async function handleModerationRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === '/api/moderation/session' && request.method === 'GET') return moderationSession(request, env);
  if (path === '/api/moderation/reports' && request.method === 'GET') return listReports(request, env);
  if (path === '/api/moderation/appeals' && request.method === 'GET') return listStaffAppeals(request, env);
  if (path === '/api/moderation/audit' && request.method === 'GET') return listAudit(request, env);
  if (path === '/api/moderation/identity-requests' && request.method === 'GET') return listIdentityRequests(request, env);

  const identityDecision = path.match(/^\/api\/moderation\/identity-requests\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/decision$/i);
  if (identityDecision && request.method === 'POST') return decideIdentityRequest(request, env, identityDecision[1].toLowerCase());

  const reportClaim = path.match(/^\/api\/moderation\/reports\/([1-9][0-9]{0,18})\/claim$/);
  if (reportClaim && request.method === 'POST') return claimReport(request, env, reportClaim[1]);

  const reportDecision = path.match(/^\/api\/moderation\/reports\/([1-9][0-9]{0,18})\/decision$/);
  if (reportDecision && request.method === 'POST') return decideReport(request, env, reportDecision[1]);

  const appealClaim = path.match(/^\/api\/moderation\/appeals\/([1-9][0-9]{0,18})\/claim$/);
  if (appealClaim && request.method === 'POST') return claimAppeal(request, env, appealClaim[1]);

  const appealDecision = path.match(/^\/api\/moderation\/appeals\/([1-9][0-9]{0,18})\/decision$/);
  if (appealDecision && request.method === 'POST') return decideAppeal(request, env, appealDecision[1]);

  if (path === '/api/appeals') {
    if (request.method === 'GET') return listMemberAppeals(request, env);
    if (request.method === 'POST') return createMemberAppeal(request, env);
  }

  return null;
}
