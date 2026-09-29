function replaceRequired(source, before, after, label) {
  if (!source.includes(before)) {
    throw new Error(`Room preview cover stability transform could not find ${label}.`);
  }
  return source.replace(before, after);
}

export function transformRoomPreviewCoverStabilitySource(filePath, source) {
  const normalized = String(filePath || '').replaceAll('\\', '/');
  if (!normalized.endsWith('/src/rooms-platform.js') && !normalized.endsWith('src/rooms-platform.js')) {
    return source;
  }

  let output = source;

  output = replaceRequired(
    output,
    `const ROOM_COVER_VARIANT_WIDTHS = Object.freeze([480, 960, 1440]);`,
    `const ROOM_COVER_VARIANT_WIDTHS = Object.freeze([480, 960, 1440]);
const roomCoverRequestCache = new Map();
const roomCoverVisibilityWaits = new WeakMap();`,
    'Room cover cache state',
  );

  output = replaceRequired(
    output,
    `function clearRoomCoverCache(slug = '') {
  for (const [key, objectUrl] of roomCoverCache.entries()) {
    if (slug && key !== slug && !key.startsWith(\`${'${slug}'}|\`)) continue;
    URL.revokeObjectURL(objectUrl);
    roomCoverCache.delete(key);
  }
}`,
    `function clearRoomCoverCache(slug = '') {
  for (const [key, objectUrl] of roomCoverCache.entries()) {
    if (slug && key !== slug && !key.startsWith(\`${'${slug}'}|\`)) continue;
    URL.revokeObjectURL(objectUrl);
    roomCoverCache.delete(key);
  }
  for (const key of roomCoverRequestCache.keys()) {
    if (slug && key !== slug && !key.startsWith(\`${'${slug}'}|\`)) continue;
    roomCoverRequestCache.delete(key);
  }
}

function roomCoverNearViewport(container, margin) {
  const rect = container.getBoundingClientRect();
  const viewportHeight = Number(window.innerHeight || document.documentElement.clientHeight || 720);
  return rect.bottom >= -margin && rect.top <= viewportHeight + margin;
}

function waitForRoomCoverNearViewport(container) {
  if (!container || !container.isConnected) return Promise.resolve();
  const margin = Math.min(Math.max(Number(window.innerHeight || 720), 480), 900);
  if (roomCoverNearViewport(container, margin) || !('IntersectionObserver' in window)) return Promise.resolve();

  const existing = roomCoverVisibilityWaits.get(container);
  if (existing) return existing;

  const wait = new Promise((resolve) => {
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      resolve();
    }, { rootMargin: \`${'${margin}'}px 0px\` });
    observer.observe(container);
  }).finally(() => roomCoverVisibilityWaits.delete(container));

  roomCoverVisibilityWaits.set(container, wait);
  return wait;
}`,
    'Room cover cache clearing',
  );

  output = replaceRequired(
    output,
    `  if (roomCoverCache.has(cacheKey)) return roomCoverCache.get(cacheKey);
  const accessToken = roomAccessToken();
  if (!accessToken) return '';

  const url = new URL(\`/api/room-media/${'${encodeURIComponent(slug)}'}/cover\`, window.location.origin);
  url.searchParams.set('w', String(variantWidth));
  const version = roomCoverVersionToken(coverKey);
  if (version) url.searchParams.set('v', version);

  const response = await fetch(\`${'${url.pathname}'}${'${url.search}'}\`, {
    headers: { Authorization: \`Bearer ${'${accessToken}'}\` },
    cache: 'force-cache',
  }).catch(() => null);
  if (!response?.ok) return '';
  const objectUrl = URL.createObjectURL(await response.blob());
  roomCoverCache.set(cacheKey, objectUrl);
  return objectUrl;`,
    `  if (roomCoverCache.has(cacheKey)) return roomCoverCache.get(cacheKey);
  if (roomCoverRequestCache.has(cacheKey)) return roomCoverRequestCache.get(cacheKey);
  const accessToken = roomAccessToken();
  if (!accessToken) return '';

  let request;
  request = (async () => {
    const url = new URL(\`/api/room-media/${'${encodeURIComponent(slug)}'}/cover\`, window.location.origin);
    url.searchParams.set('w', String(variantWidth));
    const version = roomCoverVersionToken(coverKey);
    if (version) url.searchParams.set('v', version);

    const response = await fetch(\`${'${url.pathname}'}${'${url.search}'}\`, {
      headers: { Authorization: \`Bearer ${'${accessToken}'}\` },
      cache: 'force-cache',
    }).catch(() => null);
    if (!response?.ok) return '';

    const objectUrl = URL.createObjectURL(await response.blob());
    if (roomCoverRequestCache.get(cacheKey) !== request) {
      URL.revokeObjectURL(objectUrl);
      return '';
    }
    roomCoverCache.set(cacheKey, objectUrl);
    return objectUrl;
  })();

  roomCoverRequestCache.set(cacheKey, request);
  try {
    return await request;
  } finally {
    if (roomCoverRequestCache.get(cacheKey) === request) roomCoverRequestCache.delete(cacheKey);
  }`,
    'Room cover request path',
  );

  output = replaceRequired(
    output,
    `  container.dataset.pendingRoomCover = cacheKey;

  const url = await roomCoverUrl(slug, { coverKey, width: variantWidth });
  if (!url || !container.isConnected || container.dataset.pendingRoomCover !== cacheKey) return;

  const image = document.createElement('img');
  image.className = 'room-cover-image';
  image.alt = '';
  image.loading = priority ? 'eager' : 'lazy';
  image.decoding = 'async';
  image.fetchPriority = priority ? 'high' : 'auto';
  image.src = url;
  await image.decode?.().catch(() => {});
  if (!container.isConnected || container.dataset.pendingRoomCover !== cacheKey) return;

  container.replaceChildren(image);
  container.dataset.roomCover = cacheKey;
  container.classList.add('has-image');`,
    `  container.dataset.pendingRoomCover = cacheKey;

  if (!priority) {
    await waitForRoomCoverNearViewport(container);
    if (!container.isConnected || container.dataset.pendingRoomCover !== cacheKey) return;
  }

  const url = await roomCoverUrl(slug, { coverKey, width: variantWidth });
  if (!url || !container.isConnected || container.dataset.pendingRoomCover !== cacheKey) return;

  const image = document.createElement('img');
  image.className = 'room-cover-image';
  image.alt = '';
  // The protected bytes are already fetched into an object URL. Keeping this image
  // lazy while detached can postpone decode indefinitely in some mobile browsers.
  image.loading = 'eager';
  image.decoding = 'async';
  image.fetchPriority = priority ? 'high' : 'low';
  image.src = url;

  // Attach immediately so preview covers can paint as soon as the object URL is ready.
  // Do not block card rendering on decode; detail covers may still warm decode afterward.
  container.replaceChildren(image);
  container.dataset.roomCover = cacheKey;
  container.classList.add('has-image');
  if (priority) void image.decode?.().catch(() => {});`,
    'Room cover attachment path',
  );

  return output;
}
