const MOBILE_DRAWER_ID = 'sauti-mobile-more-drawer';
const MOBILE_DRAWER_TRIGGER_ID = 'sauti-mobile-more-trigger';
const MOBILE_DRAWER_STYLE_HREF = '/app/assets/mobile-more-drawer.css?v=20260907-drawer2';
const MOBILE_BREAKPOINT = 680;

const ICONS = Object.freeze({
  menu: '<path d="M4 7h16M4 12h12M4 17h16"></path>',
  close: '<path d="m6 6 12 12M18 6 6 18"></path>',
  bookmark: '<path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-4-6 4V4.5Z"></path>',
  appeals: '<path d="M12 3v18M5 7h14M7 7l-3 6h6L7 7ZM17 7l-3 6h6l-3-6ZM7 21h10"></path>',
  settings: '<circle cx="12" cy="12" r="3"></circle><path d="M19 13.5v-3l-2-.7a7.2 7.2 0 0 0-.7-1.7l.9-1.9-2.1-2.1-1.9.9a7.2 7.2 0 0 0-1.7-.7L10.5 2h-3l-.7 2a7.2 7.2 0 0 0-1.7.7l-1.9-.9-2.1 2.1.9 1.9a7.2 7.2 0 0 0-.7 1.7l-2 .7v3l2 .7a7.2 7.2 0 0 0 .7 1.7l-.9 1.9 2.1 2.1 1.9-.9a7.2 7.2 0 0 0 1.7.7l.7 2h3l.7-2a7.2 7.2 0 0 0 1.7-.7l1.9.9 2.1-2.1-.9-1.9a7.2 7.2 0 0 0 .7-1.7l2-.7Z"></path>',
  appearance: '<circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path>',
  help: '<circle cx="12" cy="12" r="9"></circle><path d="M9.8 9a2.4 2.4 0 1 1 3.7 2c-1 .7-1.5 1.2-1.5 2.3M12 17h.01"></path>',
  signout: '<path d="M10 5H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h5M14 8l4 4-4 4M8 12h10"></path>',
  chevron: '<path d="m9 6 6 6-6 6"></path>',
});

function icon(name, className = '') {
  return `<svg${className ? ` class="${className}"` : ''} viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

function ensureMobileDrawerStylesheet() {
  if (document.querySelector(`link[href="${MOBILE_DRAWER_STYLE_HREF}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = MOBILE_DRAWER_STYLE_HREF;
  document.head.append(link);
}

function canonicalViewButton(view) {
  return document.querySelector(`.app-nav [data-member-view="${view}"]`)
    || document.querySelector(`.mobile-nav [data-member-view="${view}"]`);
}

function canonicalThemeButton() {
  return document.querySelector('.mobile-header [data-theme-toggle]')
    || document.querySelector('[data-theme-toggle]');
}

function canonicalSignoutButton() {
  return document.getElementById('mobile-signout-button')
    || document.getElementById('signout-button');
}

function memberIsVisible() {
  const railAccount = document.getElementById('rail-account');
  const memberView = document.getElementById('member-view');
  return Boolean(railAccount && !railAccount.hidden && memberView && !memberView.hidden);
}

function replaceWithSafeClones(target, source) {
  if (!(target instanceof Element) || !(source instanceof Element)) return false;
  const clones = Array.from(source.childNodes, (node) => node.cloneNode(true));
  if (!clones.length) return false;
  target.replaceChildren(...clones);
  target.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
  return true;
}

function installMobileMoreDrawer() {
  if (document.getElementById(MOBILE_DRAWER_ID)) return;

  const headerActions = document.querySelector('.mobile-header-actions');
  const railAccount = document.getElementById('rail-account');
  const memberView = document.getElementById('member-view');
  if (!headerActions || !railAccount || !memberView) return;

  ensureMobileDrawerStylesheet();

  const trigger = document.createElement('button');
  trigger.id = MOBILE_DRAWER_TRIGGER_ID;
  trigger.className = 'sauti-mobile-more-trigger';
  trigger.type = 'button';
  trigger.hidden = true;
  trigger.setAttribute('aria-label', 'Open more menu');
  trigger.setAttribute('aria-controls', MOBILE_DRAWER_ID);
  trigger.setAttribute('aria-expanded', 'false');
  trigger.innerHTML = icon('menu');

  const themeButton = headerActions.querySelector('[data-theme-toggle]');
  headerActions.insertBefore(trigger, themeButton || null);

  const backdrop = document.createElement('button');
  backdrop.className = 'sauti-mobile-drawer-backdrop';
  backdrop.type = 'button';
  backdrop.hidden = true;
  backdrop.tabIndex = -1;
  backdrop.setAttribute('aria-label', 'Close more menu');

  const drawer = document.createElement('aside');
  drawer.id = MOBILE_DRAWER_ID;
  drawer.className = 'sauti-mobile-drawer';
  drawer.hidden = true;
  drawer.setAttribute('role', 'dialog');
  drawer.setAttribute('aria-modal', 'true');
  drawer.setAttribute('aria-label', 'More');
  drawer.innerHTML = `
    <div class="sauti-mobile-drawer-head">
      <strong>More</strong>
      <button class="sauti-mobile-drawer-close" type="button" aria-label="Close more menu">${icon('close')}</button>
    </div>
    <button class="sauti-mobile-drawer-profile" type="button" data-mobile-drawer-view="profile">
      <span class="sauti-mobile-drawer-avatar" aria-hidden="true">S</span>
      <span class="sauti-mobile-drawer-profile-copy">
        <strong>SautiLink member</strong>
        <small>@username</small>
        <em>View profile</em>
      </span>
      ${icon('chevron', 'sauti-mobile-drawer-chevron')}
    </button>
    <div class="sauti-mobile-drawer-divider" aria-hidden="true"></div>
    <nav class="sauti-mobile-drawer-nav" aria-label="More navigation">
      <button type="button" data-mobile-drawer-view="saved">${icon('bookmark')}<span><strong>Saved</strong><small>Posts you kept for later</small></span>${icon('chevron', 'sauti-mobile-drawer-chevron')}</button>
      <button type="button" data-mobile-drawer-view="appeals">${icon('appeals')}<span><strong>Appeals</strong><small>Review moderation decisions</small></span>${icon('chevron', 'sauti-mobile-drawer-chevron')}</button>
      <button type="button" data-mobile-drawer-view="settings">${icon('settings')}<span><strong>Settings &amp; privacy</strong><small>Account, privacy and safety controls</small></span>${icon('chevron', 'sauti-mobile-drawer-chevron')}</button>
      <button type="button" data-mobile-drawer-appearance>${icon('appearance')}<span><strong>Appearance</strong><small data-mobile-drawer-theme-label>System theme</small></span>${icon('chevron', 'sauti-mobile-drawer-chevron')}</button>
      <a href="/help">${icon('help')}<span><strong>Help &amp; support</strong><small>Get help with SautiLink</small></span>${icon('chevron', 'sauti-mobile-drawer-chevron')}</a>
    </nav>
    <div class="sauti-mobile-drawer-spacer"></div>
    <button class="sauti-mobile-drawer-signout" type="button" data-mobile-drawer-signout>${icon('signout')}<span>Log out</span></button>
    <footer class="sauti-mobile-drawer-footer">
      <a href="/privacy">Privacy</a><span aria-hidden="true">·</span><a href="/terms">Terms</a><span aria-hidden="true">·</span><a href="/about">About</a>
    </footer>`;

  document.body.append(backdrop, drawer);

  const closeButton = drawer.querySelector('.sauti-mobile-drawer-close');
  const drawerAvatar = drawer.querySelector('.sauti-mobile-drawer-avatar');
  const drawerName = drawer.querySelector('.sauti-mobile-drawer-profile-copy strong');
  const drawerUsername = drawer.querySelector('.sauti-mobile-drawer-profile-copy small');
  const themeLabel = drawer.querySelector('[data-mobile-drawer-theme-label]');
  let restoreFocus = null;
  let hideTimer = 0;

  function syncIdentity() {
    const sourceAvatar = document.getElementById('rail-avatar');
    const sourceName = document.getElementById('rail-name');
    const sourceUsername = document.getElementById('rail-username');

    if (!replaceWithSafeClones(drawerAvatar, sourceAvatar)) {
      drawerAvatar.textContent = (sourceName?.textContent || 'S').trim().slice(0, 2) || 'S';
    }
    drawerAvatar.classList.toggle('has-profile-photo', Boolean(sourceAvatar?.classList.contains('has-profile-photo')));

    if (!replaceWithSafeClones(drawerName, sourceName)) {
      drawerName.textContent = sourceName?.textContent?.trim() || 'SautiLink member';
    }
    drawerUsername.textContent = sourceUsername?.textContent?.trim() || '@username';
  }

  function syncThemeLabel() {
    const theme = document.documentElement.dataset.theme;
    themeLabel.textContent = theme === 'light' ? 'Light mode' : theme === 'dark' ? 'Dark mode' : 'System theme';
  }

  function syncAvailability() {
    const enabled = memberIsVisible() && window.innerWidth <= MOBILE_BREAKPOINT;
    document.documentElement.classList.toggle('sauti-mobile-drawer-enabled', enabled);
    trigger.hidden = !enabled;
    if (!enabled) closeDrawer(false);
  }

  function openDrawer() {
    if (!memberIsVisible() || window.innerWidth > MOBILE_BREAKPOINT) return;
    window.clearTimeout(hideTimer);
    syncIdentity();
    syncThemeLabel();
    restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : trigger;
    backdrop.hidden = false;
    drawer.hidden = false;
    document.documentElement.classList.add('sauti-mobile-drawer-open');
    trigger.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => {
      backdrop.classList.add('is-open');
      drawer.classList.add('is-open');
      closeButton?.focus({ preventScroll: true });
    });
  }

  function closeDrawer(restore = true) {
    if (drawer.hidden && backdrop.hidden) return;
    backdrop.classList.remove('is-open');
    drawer.classList.remove('is-open');
    document.documentElement.classList.remove('sauti-mobile-drawer-open');
    trigger.setAttribute('aria-expanded', 'false');
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => {
      drawer.hidden = true;
      backdrop.hidden = true;
    }, 210);
    if (restore && restoreFocus instanceof HTMLElement && restoreFocus.isConnected && !restoreFocus.hidden) {
      restoreFocus.focus({ preventScroll: true });
    }
  }

  function openCanonicalView(view) {
    const button = canonicalViewButton(view);
    if (!(button instanceof HTMLButtonElement) || button.hidden || button.disabled) return;
    closeDrawer(false);
    button.click();
  }

  trigger.addEventListener('click', openDrawer);
  closeButton?.addEventListener('click', () => closeDrawer());
  backdrop.addEventListener('click', () => closeDrawer());

  drawer.querySelectorAll('[data-mobile-drawer-view]').forEach((button) => {
    button.addEventListener('click', () => openCanonicalView(button.dataset.mobileDrawerView));
  });

  drawer.querySelector('[data-mobile-drawer-appearance]')?.addEventListener('click', () => {
    canonicalThemeButton()?.click();
    queueMicrotask(syncThemeLabel);
  });

  drawer.querySelector('[data-mobile-drawer-signout]')?.addEventListener('click', () => {
    const signout = canonicalSignoutButton();
    if (!(signout instanceof HTMLButtonElement) || signout.disabled) return;
    closeDrawer(false);
    signout.click();
  });

  drawer.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => closeDrawer(false)));

  drawer.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDrawer();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(drawer.querySelectorAll('button:not([disabled]), a[href]'))
      .filter((node) => !node.hidden && node.getClientRects().length > 0);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  new MutationObserver(() => {
    syncIdentity();
    syncAvailability();
  }).observe(railAccount, { attributes: true, childList: true, subtree: true, characterData: true });

  new MutationObserver(syncAvailability).observe(memberView, { attributes: true, attributeFilter: ['hidden'] });
  new MutationObserver(syncThemeLabel).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  window.addEventListener('resize', syncAvailability, { passive: true });

  syncIdentity();
  syncThemeLabel();
  syncAvailability();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installMobileMoreDrawer, { once: true });
} else {
  queueMicrotask(installMobileMoreDrawer);
}
