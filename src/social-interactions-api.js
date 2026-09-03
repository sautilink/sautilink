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

async function requireSessionAndLimit(request, binding, message) {
  const session = await authenticate(request);
  if (!session) return { response: apiError(401, 'AUTH_REQUIRED', 'Sign in before using social interactions.') };

  const limited = await consumeLimit(binding, session.user.id);
  if (!limited.ready) return { response: apiError(503, 'RATE_LIMIT_NOT_READY', 'Social interactions are not ready yet.') };
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
  const normalized = String(value || '').toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(normalized)
    ? normalized
    : '';
}

function username(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._]{2,29}$/.test(normalized) ? normalized : '';
}

async function resolveProfile(session, handle) {
  const params = new URLSearchParams({
    username: `eq.${handle}`,
    select: 'id,username,is_discoverable,followers_count,following_count',
    limit: '1',
  });
  const response = await rest(`social_profiles?${params}`, { auth: session.auth });
  if (!response.ok) return null;
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function setFollow(request, env, handle, active) {
  const gate = await requireSessionAndLimit(
    request,
    env.SOCIAL_FOLLOW_LIMITER,
    'You are changing follow relationships too quickly. Try again shortly.',
  );
  if (gate.response) return gate.response;

  const target = await resolveProfile(gate.session, handle);
  if (!target) return apiError(404, 'PROFILE_UNAVAILABLE', 'This profile is unavailable.');
  if (target.id === gate.session.user.id) return apiError(400, 'SELF_FOLLOW', 'You cannot follow yourself.');

  if (active) {
    const response = await rest('social_follows', {
      method: 'POST',
      auth: gate.session.auth,
      prefer: 'return=minimal',
      body: {
        follower_id: gate.session.user.id,
        followed_id: target.id,
      },
    });
    if (!response.ok && response.status !== 409) {
      return apiError(409, 'FOLLOW_FAILED', 'This follow could not be saved.');
    }
  } else {
    const params = new URLSearchParams({
      follower_id: `eq.${gate.session.user.id}`,
      followed_id: `eq.${target.id}`,
    });
    const response = await rest(`social_follows?${params}`, {
      method: 'DELETE',
      auth: gate.session.auth,
      prefer: 'return=minimal',
    });
    if (!response.ok) return apiError(409, 'UNFOLLOW_FAILED', 'This follow could not be removed.');
  }

  return json(200, { ok: true, data: { username: target.username, following: active } });
}

async function setLike(request, env, postId, active) {
  const gate = await requireSessionAndLimit(
    request,
    env.SOCIAL_LIKE_LIMITER,
    'You are reacting too quickly. Try again shortly.',
  );
  if (gate.response) return gate.response;

  if (active) {
    const response = await rest('social_post_reactions', {
      method: 'POST',
      auth: gate.session.auth,
      prefer: 'return=minimal',
      body: {
        post_id: postId,
        user_id: gate.session.user.id,
        reaction_type: 'like',
      },
    });
    if (!response.ok && response.status !== 409) {
      return apiError(409, 'LIKE_FAILED', 'This Like could not be saved.');
    }
  } else {
    const params = new URLSearchParams({
      post_id: `eq.${postId}`,
      user_id: `eq.${gate.session.user.id}`,
    });
    const response = await rest(`social_post_reactions?${params}`, {
      method: 'DELETE',
      auth: gate.session.auth,
      prefer: 'return=minimal',
    });
    if (!response.ok) return apiError(409, 'UNLIKE_FAILED', 'This Like could not be removed.');
  }

  return json(200, { ok: true, data: { post_id: postId, liked: active } });
}

async function checkReplyPermission(session, postId) {
  const postParams = new URLSearchParams({
    id: `eq.${postId}`,
    select: 'id,author_id,reply_access,body',
    limit: '1',
  });
  const postResponse = await rest(`social_posts?${postParams}`, { auth: session.auth });
  if (!postResponse.ok) {
    return { response: apiError(409, 'REPLY_CHECK_FAILED', 'Reply permissions could not be checked.') };
  }

  const postRows = await postResponse.json().catch(() => []);
  const post = Array.isArray(postRows) ? postRows[0] || null : null;
  if (!post) return { response: apiError(404, 'POST_UNAVAILABLE', 'This post is unavailable.') };

  if (post.author_id === session.user.id || post.reply_access === 'everyone') return { allowed: true };

  if (post.reply_access === 'following') {
    const followParams = new URLSearchParams({
      follower_id: `eq.${post.author_id}`,
      followed_id: `eq.${session.user.id}`,
      select: 'follower_id',
      limit: '1',
    });
    const followResponse = await rest(`social_follows?${followParams}`, { auth: session.auth });
    const rows = followResponse.ok ? await followResponse.json().catch(() => []) : [];
    if (Array.isArray(rows) && rows[0]) return { allowed: true };
    return { response: apiError(403, 'REPLIES_RESTRICTED', 'Only people this author follows can reply to this post.') };
  }

  if (post.reply_access === 'mentioned') {
    const profileParams = new URLSearchParams({
      id: `eq.${session.user.id}`,
      select: 'username',
      limit: '1',
    });
    const profileResponse = await rest(`social_profiles?${profileParams}`, { auth: session.auth });
    const rows = profileResponse.ok ? await profileResponse.json().catch(() => []) : [];
    const handle = Array.isArray(rows) ? String(rows[0]?.username || '').toLowerCase() : '';
    if (handle) {
      const mentions = [...String(post.body || '').matchAll(/(^|[^a-z0-9._])@([a-z0-9][a-z0-9._]{2,29})(?=$|[^a-z0-9._])/gi)]
        .map((match) => String(match[2] || '').toLowerCase());
      if (mentions.includes(handle)) return { allowed: true };
    }
    return { response: apiError(403, 'REPLIES_RESTRICTED', 'Only people mentioned in this post can reply.') };
  }

  return { response: apiError(403, 'REPLIES_RESTRICTED', 'Replies are restricted on this post.') };
}

async function findReplyByRequest(session, requestId) {
  const params = new URLSearchParams({
    author_id: `eq.${session.user.id}`,
    client_request_id: `eq.${requestId}`,
    select: 'id,author_id,parent_post_id,root_post_id,thread_depth,audience_owner_id,visibility,circle_id,reply_access,quote_post_id,body,created_at,comment_count,like_count,repost_count',
    limit: '1',
  });
  const response = await rest(`social_posts?${params}`, { auth: session.auth });
  if (!response.ok) return null;
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function createReply(request, env, postId) {
  const gate = await requireSessionAndLimit(
    request,
    env.SOCIAL_COMMENT_LIMITER,
    'You are replying too quickly. Try again shortly.',
  );
  if (gate.response) return gate.response;

  const contentLength = Number(request.headers.get('Content-Length') || '0');
  if (contentLength > 4096) return apiError(413, 'BODY_TOO_LARGE', 'Replies must be 500 characters or fewer.');

  const payload = await request.json().catch(() => null);
  const body = String(payload?.body || '').trim();
  const requestId = uuid(payload?.client_request_id) || crypto.randomUUID();

  if (!body) return apiError(400, 'BODY_REQUIRED', 'Write a reply first.');
  if (body.length > 500) return apiError(400, 'BODY_TOO_LONG', 'Replies must be 500 characters or fewer.');

  const permission = await checkReplyPermission(gate.session, postId);
  if (permission.response) return permission.response;

  const existing = await findReplyByRequest(gate.session, requestId);
  if (existing) return json(200, { ok: true, data: { reply: existing, idempotent: true } });

  const response = await rest(
    'social_posts?select=id,author_id,parent_post_id,root_post_id,thread_depth,audience_owner_id,visibility,circle_id,reply_access,quote_post_id,body,created_at,comment_count,like_count,repost_count',
    {
      method: 'POST',
      auth: gate.session.auth,
      prefer: 'return=representation',
      body: {
        author_id: gate.session.user.id,
        body,
        parent_post_id: postId,
        client_request_id: requestId,
        reply_access: 'everyone',
      },
    },
  );

  if (!response.ok) {
    const databaseError = await response.json().catch(() => null);
    const code = String(databaseError?.code || '');
    const detail = String(databaseError?.message || databaseError?.details || '');

    if (code === '23505') {
      const duplicate = await findReplyByRequest(gate.session, requestId);
      if (duplicate) return json(200, { ok: true, data: { reply: duplicate, idempotent: true } });
    }
    if (code === '42501' || detail.includes('PHASE26_REPLIES_RESTRICTED')) {
      return apiError(403, 'REPLIES_RESTRICTED', 'You do not have permission to reply to this post.');
    }
    if (detail.includes('PHASE26_PARENT_UNAVAILABLE')) {
      return apiError(404, 'POST_UNAVAILABLE', 'This post is unavailable.');
    }
    if (detail.includes('PHASE26_THREAD_DEPTH_LIMIT')) {
      return apiError(409, 'THREAD_DEPTH_LIMIT', 'This reply branch is too deep. Open the conversation and reply higher in the thread.');
    }
    return apiError(409, 'REPLY_FAILED', 'This reply could not be shared.');
  }

  const rows = await response.json().catch(() => []);
  const reply = Array.isArray(rows) ? rows[0] || null : null;
  if (!reply) return apiError(409, 'REPLY_FAILED', 'This reply could not be shared.');

  return json(201, { ok: true, data: { reply, idempotent: false } });
}

async function deleteReply(request, env, replyId) {
  const gate = await requireSessionAndLimit(
    request,
    env.SOCIAL_COMMENT_DELETE_LIMITER,
    'You are deleting replies too quickly. Try again shortly.',
  );
  if (gate.response) return gate.response;

  const params = new URLSearchParams({
    id: `eq.${replyId}`,
    author_id: `eq.${gate.session.user.id}`,
    parent_post_id: 'not.is.null',
    select: 'id,parent_post_id,root_post_id',
  });
  const response = await rest(`social_posts?${params}`, {
    method: 'DELETE',
    auth: gate.session.auth,
    prefer: 'return=representation',
  });
  if (!response.ok) return apiError(409, 'REPLY_DELETE_FAILED', 'This reply could not be deleted.');

  const rows = await response.json().catch(() => []);
  const reply = Array.isArray(rows) ? rows[0] || null : null;
  if (!reply?.id) return apiError(404, 'REPLY_NOT_FOUND', 'This reply is unavailable.');

  return json(200, { ok: true, data: { reply } });
}

async function setRepost(request, env, postId, active) {
  const gate = await requireSessionAndLimit(
    request,
    env.SOCIAL_REPOST_LIMITER,
    'You are reposting too quickly. Try again shortly.',
  );
  if (gate.response) return gate.response;

  if (active) {
    const response = await rest('social_reposts', {
      method: 'POST',
      auth: gate.session.auth,
      prefer: 'return=minimal',
      body: {
        post_id: postId,
        user_id: gate.session.user.id,
      },
    });
    if (!response.ok && response.status !== 409) {
      return apiError(409, 'REPOST_FAILED', 'This repost could not be saved.');
    }
  } else {
    const params = new URLSearchParams({
      post_id: `eq.${postId}`,
      user_id: `eq.${gate.session.user.id}`,
    });
    const response = await rest(`social_reposts?${params}`, {
      method: 'DELETE',
      auth: gate.session.auth,
      prefer: 'return=minimal',
    });
    if (!response.ok) return apiError(409, 'UNDO_REPOST_FAILED', 'This repost could not be removed.');
  }

  return json(200, { ok: true, data: { post_id: postId, reposted: active } });
}

export async function handleSocialInteractionRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  const followMatch = path.match(/^\/api\/social\/follow\/([^/]+)$/);
  if (followMatch && (request.method === 'POST' || request.method === 'DELETE')) {
    const handle = username(decodeURIComponent(followMatch[1]));
    if (!handle) return apiError(400, 'INVALID_USERNAME', 'Enter a valid username.');
    return setFollow(request, env, handle, request.method === 'POST');
  }

  const likeMatch = path.match(/^\/api\/social\/posts\/([^/]+)\/like$/);
  if (likeMatch && (request.method === 'POST' || request.method === 'DELETE')) {
    const postId = uuid(likeMatch[1]);
    if (!postId) return apiError(400, 'INVALID_POST', 'This post is unavailable.');
    return setLike(request, env, postId, request.method === 'POST');
  }

  const replyMatch = path.match(/^\/api\/social\/posts\/([^/]+)\/(?:replies|comments)$/);
  if (replyMatch && request.method === 'POST') {
    const postId = uuid(replyMatch[1]);
    if (!postId) return apiError(400, 'INVALID_POST', 'This post is unavailable.');
    return createReply(request, env, postId);
  }

  const replyDeleteMatch = path.match(/^\/api\/social\/(?:replies|comments)\/([^/]+)$/);
  if (replyDeleteMatch && request.method === 'DELETE') {
    const replyId = uuid(replyDeleteMatch[1]);
    if (!replyId) return apiError(400, 'INVALID_REPLY', 'This reply is unavailable.');
    return deleteReply(request, env, replyId);
  }

  const repostMatch = path.match(/^\/api\/social\/posts\/([^/]+)\/repost$/);
  if (repostMatch && (request.method === 'POST' || request.method === 'DELETE')) {
    const postId = uuid(repostMatch[1]);
    if (!postId) return apiError(400, 'INVALID_POST', 'This post is unavailable.');
    return setRepost(request, env, postId, request.method === 'POST');
  }

  return null;
}
