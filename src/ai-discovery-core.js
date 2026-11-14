// Phase 1 (opt-in): public-content embeddings and candidate reranking.
// Never expose vector matches directly to clients. Supabase RLS and moderation
// are authoritative and MUST be rechecked before serving any recommendation.
export const DISCOVERY_MODEL = '@cf/google/embeddinggemma-2';
export const DISCOVERY_DIMENSIONS = 256;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isPublicDiscoveryPost(post) {
  return Boolean(
    post && UUID.test(String(post.id || '')) && UUID.test(String(post.author_id || ''))
    && post.visibility === 'public'
    && post.post_status === 'published'
    && post.moderation_state === 'visible'
    && post.deleted_at == null
    && post.circle_id == null
    && post.parent_post_id == null
  );
}

function cleanText(value, maxLength) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function requireVector(response) {
  const value = response?.data?.[0]?.embedding;
  if (!Array.isArray(value) || value.length !== DISCOVERY_DIMENSIONS
    || value.some((number) => !Number.isFinite(number))) {
    throw new Error('AI discovery embedding dimensions do not match the index');
  }
  return value;
}

export async function createDiscoveryEmbedding(ai, input) {
  if (typeof ai?.run !== 'function') throw new Error('Workers AI binding is missing');
  return requireVector(await ai.run(DISCOVERY_MODEL, {
    input: [input],
    dimensions: DISCOVERY_DIMENSIONS,
  }));
}

// Accept only verified public records fetched by a trusted backend query.
// This must not be exposed as a client-controlled route or accept user-submitted post objects.
export async function indexPublicPost(post, bindings) {
  if (!isPublicDiscoveryPost(post)) return { indexed: false, reason: 'ineligible' };
  const body = cleanText(post.body, 1800);
  if (!body) return { indexed: false, reason: 'empty_text' };
  if (typeof bindings?.index?.upsert !== 'function') throw new Error('Vectorize binding is missing');
  const values = await createDiscoveryEmbedding(bindings.ai, 'title: none | text: ' + body);
  const result = await bindings.index.upsert([{
    id: String(post.id),
    values,
    metadata: { visibility: 'public', author_id: String(post.author_id) },
  }]);
  return { indexed: true, mutationId: result?.mutationId || null };
}

// Invoke for deletes, account removals, moderation changes, visibility changes,
// and when a post is edited before re-indexing; do not leave stale vectors.
export async function removePostVector(postId, index) {
  if (!UUID.test(String(postId || ''))) throw new Error('Invalid post id');
  if (typeof index?.deleteByIds !== 'function') throw new Error('Vectorize binding is missing');
  return index.deleteByIds([String(postId)]);
}

// Internal candidate retrieval ONLY. Results are NOT authorization decisions.
// Always intersect IDs with currently viewer-eligible rows through Supabase RLS.
export async function findSimilarPublicPostIds(query, bindings, limit = 20) {
  const text = cleanText(query, 512);
  if (!text) return [];
  if (typeof bindings?.index?.query !== 'function') throw new Error('Vectorize binding is missing');
  const values = await createDiscoveryEmbedding(bindings.ai, 'task: search result | query: ' + text);
  const topK = Math.min(50, Math.max(1, Number.isFinite(limit) ? Math.floor(limit) : 20));
  const result = await bindings.index.query(values, {
    topK,
    filter: { visibility: 'public' },
    returnValues: false,
    returnMetadata: 'none',
  });
  return (Array.isArray(result?.matches) ? result.matches : [])
    .filter((match) => UUID.test(String(match?.id || '')))
    .map((match) => ({ id: String(match.id), score: Number(match.score) || 0 }));
}

function boundedScore(value) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

// candidates MUST already be selected with the viewer's RLS and block/mute rules.
// No followers-only, circle, deleted, or moderated posts may enter this candidate set.
// This is an extra safety filter, not a substitute for database authorization.
export function rerankEligiblePublicPosts(candidates, semanticMatches, options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const limit = Math.min(50, Math.max(1, Number.isFinite(options.limit) ? Math.floor(options.limit) : 20));
  const maxPerAuthor = Math.min(10, Math.max(1, Number.isFinite(options.maxPerAuthor) ? Math.floor(options.maxPerAuthor) : 2));
  const matches = new Map((semanticMatches || []).map((entry) => [String(entry.id), boundedScore(entry.score)]));
  const scored = (Array.isArray(candidates) ? candidates : [])
    .filter((post) => isPublicDiscoveryPost(post) && post.viewer_authorized === true
      && post.viewer_blocked !== true && post.viewer_muted !== true)
    .map((post) => {
      const ageHours = Math.max(0, (now - Date.parse(post.created_at || '')) / 3600000);
      const freshness = Number.isFinite(ageHours) ? Math.exp(-ageHours / 72) : 0;
      const engagement = Math.log1p(Math.max(0, Number(post.like_count) || 0)
        + Math.max(0, Number(post.comment_count) || 0) * 2
        + Math.max(0, Number(post.repost_count) || 0) * 2) / 12;
      const baseline = boundedScore(Number(post.baseline_score));
      const score = (0.55 * (matches.get(String(post.id)) || 0))
        + (0.2 * freshness)
        + (0.15 * boundedScore(engagement))
        + (0.1 * baseline);
      return { post, score };
    })
    .sort((a, b) => b.score - a.score || String(a.post.id).localeCompare(String(b.post.id)));
  const counts = new Map();
  const result = [];
  for (const item of scored) {
    const authorId = String(item.post.author_id);
    if ((counts.get(authorId) || 0) >= maxPerAuthor) continue;
    result.push(item.post);
    counts.set(authorId, (counts.get(authorId) || 0) + 1);
    if (result.length >= limit) break;
  }
  return result;
}
