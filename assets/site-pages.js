(function () {
    const searchInput = document.querySelector('[data-help-search]');
    if (!searchInput) return;
    searchInput.disabled = false;

    const items = Array.from(document.querySelectorAll('[data-faq-item]'));
    const emptyState = document.querySelector('[data-faq-empty]');
    const resultCount = document.querySelector('[data-faq-count]');
    const clearButton = document.querySelector('[data-faq-clear]');
    let searching = false;
    let previouslyOpen = new Set();

    function normalized(value) {
        return value.toLowerCase().replace(/\s+/g, ' ').trim();
    }

    // Index questions and answers once. Multi-word queries need not match word order.
    const indexedItems = items.map(function (item) {
        return { item: item, text: normalized(item.textContent) };
    });

    function filterAnswers() {
        const query = normalized(searchInput.value);
        const terms = query ? query.split(' ') : [];
        if (query && !searching) {
            previouslyOpen = new Set(items.filter(function (item) { return item.open; }));
        }
        let visible = 0;

        indexedItems.forEach(function (entry) {
            const item = entry.item;
            const matches = terms.every(function (term) { return entry.text.includes(term); });
            item.hidden = !matches;
            if (query) item.open = matches;
            else if (searching) item.open = previouslyOpen.has(item);
            if (matches) visible += 1;
        });

        searching = Boolean(query);
        if (emptyState) emptyState.hidden = visible !== 0;
        if (clearButton) clearButton.hidden = searchInput.value.length === 0;
        if (resultCount) {
            resultCount.textContent = visible + (visible === 1 ? ' answer' : ' answers') +
                (query ? ' for “' + searchInput.value.trim() + '”' : ' to help you get started');
        }
    }

    function clearSearch() {
        searchInput.value = '';
        filterAnswers();
    }

    function revealAnswer(hash) {
        let id;
        try { id = decodeURIComponent(hash.slice(1)); } catch (_) { return; }
        const target = document.getElementById(id);
        if (!target || !items.includes(target)) return;
        clearSearch();
        target.open = true;
        // Wait for the expanded details and cleared filter to take their final positions.
        window.requestAnimationFrame(function () { target.scrollIntoView({ block: 'start' }); });
    }

    searchInput.addEventListener('input', filterAnswers);
    searchInput.addEventListener('search', filterAnswers);
    searchInput.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && searchInput.value) {
            event.preventDefault();
            clearSearch();
        }
    });
    if (clearButton) clearButton.addEventListener('click', function () {
        clearSearch();
        searchInput.focus();
    });

    document.addEventListener('click', function (event) {
        const link = event.target.closest('a[href^="#"]');
        if (link) revealAnswer(link.getAttribute('href'));
    });
    window.addEventListener('hashchange', function () { revealAnswer(window.location.hash); });
    filterAnswers();
    revealAnswer(window.location.hash);
})();
