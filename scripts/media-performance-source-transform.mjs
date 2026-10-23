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
    `async function serveOriginalMedia(request, env, row, id) {`,
    `async function serveOriginalMedia(request, env, row, id, timings = {}) {`,
    'the protected original media delivery timing signature',
  );

  output = replaceExactOnce(
    output,
    `  if (request.method === 'HEAD') {
    const object = await mediaDeliveryPhase('ORIGINAL_R2_HEAD', () => env.SAUTI_MEDIA.head(row.object_key));`,
    `  if (request.method === 'HEAD') {
    const r2StartedAt = mediaTimingNow();
    const object = await mediaDeliveryPhase('ORIGINAL_R2_HEAD', () => env.SAUTI_MEDIA.head(row.object_key));
    addMediaTiming(timings, 'r2Ms', mediaTimingDuration(r2StartedAt));`,
    'the protected original media HEAD timing',
  );

  output = replaceExactOnce(
    output,
    `  const object = await mediaDeliveryPhase('ORIGINAL_R2_GET', () => env.SAUTI_MEDIA.get(
    row.object_key,
    rangeHeader ? { range: boundedSautiVideoRange(rangeHeader, row.size_bytes) || request.headers } : undefined,
  ));`,
    `  const r2StartedAt = mediaTimingNow();
  const object = await mediaDeliveryPhase('ORIGINAL_R2_GET', () => env.SAUTI_MEDIA.get(
    row.object_key,
    rangeHeader ? { range: boundedSautiVideoRange(rangeHeader, row.size_bytes) || request.headers } : undefined,
  ));
  addMediaTiming(timings, 'r2Ms', mediaTimingDuration(r2StartedAt));`,
    'the protected original media ranged read timing',
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
    `async function serveMedia(request, env, id, ctx = null) {
  if (!env.SAUTI_MEDIA) return apiError(503, 'MEDIA_NOT_READY', 'Post media is not enabled yet.');
  const deliveryAuth = mediaDeliveryAuthorization(request);
  const row = await mediaDeliveryPhase('METADATA_LOOKUP', () => selectVideoMediaForDelivery(request, id, deliveryAuth));
  if (!row || !['ready', 'attached'].includes(row.upload_status)) return apiError(404, 'MEDIA_NOT_FOUND', 'This media is unavailable.');

  const url = new URL(request.url);
  const posterOnly = url.searchParams.get('poster') === '1';
  if (row.media_kind === 'video' && !deliveryAuth && !posterOnly) {
    return apiError(401, 'AUTH_REQUIRED', 'Join or sign in to watch this video.');
  }

  const width = normalizeSautiMediaVariantWidth(url.searchParams.get('w'));
  const quality = normalizeSautiVideoQuality(url.searchParams.get('quality'));
  const indexed = !posterOnly && row.media_kind === 'video'
    ? await servePrecomputedOriginalIndex(request, env, row, mediaDeliveryPhase) : null;
  if (indexed) return indexed;
  if (posterOnly) return serveVideoPoster(request, env, row, id);
  if (width && row.media_kind === 'image') return serveImageVariant(request, env, row, id, width);
  if (quality && row.media_kind === 'video') return serveVideoVariant(request, env, row, id, quality, ctx);
  return serveOriginalMedia(request, env, row, id);
}`,
    `async function serveMedia(request, env, id, ctx = null) {
  const totalStartedAt = mediaTimingNow();
  const timings = {};
  if (!env.SAUTI_MEDIA) {
    return withMediaServerTiming(apiError(503, 'MEDIA_NOT_READY', 'Post media is not enabled yet.'), timings, totalStartedAt);
  }

  const deliveryAuth = mediaDeliveryAuthorization(request);
  const accessStartedAt = mediaTimingNow();
  const row = await mediaDeliveryPhase('METADATA_LOOKUP', () => selectVideoMediaForDelivery(request, id, deliveryAuth));
  timings.accessMs = mediaTimingDuration(accessStartedAt);
  if (!row || !['ready', 'attached'].includes(row.upload_status)) {
    return withMediaServerTiming(apiError(404, 'MEDIA_NOT_FOUND', 'This media is unavailable.'), timings, totalStartedAt);
  }

  const url = new URL(request.url);
  const posterOnly = url.searchParams.get('poster') === '1';
  if (row.media_kind === 'video' && !deliveryAuth && !posterOnly) {
    return withMediaServerTiming(
      apiError(401, 'AUTH_REQUIRED', 'Join or sign in to watch this video.'),
      timings,
      totalStartedAt,
    );
  }

  const width = normalizeSautiMediaVariantWidth(url.searchParams.get('w'));
  const quality = normalizeSautiVideoQuality(url.searchParams.get('quality'));
  const indexed = !posterOnly && row.media_kind === 'video'
    ? await servePrecomputedOriginalIndex(request, env, row, mediaDeliveryPhase) : null;
  if (indexed) return withMediaServerTiming(indexed, timings, totalStartedAt);
  const response = posterOnly
    ? await serveVideoPoster(request, env, row, id)
    : width && row.media_kind === 'image'
    ? await serveImageVariant(request, env, row, id, width, timings)
    : quality && row.media_kind === 'video'
      ? await serveVideoVariant(request, env, row, id, quality, ctx)
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
const SAUTI_VIDEO_SESSION_REFRESH_MS = 4 * 60 * 1000;
const SAUTI_VIDEO_SESSION_REQUEST_TIMEOUT_MS = 8000;
let sautiVideoSessionReadyUntil = 0;
let sautiVideoSessionRefreshTimer = 0;
let sautiVideoSessionAuthorization = '';
let sautiVideoSessionGeneration = 0;
let sautiVideoSessionAuthorizationRead = 0;
let sautiVideoSessionLatestAuthorizationRead = 0;
let sautiVideoSessionRequest = null;
let sautiVideoSessionClearPromise = null;

function hasSautiVideoSessionConsumer() {
  // HLS MediaSource players use blob: URLs but still fetch every protected
  // playlist and fragment with the same short-lived media-session cookie.
  return Boolean(document.querySelector('video[src*="/api/sauti-media/"], video[data-sauti-stream-managed="true"]'));
}

function scheduleSautiVideoSessionRefresh(delay = SAUTI_VIDEO_SESSION_REFRESH_MS) {
  window.clearTimeout(sautiVideoSessionRefreshTimer);
  sautiVideoSessionRefreshTimer = window.setTimeout(() => {
    sautiVideoSessionRefreshTimer = 0;
    if (!document.hidden && hasSautiVideoSessionConsumer()) {
      void ensureSautiVideoSession().catch(() => {});
    }
  }, delay);
}

function resetSautiVideoSessionRequest() {
  window.clearTimeout(sautiVideoSessionRefreshTimer);
  sautiVideoSessionRefreshTimer = 0;
  sautiVideoSessionReadyUntil = 0;
  const previous = sautiVideoSessionRequest;
  sautiVideoSessionRequest = null;
  previous?.controller.abort();
}

function invalidateSautiVideoSession() {
  sautiVideoSessionGeneration++;
  resetSautiVideoSessionRequest();
  sautiVideoSessionAuthorization = '';
}

function startSautiVideoSessionMutation(options, waitFor = null) {
  const controller = new AbortController();
  let onAbort;
  const cancelled = new Promise((_, reject) => {
    onAbort = () => reject(new Error('MEDIA_SESSION_CANCELLED'));
    controller.signal.addEventListener('abort', onAbort, { once: true });
  });
  const timeout = window.setTimeout(() => controller.abort(), SAUTI_VIDEO_SESSION_REQUEST_TIMEOUT_MS);
  const response = (async () => {
    // A slow logout DELETE must settle before issuing the next account's cookie.
    await waitFor;
    if (controller.signal.aborted) throw new Error('MEDIA_SESSION_CANCELLED');
    return fetch('/api/sauti-media/session', {
      ...options,
      credentials: 'same-origin',
      signal: controller.signal,
    });
  })();
  const promise = Promise.race([response, cancelled]).finally(() => {
    window.clearTimeout(timeout);
    controller.signal.removeEventListener('abort', onAbort);
  });
  return { controller, promise };
}

async function ensureSautiVideoSession({ force = false } = {}) {
  const generation = sautiVideoSessionGeneration;
  const authorizationRead = ++sautiVideoSessionAuthorizationRead;
  const headers = await currentAuthorizationHeader();
  const authorization = headers.Authorization || '';
  if (generation !== sautiVideoSessionGeneration
    || (authorizationRead < sautiVideoSessionLatestAuthorizationRead
      && authorization !== sautiVideoSessionAuthorization)) {
    throw new Error('MEDIA_SESSION_CANCELLED');
  }
  sautiVideoSessionLatestAuthorizationRead = Math.max(sautiVideoSessionLatestAuthorizationRead, authorizationRead);
  // Both readiness and in-flight work belong to the current exact session.
  // Check it before deduplication, including when the local window is fresh.
  if (authorization !== sautiVideoSessionAuthorization) {
    resetSautiVideoSessionRequest();
    sautiVideoSessionAuthorization = authorization;
  }
  if (!authorization) throw new Error('MEDIA_AUTH_REQUIRED');
  if (sautiVideoSessionRequest) return sautiVideoSessionRequest.promise;
  if (!force && Date.now() < sautiVideoSessionReadyUntil) return;

  resetSautiVideoSessionRequest();
  const request = startSautiVideoSessionMutation({
    method: 'POST', headers: { Authorization: authorization },
  }, sautiVideoSessionClearPromise);
  sautiVideoSessionRequest = request;
  request.promise = request.promise.then((response) => {
    if (generation !== sautiVideoSessionGeneration || sautiVideoSessionRequest !== request
      || request.controller.signal.aborted) throw new Error('MEDIA_SESSION_CANCELLED');
    if (!response.ok) throw new Error('MEDIA_SESSION_FAILED');
    sautiVideoSessionReadyUntil = Date.now() + SAUTI_VIDEO_SESSION_REFRESH_MS;
    scheduleSautiVideoSessionRefresh();
  }).finally(() => {
    if (sautiVideoSessionRequest === request) sautiVideoSessionRequest = null;
  });
  return request.promise;
}

function syncSautiVideoSessionAuthorization(event, session) {
  const authorization = event !== 'SIGNED_OUT' && session?.access_token
    ? 'Bearer ' + session.access_token : '';
  if (event !== 'SIGNED_OUT' && authorization === sautiVideoSessionAuthorization) return;
  invalidateSautiVideoSession();
  sautiVideoSessionAuthorization = authorization;
  // Supabase auth callbacks must remain synchronous. Any getSession work runs
  // on a later task, outside the auth callback's lock.
  if (authorization) scheduleSautiVideoSessionRefresh(0);
}

window.SautiLinkVideoMediaSession = Object.freeze({ ensure: ensureSautiVideoSession });

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && hasSautiVideoSessionConsumer()) {
    void ensureSautiVideoSession().catch(() => {});
  }
});

async function fetchSautiVideoStreamUrl(id, quality = 'original') {
  await ensureSautiVideoSession();
  const source = window.SautiLinkVideoQuality?.sourceUrl?.(id, quality)
    || \`/api/sauti-media/\${encodeURIComponent(id)}\`;
  const url = new URL(source, window.location.origin);
  return \`\${url.pathname}\${url.search}\`;
}

function clearSautiVideoSession() {
  invalidateSautiVideoSession();
  if (sautiVideoSessionClearPromise) return sautiVideoSessionClearPromise;
  const request = startSautiVideoSessionMutation({ method: 'DELETE', keepalive: true });
  const promise = request.promise.catch(() => null).finally(() => {
    if (sautiVideoSessionClearPromise === promise) sautiVideoSessionClearPromise = null;
  });
  sautiVideoSessionClearPromise = promise;
  return promise;
}

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

function waitForSautiMediaNearViewport(tile, poster = false) {
  if (!tile || !('IntersectionObserver' in window)) return Promise.resolve();
  const preloadMargin = poster
    ? Math.min(Math.max(Number(window.innerHeight || 720) * 1.5, 900), 1600)
    : tile.dataset.mediaKind === 'video'
    ? Math.min(Math.max(Math.round(Number(window.innerHeight || 720) * 0.3), 180), 320)
    : Math.min(Math.max(Number(window.innerHeight || 720), 480), 1200);
  return new Promise((resolve) => {
    let settled = false;
    let observer = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      observer?.disconnect();
      tile.removeEventListener('sautilink:request-media-load', finish);
      tile.removeEventListener('sautilink:request-media-poster', finish);
      resolve();
    };
    observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      finish();
    }, { rootMargin: \`\${preloadMargin}px 0px\` });
    tile.addEventListener('sautilink:request-media-load', finish, { once: true });
    if (poster) tile.addEventListener('sautilink:request-media-poster', finish, { once: true });
    observer.observe(tile);
  });
}

async function fetchSautiMediaBlobUrl(id, variantWidth = 0, tile = null, stillWanted = null) {
  const owner = currentMemberId;
  const isCurrent = () => owner === currentMemberId && (!tile || tile.isConnected)
    && (!stillWanted || stillWanted());
  return runMediaPreviewRequest(async (signal) => {
    if (!isCurrent()) throw new Error('MEDIA_PREVIEW_CANCELLED');
    const headers = await currentAuthorizationHeader();
    signal.throwIfAborted();
    if (!isCurrent()) throw new Error('MEDIA_PREVIEW_CANCELLED');
    const url = new URL(\`/api/sauti-media/\${encodeURIComponent(id)}\`, window.location.origin);
    if (variantWidth) url.searchParams.set('w', String(variantWidth));
    const response = await fetch(\`\${url.pathname}\${url.search}\`, { headers, signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) });
    if (!response.ok) throw new Error('MEDIA_PREVIEW_FAILED');
    const blob = await readMediaPreviewBlob(response);
    signal.throwIfAborted();
    if (!isCurrent()) throw new Error('MEDIA_PREVIEW_CANCELLED');
    return URL.createObjectURL(blob);
  }, { isCurrent, priority: () => mediaPreviewPriority(tile) });
}

async function loadSautiVideoPoster(id, button) {
  const owner = currentMemberId;
  try {
    await waitForSautiMediaNearViewport(button, true);
    if (!button.isConnected || owner !== currentMemberId) return;
    await runMediaPreviewRequest(async (signal) => {
      if (!button.isConnected || owner !== currentMemberId) return;
      const headers = await currentAuthorizationHeader();
      if (owner !== currentMemberId) return;
      const response = await fetch(\`/api/sauti-media/\${encodeURIComponent(id)}?poster=1\`, { headers, priority: 'low', signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) });
      if (!response.ok || response.headers.get('Content-Type')?.split(';')[0] !== 'image/jpeg') return;
      const blob = await readMediaPreviewBlob(response, 2 * 1024 * 1024);
      signal.throwIfAborted();
      if (!button.isConnected || owner !== currentMemberId) return;
      const posterUrl = URL.createObjectURL(blob);
      button.dataset.mediaPosterObjectUrl = posterUrl;
      button.style.backgroundImage = \`url("\${posterUrl}")\`;
      button.style.backgroundPosition = 'center';
      button.style.backgroundSize = 'cover';
      const video = button.querySelector('video');
      if (video) video.poster = posterUrl;
    }, { isCurrent: () => owner === currentMemberId && button.isConnected, priority: () => mediaPreviewPriority(button) });
  } catch {
    // Playback remains available if a source video cannot produce a poster.
  }
}

function enableSautiVideoBlobFallback(video, button, id) {
  const isStreaming = () => video.dataset.sautiStreamManaged !== 'true' && video.dataset.sautiPreparing !== 'true'
    && video.src.includes('/api/sauti-media/');
  const isWanted = () => video.isConnected && !video.paused && video.readyState < 1 && isStreaming()
    && window.SautiLinkStreamPlayback?.eligible?.(video) !== false;
  let timer = 0, pending = false, attempted = false;
  const clearTimer = () => {
    window.clearTimeout(timer); timer = 0;
    runMediaPreviewRequest.wake?.();
  };
  const startTimer = () => {
    if (timer || pending || attempted || !isWanted()) return;
    timer = window.setTimeout(async () => {
      timer = 0;
      if (!isWanted()) return;
      pending = true; attempted = true;
      let blobUrl = '';
      try {
        blobUrl = await fetchSautiMediaBlobUrl(id, 0, button, isWanted);
        if (!isWanted()) {
          URL.revokeObjectURL(blobUrl);
          return;
        }
        button.dataset.mediaObjectUrl = blobUrl;
        button.dataset.mediaStreaming = 'blob-fallback';
        video.dataset.sautiBlobFallback = 'true';
        video.dataset.sautiQuality = 'original';
        video.preload = 'auto';
        video.src = blobUrl;
        video.load();
        video.dispatchEvent(new CustomEvent('sautilink:video-blob-fallback'));
        syncHomeFeedVideoPlayback();
      } catch {
        if (blobUrl) URL.revokeObjectURL(blobUrl);
      } finally { pending = false; }
    }, 4000);
  };
  video.addEventListener('loadedmetadata', clearTimer);
  video.addEventListener('pause', () => { attempted = false; clearTimer(); });
  video.addEventListener('emptied', clearTimer);
  video.addEventListener('play', () => { attempted = false; startTimer(); });
  video.addEventListener('waiting', startTimer);
  video.addEventListener('stalled', startTimer);
  video.addEventListener('sautilink:video-quality-applied', () => { if (!isWanted()) clearTimer(); });
  video.addEventListener('sautilink:video-preparing', (event) => { if (event.detail?.active) clearTimer(); else startTimer(); });
  if (!video.paused) startTimer();
}`,
    'the protected Sauti media fetch helper',
  );

  output = replaceExactOnce(
    output,
    `  applyHomeVideoAudio(video);
  try {
    await video.play();`,
    `  applyHomeVideoAudio(video);
  try {
    await window.SautiLinkStreamPlayback?.prepare?.(video);
    if (!canPlayHomeFeedVideos() || !getVideoAutoplayPreference() || video.dataset.sautiUserPaused === 'true'
      || window.SautiLinkStreamPlayback?.eligible?.(video) === false) return;
    await video.play();`,
    'Home adaptive preparation before legacy playback',
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
  root.querySelectorAll('[data-media-object-url], [data-media-poster-object-url]').forEach((button) => {
    const url = button.dataset.mediaObjectUrl || '';
    if (url.startsWith('blob:')) URL.revokeObjectURL(url);
    delete button.dataset.mediaObjectUrl;
    const posterUrl = button.dataset.mediaPosterObjectUrl || '';
    if (posterUrl.startsWith('blob:')) URL.revokeObjectURL(posterUrl);
    delete button.dataset.mediaPosterObjectUrl;
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
    `    gallery.append(button);
    return { media, button };
  });`,
    `    gallery.append(button);
    if (media.media_kind === 'video') void loadSautiVideoPoster(media.id, button);
    return { media, button };
  });`,
    'the early Home video poster request',
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
      const streamingVideo = media.media_kind === 'video';
      const videoQuality = streamingVideo
        ? (window.SautiLinkVideoQuality?.qualityFor?.({ context: 'home', mediaId: media.id }) || 'original')
        : 'original';
      const url = streamingVideo
        ? await fetchSautiVideoStreamUrl(media.id, videoQuality)
        : await fetchSautiMediaBlobUrl(media.id, variantWidth, button);
      if (variantWidth) button.dataset.mediaVariantWidth = String(variantWidth);
      if (streamingVideo) {
        button.dataset.mediaStreaming = 'range';
        button.dataset.mediaQuality = videoQuality;
      }
      if (!button.parentNode) {`,
    'the Home feed media request start',
  );

  output = replaceExactOnce(
    output,
    `      button.dataset.mediaObjectUrl = url;
      visual = media.media_kind === 'video' ? document.createElement('video') : document.createElement('img');
      if (visual instanceof HTMLVideoElement) visual.preload = 'none';`,
    `      button.dataset.mediaObjectUrl = url;
      visual = media.media_kind === 'video' ? document.createElement('video') : document.createElement('img');
      if (visual instanceof HTMLVideoElement && button.dataset.mediaPosterObjectUrl) {
        visual.poster = button.dataset.mediaPosterObjectUrl;
      }
      if (visual instanceof HTMLVideoElement) visual.preload = 'none';`,
    'the Home video poster attachment',
  );

  output = replaceExactOnce(
    output,
    `        visual.preload = getVideoAutoplayPreference() ? 'metadata' : 'none';`,
    `        visual.preload = 'none';`,
    'the final Home legacy video preload guard',
  );

  output = replaceExactOnce(
    output,
    `    if (visual instanceof HTMLVideoElement) observeHomeFeedVideo(visual, gallery);`,
    `    if (visual instanceof HTMLVideoElement) {
      observeHomeFeedVideo(visual, gallery);
      enableSautiVideoBlobFallback(visual, button, media.id);
    }`,
    'the Home video playback fallback',
  );

  output = replaceExactOnce(
    output,
    `  try {
    const url = await fetchSautiMediaBlobUrl(item.id);
    if (!composerMedia.includes(item) || item.localUrl) {`,
    `  try {
    const url = item.mediaKind === 'video'
      ? await fetchSautiVideoStreamUrl(item.id, 'original')
      : await fetchSautiMediaBlobUrl(item.id);
    if (!composerMedia.includes(item) || item.localUrl) {`,
    'the composer video streaming preview',
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
  if (visual instanceof HTMLVideoElement) {
    visual.dataset.sautiMediaId = button.dataset.openMediaId || '';
    if (button.dataset.mediaStreaming === 'blob-fallback') visual.dataset.sautiBlobFallback = 'true';
    if (button.dataset.mediaPosterObjectUrl) visual.poster = button.dataset.mediaPosterObjectUrl;
    visual.dataset.sautiQuality = button.dataset.mediaQuality || 'original';`,
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
  content?.querySelectorAll('video').forEach((video) => video.pause());
  content?.replaceChildren();`,
    'the fullscreen media cleanup',
  );

  output = replaceExactOnce(
    output,
    `supabase.auth.onAuthStateChange((event, session) => {`,
    `supabase.auth.onAuthStateChange((event, session) => {
  syncSautiVideoSessionAuthorization(event, session);`,
    'the video media session auth lifecycle',
  );

  output = replaceExactOnce(
    output,
    `  if (event === 'SIGNED_OUT') {
    resetHomeVideoAudio();
    if (pendingSignup) {`,
    `  if (event === 'SIGNED_OUT') {
    resetHomeVideoAudio();
    void clearSautiVideoSession();
    if (pendingSignup) {`,
    'the signed-out video media session cleanup',
  );

  return output;
}
