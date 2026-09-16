const CACHE_NAME = "sautilink-shell-v52";
const APP_RELEASE = "20260916-captionlayout2";
const APP_FEATURE_RELEASE = "20260915-verification1";
const CORE_ASSET_PATHS = new Set([
  "/app/assets/app.css",
  "/app/assets/app.js",
  "/app/assets/theme-init.js"
]);
const APP_SHELL = [
  "/",
  "/app/",
  `/app/assets/app.css?v=${APP_RELEASE}`,
  `/app/assets/app.js?v=${APP_RELEASE}&feature=${APP_FEATURE_RELEASE}`,
  "/app/assets/theme-init.js?v=20260904-account2",
  "/manifest.json",
  "/logo.png",
  "/assets/favicon.png",
  "/assets/icon-192.png",
  "/assets/icon-maskable-512.png",
  "/assets/brand/system.css",
  `/assets/pwa.js?v=${APP_RELEASE}`,
  "/assets/launch-splash.css",
  "/assets/launch-splash.js"
];

async function cacheAppShell() {
  const cache = await caches.open(CACHE_NAME);
  await Promise.allSettled(APP_SHELL.map((url) => cache.add(url)));
}

async function matchCachedPath(pathname) {
  const exact = await caches.match(pathname);
  if (exact) return exact;

  const cache = await caches.open(CACHE_NAME);
  const requests = await cache.keys();
  const request = requests.find((candidate) => {
    try {
      return new URL(candidate.url).pathname === pathname;
    } catch {
      return false;
    }
  });
  return request ? cache.match(request) : undefined;
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(cacheAppShell());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    const hadPreviousShell = keys.some((key) => key.startsWith("sautilink-shell-") && key !== CACHE_NAME);
    await Promise.all(keys
      .filter((key) => key.startsWith("sautilink-shell-") && key !== CACHE_NAME)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
    if (!hadPreviousShell) return;

    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    await Promise.all(windows.map(async (client) => {
      try {
        const url = new URL(client.url);
        if (url.origin !== self.location.origin) return;
        const isAppRoute = /^(?:\/app(?:\/|$)|\/(?:login|signup|home|discover|saved|appeals|moderation|settings|notifications)(?:\/|$)|\/messages(?:\/|$)|\/(?:rooms|sautify)(?:\/|$)|\/u\/|\/post\/)/.test(url.pathname);
        if (isAppRoute) await client.navigate(client.url);
      } catch {
        // A closed or non-navigable client must not block the release activation.
      }
    }));
  })());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.pathname.startsWith("/api/")) return;

  if (event.request.mode === "navigate") {
    const socialRoute = /^(?:\/app(?:\/|$)|\/(?:login|signup|home|discover|saved|appeals|moderation|settings|notifications)(?:\/|$)|\/messages(?:\/|$)|\/(?:rooms|sautify)(?:\/|$)|\/u\/|\/post\/)/.test(url.pathname);
    const fallback = socialRoute ? "/app/" : "/";
    event.respondWith(fetch(event.request).catch(() => caches.match(fallback)));
    return;
  }

  const isAppCodeAsset = url.pathname.startsWith("/app/assets/") && /\.(?:css|js)$/i.test(url.pathname);
  if (url.origin === self.location.origin && (
    CORE_ASSET_PATHS.has(url.pathname) ||
    isAppCodeAsset ||
    url.pathname.startsWith("/app/assets/verification/")
  )) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(event.request);
          return cached || matchCachedPath(url.pathname);
        }),
    );
    return;
  }

  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
    if (response.ok && url.origin === self.location.origin) {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
    }
    return response;
  })));
});
