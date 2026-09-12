const PROFILE_X_UI_STYLE_ID = 'sautilink-profile-x-ui';
const PROFILE_X_UI_STYLESHEET = '/app/assets/profile-x-ui.css?v=20260910-tabs2';
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

function installProfileXUi() {
  const surface = document.getElementById('profile-surface');
  if (!surface) return;
  ensureProfileXUiStyles();
  ensureProfileSocialStatsOrderStyles();
  surface.dataset.profilePresentation = 'x-style';
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installProfileXUi, { once: true });
} else {
  installProfileXUi();
}
