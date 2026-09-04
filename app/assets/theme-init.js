(() => {
  const storageKey = 'sautilink.theme';
  const supported = new Set(['dark', 'light']);
  let theme = 'dark';

  try {
    const stored = localStorage.getItem(storageKey);
    if (supported.has(stored)) theme = stored;
    else if (window.matchMedia?.('(prefers-color-scheme: light)').matches) theme = 'light';
  } catch {
    // The dark fallback still provides a complete experience when storage is unavailable.
  }

  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute(
    'content',
    theme === 'light' ? '#ffffff' : '#0b0c0f',
  );
})();
