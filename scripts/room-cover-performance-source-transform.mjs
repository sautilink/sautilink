function replaceExactOnce(source, before, after, label) {
  if (!source.includes(before)) {
    throw new Error(`Room cover performance transform could not find ${label}.`);
  }
  return source.replace(before, after);
}

function transformRoomsPlatform(source) {
  let output = source;

  output = replaceExactOnce(
    output,
    `async function roomCoverUrl(slug) {
  if (!slug) return '';
  if (roomCoverCache.has(slug)) return roomCoverCache.get(slug);
  const accessToken = roomAccessToken();
  if (!accessToken) return '';
  const response = await fetch(\`/api/room-media/\${encodeURIComponent(slug)}/cover\`, {
    headers: { Authorization: \`Bearer \${accessToken}\` },
  }).catch(() => null);
  if (!response?.ok) return '';
  const objectUrl = URL.createObjectURL(await response.blob());
  roomCoverCache.set(slug, objectUrl);
  return objectUrl;
}

async function attachRoomCover(container, slug) {
  if (!container || !slug || container.dataset.roomCover === slug) return;
  container.dataset.pendingRoomCover = slug;
  const url = await roomCoverUrl(slug);
  if (!url || !container.isConnected || container.dataset.pendingRoomCover !== slug) return;
  let image = container.querySelector('img.room-cover-image');
  if (!image) {
    image = document.createElement('img');
    image.className = 'room-cover-image';
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    container.replaceChildren(image);
  }
  image.src = url;
  container.dataset.roomCover = slug;
  container.classList.add('has-image');
}`,
    `const ROOM_COVER_VARIANT_WIDTHS = Object.freeze([480, 960, 1440]);

function roomCoverVariantWidth(value) {
  const requested = Math.max(1, Number(value) || 960);
  return ROOM_COVER_VARIANT_WIDTHS.reduce((best, candidate) => (
    Math.abs(candidate - requested) < Math.abs(best - requested) ? candidate : best
  ));
}

function roomCoverVersionToken(coverKey) {
  const leaf = String(coverKey || '').split('/').pop() || '';
  return leaf.replace(/\.[^.]+$/, '').slice(0, 80);
}

function roomCoverCacheKey(slug, coverKey, width) {
  return \`\${slug}|\${roomCoverVersionToken(coverKey) || 'legacy'}|\${roomCoverVariantWidth(width)}\`;
}

function clearRoomCoverCache(slug = '') {
  for (const [key, objectUrl] of roomCoverCache.entries()) {
    if (slug && key !== slug && !key.startsWith(\`\${slug}|\`)) continue;
    URL.revokeObjectURL(objectUrl);
    roomCoverCache.delete(key);
  }
}

async function roomCoverUrl(slug, { coverKey = '', width = 960 } = {}) {
  if (!slug) return '';
  const variantWidth = roomCoverVariantWidth(width);
  const cacheKey = roomCoverCacheKey(slug, coverKey, variantWidth);
  if (roomCoverCache.has(cacheKey)) return roomCoverCache.get(cacheKey);
  const accessToken = roomAccessToken();
  if (!accessToken) return '';

  const url = new URL(\`/api/room-media/\${encodeURIComponent(slug)}/cover\`, window.location.origin);
  url.searchParams.set('w', String(variantWidth));
  const version = roomCoverVersionToken(coverKey);
  if (version) url.searchParams.set('v', version);

  const response = await fetch(\`\${url.pathname}\${url.search}\`, {
    headers: { Authorization: \`Bearer \${accessToken}\` },
    cache: 'force-cache',
  }).catch(() => null);
  if (!response?.ok) return '';
  const objectUrl = URL.createObjectURL(await response.blob());
  roomCoverCache.set(cacheKey, objectUrl);
  return objectUrl;
}

async function attachRoomCover(container, slug, { coverKey = '', width = 960, priority = false } = {}) {
  if (!container || !slug) return;
  const variantWidth = roomCoverVariantWidth(width);
  const cacheKey = roomCoverCacheKey(slug, coverKey, variantWidth);
  if (container.dataset.roomCover === cacheKey) return;
  container.dataset.pendingRoomCover = cacheKey;

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
  container.classList.add('has-image');
}`,
    'the Room cover fetch and attach helpers',
  );

  output = replaceExactOnce(
    output,
    `    if (room.cover_key) attachRoomCover(cover, room.slug);`,
    `    if (room.cover_key) attachRoomCover(cover, room.slug, { coverKey: room.cover_key, width: 480 });`,
    'the Room preview cover call',
  );

  output = replaceExactOnce(
    output,
    `  if (room.cover_key) attachRoomCover(cover, room.slug);`,
    `  if (room.cover_key) attachRoomCover(cover, room.slug, {
    coverKey: room.cover_key,
    width: window.innerWidth <= 680 ? 960 : 1440,
    priority: true,
  });`,
    'the opened Room cover call',
  );

  const uploadWithRuntimeCache = `  const slug = payload?.data?.slug;
  invalidateRoomRuntimeCaches({ slug, roomId, discovery: true });
  if (slug && roomCoverCache.has(slug)) {
    URL.revokeObjectURL(roomCoverCache.get(slug));
    roomCoverCache.delete(slug);
  }`;
  if (output.includes(uploadWithRuntimeCache)) {
    output = replaceExactOnce(
      output,
      uploadWithRuntimeCache,
      `  const slug = payload?.data?.slug;
  invalidateRoomRuntimeCaches({ slug, roomId, discovery: true });
  if (slug) clearRoomCoverCache(slug);`,
      'the Room cover upload cache invalidation with Room runtime cache',
    );
  } else {
    output = replaceExactOnce(
      output,
      `  const slug = payload?.data?.slug;
  if (slug && roomCoverCache.has(slug)) {
    URL.revokeObjectURL(roomCoverCache.get(slug));
    roomCoverCache.delete(slug);
  }`,
      `  const slug = payload?.data?.slug;
  if (slug) clearRoomCoverCache(slug);`,
      'the Room cover upload cache invalidation',
    );
  }

  const removalWithRuntimeCache = `  invalidateRoomRuntimeCaches({ slug, roomId, discovery: true });
  if (roomCoverCache.has(slug)) {
    URL.revokeObjectURL(roomCoverCache.get(slug));
    roomCoverCache.delete(slug);
  }`;
  if (output.includes(removalWithRuntimeCache)) {
    output = replaceExactOnce(
      output,
      removalWithRuntimeCache,
      `  invalidateRoomRuntimeCaches({ slug, roomId, discovery: true });
  clearRoomCoverCache(slug);`,
      'the Room cover removal cache invalidation with Room runtime cache',
    );
  } else {
    output = replaceExactOnce(
      output,
      `  if (roomCoverCache.has(slug)) {
    URL.revokeObjectURL(roomCoverCache.get(slug));
    roomCoverCache.delete(slug);
  }`,
      `  clearRoomCoverCache(slug);`,
      'the Room cover removal cache invalidation',
    );
  }

  return output;
}

function transformAssetRouter(source) {
  const before = `  const protectedMediaDelivery = /^\\/api\\/sauti-media\\/[0-9a-f-]{36}$/i.test(url.pathname);
  if (isApiPath(url.pathname) && !protectedMediaDelivery) {
    headers.set('Cache-Control', 'no-store');
  }`;
  if (!source.includes(before)) return source;
  return source.replace(
    before,
    `  const protectedMediaDelivery = /^\\/api\\/sauti-media\\/[0-9a-f-]{36}$/i.test(url.pathname)
    || /^\\/api\\/room-media\\/[a-z0-9][a-z0-9-]{2,49}\\/cover$/i.test(url.pathname);
  if (isApiPath(url.pathname) && !protectedMediaDelivery) {
    headers.set('Cache-Control', 'no-store');
  }`,
  );
}

export function transformRoomCoverPerformanceSource(filePath, source) {
  const normalized = String(filePath || '').replaceAll('\\', '/');
  if (normalized.endsWith('/src/rooms-platform.js') || normalized.endsWith('src/rooms-platform.js')) {
    return transformRoomsPlatform(source);
  }
  if (normalized.endsWith('/src/asset-router.js') || normalized.endsWith('src/asset-router.js')) {
    return transformAssetRouter(source);
  }
  return source;
}
