const PRIMARY_ORIGIN = 'https://sautilink.com';
const STAGING_HOST = 'test.sautilink.com';
const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._]{2,29}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PROFILE_ROUTE = /^\/(?:app\/)?u\/([^/]+)\/?$/i;
const POST_ROUTE = /^\/(?:post|app\/sauti)\/([^/]+)\/?$/i;
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
    `<meta name="twitter:card" content="summary">`,
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
  const titleSeed = body ? plainText(body, 72) : `${displayName}'s public post`;
  const title = `${titleSeed} — ${displayName} on SautiLink`;
  const description = plainText(
    body || `A public${Number(post.media_count) > 0 ? ' media' : ''} post by ${displayName} (@${username}) on SautiLink.`,
    180,
  );
  const image = avatarUrl(username, Boolean(post.author_avatar_key));
  const authorUrl = profileCanonical(username);

  const author = {
    '@type': 'Person',
    '@id': `${authorUrl}#person`,
    name: displayName,
    alternateName: `@${username}`,
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
    '@id': `${canonical}#post`,
    url: canonical,
    mainEntityOfPage: canonical,
    headline: titleSeed,
    description,
    author,
    isPartOf: {
      '@type': 'ProfilePage',
      '@id': `${authorUrl}#profile`,
      url: authorUrl,
    },
  };
  if (body) structuredData.articleBody = body;
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
  const bodyMarkup = body ? `<p>${htmlEscape(body)}</p>` : '<p>Public media post.</p>';
  const fallbackHtml = `<main aria-label="Public SautiLink post"><article><header><h1>Post by ${htmlEscape(displayName)}</h1><p><a href="${attribute(authorUrl)}">@${htmlEscape(username)}</a>${verifiedLabel}</p></header>${bodyMarkup}<p><a href="${attribute(canonical)}">View this post on SautiLink</a></p></article></main>`;

  return {
    title,
    description,
    canonical,
    image,
    imageAlt: `${displayName} profile image on SautiLink`,
    ogType: 'article',
    profileUsername: username,
    structuredData,
    fallbackHtml,
    robots: INDEX_ROBOTS,
  };
}

async function appShell(request, env, url, metadata = null) {
  if (!env.ASSETS) return new Response('Not found', { status: 404 });
  const shellUrl = new URL('/app/', url);
  const response = await env.ASSETS.fetch(new Request(shellUrl, request));
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'private, no-store, max-age=0');
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

  const result = await rpc(env, 'external_index_post_v1', { p_post_id: postId });
  if (!result.ok || !result.rows[0]) return appShell(request, env, url);
  return appShell(request, env, url, postMetadata(result.rows[0]));
}

export async function handlePublicIndexingRequest(request, env) {
  const url = new URL(request.url);
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;

  if (url.pathname === '/robots.txt') {
    const body = isStaging(url) ? 'User-agent: *\nDisallow: /\n' : productionRobots();
    return textResponse(request.method === 'HEAD' ? null : body, 'text/plain; charset=utf-8', 200, isStaging(url) ? PRIVATE_ROBOTS : '');
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
