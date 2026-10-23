export const VERIFICATION_ACCOUNT_TYPES = Object.freeze(['individual', 'business', 'brand', 'entity', 'organisation']);

export function verificationAccountType(value) {
  return VERIFICATION_ACCOUNT_TYPES.includes(value) ? value : 'individual';
}

export function verificationEvidenceReady(type, socialHandles, articleLinks) {
  return verificationAccountType(type) === 'individual'
    ? socialHandles.some(Boolean) || articleLinks.length > 0
    : articleLinks.length > 0;
}

export function rankTrendingPosts(candidates, { blocked = new Set(), muted = new Set(), limit = 5 } = {}) {
  const unique = new Map();
  for (const post of candidates) {
    if (!post?.id || blocked.has(post.author_id) || muted.has(post.author_id)) continue;
    if (!unique.has(post.id)) unique.set(post.id, post);
  }
  const count = (value) => Math.max(0, Number(value) || 0);
  const score = (post) => count(post.like_count) + 2 * count(post.comment_count) + count(post.repost_count);
  return [...unique.values()].sort((a, b) => score(b) - score(a)
    || Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, limit);
}
