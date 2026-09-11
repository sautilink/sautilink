function replaceExactOnce(source, before, after, label) {
  if (!source.includes(before)) {
    throw new Error(`Media performance source transform could not find ${label}.`);
  }
  return source.replace(before, after);
}

export function transformMediaPerformanceSource(filePath, source) {
  const normalized = String(filePath || '').replaceAll('\\', '/');
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
