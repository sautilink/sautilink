function replaceExactOnce(source, before, after, label) {
  if (!source.includes(before)) {
    throw new Error(`Mention notification source transform could not find ${label}.`);
  }
  return source.replace(before, after);
}

export function transformMentionNotificationSource(filePath, source) {
  const normalized = String(filePath || '').replaceAll('\\', '/');
  if (!normalized.endsWith('/src/app.js') && !normalized.endsWith('src/app.js')) return source;

  let output = source;

  output = replaceExactOnce(
    output,
    "function notificationCopy(notification, actorName, circleName = '') {",
    "function notificationCopy(notification, actorName, circleName = '', post = null) {",
    'notification copy signature',
  );

  output = replaceExactOnce(
    output,
    "    reshare: [actor, notification.circle_id ? ` reposted your post${circleLabel}.` : ' reposted your post.'],\n    safety: ['SautiLink', ' updated a moderation decision affecting your content.'],",
    "    reshare: [actor, notification.circle_id ? ` reposted your post${circleLabel}.` : ' reposted your post.'],\n    mention: [actor, post?.id ? (post.parent_post_id ? ' tagged you in a reply.' : ' tagged you in a post.') : ' tagged you in a bio.'],\n    safety: ['SautiLink', ' updated a moderation decision affecting your content.'],",
    'mention notification copy',
  );

  output = replaceExactOnce(
    output,
    "  if (circle?.slug) item.dataset.circleSlug = circle.slug;",
    "  if (circle?.slug) item.dataset.circleSlug = circle.slug;\n  if (notification.notification_type === 'mention' && !post?.id && actor?.username) {\n    item.dataset.profileUsername = actor.username;\n  }",
    'bio mention profile destination',
  );

  output = replaceExactOnce(
    output,
    "    actor ? `@${actor.username}` : '',\n    circle?.name || ''\n  );",
    "    actor ? `@${actor.username}` : '',\n    circle?.name || '',\n    post\n  );",
    'notification copy post context',
  );

  output = replaceExactOnce(
    output,
    "    if (item.dataset.circleSlug) window.location.assign(circlePath(item.dataset.circleSlug));",
    "    if (item.dataset.circleSlug) {\n      window.location.assign(circlePath(item.dataset.circleSlug));\n      return;\n    }\n    if (item.dataset.profileUsername) {\n      window.location.assign(`/u/${encodeURIComponent(item.dataset.profileUsername)}`);\n    }",
    'bio mention notification navigation',
  );

  return output;
}
