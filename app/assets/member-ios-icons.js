/* Member-only SVG correction. No application state, storage or network access.
 * Settings geometry: https://github.com/lucide-icons/lucide/blob/main/icons/settings.svg
 * Copyright (c) Lucide Contributors. ISC License:
 * Permission to use, copy, modify, and/or distribute this software for any purpose
 * with or without fee is hereby granted, provided that the above copyright notice
 * and this permission notice appear in all copies.
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
 * REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
 * AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
 * INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
 * LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
 * OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
 * PERFORMANCE OF THIS SOFTWARE.
 */
(() => {
  'use strict';

  const settingsOutline = 'M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915';
  const settingsSelectors = [
    '.primary-rail .app-nav > .nav-item[data-member-view="settings"] > svg',
    '.sauti-mobile-drawer-settings-toggle > svg:first-child',
  ];

  function install() {
    const member = document.getElementById('member-view');
    if (!member) return;

    let observer;
    function finish() {
      observer?.disconnect();
      document.removeEventListener('click', onDrawerOpen, true);
    }

    function polish() {
      if (member.hidden || document.body.classList.contains('auth-entry')) return;
      let updated = 0;
      for (const selector of settingsSelectors) {
        const svg = document.querySelector(selector);
        const outline = svg?.querySelector('path');
        if (!outline) continue;
        if (outline.getAttribute('d') !== settingsOutline) {
          outline.setAttribute('d', settingsOutline);
        }
        updated += 1;
      }
      if (updated === settingsSelectors.length) finish();
    }

    function onDrawerOpen(event) {
      if (event.target instanceof Element && event.target.closest('.sauti-mobile-more-trigger')) polish();
    }

    // Observe only membership visibility; post rendering never triggers this helper.
    observer = new MutationObserver(polish);
    observer.observe(member, { attributes: true, attributeFilter: ['hidden'] });
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    document.addEventListener('click', onDrawerOpen, true);
    polish();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})();
