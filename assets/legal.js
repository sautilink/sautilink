(function () {
    const root = document.documentElement;
    const themeButton = document.querySelector('[data-theme-toggle]');
    const menuButton = document.querySelector('[data-menu-toggle]');
    const navCluster = document.querySelector('[data-nav-cluster]');
    const yearNode = document.querySelector('[data-current-year]');

    document.querySelectorAll('.eyebrow, .section-label, .section-kicker').forEach(function (label) {
        label.remove();
    });

    function preferredTheme() {
        try {
            const saved = localStorage.getItem('theme');
            if (saved === 'light' || saved === 'dark') return saved;
        } catch (_) {
            // Reading a public document must also work when storage is blocked.
        }
        return 'light';
    }

    function applyTheme(theme) {
        root.dataset.theme = theme;
        try { localStorage.setItem('theme', theme); } catch (_) { /* Session-only choice. */ }
        const themeColor = document.querySelector('meta[name="theme-color"]');
        if (themeColor && document.body.hasAttribute('data-public-design')) {
            themeColor.setAttribute('content', theme === 'light' ? '#ffffff' : '#0b0b0e');
        }
        if (themeButton) {
            themeButton.setAttribute('aria-pressed', String(theme === 'light'));
            themeButton.setAttribute('aria-label', theme === 'light' ? 'Use dark theme' : 'Use light theme');
        }
    }

    applyTheme(preferredTheme());

    if (themeButton) {
        themeButton.hidden = false;
        themeButton.addEventListener('click', function () {
            applyTheme(root.dataset.theme === 'light' ? 'dark' : 'light');
        });
    }

    if (menuButton && navCluster) {
        menuButton.hidden = false;
        function setMenuOpen(open, restoreFocus) {
            navCluster.classList.toggle('open', open);
            menuButton.setAttribute('aria-expanded', String(open));
            menuButton.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
            if (open) {
                const firstLink = navCluster.querySelector('a');
                if (firstLink) firstLink.focus();
            }
            if (restoreFocus) menuButton.focus();
        }

        menuButton.addEventListener('click', function () {
            setMenuOpen(!navCluster.classList.contains('open'));
        });

        navCluster.addEventListener('click', function (event) {
            if (event.target.closest('a')) {
                setMenuOpen(false);
            }
        });

        document.addEventListener('click', function (event) {
            if (!navCluster.contains(event.target) && !menuButton.contains(event.target)) {
                setMenuOpen(false);
            }
        });

        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && navCluster.classList.contains('open')) {
                setMenuOpen(false, true);
            }
        });

        document.addEventListener('focusin', function (event) {
            if (!navCluster.contains(event.target) && !menuButton.contains(event.target)) setMenuOpen(false);
        });
    }

    const tocLinks = Array.from(document.querySelectorAll('[data-toc-link]'));
    const sections = tocLinks
        .map(function (link) {
            return document.getElementById(link.getAttribute('href').slice(1));
        })
        .filter(Boolean);

    function setActiveSection(id) {
        tocLinks.forEach(function (link) {
            const active = link.getAttribute('href') === '#' + id;
            link.classList.toggle('active', active);
            if (active) link.setAttribute('aria-current', 'location');
            else link.removeAttribute('aria-current');
        });
    }

    const disclosure = document.querySelector('[data-toc-disclosure]');
    if (disclosure && window.matchMedia) {
        const mobile = window.matchMedia('(max-width: 840px)');
        const summary = disclosure.querySelector('summary');
        function syncContents() {
            disclosure.open = !mobile.matches;
            if (summary) summary.tabIndex = mobile.matches ? 0 : -1;
        }
        syncContents();
        if (mobile.addEventListener) mobile.addEventListener('change', syncContents);
        tocLinks.forEach(function (link) {
            link.addEventListener('click', function () {
                const sectionId = link.getAttribute('href').slice(1);
                setActiveSection(sectionId);
                if (mobile.matches) disclosure.open = false;
                const target = document.getElementById(sectionId);
                if (target) target.focus({ preventScroll: true });
            });
        });
    }

    if ('IntersectionObserver' in window && sections.length) {
        const observer = new IntersectionObserver(function (entries) {
            const visible = entries
                .filter(function (entry) { return entry.isIntersecting; })
                .sort(function (a, b) { return a.boundingClientRect.top - b.boundingClientRect.top; });

            if (!visible.length) return;
            setActiveSection(visible[0].target.id);
        }, { rootMargin: '-18% 0px -68% 0px', threshold: [0, 0.1, 0.4] });

        sections.forEach(function (section) { observer.observe(section); });
    }

    // Printing remains optional; the complete document is present without JavaScript.
    document.querySelectorAll('[data-print-document]').forEach(function (button) {
        button.hidden = false;
        button.addEventListener('click', function () { window.print(); });
    });

    if (yearNode) yearNode.textContent = String(new Date().getFullYear());
})();
