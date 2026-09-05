const CACHE_NAME = "sautilink-shell-v41";
const APP_SHELL = [
  "/",
  "/app/",
  "/app/assets/app.css",
  "/app/assets/app.js",
  "/app/assets/theme-init.js",
  "/manifest.json",
  "/logo.png",
  "/assets/favicon.png",
  "/assets/icon-192.png",
  "/assets/icon-maskable-512.png",
  "/assets/launch-splash.css",
  "/assets/launch-splash.js"
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.pathname.startsWith("/api/")) return;

  if (event.request.mode === "navigate") {
    const socialRoute = /^(?:\/app(?:\/|$)|\/(?:login|signup|home|discover|saved|appeals|moderation|settings|notifications)(?:\/|$)|\/messages(?:\/|$)|\/sautify(?:\/|$)|\/u\/|\/post\/)/.test(url.pathname);
    const fallback = socialRoute ? "/app/" : "/";
    event.respondWith(fetch(event.request).catch(() => caches.match(fallback)));
    return;
  }

  if (url.origin === self.location.origin && (
    url.pathname === "/app/assets/app.js" ||
    url.pathname === "/app/assets/app.css" ||
    url.pathname === "/app/assets/theme-init.js" ||
    url.pathname.startsWith("/app/assets/verification/")
  )) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => caches.match(event.request).then((cached) => cached || caches.match(url.pathname))),
    );
    return;
  }

  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
    if (response.ok && url.origin === self.location.origin) {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
    }
    return response;
  })));
});
