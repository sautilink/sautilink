/* Apply a saved choice before the first paint; an unavailable store is harmless. */
(function () {
    try {
        const saved = localStorage.getItem('theme');
        if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved;
    } catch (_) {
        // The document already defaults to light when storage is unavailable.
    }
})();
