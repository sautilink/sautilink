function replaceExactOnce(source, before, after, label) {
  if (!source.includes(before)) {
    throw new Error(`Media performance source transform could not find ${label}.`);
  }
  return source.replace(before, after);
}

function transformMediaApiTiming(source) {
  let output = source;

  output = replaceExactOnce(
    output,
    `function mediaVariantCacheKey(request, id, width) {
  const url = new URL(request.url);
  url.search = '';
  url.searchParams.set('w', String(width));
  url.searchParams.set('variant', IMAGE_VARIANT_VERSION);
  return new Request(url.toString(), { method: 'GET' });
}`,
    `function mediaVariantCacheKey(request, id, width) {
  const url = new URL(request.url);
  url.search = '';
  url.searchParams.set('w', String(width));
  url.searchParams.set('variant', IMAGE_VARIANT_VERSION);
  return new Request(url.toString(), { method: 'GET' });
}

function mediaTimingNow() {
  const value = globalThis.performance?.now?.();
  return Number.isFinite(value) ? value : Date.now();
}

function mediaTimingDuration(startedAt) {
  return Math.max(0, Math.round((mediaTimingNow() - startedAt) * 10) / 10);
}

function addMediaTiming(timings, key, duration) {
  if (!Number.isFinite(duration)) return;
  timings[key] = Math.max(0, Number(timings[key] || 0)) + Math.max(0, duration);
}

function withMediaServerTiming(response, timings, totalStartedAt) {
  const headers = new Headers(response.headers);
  const metrics = [];
  const add = (name, duration, description = '') => {
    if (!Number.isFinite(duration)) return;
    const desc = description ? \`;desc=\"\${description}\"\` : '';
    metrics.push(\`\${name};dur=\${Math.max(0, Math.round(duration * 10) / 10)}\${desc}\`);
  };

  add('access', timings.accessMs);
  add('cache', timings.cacheMs, timings.cacheState || '');
  add('r2', timings.r2Ms);
  add('transform', timings.transformMs);
  add('total', mediaTimingDuration(totalStartedAt));
  headers.set('Server-Timing', metrics.join(', '));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}`,
    'the protected media timing helpers',
  );

  output = replaceExactOnce(
    output,
    `async function serveOriginalMedia(request, env, row, id) {
  const etag = mediaVariantEtag(id);
  const headers = mediaResponseHeaders(row.content_type, etag);
  if (requestHasEtag(request, etag)) return new Response(null, { status: 304, headers });

  if (request.method === 'HEAD') {
    const object = await env.SAUTI_MEDIA.head(row.object_key);
    if (!object) return apiError(404, 'MEDIA_NOT_FOUND', 'This media is unavailable.');
    object.writeHttpMetadata(headers);
    headers.set('Cache-Control', 'private, no-store, max-age=0');
    headers.set('ETag', etag);
    return new Response(null, { status: 200, headers });
  }

  const object = await env.SAUTI_MEDIA.get(row.object_key);
  if (!object) return apiError(404, 'MEDIA_NOT_FOUND', 'This media is unavailable.');
  object.writeHttpMetadata(headers);
  headers.set('Cache-Control', 'private, no-store, max-age=0');
  headers.set('Content-Security-Policy', "default-src 'none'");
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Content-Disposition', 'inline');
  headers.set('ETag', etag);
  headers.set('X-Sauti-Media-Variant', 'original');
  return new Response(object.body, { status: 200, headers });
}`,
    `async function serveOriginalMedia(request, env, row, id, timings = {}) {
  const etag = mediaVariantEtag(id);
  const headers = mediaResponseHeaders(row.content_type, etag);
  if (requestHasEtag(request, etag)) return new Response(null, { status: 304, headers });

  if (request.method === 'HEAD') {
    const r2StartedAt = mediaTimingNow();
    const object = await env.SAUTI_MEDIA.head(row.object_key);
    addMediaTiming(timings, 'r2Ms', mediaTimingDuration(r2StartedAt));
    if (!object) return apiError(404, 'MEDIA_NOT_FOUND', 'This media is unavailable.');
    object.writeHttpMetadata(headers);
    headers.set('Cache-Control', 'private, no-store, max-age=0');
    headers.set('ETag', etag);
    return new Response(null, { status: 200, headers });
  }

  const r2StartedAt = mediaTimingNow();
  const object = await env.SAUTI_MEDIA.get(row.object_key);
  addMediaTiming(timings, 'r2Ms', mediaTimingDuration(r2StartedAt));
  if (!object) return apiError(404, 'MEDIA_NOT_FOUND', 'This media is unavailable.');
  object.writeHttpMetadata(headers);
  headers.set('Cache-Control', 'private, no-store, max-age=0');
  headers.set('Content-Security-Policy', "default-src 'none'");
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Content-Disposition', 'inline');
  headers.set('ETag', etag);
  headers.set('X-Sauti-Media-Variant', 'original');
  return new Response(object.body, { status: 200, headers });
}`,
    'the protected original media delivery timing',
  );

  output = replaceExactOnce(
    output,
    `async function serveImageVariant(request, env, row, id, width) {
  if (!responsiveImagesEnabled(env) || row.media_kind !== 'image') {
    return serveOriginalMedia(request, env, row, id);
  }

  const etag = mediaVariantEtag(id, width);
  const clientHeaders = mediaResponseHeaders('image/webp', etag, width);
  if (requestHasEtag(request, etag)) return new Response(null, { status: 304, headers: clientHeaders });
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers: clientHeaders });

  const cache = globalThis.caches?.default;
  const cacheKey = mediaVariantCacheKey(request, id, width);
  if (cache) {
    const cached = await cache.match(cacheKey).catch(() => null);
    if (cached) {
      const headers = mediaResponseHeaders(cached.headers.get('Content-Type') || 'image/webp', etag, width);
      headers.set('X-Sauti-Media-Cache', 'HIT');
      return new Response(cached.body, { status: 200, headers });
    }
  }

  const original = await env.SAUTI_MEDIA.get(row.object_key);
  if (!original) return apiError(404, 'MEDIA_NOT_FOUND', 'This media is unavailable.');

  const sourceWidth = Math.max(1, Number(row.width || width));
  const targetWidth = Math.max(1, Math.min(width, sourceWidth));

  try {
    const output = await env.IMAGES
      .input(original.body)
      .transform({ width: targetWidth, fit: 'scale-down' })
      .output({ format: 'image/webp', quality: 85, anim: true });
    const transformed = output.response();
    if (!transformed.ok) return serveOriginalMedia(request, env, row, id);

    const edgeHeaders = new Headers();
    edgeHeaders.set('Content-Type', transformed.headers.get('Content-Type') || 'image/webp');
    edgeHeaders.set('Cache-Control', \`public, max-age=\${IMAGE_VARIANT_EDGE_TTL_SECONDS}, immutable\`);
    edgeHeaders.set('ETag', etag);
    edgeHeaders.set('X-Sauti-Media-Variant', \`\${IMAGE_VARIANT_VERSION};w=\${width}\`);
    const edgeResponse = new Response(transformed.body, { status: 200, headers: edgeHeaders });

    if (cache) await cache.put(cacheKey, edgeResponse.clone()).catch(() => {});

    const headers = mediaResponseHeaders(edgeHeaders.get('Content-Type'), etag, width);
    headers.set('X-Sauti-Media-Cache', 'MISS');
    return new Response(edgeResponse.body, { status: 200, headers });
  } catch {
    return serveOriginalMedia(request, env, row, id);
  }
}`,
    `async function serveImageVariant(request, env, row, id, width, timings = {}) {
  if (!responsiveImagesEnabled(env) || row.media_kind !== 'image') {
    timings.cacheState = 'BYPASS';
    timings.cacheMs = 0;
    return serveOriginalMedia(request, env, row, id, timings);
  }

  const etag = mediaVariantEtag(id, width);
  const clientHeaders = mediaResponseHeaders('image/webp', etag, width);
  if (requestHasEtag(request, etag)) {
    timings.cacheState = 'CLIENT';
    timings.cacheMs = 0;
    return new Response(null, { status: 304, headers: clientHeaders });
  }
  if (request.method === 'HEAD') {
    timings.cacheState = 'HEAD';
    timings.cacheMs = 0;
    return new Response(null, { status: 200, headers: clientHeaders });
  }

  const cache = globalThis.caches?.default;
  const cacheKey = mediaVariantCacheKey(request, id, width);
  if (cache) {
    const cacheStartedAt = mediaTimingNow();
    const cached = await cache.match(cacheKey).catch(() => null);
    timings.cacheMs = mediaTimingDuration(cacheStartedAt);
    if (cached) {
      timings.cacheState = 'HIT';
      const headers = mediaResponseHeaders(cached.headers.get('Content-Type') || 'image/webp', etag, width);
      headers.set('X-Sauti-Media-Cache', 'HIT');
      return new Response(cached.body, { status: 200, headers });
    }
    timings.cacheState = 'MISS';
  } else {
    timings.cacheState = 'BYPASS';
    timings.cacheMs = 0;
  }

  const r2StartedAt = mediaTimingNow();
  const original = await env.SAUTI_MEDIA.get(row.object_key);
  addMediaTiming(timings, 'r2Ms', mediaTimingDuration(r2StartedAt));
  if (!original) return apiError(404, 'MEDIA_NOT_FOUND', 'This media is unavailable.');

  const sourceWidth = Math.max(1, Number(row.width || width));
  const targetWidth = Math.max(1, Math.min(width, sourceWidth));
  const transformStartedAt = mediaTimingNow();

  try {
    const output = await env.IMAGES
      .input(original.body)
      .transform({ width: targetWidth, fit: 'scale-down' })
      .output({ format: 'image/webp', quality: 85, anim: true });
    const transformed = output.response();
    addMediaTiming(timings, 'transformMs', mediaTimingDuration(transformStartedAt));
    if (!transformed.ok) return serveOriginalMedia(request, env, row, id, timings);

    const edgeHeaders = new Headers();
    edgeHeaders.set('Content-Type', transformed.headers.get('Content-Type') || 'image/webp');
    edgeHeaders.set('Cache-Control', \`public, max-age=\${IMAGE_VARIANT_EDGE_TTL_SECONDS}, immutable\`);
    edgeHeaders.set('ETag', etag);
    edgeHeaders.set('X-Sauti-Media-Variant', \`\${IMAGE_VARIANT_VERSION};w=\${width}\`);
    const edgeResponse = new Response(transformed.body, { status: 200, headers: edgeHeaders });

    if (cache) await cache.put(cacheKey, edgeResponse.clone()).catch(() => {});

    const headers = mediaResponseHeaders(edgeHeaders.get('Content-Type'), etag, width);
    headers.set('X-Sauti-Media-Cache', 'MISS');
    return new Response(edgeResponse.body, { status: 200, headers });
  } catch {
    if (!Number.isFinite(timings.transformMs)) {
      addMediaTiming(timings, 'transformMs', mediaTimingDuration(transformStartedAt));
    }
    return serveOriginalMedia(request, env, row, id, timings);
  }
}`,
    'the responsive image variant timing',
  );

  output = replaceExactOnce(
    output,
    `async function serveMedia(request, env, id) {
  if (!env.SAUTI_MEDIA) return apiError(503, 'MEDIA_NOT_READY', 'Post media is not enabled yet.');
  const row = await selectMedia(id, authorization(request));
  if (!row || !['ready', 'attached'].includes(row.upload_status)) return apiError(404, 'MEDIA_NOT_FOUND', 'This media is unavailable.');

  const url = new URL(request.url);
  const width = normalizeSautiMediaVariantWidth(url.searchParams.get('w'));
  if (width && row.media_kind === 'image') return serveImageVariant(request, env, row, id, width);
  return serveOriginalMedia(request, env, row, id);
}`,
    `async function serveMedia(request, env, id) {
  const totalStartedAt = mediaTimingNow();
  const timings = {};
  if (!env.SAUTI_MEDIA) {
    return withMediaServerTiming(apiError(503, 'MEDIA_NOT_READY', 'Post media is not enabled yet.'), timings, totalStartedAt);
  }

  const accessStartedAt = mediaTimingNow();
  const row = await selectMedia(id, authorization(request));
  timings.accessMs = mediaTimingDuration(accessStartedAt);
  if (!row || !['ready', 'attached'].includes(row.upload_status)) {
    return withMediaServerTiming(apiError(404, 'MEDIA_NOT_FOUND', 'This media is unavailable.'), timings, totalStartedAt);
  }

  const url = new URL(request.url);
  const width = normalizeSautiMediaVariantWidth(url.searchParams.get('w'));
  const response = width && row.media_kind === 'image'
    ? await serveImageVariant(request, env, row, id, width, timings)
    : await serveOriginalMedia(request, env, row, id, timings);
  return withMediaServerTiming(response, timings, totalStartedAt);
}`,
    'the protected media total and access timing',
  );

  return output;
}

export function transformMediaPerformanceSource(filePath, source) {
  const normalized = String(filePath || '').replaceAll('\\', '/');

  if (normalized.endsWith('/src/asset-router.js') || normalized.endsWith('src/asset-router.js')) {
    return replaceExactOnce(
      source,
      `  if (isApiPath(url.pathname)) {
    headers.set('Cache-Control', 'no-store');
  }`,
      `  const protectedMediaDelivery = /^\\/api\\/sauti-media\\/[0-9a-f-]{36}$/i.test(url.pathname);
  if (isApiPath(url.pathname) && !protectedMediaDelivery) {
    headers.set('Cache-Control', 'no-store');
  }`,
      'the API cache-control finalizer',
    );
  }

  if (normalized.endsWith('/src/sauti-media-api.js') || normalized.endsWith('src/sauti-media-api.js')) {
    const cachePolicy = replaceExactOnce(
      source,
      `  headers.set('Cache-Control', 'private, no-store, max-age=0');`,
      `  headers.set('Cache-Control', 'private, max-age=0, must-revalidate');`,
      'the protected media variant browser cache policy',
    );
    return transformMediaApiTiming(cachePolicy);
  }

  if (!normalized.endsWith('/src/app.js') && !normalized.endsWith('src/app.js')) return source;

  let output = source;

  output = replaceExactOnce(
    output,
    `async function fetchSautiMediaBlobUrl(id) {
  const headers = await currentAuthorizationHeader();
  const response = await fetch(\`/api/sauti-media/\${encodeURIComponent(id)}\`, { headers });
  if (!response.ok) throw new Error('MEDIA_PREVIEW_FAILED');
  return URL.createObjectURL(await response.blob());
}`,
    `const SAUTI_MEDIA_VARIANT_WIDTHS = Object.freeze([480, 960, 1440]);

function selectSautiMediaVariantWidth(media, tile) {
  if (media?.media_kind !== 'image') return 0;
  const rect = tile?.getBoundingClientRect?.();
  const fallbackCssWidth = Math.min(Math.max(window.innerWidth || 360, 320), 680);
  const cssWidth = Math.max(1, Number(rect?.width || fallbackCssWidth));
  const dpr = Math.min(Math.max(Number(window.devicePixelRatio || 1), 1), 3);
  const sourceWidth = Math.max(0, Number(media?.width || 0));
  const targetWidth = sourceWidth
    ? Math.min(Math.ceil(cssWidth * dpr), sourceWidth)
    : Math.ceil(cssWidth * dpr);
  return SAUTI_MEDIA_VARIANT_WIDTHS.find((width) => width >= targetWidth)
    || SAUTI_MEDIA_VARIANT_WIDTHS[SAUTI_MEDIA_VARIANT_WIDTHS.length - 1];
}

function waitForSautiMediaNearViewport(tile) {
  if (!tile || !('IntersectionObserver' in window)) return Promise.resolve();
  const preloadMargin = Math.min(Math.max(Number(window.innerHeight || 720), 480), 1200);
  return new Promise((resolve) => {
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      resolve();
    }, { rootMargin: \`\${preloadMargin}px 0px\` });
    observer.observe(tile);
  });
}

async function fetchSautiMediaBlobUrl(id, variantWidth = 0) {
  const headers = await currentAuthorizationHeader();
  const url = new URL(\`/api/sauti-media/\${encodeURIComponent(id)}\`, window.location.origin);
  if (variantWidth) url.searchParams.set('w', String(variantWidth));
  const response = await fetch(\`\${url.pathname}\${url.search}\`, { headers });
  if (!response.ok) throw new Error('MEDIA_PREVIEW_FAILED');
  return URL.createObjectURL(await response.blob());
}`,
    'the protected Sauti media fetch helper',
  );

  output = replaceExactOnce(
    output,
    `function clearHomeFeedMediaState() {
  homeMediaOpenTimers.forEach((timer) => window.clearTimeout(timer));
  homeMediaOpenTimers.clear();
  homeDoubleTapState = { card: null, target: null, time: 0 };
  pauseHomeFeedVideos();`,
    `function revokeHomeFeedMediaObjectUrls(root = byId('stream-feed')) {
  if (!root) return;
  root.querySelectorAll('[data-media-object-url]').forEach((button) => {
    const url = button.dataset.mediaObjectUrl || '';
    if (url) URL.revokeObjectURL(url);
    delete button.dataset.mediaObjectUrl;
  });
}

function clearHomeFeedMediaState() {
  homeMediaOpenTimers.forEach((timer) => window.clearTimeout(timer));
  homeMediaOpenTimers.clear();
  homeDoubleTapState = { card: null, target: null, time: 0 };
  revokeHomeFeedMediaObjectUrls();
  pauseHomeFeedVideos();`,
    'the Home feed media state cleanup',
  );

  output = replaceExactOnce(
    output,
    `    homeAuthorCards(authorId).forEach((authorCard) => authorCard.remove());`,
    `    homeAuthorCards(authorId).forEach((authorCard) => {
      revokeHomeFeedMediaObjectUrls(authorCard);
      authorCard.remove();
    });`,
    'the direct Home card removal cleanup',
  );

  output = replaceExactOnce(
    output,
    `  await Promise.all(mediaEntries.map(async ({ media, button }) => {
    let visual = null;
    try {
      const url = await fetchSautiMediaBlobUrl(media.id);
      if (!button.parentNode) {`,
    `  await Promise.all(mediaEntries.map(async ({ media, button }) => {
    let visual = null;
    try {
      await waitForSautiMediaNearViewport(button);
      if (!button.parentNode) return;
      const variantWidth = selectSautiMediaVariantWidth(media, button);
      const url = await fetchSautiMediaBlobUrl(media.id, variantWidth);
      if (variantWidth) button.dataset.mediaVariantWidth = String(variantWidth);
      if (!button.parentNode) {`,
    'the Home feed media request start',
  );

  output = replaceExactOnce(
    output,
    `  const visual = button.dataset.mediaKind === 'video' ? document.createElement('video') : document.createElement('img');
  visual.src = url;
  if (visual instanceof HTMLVideoElement) {`,
    `  const visual = button.dataset.mediaKind === 'video' ? document.createElement('video') : document.createElement('img');
  visual.src = url;
  if (visual instanceof HTMLImageElement && button.dataset.openMediaId) {
    void fetchSautiMediaBlobUrl(button.dataset.openMediaId).then((originalUrl) => {
      if (!visual.isConnected) {
        URL.revokeObjectURL(originalUrl);
        return;
      }
      const previousViewerUrl = content.dataset.mediaViewerObjectUrl || '';
      if (previousViewerUrl) URL.revokeObjectURL(previousViewerUrl);
      content.dataset.mediaViewerObjectUrl = originalUrl;
      visual.src = originalUrl;
    }).catch(() => {});
  }
  if (visual instanceof HTMLVideoElement) {`,
    'the fullscreen media visual',
  );

  output = replaceExactOnce(
    output,
    `function closeSautiMediaViewer() {
  const dialog = byId('sauti-media-viewer');
  byId('sauti-media-viewer-content')?.replaceChildren();`,
    `function closeSautiMediaViewer() {
  const dialog = byId('sauti-media-viewer');
  const content = byId('sauti-media-viewer-content');
  const viewerUrl = content?.dataset.mediaViewerObjectUrl || '';
  if (viewerUrl) URL.revokeObjectURL(viewerUrl);
  if (content) delete content.dataset.mediaViewerObjectUrl;
  content?.replaceChildren();`,
    'the fullscreen media cleanup',
  );

  return output;
}
