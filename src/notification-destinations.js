// Keep in-app and push destinations on the same post/comment route contract.
export function notificationPostDestination(notification, post) {
  if (!post?.id) return '';
  const type = String(notification?.notification_type || '');
  const postPath = (id) => `/post/${encodeURIComponent(id)}`;

  if (type === 'like' || type === 'reshare' || type === 'quote') {
    return `${postPath(post.root_post_id || post.id)}?view=post`;
  }
  if (post.parent_post_id && (type === 'reply' || type === 'mention' || type === 'safety')) {
    return `${postPath(post.id)}?from=notification`;
  }
  if (type === 'mention') return `${postPath(post.id)}?view=post`;
  return postPath(post.id);
}
