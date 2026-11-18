(() => {
  const PWA_RELEASE = '20261118-mobile-install1';
  const SERVICE_WORKER_URL = `/sw.js?v=${PWA_RELEASE}`;
  const HOME_PATH_PATTERN = /^\/home\/?$/;
  const ROUTE_CHANGE_EVENT = 'sautilink:routechange';
  navigator.serviceWorker?.addEventListener('message', (event) => {
    if (event.data?.type !== 'sautilink:notification-open') return;
    const workerUrl = event.source?.scriptURL;
    if (!workerUrl || new URL(workerUrl).origin !== location.origin || new URL(workerUrl).pathname !== '/sw.js') return;
    const route = String(event.data.route || '');
    if (!/^\/(?:post\/[0-9a-f-]{36}\/?(?:\?(?:view=post|from=notification))?|messages(?:\/[0-9a-f-]{36})?|u\/[a-z0-9][a-z0-9._]{2,29}|videos(?:\/[0-9a-f-]{36})?|notifications|home|settings|appeals)(?:\/?(?:[?#].*)?)?$/i.test(route)) return;
    location.assign(new URL(route, location.origin).href);
  });
  let deferredInstallPrompt = null;

  const isStandalone = () => (
    window.matchMedia('(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)').matches ||
    window.navigator.standalone === true ||
    window.Capacitor?.isNativePlatform?.() === true
  );

  const isHomeRoute = () => HOME_PATH_PATTERN.test(window.location.pathname);
  const mobileViewport = window.matchMedia('(max-width: 680px) and (any-pointer: coarse)');
  const platform = (() => {
    const { userAgent, userAgentData, maxTouchPoints } = navigator;
    if (/Android/i.test(userAgentData?.platform || userAgent)) return 'android';
    if (/iPhone|iPad|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1)) return 'ios';
    return '';
  })();
  const isMobile = () => Boolean(platform || mobileViewport.matches);
  const promptStorageKey = 'sautilink.mobile-install.dismissed-at';
  const reminderDelay = 7 * 24 * 60 * 60 * 1000;
  let mobilePrompt;
  let mobileTimer;
  let finishedMobileOffer = false;

  const installButton = document.createElement('button');
  installButton.type = 'button';
  installButton.className = 'sautilink-pwa-install';
  installButton.textContent = 'Install SautiLink';
  installButton.setAttribute('aria-label', 'Install SautiLink app');
  installButton.setAttribute('title', 'Install SautiLink');
  installButton.hidden = true;

  const installStyles = document.createElement('link');
  installStyles.rel = 'stylesheet';
  installStyles.href = `/assets/brand/pwa-install.css?v=${PWA_RELEASE}`;
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
    if (isMobile() || !isHomeRoute() || isStandalone() || !deferredInstallPrompt) return hideInstallButton();
    installButton.hidden = false;
  };

  const shouldOfferMobileInstall = () => {
    if (!isMobile() || isStandalone() || finishedMobileOffer || document.visibilityState !== 'visible') return false;
    const { pathname, search, hash } = location;
    const entryRoute = /^\/(?:home|app)?\/?$/.test(pathname);
    if (!entryRoute || search || hash) return false;
    if (document.querySelector('dialog[open], input:focus, textarea:focus, [contenteditable]:focus')) return false;
    if (document.body.classList.contains('auth-entry')) return false;
    try {
      const dismissedAt = Number(localStorage.getItem(promptStorageKey));
      if (dismissedAt > 0 && Date.now() - dismissedAt < reminderDelay) return false;
    } catch {
      // Private browsing still respects dismissal until this page is closed.
    }
    return true;
  };

  function rememberMobileOffer() {
    finishedMobileOffer = true;
    try { localStorage.setItem(promptStorageKey, String(Date.now())); } catch { /* Storage is optional. */ }
  }

  function createMobilePrompt() {
    const dialog = document.createElement('dialog');
    dialog.className = 'sautilink-mobile-install';
    dialog.setAttribute('aria-labelledby', 'sautilink-mobile-install-title');
    dialog.setAttribute('aria-describedby', 'sautilink-mobile-install-copy');
    dialog.innerHTML = `
      <button type="button" class="mobile-install-close" aria-label="Close" autofocus>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
      </button>
      <img class="mobile-install-mark" src="/assets/brand/sautilink-wordmark-white.png" alt="SautiLink" width="126" height="38">
      <h2 id="sautilink-mobile-install-title">Take SautiLink with you</h2>
      <p id="sautilink-mobile-install-copy"></p>
      <div class="mobile-install-actions">
        <a class="mobile-install-android" href="https://play.google.com/store/apps/details?id=com.sautilink.app">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4.7 20 12 5 19.3z"/></svg>
          Download for Android
        </a>
        <button type="button" class="mobile-install-ios" aria-expanded="false" aria-controls="sautilink-ios-install-steps">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-2M12 15V3m-4 4 4-4 4 4"/></svg>
          Get for iOS
        </button>
      </div>
      <div id="sautilink-ios-install-steps" class="mobile-install-steps" hidden>
        <ol>
          <li>Open <strong>sautilink.com</strong> in Safari and tap <strong>Share</strong>.</li>
          <li>Choose <strong>Add to Home Screen</strong>.</li>
          <li>Enable <strong>Open as Web App</strong> if shown, then tap <strong>Add</strong>.</li>
        </ol>
      </div>
      <button type="button" class="mobile-install-later">Continue on web</button>
    `;
    dialog.dataset.platform = platform || 'mobile';
    dialog.querySelector('#sautilink-mobile-install-copy').textContent = {
      android: 'Download SautiLink from Google Play for your Android device.',
      ios: 'Install SautiLink on your iPhone or iPad Home Screen.',
    }[platform] || 'Get the SautiLink app on your phone or tablet.';
    const ios = dialog.querySelector('.mobile-install-ios');
    const steps = dialog.querySelector('.mobile-install-steps');
    if (platform === 'ios') ios.parentElement.prepend(ios);
    ios.addEventListener('click', () => {
      steps.hidden = !steps.hidden;
      ios.setAttribute('aria-expanded', String(!steps.hidden));
      if (!steps.hidden) steps.scrollIntoView({ block: 'nearest' });
    });
    dialog.querySelector('.mobile-install-android').addEventListener('click', () => {
      rememberMobileOffer();
      dialog.close();
    });
    dialog.querySelector('.mobile-install-close').addEventListener('click', () => dialog.close());
    dialog.querySelector('.mobile-install-later').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', rememberMobileOffer);
    document.body.append(dialog);
    return dialog;
  }

  function updateInstallOffer() {
    showInstallButton();
    window.clearTimeout(mobileTimer);
    if (mobilePrompt?.open && (isStandalone() || !isMobile())) mobilePrompt.close();
    if (mobilePrompt?.open || !shouldOfferMobileInstall()) return;
    mobileTimer = window.setTimeout(() => {
      if (!shouldOfferMobileInstall()) return;
      mobilePrompt ||= createMobilePrompt();
      mobilePrompt.showModal?.();
    }, 1700);
  }

  for (const methodName of ['pushState', 'replaceState']) {
    const nativeMethod = window.history[methodName].bind(window.history);
    window.history[methodName] = (...args) => {
      const result = nativeMethod(...args);
      window.dispatchEvent(new Event(ROUTE_CHANGE_EVENT));
      return result;
    };
  }

  window.addEventListener('popstate', updateInstallOffer);
  window.addEventListener(ROUTE_CHANGE_EVENT, updateInstallOffer);
  document.addEventListener('visibilitychange', updateInstallOffer);
  mobileViewport.addEventListener?.('change', updateInstallOffer);
  installStyles.addEventListener('load', updateInstallOffer, { once: true });

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
    rememberMobileOffer();
    if (mobilePrompt?.open) mobilePrompt.close();
    hideInstallButton();
  });

  window.addEventListener('load', async () => {
    updateInstallOffer();
    if (!navigator.serviceWorker || !window.isSecureContext) return;
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
