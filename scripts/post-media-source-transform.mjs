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

const PROFILE_ACTIVITY_REPLACEMENTS = Object.freeze([
  ['const rows = Array.isArray(mediaRows) ? mediaRows.slice(0, 4) : [];',
   'const rows = Array.isArray(mediaRows) ? mediaRows.slice(0, 5) : [];'],
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

function transformMediaReservation(source) {
  let output = source;

  output = replaceExactOnce(
    output,
    `async function hydrateStreamEvents(events) {`,
    `async function loadSautiMediaRowsMap(postIds) {
  const ids = [...new Set((postIds || []).filter(Boolean))];
  if (!ids.length) return new Map();

  const { data, error } = await supabase
    .from('social_post_media')
    .select('post_id,id,media_kind,content_type,width,height,duration_ms,alt_text,position')
    .in('post_id', ids)
    .eq('upload_status', 'attached')
    .order('position', { ascending: true });

  if (error) return null;

  const mediaMap = new Map();
  (data || []).forEach((row) => {
    if (!row?.post_id) return;
    const bucket = mediaMap.get(row.post_id) || [];
    if (bucket.length >= 5) return;
    bucket.push(row);
    mediaMap.set(row.post_id, bucket);
  });
  return mediaMap;
}

async function hydrateStreamEvents(events) {`,
    'the shared post-media metadata map helper',
  );

  output = replaceExactOnce(
    output,
    `    { data: reposts, error: repostsError },
    { data: saves, error: savesError },
  ] = await Promise.all([postQuery, actorQuery, likeQuery, repostQuery, savedQuery]);`,
    `    { data: reposts, error: repostsError },
    { data: saves, error: savesError },
    mediaMap,
  ] = await Promise.all([
    postQuery,
    actorQuery,
    likeQuery,
    repostQuery,
    savedQuery,
    loadSautiMediaRowsMap(postIds),
  ]);`,
    'the Home feed metadata Promise.all block',
  );

  output = replaceExactOnce(
    output,
    `      reposted: reposted.has(event.post_id),
      saved: saved.has(event.post_id),
      following: followedAuthors.has(postMap.get(event.post_id)?.author_id),`,
    `      reposted: reposted.has(event.post_id),
      saved: saved.has(event.post_id),
      mediaRows: mediaMap?.get(event.post_id) ?? (mediaMap ? [] : null),
      following: followedAuthors.has(postMap.get(event.post_id)?.author_id),`,
    'the Home feed item media metadata field',
  );

  output = replaceExactOnce(
    output,
    `  const [likeResult, repostResult, savedResult] = await Promise.all([
    supabase
      .from('social_post_reactions')
      .select('post_id')
      .eq('user_id', currentMemberId)
      .in('post_id', postIds),
    supabase
      .from('social_reposts')
      .select('post_id')
      .eq('user_id', currentMemberId)
      .in('post_id', postIds),
    supabase
      .from('social_saved_posts')
      .select('post_id')
      .eq('user_id', currentMemberId)
      .in('post_id', postIds),
  ]);`,
    `  const [likeResult, repostResult, savedResult, mediaMap] = await Promise.all([
    supabase
      .from('social_post_reactions')
      .select('post_id')
      .eq('user_id', currentMemberId)
      .in('post_id', postIds),
    supabase
      .from('social_reposts')
      .select('post_id')
      .eq('user_id', currentMemberId)
      .in('post_id', postIds),
    supabase
      .from('social_saved_posts')
      .select('post_id')
      .eq('user_id', currentMemberId)
      .in('post_id', postIds),
    loadSautiMediaRowsMap(postIds),
  ]);`,
    'the direct post metadata Promise.all block',
  );

  output = replaceExactOnce(
    output,
    `    reposted: reposted.has(post.id),
    saved: saved.has(post.id),
    quotedPost: quoteMap.get(post.quote_post_id) || null,`,
    `    reposted: reposted.has(post.id),
    saved: saved.has(post.id),
    mediaRows: mediaMap?.get(post.id) ?? (mediaMap ? [] : null),
    quotedPost: quoteMap.get(post.quote_post_id) || null,`,
    'the direct post media metadata field',
  );

  output = replaceExactOnce(
    output,
    `async function hydrateSautiMediaGallery(postId, gallery) {
  const rows = await loadSautiMediaRows(postId);
  if (!gallery.isConnected) return;`,
    `async function hydrateSautiMediaGallery(postId, gallery, prefetchedRows = null) {
  const rows = Array.isArray(prefetchedRows) ? prefetchedRows : await loadSautiMediaRows(postId);
  // Cards are assembled while detached from document. parentNode confirms this gallery
  // still belongs to the card without incorrectly aborting prefetched hydration.
  if (!gallery.parentNode) return;`,
    'the post media hydrator prefetch and detached-card guard',
  );

  output = replaceExactOnce(
    output,
    `  for (const media of rows) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sauti-media-tile';
    button.dataset.openMediaId = media.id;
    button.dataset.mediaKind = media.media_kind;
    button.dataset.mediaAlt = media.alt_text || '';
    button.setAttribute('aria-label', media.alt_text ? \`Open media: \${media.alt_text}\` : 'Open post media');

    let visual = null;
    try {
      const url = await fetchSautiMediaBlobUrl(media.id);
      button.dataset.mediaObjectUrl = url;
      visual = media.media_kind === 'video' ? document.createElement('video') : document.createElement('img');
      visual.src = url;
      if (visual instanceof HTMLVideoElement) {
        visual.muted = true;
        visual.playsInline = true;
        visual.preload = 'metadata';
      } else {
        visual.alt = media.alt_text || '';
        visual.loading = 'lazy';
        visual.decoding = 'async';
      }
      button.append(visual);
    } catch {
      const unavailable = document.createElement('span');
      unavailable.textContent = 'Media unavailable';
      button.append(unavailable);
      button.disabled = true;
    }
    gallery.append(button);
    if (visual instanceof HTMLVideoElement) observeHomeFeedVideo(visual, gallery);
  }`,
    `  const mediaEntries = rows.map((media) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sauti-media-tile';
    button.dataset.openMediaId = media.id;
    button.dataset.mediaKind = media.media_kind;
    button.dataset.mediaAlt = media.alt_text || '';
    button.setAttribute('aria-label', media.alt_text ? \`Open media: \${media.alt_text}\` : 'Open post media');
    button.setAttribute('aria-busy', 'true');

    // Append every tile before starting protected-byte requests. The existing tile
    // sizing rules now hold the final feed geometry while media loads.
    gallery.append(button);
    return { media, button };
  });

  await Promise.all(mediaEntries.map(async ({ media, button }) => {
    let visual = null;
    try {
      const url = await fetchSautiMediaBlobUrl(media.id);
      if (!button.parentNode) {
        URL.revokeObjectURL(url);
        return;
      }
      button.dataset.mediaObjectUrl = url;
      visual = media.media_kind === 'video' ? document.createElement('video') : document.createElement('img');
      visual.src = url;
      if (visual instanceof HTMLVideoElement) {
        visual.muted = true;
        visual.playsInline = true;
        visual.preload = 'metadata';
      } else {
        visual.alt = media.alt_text || '';
        visual.loading = 'lazy';
        visual.decoding = 'async';
      }
      button.replaceChildren(visual);
    } catch {
      if (!button.parentNode) return;
      const unavailable = document.createElement('span');
      unavailable.textContent = 'Media unavailable';
      button.replaceChildren(unavailable);
      button.disabled = true;
    } finally {
      button.setAttribute('aria-busy', 'false');
    }
    if (visual instanceof HTMLVideoElement) observeHomeFeedVideo(visual, gallery);
  }));`,
    'the post media tile hydration loop',
  );

  output = replaceExactOnce(
    output,
    `  const mediaGallery = document.createElement('div');
  mediaGallery.className = 'sauti-media-gallery loading';
  mediaGallery.setAttribute('aria-label', 'Post media');
  main.append(mediaGallery);
  void hydrateSautiMediaGallery(post.id, mediaGallery);`,
    `  const mediaGallery = document.createElement('div');
  const prefetchedMediaRows = Array.isArray(item.mediaRows) ? item.mediaRows : null;
  const prefetchedMediaCount = prefetchedMediaRows?.length || 0;
  mediaGallery.className = prefetchedMediaCount
    ? \`sauti-media-gallery loading media-count-\${prefetchedMediaCount}\`
    : 'sauti-media-gallery loading';
  mediaGallery.setAttribute('aria-label', 'Post media');

  if (prefetchedMediaCount) {
    article.classList.add('has-media');
    if (caption) caption.hidden = false;
    mediaGallery.dataset.mediaReserved = 'true';

    if (prefetchedMediaCount === 1) {
      const width = Number(prefetchedMediaRows[0]?.width);
      const height = Number(prefetchedMediaRows[0]?.height);
      const ratio = width > 0 && height > 0 ? \`\${width} / \${height}\` : '4 / 5';
      mediaGallery.style.setProperty('--single-media-aspect-ratio', ratio);
    }
  }

  main.append(mediaGallery);
  void hydrateSautiMediaGallery(post.id, mediaGallery, prefetchedMediaRows);`,
    'the shared post card media reservation block',
  );

  return output;
}

export function transformPostMediaSource(filePath, source) {
  const normalized = String(filePath || '').replaceAll('\\', '/');
  if (normalized.endsWith('/src/app.js') || normalized.endsWith('src/app.js')) {
    return transformMediaReservation(replaceAllExact(source, APP_REPLACEMENTS));
  }
  if (normalized.endsWith('/src/sauti-posts-api.js') || normalized.endsWith('src/sauti-posts-api.js')) {
    return replaceAllExact(source, POST_API_REPLACEMENTS);
  }
  if (normalized.endsWith('/src/profile-activity.js') || normalized.endsWith('src/profile-activity.js')) {
    return replaceAllExact(source, PROFILE_ACTIVITY_REPLACEMENTS);
  }
  return source;
}
