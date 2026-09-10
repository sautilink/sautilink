(() => {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;

  let deferredInstallPrompt = null;

  const isStandalone = () => (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );

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
    if (isStandalone() || !deferredInstallPrompt) return hideInstallButton();
    installButton.hidden = false;
  };

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