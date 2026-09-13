const CACHE_NAME = "sautilink-shell-v51";
const APP_SHELL = [
  "/",
  "/app/",
  "/app/assets/app.css?v=20260909-home-loading",
  "/app/assets/app.js?v=20260909-authsession4",
  "/app/assets/theme-init.js?v=20260904-account2",
  "/app/assets/app-native-android.css?v=20260913-perf1",
  "/manifest.json",
  "/logo.png",
  "/assets/favicon.png",
  "/assets/icon-192.png",
  "/assets/icon-maskable-512.png",
  "/assets/brand/system.css",
  "/assets/pwa.js",
  "/assets/launch-splash.css",
  "/assets/launch-splash.js"
];

const SOCIAL_ROUTE = /^(?:\/app(?:\/|$)|\/(?:login|signup|home|discover|saved|appeals|moderation|settings|notifications)(?:\/|$)|\/messages(?:\/|$)|\/(?:rooms|sautify)(?:\/|$)|\/u\/|\/post\/)/;

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
    )),
  );
  self.clients.claim();
});

function cacheSuccessfulResponse(cacheKey, response) {
  if (!response?.ok) return response;
  const copy = response.clone();
  void caches.open(CACHE_NAME).then((cache) => cache.put(cacheKey, copy));
  return response;
}

function staleWhileRevalidate(event, request, cacheKey = request) {
  const refresh = fetch(request, { cache: "no-cache" })
    .then((response) => cacheSuccessfulResponse(cacheKey, response));

  event.waitUntil(refresh.then(() => undefined).catch(() => undefined));
  return caches.match(cacheKey).then((cached) => cached || refresh);
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.pathname.startsWith("/api/")) return;

  if (event.request.mode === "navigate") {
    if (SOCIAL_ROUTE.test(url.pathname)) {
      // The social app is a single shell. Serve the warm shell immediately,
      // then refresh it in the background so Android resume/navigation does
      // not wait on a round trip before painting usable UI.
      event.respondWith(staleWhileRevalidate(event, "/app/", "/app/"));
      return;
    }

    event.respondWith(fetch(event.request).catch(() => caches.match("/")));
    return;
  }

  if (url.origin === self.location.origin && (
    url.pathname === "/app/assets/app.js" ||
    url.pathname === "/app/assets/app.css" ||
    url.pathname === "/app/assets/theme-init.js" ||
    url.pathname === "/app/assets/app-native-android.css" ||
    url.pathname.startsWith("/app/assets/verification/")
  )) {
    event.respondWith(staleWhileRevalidate(event, event.request));
    return;
  }

  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
    if (response.ok && url.origin === self.location.origin) {
      const copy = response.clone();
      void caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
    }
    return response;
  })));
});
