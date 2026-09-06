const APP_REPLACEMENTS = Object.freeze([
  ['return composerMedia\n    .slice(0, 4)', 'return composerMedia\n    .slice(0, 5)'],
  ['? items.slice(0, 4).filter', '? items.slice(0, 5).filter'],
  ['`${composerMedia.length} / 4`', '`${composerMedia.length} / 5`'],
  ['composerMedia.length >= 4', 'composerMedia.length >= 5'],
  ['Math.max(0, 4 - composerMedia.length)', 'Math.max(0, 5 - composerMedia.length)'],
  ["A post can include up to four media items.", "A post can include up to five media items."],
  ['return Array.isArray(data) ? data.slice(0, 4) : [];', 'return Array.isArray(data) ? data.slice(0, 5) : [];'],
  ['composerMedia.length > 4', 'composerMedia.length > 5'],
  ['composerMedia.length < 4', 'composerMedia.length < 5'],
]);

const POST_API_REPLACEMENTS = Object.freeze([
  ['requestedMedia.length > 4', 'requestedMedia.length > 5'],
  ["A post can include up to four media items.", "A post can include up to five media items."],
]);

function replaceAllExact(source, replacements) {
  let output = source;
  for (const [before, after] of replacements) output = output.replaceAll(before, after);
  return output;
}

function replaceExactOnce(source, before, after, label) {
  if (!source.includes(before)) {
    throw new Error(`Post media source transform could not find ${label}.`);
  }
  return source.replace(before, after);
}

function transformHomeMediaReservation(source) {
  let output = source;

  output = replaceExactOnce(
    output,
    `  const savedQuery = supabase\n    .from('social_saved_posts')\n    .select('post_id')\n    .eq('user_id', currentMemberId)\n    .in('post_id', postIds);\n\n  const [`,
    `  const savedQuery = supabase\n    .from('social_saved_posts')\n    .select('post_id')\n    .eq('user_id', currentMemberId)\n    .in('post_id', postIds);\n\n  // Fetch attached media metadata with the feed page so media posts can reserve\n  // their final layout before protected image/video bytes begin loading.\n  const mediaQuery = supabase\n    .from('social_post_media')\n    .select('post_id,id,media_kind,content_type,width,height,duration_ms,alt_text,position')\n    .in('post_id', postIds)\n    .eq('upload_status', 'attached')\n    .order('position', { ascending: true });\n\n  const [`,
    'the Home media metadata query insertion point',
  );

  output = replaceExactOnce(
    output,
    `    { data: saves, error: savesError },\n  ] = await Promise.all([postQuery, actorQuery, likeQuery, repostQuery, savedQuery]);\n\n  if (postsError || actorsError || likesError || repostsError || savesError) {\n    throw postsError || actorsError || likesError || repostsError || savesError;\n  }`,
    `    { data: saves, error: savesError },\n    { data: mediaRows },\n  ] = await Promise.all([postQuery, actorQuery, likeQuery, repostQuery, savedQuery, mediaQuery]);\n\n  if (postsError || actorsError || likesError || repostsError || savesError) {\n    throw postsError || actorsError || likesError || repostsError || savesError;\n  }`,
    'the Home hydration Promise.all block',
  );

  output = replaceExactOnce(
    output,
    `  const liked = new Set((likes || []).map((row) => row.post_id));\n  const reposted = new Set((reposts || []).map((row) => row.post_id));\n  const saved = new Set((saves || []).map((row) => row.post_id));\n\n  const authorIds =`,
    `  const liked = new Set((likes || []).map((row) => row.post_id));\n  const reposted = new Set((reposts || []).map((row) => row.post_id));\n  const saved = new Set((saves || []).map((row) => row.post_id));\n  const mediaMap = new Map();\n  (mediaRows || []).forEach((row) => {\n    if (!row?.post_id) return;\n    const bucket = mediaMap.get(row.post_id) || [];\n    if (bucket.length >= 5) return;\n    bucket.push(row);\n    mediaMap.set(row.post_id, bucket);\n  });\n\n  const authorIds =`,
    'the Home media metadata map insertion point',
  );

  output = replaceExactOnce(
    output,
    `      saved: saved.has(event.post_id),\n      following: followedAuthors.has(postMap.get(event.post_id)?.author_id),`,
    `      saved: saved.has(event.post_id),\n      mediaRows: mediaMap.get(event.post_id) || [],\n      following: followedAuthors.has(postMap.get(event.post_id)?.author_id),`,
    'the hydrated Home feed item media metadata field',
  );

  output = replaceExactOnce(
    output,
    `async function hydrateSautiMediaGallery(postId, gallery) {\n  const rows = await loadSautiMediaRows(postId);`,
    `async function hydrateSautiMediaGallery(postId, gallery, prefetchedRows = null) {\n  const rows = Array.isArray(prefetchedRows) ? prefetchedRows : await loadSautiMediaRows(postId);`,
    'the post media hydrator signature',
  );

  output = replaceExactOnce(
    output,
    `  const mediaGallery = document.createElement('div');\n  mediaGallery.className = 'sauti-media-gallery loading';\n  mediaGallery.setAttribute('aria-label', 'Post media');\n  main.append(mediaGallery);\n  void hydrateSautiMediaGallery(post.id, mediaGallery);`,
    `  const mediaGallery = document.createElement('div');\n  const homeMediaRows = home && Array.isArray(item.mediaRows) ? item.mediaRows : [];\n  mediaGallery.className = homeMediaRows.length\n    ? \`sauti-media-gallery loading media-count-\${homeMediaRows.length}\`\n    : 'sauti-media-gallery loading';\n  mediaGallery.setAttribute('aria-label', 'Post media');\n\n  if (homeMediaRows.length) {\n    // Mark the post as media-backed before it reaches the DOM. This keeps the text\n    // body/caption mode stable and prevents the image region from appearing later.\n    article.classList.add('has-media');\n    if (caption) caption.hidden = false;\n    mediaGallery.dataset.mediaReserved = 'true';\n\n    if (homeMediaRows.length === 1) {\n      const width = Number(homeMediaRows[0]?.width);\n      const height = Number(homeMediaRows[0]?.height);\n      const ratio = width > 0 && height > 0 ? \`\${width} / \${height}\` : '4 / 5';\n      mediaGallery.style.setProperty('--single-media-aspect-ratio', ratio);\n\n      // The existing single-media tile rules reserve the exact final height. The\n      // hydrator replaces this neutral slot in-place when protected bytes arrive.\n      const reservedSlot = document.createElement('span');\n      reservedSlot.className = 'sauti-media-tile';\n      reservedSlot.setAttribute('aria-hidden', 'true');\n      mediaGallery.append(reservedSlot);\n    }\n  }\n\n  main.append(mediaGallery);\n  void hydrateSautiMediaGallery(post.id, mediaGallery, homeMediaRows.length ? homeMediaRows : null);`,
    'the Home post media gallery creation block',
  );

  return output;
}

export function transformPostMediaSource(filePath, source) {
  const normalized = String(filePath || '').replaceAll('\\\\', '/');
  if (normalized.endsWith('/src/app.js') || normalized.endsWith('src/app.js')) {
    return transformHomeMediaReservation(replaceAllExact(source, APP_REPLACEMENTS));
  }
  if (normalized.endsWith('/src/sauti-posts-api.js') || normalized.endsWith('src/sauti-posts-api.js')) {
    return replaceAllExact(source, POST_API_REPLACEMENTS);
  }
  return source;
}
