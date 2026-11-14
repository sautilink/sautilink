// Opt-in, staging-only semantic discovery preview. Never mounted on production.
import { findSimilarPublicPostIds, rerankEligiblePublicPosts } from './ai-discovery-core.js';

const PREVIEW_PATH = '/api/internal/ai-discovery/preview';
const STAGING_HOST = 'test.sautilink.com';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function config(env) {
  const rawUrl = String(env.DISCOVERY_SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const publicKey = String(env.DISCOVERY_SUPABASE_PUBLISHABLE_KEY || '').trim();
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/'
      || !/^[a-z0-9-]+\.supabase\.co$/i.test(parsed.hostname)) return null;
  } catch {
    return null;
  }
  return rawUrl && publicKey && env.AI && env.DISCOVERY_VECTOR_INDEX && env.AI_DISCOVERY_PREVIEW_LIMITER
    ? { url: rawUrl, key: publicKey } : null;
}

async function verifiedUser(request, config, fetchImpl) {
  const auth = String(request.headers.get('Authorization') || '');
  if (!/^Bearer [A-Za-z0-9._~-]+$/i.test(auth)) return null;
  const response = await fetchImpl(config.url + '/auth/v1/user', {
    method: 'GET',
    headers: { apikey: config.key, Authorization: auth, Accept: 'application/json' },
  });
  if (!response.ok) return null;
  const payload = await response.json();
  if (!UUID.test(String(payload?.id || ''))) return null;
  return { id: payload.id, authorization: auth };
}

async function viewerAllowedPosts(config, user, ids, fetchImpl) {
  if (!ids.length) return [];
  // Authenticated PostgREST SELECT enforces social_posts RLS, including:
  // visibility, moderation, author discoverability, block and mute policies.
  // Never use a service_role/secret key for this user-facing read.
  const url = new URL(config.url + '/rest/v1/social_posts');
  url.searchParams.set('select',
    'id,author_id,visibility,post_status,moderation_state,deleted_at,circle_id,parent_post_id,created_at,like_count,comment_count,repost_count');
  url.searchParams.set('id', 'in.(' + ids.join(',') + ')');
  url.searchParams.set('visibility', 'eq.public');
  url.searchParams.set('post_status', 'eq.published');
  url.searchParams.set('moderation_state', 'eq.visible');
  url.searchParams.set('deleted_at', 'is.null');
  url.searchParams.set('circle_id', 'is.null');
  url.searchParams.set('parent_post_id', 'is.null');
  url.searchParams.set('limit', '50');
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: {
      apikey: config.key, Authorization: user.authorization,
      Accept: 'application/json',
    },
  });
  if (!response.ok) throw new Error('VIEWER_SCOPED_READ_FAILED');
  const records = await response.json();
  if (!Array.isArray(records)) throw new Error('VIEWER_SCOPED_READ_INVALID');
  const allow = new Set(ids);
  return records.filter((post) => allow.has(String(post?.id || '')))
    .map((post) => ({ ...post, viewer_authorized: true }));
}

/**
 * An authenticated development probe for semantic candidates. Returns only
 * post IDs, never vectors or private attributes. The default is fail-closed.
 *
 * Important: do not use this endpoint to replace For You/Short Videos directly.
 * It is an experiment with a user-entered search string, not a personalized feed.
 */
export async function handleAIDiscoveryPreviewRequest(request, env, fetchImpl = fetch) {
  const url = new URL(request.url);
  if (url.pathname !== PREVIEW_PATH) return null;

  // Never enable this path on production, Workers previews, or arbitrary hosts.
  if (url.hostname !== STAGING_HOST || env.AI_DISCOVERY_PREVIEW_ENABLED !== 'true') {
    return json(404, { ok: false, error: 'NOT_FOUND' });
  }
  if (request.method !== 'GET') return json(405, { ok: false, error: 'METHOD_NOT_ALLOWED' });

  const settings = config(env);
  if (!settings) return json(503, { ok: false, error: 'DISCOVERY_NOT_CONFIGURED' });

  const input = String(url.searchParams.get('q') || '').trim();
  if (input.length < 3 || input.length > 180 || /[\x00-\x1f\x7f]/.test(input)) {
    return json(400, { ok: false, error: 'INVALID_QUERY' });
  }

  try {
    const user = await verifiedUser(request, settings, fetchImpl);
    if (!user) return json(401, { ok: false, error: 'UNAUTHORIZED' });

    // Hard dependency: no limiter = no costly AI calls.
    const allowed = await env.AI_DISCOVERY_PREVIEW_LIMITER.limit({ key: user.id });
    if (!allowed?.success) return json(429, { ok: false, error: 'RATE_LIMITED' });

    const matches = await findSimilarPublicPostIds(input, {
      ai: env.AI, index: env.DISCOVERY_VECTOR_INDEX,
    }, 30);
    if (!matches.length) return json(200, { ok: true, post_ids: [], count: 0, experimental: true });

    const posts = await viewerAllowedPosts(settings, user, matches.map((m) => m.id), fetchImpl);
    const ranked = rerankEligiblePublicPosts(posts, matches, { limit: 20, maxPerAuthor: 2 });
    return json(200, {
      ok: true, post_ids: ranked.map((post) => String(post.id)),
      count: ranked.length, experimental: true,
    });
  } catch {
    // Fail closed; the existing home-feed service remains the fallback.
    return json(503, { ok: false, error: 'DISCOVERY_UNAVAILABLE', fallback: 'current_feed' });
  }
}
