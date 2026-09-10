(() => {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', {
      scope: '/',
      updateViaCache: 'none',
    }).catch(() => {
      // PWA support is progressive enhancement; the web app must keep working
      // normally if service-worker registration is unavailable.
    });
  }, { once: true });
})();
