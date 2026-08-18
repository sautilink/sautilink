(function () {
    const root = document.documentElement;
    const themeButton = document.querySelector('[data-theme-toggle]');
    const menuButton = document.querySelector('[data-menu-toggle]');
    const navCluster = document.querySelector('[data-nav-cluster]');
    const yearNode = document.querySelector('[data-current-year]');

    function preferredTheme() {
        const saved = localStorage.getItem('theme');
        if (saved === 'light' || saved === 'dark') return saved;
        return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }

    function applyTheme(theme) {
        root.dataset.theme = theme;
        localStorage.setItem('theme', theme);
        if (themeButton) {
            themeButton.setAttribute('aria-pressed', String(theme === 'light'));
            themeButton.setAttribute('aria-label', theme === 'light' ? 'Use dark theme' : 'Use light theme');
        }
    }

    applyTheme(preferredTheme());

    if (themeButton) {
        themeButton.addEventListener('click', function () {
            applyTheme(root.dataset.theme === 'light' ? 'dark' : 'light');
        });
    }

    if (menuButton && navCluster) {
        menuButton.addEventListener('click', function () {
            const open = navCluster.classList.toggle('open');
            menuButton.setAttribute('aria-expanded', String(open));
        });

        navCluster.addEventListener('click', function (event) {
            if (event.target.closest('a')) {
                navCluster.classList.remove('open');
                menuButton.setAttribute('aria-expanded', 'false');
            }
        });

        document.addEventListener('click', function (event) {
            if (!navCluster.contains(event.target) && !menuButton.contains(event.target)) {
                navCluster.classList.remove('open');
                menuButton.setAttribute('aria-expanded', 'false');
            }
        });
    }

    const tocLinks = Array.from(document.querySelectorAll('[data-toc-link]'));
    const sections = tocLinks
        .map(function (link) {
            return document.querySelector(link.getAttribute('href'));
        })
        .filter(Boolean);

    if ('IntersectionObserver' in window && sections.length) {
        const observer = new IntersectionObserver(function (entries) {
            const visible = entries
                .filter(function (entry) { return entry.isIntersecting; })
                .sort(function (a, b) { return a.boundingClientRect.top - b.boundingClientRect.top; });

            if (!visible.length) return;
            const activeId = '#' + visible[0].target.id;
            tocLinks.forEach(function (link) {
                link.classList.toggle('active', link.getAttribute('href') === activeId);
            });
        }, { rootMargin: '-18% 0px -68% 0px', threshold: [0, 0.1, 0.4] });

        sections.forEach(function (section) { observer.observe(section); });
    }

    if (yearNode) yearNode.textContent = String(new Date().getFullYear());
})();
