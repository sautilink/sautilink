(() => {
  const storageKey = 'sautilink.theme';
  const supported = new Set(['dark', 'light']);
  let theme = 'light';

  try {
    const stored = localStorage.getItem(storageKey);
    if (supported.has(stored)) theme = stored;
  } catch {
    // The light fallback still provides a complete experience when storage is unavailable.
  }

  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute(
    'content',
    theme === 'light' ? '#ffffff' : '#0b0c0f',
  );

  let nativeDetectionAttempts = 0;
  const enableAndroidNativeMode = () => {
    const platform = globalThis.Capacitor?.getPlatform?.();
    if (platform === 'android') {
      document.documentElement.classList.add('native-android');
      if (!document.querySelector('link[data-sautilink-native-android]')) {
        const stylesheet = document.createElement('link');
        stylesheet.rel = 'stylesheet';
        stylesheet.href = '/app/assets/app-native-android.css?v=20260913-perf1';
        stylesheet.dataset.sautilinkNativeAndroid = '';
        document.head.append(stylesheet);
      }
      return;
    }

    nativeDetectionAttempts += 1;
    if (nativeDetectionAttempts < 8) window.setTimeout(enableAndroidNativeMode, 40);
  };

  enableAndroidNativeMode();
})();
