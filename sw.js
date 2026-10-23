const CACHE_NAME = "sautilink-shell-v95";
const PWA_RELEASE = "20260930-swala-otp2";
const CORE_ASSET_PATHS = new Set([
  "/app/assets/app.css",
  "/app/assets/app.js",
  "/app/assets/theme-init.js"
]);
const APP_SHELL = [
  "/",
  "/app/",
  // UI code is cached by its final content version when actually requested.
  // Preloading legacy core URLs here duplicates the page's hashed downloads.
  "/manifest.json",
  "/logo.png",
  "/assets/favicon.png",
  "/assets/icon-192.png",
  "/assets/icon-maskable-512.png",
  "/assets/brand/system.css",
  `/assets/pwa.js?v=${PWA_RELEASE}`,
  "/assets/launch-splash.css",
  "/assets/launch-splash.js",
  "/assets/lottie-loader.js?v=20260917-lottie1",
  "/assets/lottie-loader.css?v=20260917-lottie1",
  "/assets/vendor/lottie-web/lottie_light.min.js",
  "/assets/animations/sautilink-loader/animations/12345.json"
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

async function immutableCodeMatches(response, version) {
  if (!response.ok || response.type === "opaque" || response.redirected || !response.body) return false;
  // Code is public but still bounded; never allocate an unbounded response merely
  // to validate its version. Protected media never reaches this helper.
  const reader = response.clone().body.getReader(), chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4 * 1024 * 1024) { void reader.cancel().catch(() => {}); return false; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    return hash.slice(0, 12) === version.toLowerCase();
  } catch { return false; }
  finally { reader.releaseLock(); }
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(cacheAppShell());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith("sautilink-shell-") && key !== CACHE_NAME)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

function safeNotificationRoute(value) {
  const route = String(value || "").trim();
  if (!route.startsWith("/") || route.startsWith("//")) return "/notifications";
  if (/^\/(?:notifications|home|settings)\/?(?:[?#].*)?$/.test(route)) return route;
  if (/^\/videos(?:\/[0-9a-f-]{36})?\/?(?:[?#].*)?$/i.test(route)) return route;
  if (/^\/appeals\/?(?:\?action=\d+)?$/.test(route)) return route;
  if (/^\/u\/[a-z0-9][a-z0-9._]{2,29}\/?(?:[?#].*)?$/i.test(route)) return route;
  if (/^\/post\/[0-9a-f-]{36}\/?(?:\?(?:view=post|from=notification))?$/i.test(route)) return route;
  if (/^\/messages(?:\/[0-9a-f-]{36})?\/?(?:[?#].*)?$/i.test(route)) return route;
  return "/notifications";
}

self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data?.json() || {}; } catch { payload = {}; }
  const title = String(payload.title || "SautiLink").slice(0, 80);
  const body = String(payload.body || "You have a new notification.").slice(0, 240);
  const route = safeNotificationRoute(payload.route);
  event.waitUntil(Promise.all([
    self.registration.showNotification(title, {
      body,
      icon: "/assets/icon-192.png",
      badge: "/assets/icon-192.png",
      tag: `sautilink-${String(payload.type || "update")}-${String(payload.source_id || "new")}`,
      data: { route },
    }),
    typeof self.navigator?.setAppBadge === "function"
      ? self.navigator.setAppBadge().catch(() => {})
      : Promise.resolve(),
  ]));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const route = safeNotificationRoute(event.notification.data?.route);
  const destination = new URL(route, self.location.origin);
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    let fallbackClient = null;
    for (const client of clients) {
      if (new URL(client.url).origin !== destination.origin) continue;
      if (client.url === destination.href) return client.focus();
      fallbackClient ||= client;
      if (typeof client.navigate !== "function") continue;
      const navigated = await client.navigate(destination.href).catch(() => null);
      if (navigated && navigated.url === destination.href) return navigated.focus();
    }
    const opened = await self.clients.openWindow(destination.href).catch(() => null);
    if (opened && opened.url === destination.href) return opened.focus();
    // Some installed browsers reuse the PWA window without navigating it.
    const target = opened || fallbackClient;
    if (target && new URL(target.url).origin === destination.origin) {
      target.postMessage({ type: "sautilink:notification-open", route });
      return target.focus();
    }
    return null;
  })());
});

// A share must stay on this device until the member reviews it in the composer.
function openShareInbox() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("sautilink-share-inbox", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("shares");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function receiveShare(request) {
  const tooLarge = Number(request.headers.get("content-length"));
  if (tooLarge > 110 * 1024 * 1024) return new Response("Shared media is too large.", { status: 413 });
  const form = await request.formData();
  const title = String(form.get("title") || "").trim();
  const text = String(form.get("text") || "").trim();
  const rawUrl = String(form.get("url") || "").trim();
  const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : "";
  const parts = [title, text, url].filter((part, index, values) => part && values.indexOf(part) === index);
  const body = parts.join("\n");
  const files = form.getAll("media").filter((file) => file && typeof file !== "string" && file.size > 0);
  const allowed = new Set(["image/jpeg", "image/png", "image/webp", "video/mp4"]);
  if (body.length > 500 || files.length > 4 || files.some((file) =>
    !allowed.has(file.type) || file.size > (file.type.startsWith("image/") ? 8 : 25) * 1024 * 1024)) {
    return new Response("This share exceeds SautiLink's post limits. Share a shorter text or a supported media file.", { status: 413 });
  }
  if (!body && !files.length) return new Response("Nothing to share.", { status: 400 });

  const id = crypto.randomUUID();
  const db = await openShareInbox();
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction("shares", "readwrite");
      transaction.objectStore("shares").put({ body, files, createdAt: Date.now() }, id);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
  return Response.redirect(new URL(`/compose?shared=${id}`, self.location.origin), 303);
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin === self.location.origin && url.pathname === "/share-target" && event.request.method === "POST") {
    event.respondWith(receiveShare(event.request).catch(() =>
      new Response("SautiLink could not save this share on your device. Please try again.", { status: 503 })));
    return;
  }
  if (event.request.method !== "GET" || url.pathname.startsWith("/api/")) return;

  if (event.request.mode === "navigate") {
    const socialRoute = /^(?:\/app(?:\/|$)|\/(?:login|signup|home|compose|discover|saved|appeals|moderation|settings|menu|notifications|dashboard)(?:\/|$)|\/(?:messages|videos)(?:\/|$)|\/(?:rooms|sautify)(?:\/|$)|\/u\/|\/post\/)/.test(url.pathname);
    const fallback = socialRoute ? "/app/" : "/";
    event.respondWith(fetch(event.request, { cache: "no-store" }).catch(() => caches.match(fallback)));
    return;
  }

  const isAppCodeAsset = url.pathname.startsWith("/app/assets/") && /\.(?:css|js)$/i.test(url.pathname);
  // Production v tokens identify the final bytes. Exact-URL reuse is safe across
  // accounts because this branch caches only public code, never API/media data.
  // Legacy version strings still revalidate below so deployments cannot strand UI.
  const immutableAppCodeAsset = url.origin === self.location.origin && isAppCodeAsset
    && url.searchParams.getAll("v").length === 1
    && /^[a-f0-9]{12}$/i.test(url.searchParams.get("v") || "");
  if (immutableAppCodeAsset) {
    let persistence = Promise.resolve();
    const responsePromise = (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(event.request);
      if (cached) return cached;
      const response = await fetch(event.request);
      // Deliver the network stream immediately. Hashing and disk persistence
      // use a clone and remain alive through the registered background task.
      const copy = response.clone();
      persistence = immutableCodeMatches(copy, url.searchParams.get("v")).then((matches) => {
        if (matches) return cache.put(event.request, copy);
        void copy.body?.cancel().catch(() => {});
      }).catch(() => {});
      return response;
    })();
    event.respondWith(responsePromise);
    event.waitUntil(responsePromise.then(() => persistence).catch(() => {}));
    return;
  }
  if (url.origin === self.location.origin && (
    CORE_ASSET_PATHS.has(url.pathname) ||
    isAppCodeAsset ||
    url.pathname.startsWith("/app/assets/verification/")
  )) {
    event.respondWith(
      fetch(event.request, { cache: "no-store" })
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
