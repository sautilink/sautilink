const PROFILE_X_UI_STYLE_ID = 'sautilink-profile-x-ui';
const PROFILE_X_UI_STYLESHEET = '/app/assets/profile-x-ui.css?v=20260918-profile2';
const PROFILE_SOCIAL_STATS_ORDER_STYLE_ID = 'sautilink-profile-social-stats-order';
const PROFILE_SOCIAL_STATS_ORDER_STYLESHEET = '/app/assets/profile-social-stats-order.css?v=20260912-followers1';

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

function placeProfileStatsBeforeBio() {
  const stats = document.querySelector('#profile-surface .profile-social-stats');
  const bio = document.getElementById('profile-bio');
  if (!stats || !bio || stats.parentElement !== bio.parentElement) return;
  if (bio.previousElementSibling !== stats) bio.before(stats);
}

function installProfileVisibilityPresentation() {
  const visibility = document.getElementById('profile-visibility');
  if (!visibility) return;

  const sync = () => {
    const privateAccount = visibility.classList.contains('private');
    const label = visibility.querySelector('b');
    const nextLabel = privateAccount ? 'Private Account' : '';

    if (label && label.textContent !== nextLabel) label.textContent = nextLabel;
    visibility.hidden = !privateAccount;
    visibility.setAttribute('aria-hidden', String(!privateAccount));
  };

  if (visibility.dataset.profilePrivacyPresentationBound !== 'true') {
    visibility.dataset.profilePrivacyPresentationBound = 'true';
    const observer = new MutationObserver(sync);
    observer.observe(visibility, {
      attributes: true,
      attributeFilter: ['class'],
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  sync();
}

function installProfileXUi() {
  const surface = document.getElementById('profile-surface');
  if (!surface) return;
  ensureProfileXUiStyles();
  ensureProfileSocialStatsOrderStyles();
  surface.dataset.profilePresentation = 'x-style';
  placeProfileStatsBeforeBio();
  installProfileVisibilityPresentation();

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
