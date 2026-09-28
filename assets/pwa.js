(() => {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;

  const PWA_RELEASE = '20260928-pwa-share-camera1';
  const SERVICE_WORKER_URL = `/sw.js?v=${PWA_RELEASE}`;
  const HOME_PATH_PATTERN = /^\/home\/?$/;
  const ROUTE_CHANGE_EVENT = 'sautilink:routechange';
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type !== 'sautilink:notification-open') return;
    const workerUrl = event.source?.scriptURL;
    if (!workerUrl || new URL(workerUrl).origin !== location.origin || new URL(workerUrl).pathname !== '/sw.js') return;
    const route = String(event.data.route || '');
    if (!/^\/(?:post\/[0-9a-f-]{36}|messages(?:\/[0-9a-f-]{36})?|u\/[a-z0-9][a-z0-9._]{2,29}|videos(?:\/[0-9a-f-]{36})?|notifications|home|settings|appeals)(?:\/?(?:[?#].*)?)?$/i.test(route)) return;
    location.assign(new URL(route, location.origin).href);
  });
  let deferredInstallPrompt = null;

  const isStandalone = () => (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );

  const isHomeRoute = () => HOME_PATH_PATTERN.test(window.location.pathname);

  const installButton = document.createElement('button');
  installButton.type = 'button';
  installButton.className = 'sautilink-pwa-install';
  installButton.textContent = 'Install SautiLink';
  installButton.setAttribute('aria-label', 'Install SautiLink app');
  installButton.setAttribute('title', 'Install SautiLink');
  installButton.hidden = true;

  const installStyles = document.createElement('link');
  installStyles.rel = 'stylesheet';
  installStyles.href = '/assets/pwa-install.css';
  installStyles.dataset.pwaInstallStyle = '';
  document.head.append(installStyles);

  if (document.querySelector('.mobile-nav')) document.body.classList.add('sautilink-pwa-app-shell');
  document.body.append(installButton);

  const hideInstallButton = () => {
    installButton.hidden = true;
    installButton.disabled = false;
    installButton.textContent = 'Install SautiLink';
  };

  const showInstallButton = () => {
    if (!isHomeRoute() || isStandalone() || !deferredInstallPrompt) return hideInstallButton();
    installButton.hidden = false;
  };

  for (const methodName of ['pushState', 'replaceState']) {
    const nativeMethod = window.history[methodName].bind(window.history);
    window.history[methodName] = (...args) => {
      const result = nativeMethod(...args);
      window.dispatchEvent(new Event(ROUTE_CHANGE_EVENT));
      return result;
    };
  }

  window.addEventListener('popstate', showInstallButton);
  window.addEventListener(ROUTE_CHANGE_EVENT, showInstallButton);

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    showInstallButton();
  });

  installButton.addEventListener('click', async () => {
    if (!deferredInstallPrompt || isStandalone()) return hideInstallButton();

    const promptEvent = deferredInstallPrompt;
    deferredInstallPrompt = null;
    installButton.disabled = true;
    installButton.textContent = 'Opening install…';

    try {
      await promptEvent.prompt();
      await promptEvent.userChoice;
    } catch {
      // The browser keeps control of install availability; normal browsing must continue.
    } finally {
      hideInstallButton();
    }
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    hideInstallButton();
  });

  window.addEventListener('load', async () => {
    const registration = await navigator.serviceWorker.register(SERVICE_WORKER_URL, {
      scope: '/',
      updateViaCache: 'none',
    }).catch(() => null);
    if (!registration) {
      // PWA support is progressive enhancement; the web app must keep working
      // normally if service-worker registration is unavailable.
      return;
    }
    await registration.update().catch(() => {});
  }, { once: true });
})();
