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
})();
