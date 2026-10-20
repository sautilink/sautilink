const MOBILE_DRAWER_ID = 'sauti-mobile-more-drawer';
const MOBILE_DRAWER_TRIGGER_ID = 'sauti-mobile-more-trigger';
const MOBILE_DRAWER_STYLE_ID = 'sautilink-mobile-more-drawer-style';
const MOBILE_DRAWER_STYLE_HREF = '/app/assets/mobile-more-drawer.css?v=20260921-sidebar-systems1';
const MOBILE_BREAKPOINT = 680;

const ICONS = Object.freeze({
  menu: '<path d="M4 7h16M4 12h12M4 17h16"></path>',
  close: '<path d="m6 6 12 12M18 6 6 18"></path>',
  bookmark: '<path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-4-6 4V4.5Z"></path>',
  appeals: '<path d="M12 3v18M5 7h14M7 7l-3 6h6L7 7ZM17 7l-3 6h6l-3-6ZM7 21h10"></path>',
  settings: '<circle cx="12" cy="12" r="3"></circle><path d="M19 13.5v-3l-2-.7a7.2 7.2 0 0 0-.7-1.7l.9-1.9-2.1-2.1-1.9.9a7.2 7.2 0 0 0-1.7-.7L10.5 2h-3l-.7 2a7.2 7.2 0 0 0-1.7.7l-1.9-.9-2.1 2.1.9 1.9a7.2 7.2 0 0 0-.7 1.7l-2 .7v3l2 .7a7.2 7.2 0 0 0 .7 1.7l-.9 1.9 2.1 2.1 1.9-.9a7.2 7.2 0 0 0 1.7.7l.7 2h3l.7-2a7.2 7.2 0 0 0 1.7-.7l1.9.9 2.1-2.1-.9-1.9a7.2 7.2 0 0 0 .7-1.7l2-.7Z"></path>',
  account: '<circle cx="12" cy="8" r="4"></circle><path d="M4.5 21c.7-4.2 3.2-6.5 7.5-6.5s6.8 2.3 7.5 6.5"></path>',
  privacy: '<rect x="5" y="10" width="14" height="11" rx="2"></rect><path d="M8 10V7a4 4 0 0 1 8 0v3"></path>',
  notifications: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"></path><path d="M10 21h4"></path>',
  safety: '<path d="M12 3 4.5 6v5.5c0 4.6 3 7.8 7.5 9.5 4.5-1.7 7.5-4.9 7.5-9.5V6L12 3Z"></path><path d="m8.5 12 2.2 2.2 4.8-5"></path>',
  verification: '<path d="M12 3 4.5 6v5.5c0 4.6 3 7.8 7.5 9.5 4.5-1.7 7.5-4.9 7.5-9.5V6L12 3Z"></path><path d="m8.7 12.2 2.1 2.1 4.6-4.8"></path>',
  memberShield: '<path d="M12 3 5.5 5.7v5.5c0 4.2 2.7 7.2 6.5 8.8 3.8-1.6 6.5-4.6 6.5-8.8V5.7L12 3Z"></path><circle cx="12" cy="10" r="2"></circle><path d="M8.8 15.5c.9-1.5 2-2.2 3.2-2.2s2.3.7 3.2 2.2"></path>',
  data: '<path d="M12 3v12"></path><path d="m7 10 5 5 5-5"></path><path d="M5 20h14"></path>',
  appearance: '<circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path>',
  help: '<circle cx="12" cy="12" r="9"></circle><path d="M9.8 9a2.4 2.4 0 1 1 3.7 2c-1 .7-1.5 1.2-1.5 2.3M12 17h.01"></path>',
  terms: '<path d="M6 3.5h8l4 4v13H6Z"></path><path d="M14 3.5v4h4M9 12h6M9 15.5h6"></path>',
  contact: '<path d="M4 5.5h16v13H4Z"></path><path d="m4 7 8 6 8-6"></path>',
  cloud: '<path d="M7.2 18.5h9.9a4 4 0 0 0 .6-8A6 6 0 0 0 6.3 9.2a4.7 4.7 0 0 0 .9 9.3Z"></path>',
  router: '<rect x="3.5" y="11" width="17" height="8" rx="2"></rect><path d="M7 15h.01M11 15h.01M8 8.2a6 6 0 0 1 8 0M10.4 9.8a2.5 2.5 0 0 1 3.2 0"></path>',
  signout: '<path d="M10 5H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h5M14 8l4 4-4 4M8 12h10"></path>',
  chevron: '<path d="m9 6 6 6-6 6"></path>',
  chevronDown: '<path d="m6 9 6 6 6-6"></path>',
  rooms: '<circle cx="9" cy="9" r="3"></circle><circle cx="17" cy="10" r="2.5"></circle><path d="M3.5 20c.5-4 2.3-6 5.5-6s5 2 5.5 6M14 15c3.4-.7 5.5.9 6 4"></path>',
  language: '<circle cx="12" cy="12" r="9"></circle><path d="M3 12h18M12 3c5 5 5 13 0 18M12 3c-5 5-5 13 0 18"></path>',
  back: '<path d="M19 12H5M11 6l-6 6 6 6"></path>',
});

const MENU_ICON_NAMES = Object.freeze({
  menu: 'menu-0-1', close: 'cancel-0-1', bookmark: 'bookmark', appeals: 'sautilink:justice-scale',
  settings: 'settings-0-1', account: 'user', privacy: 'lock-keyhole', notifications: 'notification',
  safety: 'shield-check', verification: 'id-verified', memberShield: 'shield-check', data: 'download',
  appearance: 'moon-0-1', help: 'help-circle', terms: 'file-0-1', contact: 'mail-0-1',
  cloud: 'lucide:cloud', router: 'lucide:router', signout: 'logout-0-1',
  chevron: 'chevron-right', chevronDown: 'chevron-down', rooms: 'user-group',
  language: 'globe-0-2', back: 'arrow-left-0-2',
});

function icon(name, className = '') {
  return `<svg${className ? ` class="${className}"` : ''} data-sl-icon-name="${MENU_ICON_NAMES[name] || 'help-circle'}" viewBox="0 0 24 24" width="24" height="24" focusable="false" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

function ensureMobileDrawerStylesheet() {
  if (!document.getElementById(MOBILE_DRAWER_STYLE_ID)) {
    const link = document.createElement('link');
    link.id = MOBILE_DRAWER_STYLE_ID;
    link.rel = 'stylesheet';
    link.href = MOBILE_DRAWER_STYLE_HREF;
    document.head.append(link);
  }
  if (!document.querySelector('link[data-menu-native-style]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/app/assets/menu-native.css?v=20261020-native1';
    link.dataset.menuNativeStyle = 'true';
    document.head.append(link);
  }
}

function menuHeading(label, iconName = 'rooms') {
  const heading = document.createElement('h2');
  heading.className = 'menu-native-section-heading';
  heading.innerHTML = icon(iconName);
  heading.append(document.createTextNode(label));
  return heading;
}

function decorateMenuTile(control) {
  control.classList.add('menu-native-tile');
  const graphic = control.querySelector(':scope > svg');
  if (graphic?.dataset.slHugeIcon && !graphic.dataset.slIconName) {
    graphic.dataset.slIconName = graphic.dataset.slHugeIcon;
  }
  const key = control.dataset.memberView || control.dataset.mobileDrawerView
    || control.dataset.mobileDrawerSettingsSection || control.dataset.menuNativeAction
    || (control.hasAttribute('data-mobile-drawer-verification') ? 'verification' : '')
    || (control.hasAttribute('data-mobile-drawer-appearance') ? 'theme' : '');
  const href = control.getAttribute('href') || '';
  const tone = /saved|settings|theme/.test(key) || control.hasAttribute('data-mobile-drawer-settings-toggle') ? 'purple'
    : /privacy|safety|verification/.test(key) || /community-guidelines|privacy/.test(href) ? 'green'
      : /help|contact/.test(href) ? 'orange' : 'blue';
  control.dataset.menuTone = tone;
}

function menuExtraButton(label, iconName, action, section = '') {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.menuNativeAction = action;
  if (section) button.dataset.menuNativeSection = section;
  button.innerHTML = icon(iconName);
  const caption = document.createElement('span');
  caption.textContent = label;
  button.append(caption);
  decorateMenuTile(button);
  return button;
}

/** Reuse the real sidebar clone: its data attributes, links and permission gates
 * remain owned by app.js. Only move those same controls into native-style cards. */
function enhanceNativeMenuClone(rail) {
  if (!rail || rail.dataset.nativeMenuReady === 'true') return;
  rail.dataset.nativeMenuReady = 'true';
  rail.classList.add('menu-native-page');
  const profile = rail.querySelector('[data-member-view="profile"]');
  const avatar = rail.querySelector('[data-menu-source-id="rail-avatar"]');
  const identity = rail.querySelector('.rail-account-copy');
  const signout = rail.querySelector('[data-menu-source-id="signout-button"]');
  const products = Array.from(rail.querySelectorAll('.primary-rail-systems .nav-item'));
  const controls = Array.from(rail.querySelectorAll('.nav-item, [data-open-sauti-composer]'))
    .filter((control) => control !== profile && !products.includes(control));
  if (profile && avatar && identity) {
    profile.classList.add('menu-native-profile');
    const chevron = document.createElement('span');
    chevron.className = 'menu-native-profile-chevron';
    chevron.innerHTML = icon('chevron');
    profile.replaceChildren(avatar, identity, chevron);
    profile.setAttribute('aria-label', 'View your profile');
  }
  const grid = document.createElement('nav');
  grid.className = 'menu-native-grid';
  grid.setAttribute('aria-label', 'Discover and manage');
  controls.forEach((control) => { decorateMenuTile(control); grid.append(control); });
  grid.append(
    menuExtraButton('Verification', 'verification', 'verification'),
    menuExtraButton('Privacy', 'privacy', 'settings', 'privacy'),
    menuExtraButton('Language', 'language', 'settings', 'language'),
    menuExtraButton('Theme', 'appearance', 'theme'),
  );
  for (const [label, href, iconName] of [['Help & support', '/help', 'help'], ['About SautiLink', '/about', 'help'], ['Privacy policy', '/privacy', 'privacy']]) {
    const link = document.createElement('a');
    link.href = href;
    link.innerHTML = icon(iconName);
    const caption = document.createElement('span');
    caption.textContent = label;
    link.append(caption);
    decorateMenuTile(link);
    grid.append(link);
  }
  const productGrid = document.createElement('nav');
  productGrid.className = 'menu-native-grid menu-native-products';
  productGrid.setAttribute('aria-label', 'Other SautiLink Products');
  products.forEach((control) => {
    if (control.getAttribute('href')?.startsWith('https://router.sautilink.com')) {
      const label = control.querySelector('span');
      if (label) label.textContent = 'Router Setup';
    }
    decorateMenuTile(control);
    productGrid.append(control);
  });
  if (signout) {
    signout.classList.add('menu-native-signout');
    const caption = document.createElement('span');
    caption.textContent = 'Log out';
    signout.append(caption);
  }
  const content = [profile, menuHeading('Discover and manage'), grid];
  if (products.length) content.push(menuHeading('Other SautiLink Products', 'cloud'), productGrid);
  if (signout) content.push(signout);
  rail.replaceChildren(...content.filter(Boolean));
}

function canonicalViewButton(view) {
  return document.querySelector(`.app-nav [data-member-view="${view}"]`)
    || document.querySelector(`.mobile-nav [data-member-view="${view}"]`);
}

function canonicalSettingsSectionButton(section) {
  return document.querySelector(`#settings-surface [data-settings-section="${section}"]`);
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

function memberVerificationBadge() {
  return document.querySelector('#rail-name .verification-badge');
}

function memberIsVerified() {
  return memberVerificationBadge() instanceof Element;
}

function installMobileMoreDrawer() {
  if (document.getElementById(MOBILE_DRAWER_ID)) return;

  const headerActions = document.querySelector('.mobile-header-actions');
  const railAccount = document.getElementById('rail-account');
  const memberView = document.getElementById('member-view');
  if (!headerActions || !railAccount || !memberView) return;

  ensureMobileDrawerStylesheet();

  let trigger = document.getElementById(MOBILE_DRAWER_TRIGGER_ID);
  if (!(trigger instanceof HTMLButtonElement)) {
    trigger = document.createElement('button');
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
  }

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
  drawer.setAttribute('aria-label', 'Menu');
  drawer.innerHTML = `
    <div class="sauti-mobile-drawer-head">
      <button class="sauti-mobile-drawer-back" type="button" aria-label="Back">${icon('back')}</button>
      <strong>Menu</strong>
      <button class="sauti-mobile-drawer-close" type="button" aria-label="Close more menu">${icon('close')}</button>
    </div>
    <button class="sauti-mobile-drawer-profile" type="button" data-mobile-drawer-view="profile" aria-label="View profile">
      <span class="sauti-mobile-drawer-avatar" aria-hidden="true">S</span>
      <span class="sauti-mobile-drawer-profile-copy">
        <strong>SautiLink member</strong>
        <small>@username</small>
        <span class="sauti-mobile-drawer-member-status" data-mobile-drawer-member-status>
          <span class="sauti-mobile-drawer-member-icon" data-mobile-drawer-member-icon>${icon('memberShield')}</span>
          <span data-mobile-drawer-member-label>SautiLinker</span>
        </span>
      </span>
    </button>
    <h2 class="menu-native-section-heading">${icon('rooms')}Discover and manage</h2>
    <nav class="sauti-mobile-drawer-nav" aria-label="Discover and manage">
      <button type="button" data-mobile-drawer-view="circles">${icon('rooms')}<span><strong>Rooms</strong><small>Find your communities</small></span></button>
      <button type="button" data-mobile-drawer-view="saved">${icon('bookmark')}<span><strong>Saved</strong><small>Posts you kept for later</small></span>${icon('chevron', 'sauti-mobile-drawer-chevron')}</button>
      <button type="button" data-mobile-drawer-view="notifications">${icon('notifications')}<span><strong>Notifications</strong><small>Activity and updates</small></span></button>
      <button type="button" data-mobile-drawer-view="moderation" hidden>${icon('safety')}<span><strong>Moderation</strong><small>Review platform reports</small></span></button>
      <button type="button" data-mobile-drawer-view="appeals">${icon('appeals')}<span><strong>Appeals</strong><small>Review moderation decisions</small></span>${icon('chevron', 'sauti-mobile-drawer-chevron')}</button>
      <div class="sauti-mobile-drawer-settings-group">
        <button class="sauti-mobile-drawer-settings-toggle" type="button" data-mobile-drawer-settings-toggle aria-expanded="false" aria-controls="sauti-mobile-drawer-settings-panel">
          ${icon('settings')}<span><strong>Settings</strong><small>Account, privacy and safety controls</small></span>${icon('chevronDown', 'sauti-mobile-drawer-settings-chevron')}
        </button>
        <div class="sauti-mobile-drawer-settings-panel" id="sauti-mobile-drawer-settings-panel" role="group" aria-label="Settings sections" hidden>
          <button type="button" data-mobile-drawer-settings-section="account">${icon('account')}<span><strong>Account</strong><small>Profile, email and account security</small></span>${icon('chevron', 'sauti-mobile-drawer-chevron')}</button>
          <button type="button" data-mobile-drawer-settings-section="privacy">${icon('privacy')}<span><strong>Privacy</strong><small>Audience and messaging controls</small></span>${icon('chevron', 'sauti-mobile-drawer-chevron')}</button>
          <button type="button" data-mobile-drawer-settings-section="notifications">${icon('notifications')}<span><strong>Notifications</strong><small>Choose the alerts you receive</small></span>${icon('chevron', 'sauti-mobile-drawer-chevron')}</button>
          <button type="button" data-mobile-drawer-settings-section="safety">${icon('safety')}<span><strong>Safety</strong><small>Blocking, muting and moderation</small></span>${icon('chevron', 'sauti-mobile-drawer-chevron')}</button>
          <button type="button" data-mobile-drawer-settings-section="data">${icon('data')}<span><strong>Your data</strong><small>Export and account data controls</small></span>${icon('chevron', 'sauti-mobile-drawer-chevron')}</button>
          <button type="button" data-mobile-drawer-appearance>${icon('appearance')}<span><strong>Appearance</strong><small data-mobile-drawer-theme-label>System theme</small></span>${icon('chevron', 'sauti-mobile-drawer-chevron')}</button>
        </div>
      </div>
      <button type="button" data-mobile-drawer-verification>${icon('verification')}<span><strong>Verification</strong><small data-mobile-drawer-verification-copy>Request or check verification status</small></span>${icon('chevron', 'sauti-mobile-drawer-chevron')}</button>
      <p class="sauti-mobile-drawer-verification-message" data-mobile-drawer-verification-message role="status" aria-live="polite" hidden></p>
      <button type="button" data-mobile-drawer-settings-section="privacy">${icon('privacy')}<span><strong>Privacy</strong><small>Audience and messaging controls</small></span></button>
      <button type="button" data-mobile-drawer-settings-section="language">${icon('language')}<span><strong>Language</strong><small>Choose your language</small></span></button>
      <button type="button" data-mobile-drawer-appearance>${icon('appearance')}<span><strong>Theme</strong><small data-mobile-drawer-theme-label>System theme</small></span></button>
      <a href="/help">${icon('help')}<span><strong>Help &amp; support</strong><small>Get help with SautiLink</small></span>${icon('chevron', 'sauti-mobile-drawer-chevron')}</a>
      <a href="/about">${icon('help')}<span><strong>About SautiLink</strong><small>About the platform</small></span></a>
      <a href="/terms">${icon('terms')}<span><strong>Terms of Service</strong><small>Rules for using SautiLink</small></span>${icon('chevron', 'sauti-mobile-drawer-chevron')}</a>
      <a href="/community-guidelines">${icon('safety')}<span><strong>Community Guidelines</strong><small>Expression, safety and community rules</small></span>${icon('chevron', 'sauti-mobile-drawer-chevron')}</a>
      <a href="/upload-guidelines">${icon('terms')}<span><strong>Upload Guidelines</strong><small>Formats, sizes and media limits</small></span>${icon('chevron', 'sauti-mobile-drawer-chevron')}</a>
      <a href="/contact">${icon('contact')}<span><strong>Contact</strong><small>Reach the SautiLink team</small></span>${icon('chevron', 'sauti-mobile-drawer-chevron')}</a>
      <a href="https://wa.me/255629145502" target="_blank" rel="noopener noreferrer">${icon('contact')}<span><strong>WhatsApp Support · 24/7</strong><small>+255 629 145 502 · AI + Live Human Agents</small></span>${icon('chevron', 'sauti-mobile-drawer-chevron')}</a>
      <h2 class="menu-native-section-heading menu-native-products-heading">${icon('cloud')}Other SautiLink Products</h2>
      <a href="https://cloudengine.sautilink.com" target="_blank" rel="noopener noreferrer">${icon('cloud')}<span><strong>Cloud Engine</strong><small>Open SautiLink Cloud Engine</small></span>${icon('chevron', 'sauti-mobile-drawer-chevron')}</a>
      <a href="https://router.sautilink.com" target="_blank" rel="noopener noreferrer">${icon('router')}<span><strong>Router Setup</strong><small>Open the router setup system</small></span>${icon('chevron', 'sauti-mobile-drawer-chevron')}</a>
    </nav>
    <div class="sauti-mobile-drawer-spacer"></div>
    <button class="sauti-mobile-drawer-signout" type="button" data-mobile-drawer-signout>${icon('signout')}<span>Log out</span></button>
    <footer class="sauti-mobile-drawer-footer">
      <a href="/privacy">Privacy</a><span aria-hidden="true">·</span><a href="/about">About</a>
    </footer>`;

  document.body.append(backdrop, drawer);

  const closeButton = drawer.querySelector('.sauti-mobile-drawer-close');
  const backButton = drawer.querySelector('.sauti-mobile-drawer-back');
  const drawerAvatar = drawer.querySelector('.sauti-mobile-drawer-avatar');
  const drawerName = drawer.querySelector('.sauti-mobile-drawer-profile-copy > strong');
  const drawerUsername = drawer.querySelector('.sauti-mobile-drawer-profile-copy > small');
  const memberStatus = drawer.querySelector('[data-mobile-drawer-member-status]');
  const memberStatusIcon = drawer.querySelector('[data-mobile-drawer-member-icon]');
  const memberStatusLabel = drawer.querySelector('[data-mobile-drawer-member-label]');
  const verificationButton = drawer.querySelector('[data-mobile-drawer-verification]');
  const verificationCopy = drawer.querySelector('[data-mobile-drawer-verification-copy]');
  const verificationMessage = drawer.querySelector('[data-mobile-drawer-verification-message]');
  const settingsToggle = drawer.querySelector('[data-mobile-drawer-settings-toggle]');
  const settingsPanel = drawer.querySelector('#sauti-mobile-drawer-settings-panel');
  const themeLabels = drawer.querySelectorAll('[data-mobile-drawer-theme-label]');
  let restoreFocus = null;
  let hideTimer = 0;
  let verificationMessageTimer = 0;

  function syncIdentity() {
    const sourceAvatar = document.getElementById('rail-avatar');
    const sourceName = document.getElementById('rail-name');
    const sourceUsername = document.getElementById('rail-username');
    const sourceBadge = memberVerificationBadge();
    const verified = sourceBadge instanceof Element;

    if (!replaceWithSafeClones(drawerAvatar, sourceAvatar)) {
      drawerAvatar.textContent = (sourceName?.textContent || 'S').trim().slice(0, 2) || 'S';
    }
    drawerAvatar.classList.toggle('has-profile-photo', Boolean(sourceAvatar?.classList.contains('has-profile-photo')));

    drawerName.textContent = sourceName?.textContent?.trim() || 'SautiLink member';
    if (sourceBadge) {
      const badge = sourceBadge.cloneNode(true);
      badge.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
      drawerName.append(badge);
    }
    drawerUsername.textContent = sourceUsername?.textContent?.trim() || '@username';

    memberStatus?.classList.toggle('is-verified', verified);
    if (memberStatusLabel) memberStatusLabel.textContent = verified ? 'Verified SautiLinker' : 'SautiLinker';
    if (memberStatusIcon) {
      if (verified) {
        memberStatusIcon.replaceChildren(sourceBadge.cloneNode(true));
        memberStatusIcon.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
      } else {
        memberStatusIcon.innerHTML = icon('memberShield');
      }
    }
    if (verificationCopy) {
      verificationCopy.textContent = verified
        ? 'Your account is verified'
        : 'Request or check verification status';
    }
    verificationButton?.classList.toggle('menu-native-verified', verified);
    const verificationLabel = verificationButton?.querySelector('strong');
    if (verificationLabel) verificationLabel.textContent = verified ? 'Verified' : 'Verification';
  }

  function syncThemeLabel() {
    const theme = document.documentElement.dataset.theme;
    themeLabels.forEach((label) => { label.textContent = theme === 'light' ? 'Light mode' : theme === 'dark' ? 'Dark mode' : 'System theme'; });
  }

  function setSettingsExpanded(expanded) {
    const next = Boolean(expanded);
    if (settingsToggle) settingsToggle.setAttribute('aria-expanded', String(next));
    if (settingsPanel) settingsPanel.hidden = !next;
  }

  function syncAvailability() {
    const enabled = memberIsVisible() && window.innerWidth <= MOBILE_BREAKPOINT;
    document.documentElement.classList.toggle('sauti-mobile-drawer-enabled', enabled);
    trigger.hidden = !enabled;
    const moderation = drawer.querySelector('[data-mobile-drawer-view="moderation"]');
    const moderationSource = canonicalViewButton('moderation');
    if (moderation) {
      const available = moderationSource instanceof HTMLButtonElement && !moderationSource.hidden && !moderationSource.disabled;
      if (moderation.hidden === available) moderation.hidden = !available;
    }
    if (!enabled) closeDrawer(false);
  }

  function openDrawer() {
    if (!memberIsVisible() || window.innerWidth > MOBILE_BREAKPOINT) return;
    window.clearTimeout(hideTimer);
    window.clearTimeout(verificationMessageTimer);
    if (verificationMessage) verificationMessage.hidden = true;
    syncIdentity();
    syncThemeLabel();
    setSettingsExpanded(false);
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
    setSettingsExpanded(false);
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

  function openSettingsSection(section) {
    const settingsView = canonicalViewButton('settings');
    if (!(settingsView instanceof HTMLButtonElement) || settingsView.hidden || settingsView.disabled) return;
    closeDrawer(false);
    settingsView.click();
    queueMicrotask(() => {
      const sectionButton = canonicalSettingsSectionButton(section);
      if (sectionButton instanceof HTMLButtonElement && !sectionButton.disabled) sectionButton.click();
    });
  }

  function showVerifiedMessage() {
    if (!verificationMessage) return;
    window.clearTimeout(verificationMessageTimer);
    verificationMessage.textContent = "You're already a verified SautiLinker.";
    verificationMessage.hidden = false;
    verificationMessageTimer = window.setTimeout(() => {
      verificationMessage.hidden = true;
    }, 4200);
  }

  function openVerificationSettings() {
    if (memberIsVerified()) {
      showVerifiedMessage();
      return;
    }

    const settingsView = canonicalViewButton('settings');
    if (!(settingsView instanceof HTMLButtonElement) || settingsView.hidden || settingsView.disabled) return;
    closeDrawer(false);
    settingsView.click();
    queueMicrotask(() => {
      const accountButton = canonicalSettingsSectionButton('account');
      if (accountButton instanceof HTMLButtonElement && !accountButton.disabled) accountButton.click();
      queueMicrotask(() => {
        const card = document.querySelector('#settings-surface .settings-verification-card');
        if (!(card instanceof HTMLElement)) return;
        const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        card.scrollIntoView({ block: 'start', behavior: reducedMotion ? 'auto' : 'smooth' });
        const request = document.getElementById('settings-verification-request');
        if (request instanceof HTMLButtonElement && !request.hidden && !request.disabled) {
          request.focus({ preventScroll: true });
        }
      });
    });
  }

  trigger.addEventListener('click', openDrawer);
  closeButton?.addEventListener('click', () => closeDrawer());
  backButton?.addEventListener('click', () => closeDrawer());
  backdrop.addEventListener('click', () => closeDrawer());

  drawer.querySelectorAll('[data-mobile-drawer-view]').forEach((button) => {
    button.addEventListener('click', () => openCanonicalView(button.dataset.mobileDrawerView));
  });

  settingsToggle?.addEventListener('click', () => {
    setSettingsExpanded(settingsToggle.getAttribute('aria-expanded') !== 'true');
  });

  drawer.querySelectorAll('[data-mobile-drawer-settings-section]').forEach((button) => {
    button.addEventListener('click', () => openSettingsSection(button.dataset.mobileDrawerSettingsSection));
  });

  verificationButton?.addEventListener('click', openVerificationSettings);

  drawer.querySelectorAll('[data-mobile-drawer-appearance]').forEach((button) => button.addEventListener('click', () => {
    canonicalThemeButton()?.click();
    queueMicrotask(syncThemeLabel);
  }));

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
  new MutationObserver(() => {
    syncThemeLabel();
    syncIdentity();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  window.addEventListener('resize', syncAvailability, { passive: true });
  const moderationSource = canonicalViewButton('moderation');
  if (moderationSource) {
    new MutationObserver(syncAvailability).observe(moderationSource, {
      attributes: true, attributeFilter: ['hidden', 'disabled'],
    });
  }

  drawer.querySelectorAll('.sauti-mobile-drawer-nav button, .sauti-mobile-drawer-nav a')
    .forEach(decorateMenuTile);
  const menuShell = document.getElementById('menu-page-shell');
  if (menuShell) {
    let focusedControl = null;
    let focusedIdentity = '';
    const identityOf = (control) => control?.dataset.memberView || control?.dataset.menuSourceId
      || control?.dataset.menuNativeAction && `${control.dataset.menuNativeAction}:${control.dataset.menuNativeSection || ''}`
      || control?.getAttribute('href') || '';
    menuShell.addEventListener('focusin', (event) => {
      focusedControl = event.target.closest('button, a');
      focusedIdentity = identityOf(focusedControl);
    });
    const enhance = () => {
      const restore = focusedControl && !focusedControl.isConnected && document.activeElement === document.body
        && !document.getElementById('menu-surface')?.hidden && document.visibilityState !== 'hidden';
      enhanceNativeMenuClone(menuShell.querySelector('.menu-page-rail-inner'));
      if (restore && focusedIdentity) {
        const replacement = Array.from(menuShell.querySelectorAll('button, a')).find((control) =>
          identityOf(control) === focusedIdentity && !control.disabled && !control.hidden && control.getClientRects().length > 0);
        replacement?.focus({ preventScroll: true });
      }
    };
    new MutationObserver(enhance).observe(menuShell, { childList: true, subtree: true });
    menuShell.addEventListener('click', (event) => {
      const action = event.target.closest('[data-menu-native-action]');
      if (!action) return;
      event.preventDefault();
      if (action.dataset.menuNativeAction === 'verification') {
        if (memberIsVerified()) openSettingsSection('account');
        else openVerificationSettings();
      }
      else if (action.dataset.menuNativeAction === 'settings') openSettingsSection(action.dataset.menuNativeSection);
      else if (action.dataset.menuNativeAction === 'theme') canonicalThemeButton()?.click();
    });
    enhance();
  }

  syncIdentity();
  syncThemeLabel();
  setSettingsExpanded(false);
  syncAvailability();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installMobileMoreDrawer, { once: true });
} else {
  queueMicrotask(installMobileMoreDrawer);
}
