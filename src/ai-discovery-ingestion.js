// Private, asynchronous indexing helper. Call from a trusted queue/worker only.
// This module deliberately exports no HTTP ingestion route.
import {
  createDiscoveryEmbedding, isPublicDiscoveryPost, removePostVector,
} from './ai-discovery-core.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isIndexableText(post) {
  return isPublicDiscoveryPost(post) && typeof post.body === 'string' && Boolean(post.body.trim());
}

function sameRevision(a, b) {
  return a?.id === b?.id
    && a?.author_id === b?.author_id
    && a?.audience_owner_id === b?.audience_owner_id
    && a?.updated_at === b?.updated_at
    && a?.body === b?.body
    && a?.visibility === b?.visibility
    && a?.post_status === b?.post_status
    && a?.moderation_state === b?.moderation_state
    && a?.deleted_at === b?.deleted_at
    && a?.circle_id === b?.circle_id
    && a?.parent_post_id === b?.parent_post_id;
}

async function isEligible(post, dependencies) {
  if (!isIndexableText(post)) return false;
  // Backend-specific lookup: must verify author/audience_owner discoverability
  // against current Supabase state and fail closed on query errors.
  return (await dependencies.authorAndAudienceDiscoverable(post)) === true;
}

/**
 * Sync one post's Vectorize representation using only trusted DB readers.
 *
 * fetchPost(id): returns the current DB record or null when truly absent;
 *                MUST throw on read errors.
 * authorAndAudienceDiscoverable(post): returns true only for discoverable
 *                authors and audience owners; MUST throw on read errors.
 *
 * The caller owns queue retries and full reconciliation. Re-checks narrow
 * privacy races but cannot make R2/Vectorize and PostgreSQL transactions atomic.
 * Final recommendations MUST revalidate viewer-specific Supabase RLS.
 */
export async function syncDiscoveryPost(postId, dependencies) {
  if (!UUID.test(String(postId || ''))) throw new Error('Invalid post id');
  if (typeof dependencies?.fetchPost !== 'function'
    || typeof dependencies?.authorAndAudienceDiscoverable !== 'function'
    || typeof dependencies?.index?.upsert !== 'function'
    || typeof dependencies?.index?.deleteByIds !== 'function') {
    throw new Error('Missing trusted discovery ingestion dependencies');
  }

  const previous = await dependencies.fetchPost(postId);
  if (!(await isEligible(previous, dependencies))) {
    await removePostVector(postId, dependencies.index);
    return { synced: true, action: 'removed', reason: 'not_publicly_discoverable' };
  }

  // Inference happens off the feed request path, once per published revision.
  const input = 'title: none | text: ' + previous.body.replace(/\s+/g, ' ').trim().slice(0, 1800);
  const values = await createDiscoveryEmbedding(dependencies.ai, input);
  const refreshed = await dependencies.fetchPost(postId);

  // If edited/deleted/hidden while inference ran, delete the old vector and
  // allow a subsequent queued retry to index the latest eligible revision.
  if (!sameRevision(previous, refreshed) || !(await isEligible(refreshed, dependencies))) {
    await removePostVector(postId, dependencies.index);
    return { synced: true, action: 'removed', reason: 'changed_during_inference' };
  }

  const result = await dependencies.index.upsert([{
    id: String(postId), values,
    metadata: { visibility: 'public', author_id: refreshed.author_id },
  }]);
  return { synced: true, action: 'indexed', mutationId: result?.mutationId || null };
}
