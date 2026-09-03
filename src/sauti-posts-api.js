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

function normalizeBody(value) {
  return String(value ?? '').trim();
}

function uuid(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)
    ? normalized
    : '';
}

function replyAccess(value) {
  const normalized = String(value || 'everyone').trim().toLowerCase();
  return ['everyone', 'following', 'mentioned'].includes(normalized) ? normalized : '';
}

function audienceVisibility(value) {
  const normalized = String(value || 'public').trim().toLowerCase();
  return ['public', 'followers'].includes(normalized) ? normalized : '';
}

function hasMentionToken(value) {
  return /(^|[^a-z0-9._])@[a-z0-9][a-z0-9._]{2,29}(?=$|[^a-z0-9._])/i.test(String(value || ''));
}

async function consumeLimit(binding, key) {
  if (!binding?.limit) return { ready: false, allowed: false };
  const result = await binding.limit({ key });
  return { ready: true, allowed: Boolean(result?.success) };
}

async function createSauti(request, env) {
  const session = await authenticate(request);
  if (!session) return apiError(401, 'AUTH_REQUIRED', 'Sign in before creating a post.');

  const limited = await consumeLimit(env.SAUTI_CREATE_LIMITER, session.user.id);
  if (!limited.ready) return apiError(503, 'RATE_LIMIT_NOT_READY', 'Posting is not ready yet.');
  if (!limited.allowed) return apiError(429, 'RATE_LIMITED', 'You are sharing too quickly. Try again shortly.');

  const contentLength = Number(request.headers.get('Content-Length') || '0');
  if (contentLength > 16384) return apiError(413, 'BODY_TOO_LARGE', 'This post request is too large.');

  const payload = await request.json().catch(() => null);
  const body = normalizeBody(payload?.body);
  const requestedCircle = payload?.circle_id == null || payload.circle_id === '' ? '' : uuid(payload.circle_id);
  const requestedQuote = payload?.quote_post_id == null || payload.quote_post_id === '' ? '' : uuid(payload.quote_post_id);
  const requestedReplyAccess = replyAccess(payload?.reply_access);
  const requestedVisibility = requestedCircle ? 'circle' : audienceVisibility(payload?.visibility);
  const requestedMedia = Array.isArray(payload?.media) ? payload.media : [];

  if (payload?.circle_id && !requestedCircle) return apiError(400, 'INVALID_CIRCLE', 'This Sautify is unavailable.');
  if (payload?.quote_post_id && !requestedQuote) return apiError(400, 'INVALID_QUOTE', 'The quoted post is unavailable.');
  if (!requestedReplyAccess) return apiError(400, 'INVALID_REPLY_ACCESS', 'Choose who can reply to this post.');
  if (!requestedVisibility) return apiError(400, 'INVALID_AUDIENCE', 'Choose a valid post audience.');
  if (requestedMedia.length > 4) return apiError(400, 'MEDIA_LIMIT', 'A post can include up to four media items.');
  if (!body && !requestedQuote && !requestedMedia.length) {
    return apiError(400, 'BODY_REQUIRED', 'Write something or add media before sharing.');
  }
  if (body.length > 500) return apiError(400, 'BODY_TOO_LONG', 'Post text must be 500 characters or fewer.');
  if (requestedReplyAccess === 'mentioned' && !hasMentionToken(body)) {
    return apiError(400, 'MENTION_REQUIRED', 'Mention at least one SautiLink username or change who can reply.');
  }

  const media = [];
  const seen = new Set();
  for (let position = 0; position < requestedMedia.length; position += 1) {
    const item = requestedMedia[position] || {};
    const id = uuid(item.id);
    if (!id || seen.has(id)) return apiError(400, 'INVALID_MEDIA', 'One or more media items are invalid.');
    seen.add(id);
    const altText = String(item.alt_text || '').trim();
    if (altText.length > 1000) return apiError(400, 'ALT_TEXT_TOO_LONG', 'Alternative text must be 1,000 characters or fewer.');

    const params = new URLSearchParams({
      id: `eq.${id}`,
      owner_id: `eq.${session.user.id}`,
      post_id: 'is.null',
      upload_status: 'eq.ready',
      select: 'id,owner_id,object_key,media_kind,content_type,size_bytes,width,height,duration_ms',
      limit: '1',
    });
    const mediaResponse = await fetch(`${SUPABASE_URL}/rest/v1/social_post_media?${params}`, {
      headers: supabaseHeaders(session.auth),
    });
    if (!mediaResponse.ok) return apiError(409, 'MEDIA_LOOKUP_FAILED', 'The selected media could not be verified.');
    const rows = await mediaResponse.json().catch(() => []);
    const row = Array.isArray(rows) ? rows[0] || null : null;
    if (!row || !env.SAUTI_MEDIA) return apiError(409, 'MEDIA_NOT_READY', 'Upload the media again before sharing.');

    const object = await env.SAUTI_MEDIA.head(row.object_key);
    if (
      !object ||
      object.size !== Number(row.size_bytes) ||
      object.customMetadata?.ownerId !== session.user.id ||
      object.customMetadata?.mediaId !== id ||
      object.customMetadata?.validated !== 'true'
    ) {
      return apiError(409, 'MEDIA_VALIDATION_FAILED', 'One or more media items failed storage validation.');
    }
    media.push({ ...row, alt_text: altText, position });
  }

  const clientRequestId = crypto.randomUUID();
  const response = await fetch(`${SUPABASE_URL}/rest/v1/social_posts?select=id,author_id,circle_id,visibility,reply_access,quote_post_id,body,media_count,created_at`, {
    method: 'POST',
    headers: {
      ...supabaseHeaders(session.auth),
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      author_id: session.user.id,
      body,
      visibility: requestedVisibility,
      post_status: 'published',
      circle_id: requestedCircle || null,
      reply_access: requestedReplyAccess,
      quote_post_id: requestedQuote || null,
      client_request_id: clientRequestId,
      media_count: media.length,
    }),
  });

  if (!response.ok) {
    const databaseError = await response.json().catch(() => null);
    const detail = String(databaseError?.message || databaseError?.details || '');
    if (detail.includes('PHASE25_QUOTE_TARGET_UNAVAILABLE')) {
      return apiError(409, 'QUOTE_UNAVAILABLE', 'Only an available public post can be quoted.');
    }
    const message = requestedCircle
      ? 'This Sautify post could not be published. Confirm that you are still a Sautify member.'
      : requestedVisibility === 'followers'
        ? 'This followers-only post could not be published. Try again.'
        : 'Your post could not be published. Try again.';
    return apiError(409, 'SAUTI_CREATE_FAILED', message);
  }

  const rows = await response.json().catch(() => []);
  const post = Array.isArray(rows) ? rows[0] || null : null;
  if (!post) return apiError(409, 'SAUTI_CREATE_FAILED', 'Your post could not be published. Try again.');

  const attached = [];
  try {
    for (const item of media) {
      const params = new URLSearchParams({
        id: `eq.${item.id}`,
        owner_id: `eq.${session.user.id}`,
        post_id: 'is.null',
        upload_status: 'eq.ready',
        select: 'id',
      });
      const attachResponse = await fetch(`${SUPABASE_URL}/rest/v1/social_post_media?${params}`, {
        method: 'PATCH',
        headers: {
          ...supabaseHeaders(session.auth),
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify({
          post_id: post.id,
          position: item.position,
          alt_text: item.alt_text,
          upload_status: 'attached',
          attached_at: new Date().toISOString(),
        }),
      });
      if (!attachResponse.ok) throw new Error('MEDIA_ATTACH_FAILED');
      const attachedRows = await attachResponse.json().catch(() => []);
      if (!Array.isArray(attachedRows) || !attachedRows[0]?.id) throw new Error('MEDIA_ATTACH_FAILED');
      attached.push(item);
    }
  } catch {
    const deleteParams = new URLSearchParams({ id: `eq.${post.id}`, author_id: `eq.${session.user.id}` });
    await fetch(`${SUPABASE_URL}/rest/v1/social_posts?${deleteParams}`, {
      method: 'DELETE',
      headers: supabaseHeaders(session.auth),
    }).catch(() => {});
    await Promise.all(media.map((item) => env.SAUTI_MEDIA.delete(item.object_key).catch(() => {})));
    return apiError(409, 'MEDIA_ATTACH_FAILED', 'The post was not published because its media could not be attached safely.');
  }

  return json(201, { ok: true, data: { post, media: attached.map((item) => item.id) } });
}

function postIdFromPath(pathname) {
  const match = pathname.match(/^\/api\/sauti\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  return match?.[1]?.toLowerCase() || '';
}

async function deleteSauti(request, env, postId) {
  const session = await authenticate(request);
  if (!session) return apiError(401, 'AUTH_REQUIRED', 'Sign in before deleting a post.');

  const limited = await consumeLimit(env.SAUTI_DELETE_LIMITER, session.user.id);
  if (!limited.ready) return apiError(503, 'RATE_LIMIT_NOT_READY', 'Post deletion is not ready yet.');
  if (!limited.allowed) return apiError(429, 'RATE_LIMITED', 'You are making changes too quickly. Try again shortly.');

  let mediaObjects = [];
  if (env.SAUTI_MEDIA) {
    const mediaParams = new URLSearchParams({
      post_id: `eq.${postId}`,
      owner_id: `eq.${session.user.id}`,
      select: 'object_key',
    });
    const mediaResponse = await fetch(`${SUPABASE_URL}/rest/v1/social_post_media?${mediaParams}`, {
      headers: supabaseHeaders(session.auth),
    });
    if (mediaResponse.ok) {
      const mediaRows = await mediaResponse.json().catch(() => []);
      mediaObjects = Array.isArray(mediaRows) ? mediaRows.map((row) => row.object_key).filter(Boolean) : [];
    }
  }

  const params = new URLSearchParams({
    id: `eq.${postId}`,
    author_id: `eq.${session.user.id}`,
    select: 'id',
  });

  const response = await fetch(`${SUPABASE_URL}/rest/v1/social_posts?${params}`, {
    method: 'DELETE',
    headers: {
      ...supabaseHeaders(session.auth),
      Prefer: 'return=representation',
    },
  });

  if (!response.ok) return apiError(409, 'SAUTI_DELETE_FAILED', 'This post could not be deleted.');

  const rows = await response.json().catch(() => []);
  if (!Array.isArray(rows) || !rows[0]?.id) {
    return apiError(404, 'SAUTI_NOT_FOUND', 'This post is unavailable.');
  }

  if (env.SAUTI_MEDIA && mediaObjects.length) {
    await Promise.all(mediaObjects.map((key) => env.SAUTI_MEDIA.delete(key).catch(() => {})));
  }

  return json(200, { ok: true, data: { id: rows[0].id } });
}

export async function handleSautiRequest(request, env) {
  const url = new URL(request.url);

  if (url.pathname === '/api/sauti' && request.method === 'POST') {
    return createSauti(request, env);
  }

  const postId = postIdFromPath(url.pathname);
  if (postId && request.method === 'DELETE') {
    return deleteSauti(request, env, postId);
  }

  return null;
}
