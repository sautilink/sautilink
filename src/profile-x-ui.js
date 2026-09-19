const PROFILE_X_UI_STYLE_ID = 'sautilink-profile-x-ui';
const PROFILE_X_UI_STYLESHEET = '/app/assets/profile-x-ui.css?v=20260918-profile2';
const PROFILE_SOCIAL_STATS_ORDER_STYLE_ID = 'sautilink-profile-social-stats-order';
const PROFILE_SOCIAL_STATS_ORDER_STYLESHEET = '/app/assets/profile-social-stats-order.css?v=20260912-followers1';
const PROFILE_PRIVACY_VISIBILITY_STYLE_ID = 'sautilink-profile-privacy-visibility';
const PROFILE_PRIVACY_VISIBILITY_STYLESHEET = '/app/assets/profile-privacy-visibility.css?v=20260919-profileprivacy2';

function ensureProfileXUiStyles() {
  if (document.getElementById(PROFILE_X_UI_STYLE_ID)) return;
  const link = document.createElement('link');
  link.id = PROFILE_X_UI_STYLE_ID;
  link.rel = 'stylesheet';
  link.href = PROFILE_X_UI_STYLESHEET;
  document.head.append(link);
}

function ensureProfileSocialStatsOrderStyles() {
  if (document.getElementById(PROFILE_SOCIAL_STATS_ORDER_STYLE_ID)) return;
  const link = document.createElement('link');
  link.id = PROFILE_SOCIAL_STATS_ORDER_STYLE_ID;
  link.rel = 'stylesheet';
  link.href = PROFILE_SOCIAL_STATS_ORDER_STYLESHEET;
  document.head.append(link);
}

function ensureProfilePrivacyVisibilityStyles() {
  if (document.getElementById(PROFILE_PRIVACY_VISIBILITY_STYLE_ID)) return;
  const link = document.createElement('link');
  link.id = PROFILE_PRIVACY_VISIBILITY_STYLE_ID;
  link.rel = 'stylesheet';
  link.href = PROFILE_PRIVACY_VISIBILITY_STYLESHEET;
  document.head.append(link);
}

function placeProfileStatsBeforeBio() {
  const stats = document.querySelector('#profile-surface .profile-social-stats');
  const bio = document.getElementById('profile-bio');
  if (!stats || !bio || stats.parentElement !== bio.parentElement) return;
  if (bio.previousElementSibling !== stats) bio.before(stats);
}

function hideProfileSettingsShortcut() {
  const settings = document.getElementById('profile-settings-button');
  if (!settings) return;
  if (!settings.hidden) settings.hidden = true;
  if (settings.getAttribute('aria-hidden') !== 'true') settings.setAttribute('aria-hidden', 'true');
}

function syncProfileVisibilityPresentation() {
  const visibility = document.getElementById('profile-visibility');
  if (!visibility) return;

  const privateAccount = visibility.classList.contains('private');
  const label = visibility.querySelector('b');
  const nextLabel = privateAccount ? 'Private Account' : '';

  if (label && label.textContent !== nextLabel) label.textContent = nextLabel;
  if (visibility.hidden === privateAccount) visibility.hidden = !privateAccount;
  const ariaHidden = String(!privateAccount);
  if (visibility.getAttribute('aria-hidden') !== ariaHidden) visibility.setAttribute('aria-hidden', ariaHidden);
}

function enforceProfilePresentation() {
  placeProfileStatsBeforeBio();
  hideProfileSettingsShortcut();
  syncProfileVisibilityPresentation();
}

function installProfilePresentationGuard(surface) {
  if (surface.dataset.profilePresentationGuardBound === 'true') return;
  surface.dataset.profilePresentationGuardBound = 'true';

  let scheduled = false;
  const scheduleSync = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      enforceProfilePresentation();
    });
  };

  const observer = new MutationObserver(scheduleSync);
  observer.observe(surface, {
    attributes: true,
    attributeFilter: ['class', 'hidden'],
    childList: true,
    subtree: true,
    characterData: true,
  });
}

function installProfileXUi() {
  const surface = document.getElementById('profile-surface');
  if (!surface) return;
  ensureProfileXUiStyles();
  ensureProfileSocialStatsOrderStyles();
  ensureProfilePrivacyVisibilityStyles();
  surface.dataset.profilePresentation = 'x-style';
  enforceProfilePresentation();
  installProfilePresentationGuard(surface);

  const moreMenu = document.getElementById('profile-more-menu');
  const moreButton = document.getElementById('profile-more-button');
  const morePopover = document.getElementById('profile-more-popover');
  if (!moreMenu || !moreButton || !morePopover || moreMenu.dataset.bound === 'true') return;
  moreMenu.dataset.bound = 'true';

  const closeMoreMenu = ({ restoreFocus = false } = {}) => {
    morePopover.hidden = true;
    moreButton.setAttribute('aria-expanded', 'false');
    if (restoreFocus) moreButton.focus();
  };

  moreButton.addEventListener('click', (event) => {
    event.stopPropagation();
    if (moreMenu.hidden) return;
    const opening = morePopover.hidden;
    morePopover.hidden = !opening;
    moreButton.setAttribute('aria-expanded', String(opening));
  });
  morePopover.addEventListener('click', (event) => {
    if (event.target.closest('.profile-safety-button')) closeMoreMenu();
  });
  document.addEventListener('click', (event) => {
    if (!morePopover.hidden && !event.target.closest('#profile-more-menu')) closeMoreMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !morePopover.hidden) {
      event.preventDefault();
      closeMoreMenu({ restoreFocus: true });
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installProfileXUi, { once: true });
} else {
  installProfileXUi();
}
