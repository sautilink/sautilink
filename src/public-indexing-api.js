import { handleSautiMediaRequest } from './sauti-media-api.js';

const PRIMARY_ORIGIN = 'https://sautilink.com';
const STAGING_HOST = 'test.sautilink.com';
const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._]{2,29}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PROFILE_ROUTE = /^\/(?:app\/)?u\/([^/]+)\/?$/i;
const POST_ROUTE = /^\/(?:post|app\/sauti)\/([^/]+)\/?$/i;
const PUBLIC_POST_JSON_ROUTE = /^\/api\/public-post\/([0-9a-f-]{36})\/?$/i;
const PUBLIC_POST_MEDIA_ROUTE = /^\/api\/public-post-media\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/?$/i;
const PUBLIC_POST_CARD_ROUTE = /^\/api\/public-post-card\/([0-9a-f-]{36})\.png$/i;
const SITEMAP_PAGE_SIZE = 1000;
const INDEX_ROBOTS = 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1';
const PRIVATE_ROBOTS = 'noindex, nofollow, noarchive';

function isStaging(url) {
  return url.hostname.toLowerCase() === STAGING_HOST;
}

function config(env) {
  const url = String(env.PUBLIC_INDEX_SUPABASE_URL || '').replace(/\/$/, '');
  const key = String(env.PUBLIC_INDEX_SUPABASE_KEY || '');
  return url && key ? { url, key } : null;
}

function supabaseHeaders(key) {
  return {
    apikey: key,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

async function rpc(env, name, payload = {}) {
  const connection = config(env);
  if (!connection) return { ok: false, rows: [] };

  const response = await fetch(`${connection.url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: supabaseHeaders(connection.key),
    body: JSON.stringify(payload),
  });
  if (!response.ok) return { ok: false, rows: [] };

  const data = await response.json().catch(() => []);
  return { ok: true, rows: Array.isArray(data) ? data : [] };
}

function htmlEscape(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function xmlEscape(value) {
  return htmlEscape(value);
}

function attribute(value) {
  return htmlEscape(String(value ?? '').replace(/[\r\n]+/g, ' ').trim());
}

function jsonLd(value) {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}

function plainText(value, limit = 160) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(1, limit - 1)).trimEnd()}…`;
}

function safeHttpUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : '';
  } catch {
    return '';
  }
}

function isoDate(value) {
  const date = new Date(value || 0);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function profileCanonical(username) {
  return `${PRIMARY_ORIGIN}/u/${encodeURIComponent(username)}`;
}

function postCanonical(postId) {
  return `${PRIMARY_ORIGIN}/post/${postId}`;
}

function avatarUrl(username, hasAvatar) {
  return hasAvatar
    ? `${PRIMARY_ORIGIN}/api/profile-media/${encodeURIComponent(username)}/avatar`
    : `${PRIMARY_ORIGIN}/logo.png`;
}

function publicPostMediaUrl(postId, mediaId, kind = 'image') {
  const suffix = kind === 'video' ? '?poster=1' : '?w=1440';
  return \`${PRIMARY_ORIGIN}/api/public-post-media/${postId}/${mediaId}${suffix}\`;
}

function publicPostCardUrl(postId, updatedAt = '') {
  const stamp = encodeURIComponent(isoDate(updatedAt) || '1');
  return \`${PRIMARY_ORIGIN}/api/public-post-card/${postId}.png?v=${stamp}\`;
}

function normalizePostMedia(post) {
  const source = Array.isArray(post?.media) ? post.media : [];
  return source
    .map((item) => ({
      id: String(item?.id || '').toLowerCase(),
      kind: item?.kind === 'video' ? 'video' : 'image',
      contentType: String(item?.content_type || ''),
      width: Math.max(0, Number(item?.width || 0)),
      height: Math.max(0, Number(item?.height || 0)),
      durationMs: Math.max(0, Number(item?.duration_ms || 0)),
      altText: plainText(item?.alt_text || '', 1000),
      position: Number(item?.position || 0),
    }))
    .filter((item) => UUID_PATTERN.test(item.id))
    .sort((a, b) => a.position - b.position);
}

function secondsToIsoDuration(durationMs) {
  const seconds = Math.max(1, Math.ceil(Number(durationMs || 0) / 1000));
  return \`PT${seconds}S\`;
}

function compactCount(value) {
  const count = Math.max(0, Number(value || 0));
  return Number.isFinite(count) ? Math.trunc(count) : 0;
}

async function publicSharePost(env, postId) {
  if (!UUID_PATTERN.test(postId)) return null;
  const result = await rpc(env, 'public_share_post_v1', { p_post_id: postId });
  return result.ok && result.rows[0] ? result.rows[0] : null;
}

function replaceOrInsertMeta(html, matcher, replacement) {
  if (matcher.test(html)) return html.replace(matcher, replacement);
  return html.replace('</head>', `  ${replacement}\n</head>`);
}

function applySeoHead(html, metadata) {
  let output = html;
  output = output.replace(/<title>[\s\S]*?<\/title>/i, `<title>${htmlEscape(metadata.title)}</title>`);
  output = replaceOrInsertMeta(
    output,
    /<meta\s+name=["']description["'][^>]*>/i,
    `<meta name="description" content="${attribute(metadata.description)}">`,
  );
  output = replaceOrInsertMeta(
    output,
    /<meta\s+name=["']robots["'][^>]*>/i,
    `<meta name="robots" content="${metadata.robots}">`,
  );

  const extra = [
    `<link rel="canonical" href="${attribute(metadata.canonical)}">`,
    `<meta property="og:site_name" content="SautiLink">`,
    `<meta property="og:type" content="${attribute(metadata.ogType)}">`,
    `<meta property="og:title" content="${attribute(metadata.title)}">`,
    `<meta property="og:description" content="${attribute(metadata.description)}">`,
    `<meta property="og:url" content="${attribute(metadata.canonical)}">`,
    `<meta property="og:image" content="${attribute(metadata.image)}">`,
    `<meta property="og:image:alt" content="${attribute(metadata.imageAlt)}">`,
    metadata.imageType ? `<meta property="og:image:type" content="${attribute(metadata.imageType)}">` : '',
    metadata.imageWidth ? `<meta property="og:image:width" content="${attribute(metadata.imageWidth)}">` : '',
    metadata.imageHeight ? `<meta property="og:image:height" content="${attribute(metadata.imageHeight)}">` : '',
    `<meta name="twitter:card" content="${attribute(metadata.twitterCard || 'summary')}">`,
    `<meta name="twitter:title" content="${attribute(metadata.title)}">`,
    `<meta name="twitter:description" content="${attribute(metadata.description)}">`,
    `<meta name="twitter:image" content="${attribute(metadata.image)}">`,
    metadata.profileUsername ? `<meta property="profile:username" content="${attribute(metadata.profileUsername)}">` : '',
    `<script type="application/ld+json">${jsonLd(metadata.structuredData)}</script>`,
  ].filter(Boolean).map((line) => `  ${line}`).join('\n');

  output = output.replace('</head>', `${extra}\n</head>`);
  if (metadata.fallbackHtml) {
    output = output.replace('</body>', `  <noscript>${metadata.fallbackHtml}</noscript>\n</body>`);
  }
  return output;
}

function profileMetadata(profile) {
  const username = String(profile.username || '').toLowerCase();
  const displayName = plainText(profile.display_name || username, 80);
  const verified = Boolean(profile.is_verified);
  const canonical = profileCanonical(username);
  const bio = plainText(profile.bio, 220);
  const title = verified
    ? `${displayName} — Official Verified Profile on SautiLink (@${username})`
    : `${displayName} (@${username}) on SautiLink`;
  const description = plainText(
    bio || (verified
      ? `${displayName}'s official verified profile on SautiLink. Follow @${username} for public posts and updates.`
      : `${displayName}'s public profile on SautiLink. Follow @${username} for public posts and updates.`),
    180,
  );
  const image = avatarUrl(username, Boolean(profile.avatar_key));
  const website = safeHttpUrl(profile.website_url);
  const modified = isoDate(profile.updated_at);

  const person = {
    '@type': 'Person',
    '@id': `${canonical}#person`,
    name: displayName,
    alternateName: `@${username}`,
    url: canonical,
    description,
    image,
  };
  if (website) person.sameAs = [website];
  if (Number.isFinite(Number(profile.followers_count))) {
    person.interactionStatistic = {
      '@type': 'InteractionCounter',
      interactionType: 'https://schema.org/FollowAction',
      userInteractionCount: Math.max(0, Number(profile.followers_count)),
    };
  }
  if (verified) {
    person.additionalProperty = {
      '@type': 'PropertyValue',
      name: 'SautiLink verification',
      value: profile.verification_badge_type === 'team' ? 'Verified SautiLink Team profile' : 'Verified profile',
    };
  }

  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    '@id': `${canonical}#profile`,
    url: canonical,
    name: title,
    description,
    mainEntity: person,
  };
  if (modified) structuredData.dateModified = modified;

  const verifiedLabel = verified ? '<p><strong>Verified SautiLink profile</strong></p>' : '';
  const bioMarkup = bio ? `<p>${htmlEscape(bio)}</p>` : '';
  const locationMarkup = profile.location ? `<p>${htmlEscape(plainText(profile.location, 100))}</p>` : '';
  const websiteMarkup = website ? `<p><a href="${attribute(website)}" rel="me noopener noreferrer">Website</a></p>` : '';
  const fallbackHtml = `<main aria-label="Public SautiLink profile"><article><h1>${htmlEscape(displayName)}</h1><p>@${htmlEscape(username)}</p>${verifiedLabel}${bioMarkup}${locationMarkup}${websiteMarkup}<p><a href="${attribute(canonical)}">View this profile on SautiLink</a></p></article></main>`;

  return {
    title,
    description,
    canonical,
    image,
    imageAlt: `${displayName} profile image on SautiLink`,
    ogType: 'profile',
    profileUsername: username,
    structuredData,
    fallbackHtml,
    robots: INDEX_ROBOTS,
  };
}

function postMetadata(post) {
  const postId = String(post.post_id || '').toLowerCase();
  const username = String(post.author_username || '').toLowerCase();
  const displayName = plainText(post.author_display_name || username, 80);
  const verified = Boolean(post.author_is_verified);
  const canonical = postCanonical(postId);
  const body = plainText(post.body, 500);
  const media = normalizePostMedia(post);
  const firstMedia = media[0] || null;
  const imageMedia = media.filter((item) => item.kind === 'image');
  const videoMedia = media.filter((item) => item.kind === 'video');
  const titleSeed = body ? plainText(body, 72) : \`${displayName}'s public post\`;
  const title = \`${titleSeed} — ${displayName} on SautiLink\`;
  const description = plainText(
    body || \`A public${media.length ? ' media' : ''} post by ${displayName} (@${username}) on SautiLink.\`,
    180,
  );
  const image = firstMedia
    ? publicPostMediaUrl(postId, firstMedia.id, firstMedia.kind)
    : publicPostCardUrl(postId, post.updated_at);
  const imageAlt = firstMedia?.altText
    || (firstMedia?.kind === 'video' ? \`Video preview from ${displayName}'s SautiLink post\` : '')
    || (firstMedia ? \`Image from ${displayName}'s SautiLink post\` : \`Text post by ${displayName} on SautiLink\`);
  const authorUrl = profileCanonical(username);

  const author = {
    '@type': 'Person',
    '@id': \`${authorUrl}#person\`,
    name: displayName,
    alternateName: \`@${username}\`,
    url: authorUrl,
  };
  if (verified) {
    author.additionalProperty = {
      '@type': 'PropertyValue',
      name: 'SautiLink verification',
      value: post.author_verification_badge_type === 'team' ? 'Verified SautiLink Team profile' : 'Verified profile',
    };
  }

  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'SocialMediaPosting',
    '@id': \`${canonical}#post\`,
    url: canonical,
    mainEntityOfPage: canonical,
    headline: titleSeed,
    description,
    author,
    isPartOf: {
      '@type': 'ProfilePage',
      '@id': \`${authorUrl}#profile\`,
      url: authorUrl,
    },
  };
  if (body) structuredData.articleBody = body;
  if (imageMedia.length) {
    structuredData.image = imageMedia.map((item) => ({
      '@type': 'ImageObject',
      contentUrl: publicPostMediaUrl(postId, item.id, 'image'),
      width: item.width || undefined,
      height: item.height || undefined,
      caption: item.altText || undefined,
    }));
  }
  if (videoMedia.length) {
    structuredData.video = videoMedia.map((item, index) => ({
      '@type': 'VideoObject',
      name: body ? plainText(body, 90) : \`Video ${index + 1} by ${displayName}\`,
      description,
      thumbnailUrl: publicPostMediaUrl(postId, item.id, 'video'),
      uploadDate: isoDate(post.created_at) || undefined,
      duration: item.durationMs ? secondsToIsoDuration(item.durationMs) : undefined,
      url: canonical,
    }));
  }
  const published = isoDate(post.created_at);
  const modified = isoDate(post.updated_at);
  if (published) structuredData.datePublished = published;
  if (modified) structuredData.dateModified = modified;

  const interactions = [
    ['https://schema.org/LikeAction', post.like_count],
    ['https://schema.org/CommentAction', post.comment_count],
    ['https://schema.org/ShareAction', post.repost_count],
  ].filter(([, count]) => Number.isFinite(Number(count)))
    .map(([interactionType, count]) => ({
      '@type': 'InteractionCounter',
      interactionType,
      userInteractionCount: Math.max(0, Number(count)),
    }));
  if (interactions.length) structuredData.interactionStatistic = interactions;

  const verifiedLabel = verified ? ' <strong>(Verified)</strong>' : '';
  const bodyMarkup = body ? \`<p>${htmlEscape(body)}</p>\` : '<p>Public media post.</p>';
  const mediaMarkup = media.map((item) => {
    const mediaUrl = publicPostMediaUrl(postId, item.id, item.kind);
    if (item.kind === 'video') {
      return \`<figure><img src="${attribute(mediaUrl)}" alt="${attribute(item.altText || 'Video preview')}" width="${item.width || 640}" height="${item.height || 360}"><figcaption>Video available on SautiLink</figcaption></figure>\`;
    }
    return \`<figure><img src="${attribute(mediaUrl)}" alt="${attribute(item.altText || 'Post image')}"${item.width ? \` width="${item.width}"\` : ''}${item.height ? \` height="${item.height}"\` : ''}></figure>\`;
  }).join('');
  const statsMarkup = \`<p>${compactCount(post.like_count)} likes · ${compactCount(post.comment_count)} comments · ${compactCount(post.repost_count)} reposts</p>\`;
  const fallbackHtml = \`<main aria-label="Public SautiLink post"><article><header><h1>Post by ${htmlEscape(displayName)}</h1><p><a href="${attribute(authorUrl)}">@${htmlEscape(username)}</a>${verifiedLabel}</p></header>${bodyMarkup}${mediaMarkup}${statsMarkup}<p><a href="${attribute(canonical)}">View this post on SautiLink</a></p></article></main>\`;

  return {
    title,
    description,
    canonical,
    image,
    imageAlt,
    imageType: firstMedia?.kind === 'video' ? 'image/jpeg' : (firstMedia?.contentType || 'image/png'),
    imageWidth: firstMedia?.width || 1200,
    imageHeight: firstMedia?.height || 630,
    ogType: 'article',
    twitterCard: 'summary_large_image',
    profileUsername: username,
    structuredData,
    fallbackHtml,
    robots: post.search_indexable ? INDEX_ROBOTS : PRIVATE_ROBOTS,
  };
}

function publicPostJson(post) {
  const postId = String(post.post_id || '').toLowerCase();
  const username = String(post.author_username || '').toLowerCase();
  const media = normalizePostMedia(post);
  return {
    ok: true,
    data: {
      post: {
        id: postId,
        body: String(post.body || ''),
        created_at: post.created_at || null,
        updated_at: post.updated_at || null,
        counts: {
          likes: compactCount(post.like_count),
          comments: compactCount(post.comment_count),
          reposts: compactCount(post.repost_count),
        },
        author: {
          username,
          display_name: String(post.author_display_name || username),
          avatar_url: avatarUrl(username, Boolean(post.author_avatar_key)),
          is_verified: Boolean(post.author_is_verified),
          verification_badge_type: String(post.author_verification_badge_type || ''),
        },
        search_indexable: Boolean(post.search_indexable),
        media: media.map((item) => ({
          id: item.id,
          kind: item.kind,
          content_type: item.contentType,
          width: item.width || null,
          height: item.height || null,
          duration_ms: item.durationMs || null,
          alt_text: item.altText,
          preview_url: publicPostMediaUrl(postId, item.id, item.kind),
        })),
      },
    },
  };
}

async function publicPostJsonResponse(request, env, postId) {
  if (isStaging(new URL(request.url))) return textResponse('Not found\n', 'text/plain; charset=utf-8', 404, PRIVATE_ROBOTS);
  const post = await publicSharePost(env, postId);
  if (!post) return textResponse('Not found\n', 'text/plain; charset=utf-8', 404, PRIVATE_ROBOTS);
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=30, stale-while-revalidate=120',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': post.search_indexable ? INDEX_ROBOTS : PRIVATE_ROBOTS,
  });
  return new Response(request.method === 'HEAD' ? null : JSON.stringify(publicPostJson(post)), { status: 200, headers });
}

async function publicPostMediaResponse(request, env, postId, mediaId) {
  const url = new URL(request.url);
  if (isStaging(url)) return textResponse('Not found\n', 'text/plain; charset=utf-8', 404, PRIVATE_ROBOTS);
  const post = await publicSharePost(env, postId);
  if (!post) return textResponse('Not found\n', 'text/plain; charset=utf-8', 404, PRIVATE_ROBOTS);
  const media = normalizePostMedia(post).find((item) => item.id === mediaId);
  if (!media) return textResponse('Not found\n', 'text/plain; charset=utf-8', 404, PRIVATE_ROBOTS);

  const mediaUrl = new URL(\`/api/sauti-media/${mediaId}\`, url);
  if (media.kind === 'video') {
    mediaUrl.searchParams.set('poster', '1');
  } else {
    const width = ['480', '960', '1440'].includes(url.searchParams.get('w')) ? url.searchParams.get('w') : '1440';
    mediaUrl.searchParams.set('w', width);
  }

  const method = request.method === 'HEAD' && media.kind === 'video' ? 'GET' : request.method;
  const response = await handleSautiMediaRequest(new Request(mediaUrl, { method }), env);
  if (!response) return textResponse('Not found\n', 'text/plain; charset=utf-8', 404, PRIVATE_ROBOTS);
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'public, max-age=300, must-revalidate');
  headers.set('X-Robots-Tag', post.search_indexable ? 'index, noarchive' : PRIVATE_ROBOTS);
  headers.delete('Set-Cookie');
  if (request.method === 'HEAD') return new Response(null, { status: response.status, headers });
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function previewLines(value, maxChars = 34, maxLines = 4) {
  const words = plainText(value, 190).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const next = current ? \`${current} ${word}\` : word;
    if (next.length <= maxChars || !current) {
      current = next;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length >= maxLines - 1) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (words.length && lines.join(' ').length < words.join(' ').length && lines.length) {
    lines[lines.length - 1] = \`${lines[lines.length - 1].replace(/[.…]+$/, '')}…\`;
  }
  return lines.slice(0, maxLines);
}

async function textCardFallback(request, env) {
  if (!env.ASSETS) return textResponse('Not found\n', 'text/plain; charset=utf-8', 404, PRIVATE_ROBOTS);
  const asset = await env.ASSETS.fetch(new Request(new URL('/logo.png', request.url), request));
  const headers = new Headers(asset.headers);
  headers.set('Cache-Control', 'public, max-age=300');
  return new Response(request.method === 'HEAD' ? null : asset.body, { status: asset.status, headers });
}

async function publicPostCardResponse(request, env, postId) {
  const url = new URL(request.url);
  if (isStaging(url)) return textResponse('Not found\n', 'text/plain; charset=utf-8', 404, PRIVATE_ROBOTS);
  const post = await publicSharePost(env, postId);
  if (!post) return textResponse('Not found\n', 'text/plain; charset=utf-8', 404, PRIVATE_ROBOTS);
  if (!env.IMAGES) return textCardFallback(request, env);

  const cache = globalThis.caches?.default;
  const cacheKey = new Request(url.toString(), { method: 'GET' });
  if (request.method === 'GET' && cache) {
    const cached = await cache.match(cacheKey).catch(() => null);
    if (cached) return cached;
  }

  const displayName = plainText(post.author_display_name || post.author_username, 60);
  const username = plainText(post.author_username, 40);
  const body = String(post.body || '').trim() || \`Public post by ${displayName}\`;
  const lines = previewLines(body);
  const baseSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#07101f"/><stop offset="1" stop-color="#101c31"/></linearGradient></defs><rect width="1200" height="630" fill="url(#g)"/><circle cx="1080" cy="90" r="210" fill="#e6205a" opacity=".12"/><circle cx="1120" cy="520" r="280" fill="#246bfe" opacity=".12"/><rect x="70" y="62" width="1060" height="506" rx="32" fill="#0b1525" stroke="#33415a" stroke-width="2"/></svg>';

  try {
    let canvas = env.IMAGES.input(new Response(baseSvg, { headers: { 'Content-Type': 'image/svg+xml' } }).body);
    canvas = canvas.draw(env.IMAGES.text('SautiLink', { color: '#f7f9fc', size: 42 }), { left: 112, top: 100 });
    canvas = canvas.draw(env.IMAGES.text(\`${displayName}${post.author_is_verified ? '  ✓' : ''}\`, { color: '#f7f9fc', size: 32 }), { left: 112, top: 168 });
    canvas = canvas.draw(env.IMAGES.text(\`@${username}\`, { color: '#aeb8c8', size: 24 }), { left: 112, top: 214 });
    lines.forEach((line, index) => {
      canvas = canvas.draw(env.IMAGES.text(line, { color: '#f7f9fc', size: 52 }), { left: 112, top: 286 + (index * 66) });
    });
    canvas = canvas.draw(env.IMAGES.text('sautilink.com', { color: '#aeb8c8', size: 24 }), { left: 112, bottom: 92 });
    const generated = (await canvas.output({ format: 'image/png' })).response({
      headers: {
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
        'X-Robots-Tag': post.search_indexable ? 'index, noarchive' : PRIVATE_ROBOTS,
      },
    });
    if (request.method === 'HEAD') return new Response(null, { status: generated.status, headers: generated.headers });
    if (cache) await cache.put(cacheKey, generated.clone()).catch(() => {});
    return generated;
  } catch {
    return textCardFallback(request, env);
  }
}

async function appShell(request, env, url, metadata = null) {
  if (!env.ASSETS) return new Response('Not found', { status: 404 });
  const shellUrl = new URL('/app/', url);
  const response = await env.ASSETS.fetch(new Request(shellUrl, request));
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', metadata ? 'public, max-age=60, stale-while-revalidate=300' : 'private, no-store, max-age=0');
  headers.set('X-Robots-Tag', metadata?.robots || PRIVATE_ROBOTS);
  headers.delete('Content-Length');
  headers.delete('ETag');

  if (request.method === 'HEAD' || !response.ok || !metadata) {
    return new Response(request.method === 'HEAD' ? null : response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  const contentType = String(response.headers.get('Content-Type') || '').toLowerCase();
  if (!contentType.includes('text/html')) {
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }

  const html = applySeoHead(await response.text(), metadata);
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
}

function textResponse(body, contentType, status = 200, robots = '') {
  const headers = new Headers({
    'Content-Type': contentType,
    'Cache-Control': 'no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff',
  });
  if (robots) headers.set('X-Robots-Tag', robots);
  return new Response(body, { status, headers });
}

function productionRobots() {
  return [
    'User-agent: *',
    'Allow: /',
    'Allow: /api/profile-media/',
    'Allow: /api/public-post-media/',
    'Allow: /api/public-post-card/',
    'Disallow: /api/',
    '',
    `Sitemap: ${PRIMARY_ORIGIN}/sitemap.xml`,
    `Sitemap: ${PRIMARY_ORIGIN}/sitemap-social.xml`,
    '',
  ].join('\n');
}

function emptySitemap() {
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>\n';
}

async function sitemapIndex(env) {
  const result = await rpc(env, 'external_index_sitemap_counts_v1');
  if (!result.ok) return textResponse('Sitemap temporarily unavailable.\n', 'text/plain; charset=utf-8', 503, PRIVATE_ROBOTS);

  const counts = result.rows[0] || {};
  const profilePages = Math.ceil(Math.max(0, Number(counts.profile_count) || 0) / SITEMAP_PAGE_SIZE);
  const postPages = Math.ceil(Math.max(0, Number(counts.post_count) || 0) / SITEMAP_PAGE_SIZE);
  const locations = [];
  for (let page = 1; page <= profilePages; page += 1) locations.push(`${PRIMARY_ORIGIN}/sitemap-social-profiles.xml?page=${page}`);
  for (let page = 1; page <= postPages; page += 1) locations.push(`${PRIMARY_ORIGIN}/sitemap-social-posts.xml?page=${page}`);

  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...locations.map((location) => `  <sitemap><loc>${xmlEscape(location)}</loc></sitemap>`),
    '</sitemapindex>',
    '',
  ].join('\n');
  return textResponse(body, 'application/xml; charset=utf-8');
}

function sitemapPageNumber(url) {
  const raw = String(url.searchParams.get('page') || '1');
  if (!/^\d{1,6}$/.test(raw)) return 0;
  const page = Number(raw);
  return Number.isSafeInteger(page) && page >= 1 ? page : 0;
}

async function sitemapPage(env, url, kind) {
  const page = sitemapPageNumber(url);
  if (!page) return textResponse('Not found\n', 'text/plain; charset=utf-8', 404, PRIVATE_ROBOTS);
  const offset = (page - 1) * SITEMAP_PAGE_SIZE;
  const rpcName = kind === 'profiles' ? 'external_index_profiles_page_v1' : 'external_index_posts_page_v1';
  const result = await rpc(env, rpcName, { p_offset: offset, p_limit: SITEMAP_PAGE_SIZE });
  if (!result.ok) return textResponse('Sitemap temporarily unavailable.\n', 'text/plain; charset=utf-8', 503, PRIVATE_ROBOTS);

  if (!result.rows.length && page > 1) return textResponse('Not found\n', 'text/plain; charset=utf-8', 404, PRIVATE_ROBOTS);
  const entries = result.rows.map((row) => {
    const location = kind === 'profiles'
      ? profileCanonical(String(row.username || '').toLowerCase())
      : postCanonical(String(row.post_id || '').toLowerCase());
    const modified = isoDate(row.updated_at);
    const verified = Boolean(kind === 'profiles' ? row.is_verified : row.author_is_verified);
    const priority = kind === 'profiles' ? (verified ? '1.0' : '0.8') : (verified ? '0.8' : '0.7');
    return `  <url><loc>${xmlEscape(location)}</loc>${modified ? `<lastmod>${xmlEscape(modified)}</lastmod>` : ''}<priority>${priority}</priority></url>`;
  });

  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries,
    '</urlset>',
    '',
  ].join('\n');
  return textResponse(body, 'application/xml; charset=utf-8');
}

async function profileResponse(request, env, url, rawUsername) {
  if (isStaging(url)) return appShell(request, env, url);
  let username = '';
  try {
    username = decodeURIComponent(rawUsername).trim().toLowerCase();
  } catch {
    return appShell(request, env, url);
  }
  if (!USERNAME_PATTERN.test(username)) return appShell(request, env, url);

  const result = await rpc(env, 'external_index_profile_v1', { p_username: username });
  if (!result.ok || !result.rows[0]) return appShell(request, env, url);
  return appShell(request, env, url, profileMetadata(result.rows[0]));
}

async function postResponse(request, env, url, rawPostId) {
  if (isStaging(url)) return appShell(request, env, url);
  let postId = '';
  try {
    postId = decodeURIComponent(rawPostId).trim().toLowerCase();
  } catch {
    return appShell(request, env, url);
  }
  if (!UUID_PATTERN.test(postId)) return appShell(request, env, url);

  const post = await publicSharePost(env, postId);
  if (!post) return appShell(request, env, url);
  return appShell(request, env, url, postMetadata(post));
}

export async function handlePublicIndexingRequest(request, env) {
  const url = new URL(request.url);
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;

  if (url.pathname === '/robots.txt') {
    const body = isStaging(url) ? 'User-agent: *\nDisallow: /\n' : productionRobots();
    return textResponse(request.method === 'HEAD' ? null : body, 'text/plain; charset=utf-8', 200, isStaging(url) ? PRIVATE_ROBOTS : '');
  }

  let publicMatch = url.pathname.match(PUBLIC_POST_JSON_ROUTE);
  if (publicMatch && (request.method === 'GET' || request.method === 'HEAD')) {
    return publicPostJsonResponse(request, env, publicMatch[1].toLowerCase());
  }

  publicMatch = url.pathname.match(PUBLIC_POST_MEDIA_ROUTE);
  if (publicMatch && (request.method === 'GET' || request.method === 'HEAD')) {
    return publicPostMediaResponse(request, env, publicMatch[1].toLowerCase(), publicMatch[2].toLowerCase());
  }

  publicMatch = url.pathname.match(PUBLIC_POST_CARD_ROUTE);
  if (publicMatch && (request.method === 'GET' || request.method === 'HEAD')) {
    return publicPostCardResponse(request, env, publicMatch[1].toLowerCase());
  }

  if (url.pathname === '/sitemap-social.xml') {
    if (isStaging(url)) return textResponse(request.method === 'HEAD' ? null : emptySitemap(), 'application/xml; charset=utf-8', 200, PRIVATE_ROBOTS);
    if (request.method === 'HEAD') return textResponse(null, 'application/xml; charset=utf-8');
    return sitemapIndex(env);
  }

  if (url.pathname === '/sitemap-social-profiles.xml') {
    if (isStaging(url)) return textResponse(request.method === 'HEAD' ? null : emptySitemap(), 'application/xml; charset=utf-8', 200, PRIVATE_ROBOTS);
    if (request.method === 'HEAD') return textResponse(null, 'application/xml; charset=utf-8');
    return sitemapPage(env, url, 'profiles');
  }

  if (url.pathname === '/sitemap-social-posts.xml') {
    if (isStaging(url)) return textResponse(request.method === 'HEAD' ? null : emptySitemap(), 'application/xml; charset=utf-8', 200, PRIVATE_ROBOTS);
    if (request.method === 'HEAD') return textResponse(null, 'application/xml; charset=utf-8');
    return sitemapPage(env, url, 'posts');
  }

  const profileMatch = url.pathname.match(PROFILE_ROUTE);
  if (profileMatch) return profileResponse(request, env, url, profileMatch[1]);

  const postMatch = url.pathname.match(POST_ROUTE);
  if (postMatch) return postResponse(request, env, url, postMatch[1]);

  return null;
}
