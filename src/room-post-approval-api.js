// Additive Room review API. All DB calls retain the caller's bearer identity.
// Deploy only with the reviewed migration; no service-role or Firebase changes.
const SUPABASE_URL = 'https://rggpyiterdbbugluejcs.supabase.co';
const KEY = 'sb_publishable_omJ-5Mem-K4vgm6WLXRzJQ_jeGs65ca';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const roomUuid = (value) => UUID.test(String(value || '')) ? String(value).toLowerCase() : '';

function json(status, payload) {
  return new Response(JSON.stringify(payload), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  } });
}
const error = (status, code, message) => json(status, { ok: false, error: { code, message } });
const headers = (auth) => ({ apikey: KEY, Authorization: auth, Accept: 'application/json', 'Content-Type': 'application/json' });

async function readRoomActionBody(request) {
  const limit = 4096;
  if (Number(request.headers.get('Content-Length') || 0) > limit) {
    void request.body?.cancel().catch(() => {});
    return { response: error(413, 'BODY_TOO_LARGE', 'This Room action is too large.') };
  }
  if (!request.body) return { payload: null };
  let reader;
  try {
    reader = request.body.getReader();
    const chunks = [];
    let length = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        // Stop consuming immediately, even without Content-Length. Do not wait
        // for a slow upstream cancellation before returning the bounded error.
        void reader.cancel().catch(() => {});
        return { response: error(413, 'BODY_TOO_LARGE', 'This Room action is too large.') };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return { payload: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) };
  } catch {
    if (reader) void reader.cancel().catch(() => {});
    return { payload: null };
  } finally {
    reader?.releaseLock();
  }
}

export async function roomApprovalRpc(session, name, args = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: headers(session.auth), body: JSON.stringify(args),
  });
  const value = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, value,
    missing: !response.ok && value?.code === 'PGRST202' };
}

function rpcError(result) {
  const detail = String(result.value?.message || '');
  for (const code of ['AUTH_REQUIRED', 'ROOM_STAFF_REQUIRED', 'ROOM_ADMIN_REQUIRED', 'ROOM_MEMBERSHIP_REQUIRED', 'AUTHOR_NO_LONGER_ALLOWED', 'ROOM_POST_STAFF_ONLY']) {
    if (detail.includes(code)) return error(code === 'AUTH_REQUIRED' ? 401 : 403, code, 'This account cannot perform this Room action.');
  }
  for (const code of ['SUBMISSION_UNAVAILABLE', 'ROOM_UNAVAILABLE']) {
    if (detail.includes(code)) return error(404, code, 'This Room submission is unavailable.');
  }
  for (const code of ['VERSION_CONFLICT', 'ALREADY_DECIDED', 'REQUEST_PAYLOAD_CONFLICT', 'MEDIA_NOT_READY', 'ROOM_APPROVAL_NOT_REQUIRED', 'QUOTE_UNAVAILABLE']) {
    if (detail.includes(code)) return error(409, code, 'The Room submission changed. Refresh and try again.');
  }
  if (result.missing) return error(503, 'ROOM_APPROVAL_UNAVAILABLE', 'Room post review is not available yet.');
  if (result.status >= 500) return error(503, 'ROOM_APPROVAL_UNAVAILABLE', 'Room post review is temporarily unavailable.');
  return error(400, 'INVALID_ROOM_REQUEST', 'Check the Room submission details and try again.');
}

async function authenticate(request) {
  const auth = request.headers.get('Authorization') || '';
  if (!/^Bearer\s+[^\s]+$/i.test(auth)) return null;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: headers(auth) });
  if (!response.ok) return null;
  const user = await response.json().catch(() => null);
  return roomUuid(user?.id) ? { auth, user } : null;
}

// Called after the existing /api/sauti body and R2 validations. Only Room
// submissions can enter this path; missing migration preserves legacy posting.
export async function roomPostSubmissionRoute(session, roomId, requestId) {
  return roomApprovalRpc(session, 'room_post_submission_route', {
    p_room_id: roomId, p_client_request_id: requestId,
  });
}

export async function maybeQueueRoomPost(session, { roomId, requestId, body, replyAccess, quoteId, media, hasPoll, route: suppliedRoute, resumeOnly = false }) {
  const route = suppliedRoute || await roomPostSubmissionRoute(session, roomId, requestId);
  if (route.missing) return null;
  if (!route.ok) return rpcError(route);
  if (resumeOnly && route.value?.existing_submission !== true) return null;
  if (route.value?.requires_review !== true) return null;
  if (hasPoll) return error(400, 'ROOM_REVIEW_POLL_UNSUPPORTED', 'Room posts awaiting review cannot include a poll.');
  if (route.value?.existing_submission !== true && media.length > 4 && media.some((item) => item.media_kind !== 'image')) {
    return error(400, 'MEDIA_LIMIT', 'Room posts can include five images or up to four items when a video is included.');
  }
  const result = await roomApprovalRpc(session, 'room_submit_post_for_review', {
    p_room_id: roomId, p_client_request_id: requestId, p_body: body,
    p_reply_access: replyAccess, p_quote_post_id: quoteId || null,
    p_media: media.map((item) => ({ id: item.id, alt_text: item.alt_text })),
  });
  if (!result.ok) return rpcError(result);
  if (!roomUuid(result.value?.submission?.id) || result.value?.published !== false) {
    return error(503, 'ROOM_REVIEW_RESPONSE_INVALID', 'Room submission could not be confirmed. Retry this draft.');
  }
  const submission = result.value.submission;
  if (submission.state === 'approved' && roomUuid(submission.published_post_id)) {
    // An exact lost202 retry may arrive after staff approved. Confirm the existing
    // post, never create a second row or reattach/delete its now-published media.
    return json(201, { ok: true, data: { post: {
      id: submission.published_post_id, author_id: submission.author_id, circle_id: submission.room_id,
      visibility: 'circle', body: submission.body, reply_access: submission.reply_access,
      quote_post_id: submission.quote_post_id, media_count: submission.media_count, created_at: submission.decided_at,
    }, media: media.map((item) => item.id) } });
  }
  if (submission.state !== 'pending') return error(409, 'ALREADY_DECIDED', 'This submission was already decided. Open your Room submissions.');
  return json(202, { ok: true, data: result.value });
}

export async function heldRoomMedia(session, ids) {
  if (!ids.length) return { ids: [] };
  const result = await roomApprovalRpc(session, 'room_held_media_uploads', { p_media_ids: ids });
  if (result.missing) return { ids: [] };
  if (!result.ok || !Array.isArray(result.value)) return { response: rpcError(result) };
  return { ids: result.value };
}

function validStorageObject(object, media) {
  return object && object.size === Number(media.size_bytes) &&
    object.customMetadata?.ownerId === media.owner_id && object.customMetadata?.mediaId === media.id &&
    object.customMetadata?.validated === 'true';
}

async function mediaForReview(session, roomId, submissionId, mediaId) {
  return roomApprovalRpc(session, 'room_submission_media_for_review', {
    p_room_id: roomId, p_submission_id: submissionId, p_media_id: mediaId,
  });
}

async function serveReviewMedia(request, env, session, roomId, submissionId, mediaId) {
  if (!env.SAUTI_MEDIA) return error(503, 'MEDIA_NOT_READY', 'Room review media is unavailable.');
  const result = await mediaForReview(session, roomId, submissionId, mediaId);
  if (!result.ok) return rpcError(result);
  const row = result.value;
  const head = await env.SAUTI_MEDIA.head(row.object_key);
  if (!validStorageObject(head, row)) return error(404, 'MEDIA_NOT_FOUND', 'This Room review media is unavailable.');
  const responseHeaders = new Headers({
    'Content-Type': row.content_type, 'Cache-Control': 'private, no-store', Vary: 'Authorization',
    'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'",
    'Content-Disposition': 'inline', 'Accept-Ranges': 'bytes',
  });
  if (request.method === 'HEAD') {
    responseHeaders.set('Content-Length', String(head.size));
    return new Response(null, { headers: responseHeaders });
  }
  const object = await env.SAUTI_MEDIA.get(row.object_key, { range: request.headers });
  if (!object) return error(404, 'MEDIA_NOT_FOUND', 'This Room review media is unavailable.');
  let status = 200;
  if (object.range && Number.isSafeInteger(object.range.offset) && Number.isSafeInteger(object.range.length)) {
    status = 206;
    responseHeaders.set('Content-Range', `bytes ${object.range.offset}-${object.range.offset + object.range.length - 1}/${object.size}`);
    responseHeaders.set('Content-Length', String(object.range.length));
  } else responseHeaders.set('Content-Length', String(object.size));
  return new Response(object.body, { status, headers: responseHeaders });
}

export async function handleRoomPostApprovalRequest(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/rooms/')) return null;
  const capability = url.pathname === '/api/rooms/capabilities';
  const match = url.pathname.match(/^\/api\/rooms\/([^/]+)\/(post-submissions|post-approval-audit)(?:\/([^/]+))?(?:\/(decision|media)(?:\/([^/]+))?)?$/);
  if (!capability && !match) return null;
  const session = await authenticate(request);
  if (!session) return error(401, 'AUTH_REQUIRED', 'Sign in to use Room post review.');
  if (capability) {
    if (request.method !== 'GET') return error(405, 'METHOD_NOT_ALLOWED', 'Use GET.');
    const result = await roomApprovalRpc(session, 'room_post_approval_capabilities');
    if (result.missing) return json(200, { ok: true, data: { post_approval: false, version: 0 } });
    return result.ok ? json(200, { ok: true, data: result.value }) : rpcError(result);
  }
  const [, rawRoomId, resource, rawSubmissionId, operation, rawMediaId] = match;
  const roomId = roomUuid(rawRoomId);
  const submissionId = rawSubmissionId ? roomUuid(rawSubmissionId) : '';
  if (!roomId || (rawSubmissionId && !submissionId)) return error(404, 'SUBMISSION_UNAVAILABLE', 'This Room submission is unavailable.');
  if (resource === 'post-approval-audit' && !submissionId && request.method === 'GET') {
    const cursor = url.searchParams.get('cursor');
    if (cursor && !/^[0-9]{1,18}$/.test(cursor)) return error(400, 'INVALID_CURSOR', 'Choose a valid audit cursor.');
    const result = await roomApprovalRpc(session, 'room_post_approval_audit', {
      p_room_id: roomId, p_before_id: cursor || null, p_limit: Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 50)),
    });
    return result.ok ? json(200, { ok: true, data: result.value }) : rpcError(result);
  }
  if (resource !== 'post-submissions') return null;
  if (!submissionId && request.method === 'GET') {
    const cursor = url.searchParams.get('cursor') || '';
    if (cursor && !roomUuid(cursor)) return error(400, 'INVALID_CURSOR', 'Choose a valid submission cursor.');
    const result = await roomApprovalRpc(session, 'room_list_post_submissions', {
      p_room_id: roomId, p_scope: url.searchParams.get('scope') || 'mine', p_state: url.searchParams.get('state') || 'pending',
      p_before_id: cursor || null, p_limit: Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 50)),
    });
    return result.ok ? json(200, { ok: true, data: result.value }) : rpcError(result);
  }
  if (submissionId && !operation && request.method === 'GET') {
    const result = await roomApprovalRpc(session, 'room_get_post_submission', { p_room_id: roomId, p_submission_id: submissionId });
    return result.ok ? json(200, { ok: true, data: result.value }) : rpcError(result);
  }
  if (submissionId && operation === 'media' && roomUuid(rawMediaId) && ['GET', 'HEAD'].includes(request.method)) {
    return serveReviewMedia(request, env, session, roomId, submissionId, roomUuid(rawMediaId));
  }
  if (submissionId && ((operation === 'decision' && request.method === 'POST') || (!operation && request.method === 'DELETE'))) {
    if (!env.SAUTI_CREATE_LIMITER?.limit) return error(503, 'RATE_LIMIT_NOT_READY', 'Room moderation is temporarily unavailable.');
    if (!(await env.SAUTI_CREATE_LIMITER.limit({ key: session.user.id }))?.success) return error(429, 'RATE_LIMITED', 'You are making Room changes too quickly.');
    const actionBody = await readRoomActionBody(request);
    if (actionBody.response) return actionBody.response;
    const payload = actionBody.payload;
    if (!roomUuid(payload?.request_id) || !Number.isInteger(payload?.expected_version) || payload.expected_version < 1) {
      return error(400, 'INVALID_DECISION', 'Refresh this submission before deciding.');
    }
    const args = { p_room_id: roomId, p_submission_id: submissionId, p_request_id: payload.request_id, p_expected_version: payload.expected_version };
    if (operation === 'decision') {
      const reason = String(payload.reason || '').trim();
      if (!['approve', 'reject'].includes(payload.decision) || reason.length > 500 || (payload.decision === 'reject' && !reason)) {
        return error(400, 'INVALID_DECISION', 'Use a rejection reason of 500 characters or fewer.');
      }
      args.p_decision = payload.decision;
      args.p_reason = reason || null;
      if (payload.decision === 'approve') {
        const detail = await roomApprovalRpc(session, 'room_get_post_submission', { p_room_id: roomId, p_submission_id: submissionId });
        if (!detail.ok) return rpcError(detail);
        if (detail.value?.submission?.state === 'pending') {
          for (const item of detail.value.submission.media || []) {
            if (!env.SAUTI_MEDIA) return error(503, 'MEDIA_NOT_READY', 'Room review media is unavailable.');
            const media = await mediaForReview(session, roomId, submissionId, item.id);
            if (!media.ok) return rpcError(media);
            const object = await env.SAUTI_MEDIA.head(media.value.object_key);
            if (!validStorageObject(object, media.value)) return error(409, 'MEDIA_VALIDATION_FAILED', 'The submitted media is no longer available.');
          }
        }
      }
    }
    const result = await roomApprovalRpc(session, operation === 'decision' ? 'room_decide_post_submission' : 'room_withdraw_post_submission', args);
    if (result.ok && operation === 'decision' && payload.decision === 'approve' &&
        result.value?.submission?.state === 'approved' && !roomUuid(result.value?.post_id)) {
      return error(409, 'POST_UNAVAILABLE', 'This post was approved earlier and has since been removed.');
    }
    return result.ok ? json(200, { ok: true, data: result.value }) : rpcError(result);
  }
  return error(405, 'METHOD_NOT_ALLOWED', 'This Room action is unavailable.');
}
