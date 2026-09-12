const SUPABASE_URL = 'https://rggpyiterdbbugluejcs.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_omJ-5Mem-K4vgm6WLXRzJQ_jeGs65ca';
const TRANSLATION_MODEL = '@cf/meta/m2m100-1.2b';
const TRANSLATION_VERSION = 'v1';
const TRANSLATION_EDGE_TTL_SECONDS = 30 * 24 * 60 * 60;
const SUPPORTED_SOURCE_LANGUAGES = new Set(['sw', 'fr']);

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

function postIdFromPath(pathname) {
  const match = String(pathname || '').match(/^\/api\/post-translations\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/?$/i);
  return match?.[1]?.toLowerCase() || '';
}

export function normalizeTranslationSourceLanguage(value) {
  const language = String(value || '').trim().toLowerCase();
  return SUPPORTED_SOURCE_LANGUAGES.has(language) ? language : '';
}

async function selectVisiblePost(postId, auth) {
  const params = new URLSearchParams({
    id: `eq.${postId}`,
    select: 'id,body',
    limit: '1',
  });
  const response = await fetch(`${SUPABASE_URL}/rest/v1/social_posts?${params}`, {
    headers: supabaseHeaders(auth),
  });
  if (!response.ok) return null;
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function consumeLimit(binding, key) {
  if (!binding?.limit) return { ready: false, allowed: false };
  const result = await binding.limit({ key });
  return { ready: true, allowed: Boolean(result?.success) };
}

async function bodyDigest(value) {
  const bytes = new TextEncoder().encode(String(value || ''));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].slice(0, 16).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function translationCacheKey(request, postId, sourceLanguage, body) {
  const digest = await bodyDigest(body);
  const url = new URL(request.url);
  url.pathname = `/__sautilink-cache/post-translation/${TRANSLATION_VERSION}/${postId}/${sourceLanguage}/${digest}/en`;
  url.search = '';
  return new Request(url.toString(), { method: 'GET' });
}

function translationPayload(postId, sourceLanguage, translatedText, cached) {
  return {
    ok: true,
    data: {
      post_id: postId,
      source_language: sourceLanguage,
      target_language: 'en',
      translated_text: translatedText,
      cached,
    },
  };
}

async function translatePost(request, env, postId) {
  const session = await authenticate(request);
  if (!session) return apiError(401, 'AUTH_REQUIRED', 'Sign in before translating a post.');

  const payload = await request.json().catch(() => null);
  const sourceLanguage = normalizeTranslationSourceLanguage(payload?.source_language);
  if (!sourceLanguage) {
    return apiError(400, 'UNSUPPORTED_SOURCE_LANGUAGE', 'Only Kiswahili and French posts can be translated to English right now.');
  }

  // RLS is deliberately checked before the shared edge cache. A viewer must still
  // be allowed to read the original post before a cached translation is returned.
  const post = await selectVisiblePost(postId, session.auth);
  if (!post?.id) return apiError(404, 'POST_UNAVAILABLE', 'This post is unavailable.');

  const body = String(post.body || '').trim();
  if (!body) return apiError(422, 'POST_HAS_NO_TEXT', 'This post has no text to translate.');
  if (body.length > 500) return apiError(422, 'POST_TEXT_TOO_LONG', 'This post is too long to translate safely.');

  const cache = globalThis.caches?.default;
  const cacheKey = await translationCacheKey(request, postId, sourceLanguage, body);
  if (cache) {
    const cachedResponse = await cache.match(cacheKey).catch(() => null);
    if (cachedResponse) {
      const cachedPayload = await cachedResponse.json().catch(() => null);
      const translatedText = String(cachedPayload?.translated_text || '').trim();
      if (translatedText) return json(200, translationPayload(postId, sourceLanguage, translatedText, true));
    }
  }

  if (!env.AI?.run) return apiError(503, 'TRANSLATION_NOT_READY', 'Post translation is not available yet.');

  const limited = await consumeLimit(env.POST_TRANSLATION_LIMITER, session.user.id);
  if (!limited.ready) return apiError(503, 'TRANSLATION_NOT_READY', 'Post translation is not available yet.');
  if (!limited.allowed) return apiError(429, 'TRANSLATION_RATE_LIMITED', 'You are translating too many new posts. Try again shortly.');

  let result = null;
  try {
    result = await env.AI.run(TRANSLATION_MODEL, {
      text: body,
      source_lang: sourceLanguage,
      target_lang: 'en',
    });
  } catch {
    return apiError(503, 'TRANSLATION_FAILED', 'This post could not be translated right now.');
  }

  const translatedText = String(result?.translated_text || '').trim();
  if (!translatedText) return apiError(502, 'TRANSLATION_EMPTY', 'This post could not be translated right now.');

  if (cache) {
    const edgeResponse = new Response(JSON.stringify({ translated_text: translatedText }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': `public, max-age=${TRANSLATION_EDGE_TTL_SECONDS}, immutable`,
      },
    });
    await cache.put(cacheKey, edgeResponse).catch(() => {});
  }

  return json(200, translationPayload(postId, sourceLanguage, translatedText, false));
}

export async function handlePostTranslationRequest(request, env) {
  const url = new URL(request.url);
  const postId = postIdFromPath(url.pathname);
  if (!postId) return null;
  if (request.method !== 'POST') return apiError(405, 'METHOD_NOT_ALLOWED', 'Use POST to translate a post.');
  return translatePost(request, env, postId);
}
