(function () {
    const searchInput = document.querySelector('[data-help-search]');
    if (!searchInput) return;

    const items = Array.from(document.querySelectorAll('[data-faq-item]'));
    const emptyState = document.querySelector('[data-faq-empty]');

    searchInput.addEventListener('input', function () {
        const query = searchInput.value.trim().toLowerCase();
        let visible = 0;

        items.forEach(function (item) {
            const matches = !query || item.textContent.toLowerCase().includes(query);
            item.hidden = !matches;
            if (matches) visible += 1;
        });

        if (emptyState) emptyState.hidden = visible !== 0;
    });
})();
