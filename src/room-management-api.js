// Additive Rooms management transport. Authority, snapshots and idempotency
// belong to the caller-scoped SQL RPCs, never to client-supplied role fields.
import { authenticate, readRoomActionBody, roomApprovalRpc, roomUuid } from './room-post-approval-api.js';

const textLength = (value) => [...value].length;
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const validText = (value, max, { required = false } = {}) => typeof value === 'string' &&
  textLength(value) <= max && (!required || value.trim().length > 0);
const version = (value) => Number.isSafeInteger(value) && value >= 1;
const timestamp = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const uniqueIds = (items, key) => new Set(items.map((item) => item[key].toLowerCase())).size === items.length;

function json(status, payload) {
  return new Response(JSON.stringify(payload), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', Vary: 'Authorization',
  } });
}
const error = (status, code, message) => json(status, { ok: false, error: { code, message } });
const unavailable = () => error(503, 'ROOM_MANAGEMENT_UNAVAILABLE', 'Room management is temporarily unavailable.');
const invalidResponse = () => error(503, 'ROOM_MANAGEMENT_RESPONSE_INVALID', 'The Room action could not be confirmed. Refresh before trying again.');

function rpcError(result) {
  const message = String(result.value?.message || '');
  const codes = [
    [401, ['AUTH_REQUIRED']],
    [403, ['ROOM_STAFF_REQUIRED', 'ROOM_ADMIN_REQUIRED', 'ROOM_MEMBERSHIP_REQUIRED', 'ROOM_MODERATION_FORBIDDEN']],
    [404, ['ROOM_UNAVAILABLE', 'ROOM_POST_UNAVAILABLE', 'MEMBERSHIP_ANSWERS_UNAVAILABLE']],
    [409, ['ROOM_MANAGEMENT_VERSION_CONFLICT', 'REQUEST_PAYLOAD_CONFLICT', 'ROOM_PIN_LIMIT', 'ROOM_PIN_CHANGED',
      'MEMBERSHIP_STATE_CHANGED', 'ROOM_QUESTIONS_REQUIRED', 'ROOM_JOIN_INVITATION_REQUIRED']],
    [400, ['INVALID_ROOM_MANAGEMENT', 'INVALID_ROOM_ANSWERS', 'INVALID_ROOM_PIN', 'INVALID_ROOM_MODERATION']],
  ];
  for (const [status, allowed] of codes) {
    for (const code of allowed) {
      if (new RegExp(`(?:^|[^A-Z_])${code}(?:$|[^A-Z_])`).test(message)) {
        const detail = code === 'ROOM_QUESTIONS_REQUIRED' ? 'Answer the required membership questions before continuing.' :
          code === 'ROOM_JOIN_INVITATION_REQUIRED' ? 'An invitation is required to join this Room.' :
          code === 'ROOM_PIN_LIMIT' ? 'This Room already has three pinned posts. Unpin one before adding another.' :
          status === 409 ? 'The Room changed. Refresh before trying again.' :
          status === 404 ? 'This Room item is unavailable.' :
          status === 400 ? 'Check the Room details and try again.' :
          status === 401 ? 'Sign in to use Room management.' : 'This account cannot perform this Room action.';
        return error(status, code, detail);
      }
    }
  }
  if (result.missing || result.status >= 500) return unavailable();
  return error(400, 'INVALID_ROOM_REQUEST', 'Check the Room details and try again.');
}

function validRules(rules) {
  return Array.isArray(rules) && rules.length <= 10 && rules.every((rule) => record(rule) &&
    roomUuid(rule.id) && validText(rule.title, 120, { required: true }) && validText(rule.body, 1000)) && uniqueIds(rules, 'id');
}

function validQuestions(questions) {
  return Array.isArray(questions) && questions.length <= 3 && questions.every((question) => record(question) &&
    roomUuid(question.id) && validText(question.prompt, 300, { required: true }) && typeof question.required === 'boolean') && uniqueIds(questions, 'id');
}

function validAnswers(answers) {
  return Array.isArray(answers) && answers.length <= 3 && answers.every((answer) => record(answer) &&
    roomUuid(answer.question_id) && validText(answer.answer, 1000)) && uniqueIds(answers, 'question_id');
}

function validState(value, roomId) {
  return record(value) && roomUuid(value.room_id) === roomId && version(value.version) &&
    validRules(value.rules) && validQuestions(value.questions) && value.pin_limit === 3;
}

function routeFor(path) {
  let match = path.match(/^\/api\/rooms\/([^/]+)\/(management|membership-request|pinned-posts)$/);
  if (match) return { room: match[1], action: match[2] };
  match = path.match(/^\/api\/rooms\/([^/]+)\/membership-requests\/([^/]+)\/answers$/);
  if (match) return { room: match[1], action: 'answers', target: match[2] };
  match = path.match(/^\/api\/rooms\/([^/]+)\/posts\/([^/]+)\/(pin|moderation)$/);
  return match ? { room: match[1], action: match[3], target: match[2] } : null;
}

async function call(session, name, args) {
  try { return await roomApprovalRpc(session, name, args); }
  catch { return { ok: false, status: 503, value: null }; }
}

async function read(session, route, roomId) {
  const args = { p_room_id: roomId };
  let name;
  if (route.action === 'management') name = 'room_management_state';
  else if (route.action === 'pinned-posts') name = 'room_pinned_posts';
  else { name = 'room_membership_request_answers'; args.p_requester_id = roomUuid(route.target); }
  const result = await call(session, name, args);
  if (!result.ok) return rpcError(result);
  const value = result.value;
  const valid = route.action === 'management' ? validState(value, roomId) : route.action === 'pinned-posts' ?
    record(value) && value.pin_limit === 3 && Array.isArray(value.posts) && value.posts.length <= 3 &&
      value.posts.every((post) => record(post) && roomUuid(post.post_id) &&
        (post.pinned_by === null || roomUuid(post.pinned_by)) && timestamp(post.pinned_at)) && uniqueIds(value.posts, 'post_id') :
    record(value) && roomUuid(value.room_id) === roomId && roomUuid(value.requester_id) === args.p_requester_id &&
      version(value.config_version) && validQuestions(value.questions) && validAnswers(value.answers) && timestamp(value.submitted_at);
  return valid ? json(200, { ok: true, data: value }) : invalidResponse();
}

async function write(request, env, session, route, roomId) {
  if (!env.SAUTI_CREATE_LIMITER?.limit) return error(503, 'RATE_LIMIT_NOT_READY', 'Room management is temporarily unavailable.');
  let allowed;
  try { allowed = await env.SAUTI_CREATE_LIMITER.limit({ key: session.user.id }); }
  catch { return unavailable(); }
  if (!allowed?.success) return error(429, 'RATE_LIMITED', 'You are making Room changes too quickly.');
  if ((request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase() !== 'application/json') {
    return error(415, 'JSON_REQUIRED', 'Send this Room action as JSON.');
  }
  const body = await readRoomActionBody(request, { limit: route.action === 'management' ? 65536 : 16384 });
  if (body.response) return body.response;
  const payload = body.payload;
  if (!record(payload) || !roomUuid(payload.request_id)) return error(400, 'INVALID_ROOM_REQUEST', 'Use a valid request identifier.');
  const args = { p_room_id: roomId, p_request_id: roomUuid(payload.request_id) };
  let name;
  if (route.action === 'management') {
    if (!version(payload.expected_version) || !validRules(payload.rules) || !validQuestions(payload.questions)) {
      return error(400, 'INVALID_ROOM_MANAGEMENT', 'Check the Room rules and membership questions.');
    }
    name = 'room_update_management';
    args.p_expected_version = payload.expected_version;
    args.p_rules = payload.rules.map(({ id, title, body: text }) => ({ id: roomUuid(id), title: title.trim(), body: text.trim() }));
    args.p_questions = payload.questions.map(({ id, prompt, required }) => ({ id: roomUuid(id), prompt: prompt.trim(), required }));
  } else if (route.action === 'membership-request') {
    if (!version(payload.expected_version) || !validAnswers(payload.answers) ||
        !['join', 'request', 'accept_invitation'].includes(payload.action_kind)) {
      return error(400, 'INVALID_MEMBERSHIP_ANSWERS', 'Check your membership answers and refresh the Room questions.');
    }
    name = 'room_submit_membership_request';
    args.p_action_kind = payload.action_kind;
    args.p_expected_version = payload.expected_version;
    args.p_answers = payload.answers.map(({ question_id, answer }) => ({ question_id: roomUuid(question_id), answer: answer.trim() }));
  } else {
    args.p_post_id = roomUuid(route.target);
    if (route.action === 'pin') {
      if (typeof payload.pinned !== 'boolean') return error(400, 'INVALID_PIN', 'Choose whether this post should be pinned.');
      name = 'room_set_post_pin'; args.p_pinned = payload.pinned;
    } else {
      if (payload.action !== 'remove' || !validText(payload.reason, 500, { required: true })) {
        return error(400, 'INVALID_POST_MODERATION', 'Use a removal reason of 500 characters or fewer.');
      }
      name = 'room_moderate_published_post'; args.p_action = 'remove'; args.p_reason = payload.reason.trim();
    }
  }
  const result = await call(session, name, args);
  if (!result.ok) return rpcError(result);
  const value = result.value;
  let confirmed = false;
  if (route.action === 'management') confirmed = validState(value, roomId) && value.version === args.p_expected_version + 1 &&
    JSON.stringify(value.rules.map(({ id, title, body: text }) => ({ id: roomUuid(id), title, body: text }))) === JSON.stringify(args.p_rules) &&
    JSON.stringify(value.questions.map(({ id, prompt, required }) => ({ id: roomUuid(id), prompt, required }))) === JSON.stringify(args.p_questions);
  else if (route.action === 'membership-request') confirmed = record(value) && roomUuid(value.room_id) === roomId &&
    roomUuid(value.requester_id) === session.user.id.toLowerCase() && ['member', 'pending'].includes(value.status) &&
    value.config_version === args.p_expected_version && roomUuid(value.request_id) === args.p_request_id;
  else if (route.action === 'pin') confirmed = record(value) && roomUuid(value.room_id) === roomId &&
    roomUuid(value.post_id) === args.p_post_id && value.pinned === args.p_pinned &&
    (value.pinned ? timestamp(value.pinned_at) : value.pinned_at === null);
  else confirmed = record(value) && roomUuid(value.room_id) === roomId && roomUuid(value.post_id) === args.p_post_id &&
    value.action === 'remove' && value.removed === true && timestamp(value.removed_at);
  return confirmed ? json(200, { ok: true, data: value }) : invalidResponse();
}

export async function handleRoomManagementRequest(request, env) {
  const route = routeFor(new URL(request.url).pathname);
  if (!route) return null;
  let session;
  try { session = await authenticate(request); } catch { return unavailable(); }
  if (!session) return error(401, 'AUTH_REQUIRED', 'Sign in to use Room management.');
  const roomId = roomUuid(route.room);
  if (!roomId || (route.target && !roomUuid(route.target))) return error(404, 'ROOM_UNAVAILABLE', 'This Room action is unavailable.');
  if (request.method === 'GET' && ['management', 'pinned-posts', 'answers'].includes(route.action)) return read(session, route, roomId);
  if ((request.method === 'PUT' && ['management', 'pin'].includes(route.action)) ||
      (request.method === 'POST' && ['membership-request', 'moderation'].includes(route.action))) {
    return write(request, env, session, route, roomId);
  }
  return error(405, 'METHOD_NOT_ALLOWED', 'Use the supported method for this Room action.');
}
