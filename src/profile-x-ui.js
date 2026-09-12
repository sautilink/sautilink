const PROFILE_X_UI_STYLE_ID = 'sautilink-profile-x-ui';
const PROFILE_X_UI_STYLESHEET = '/app/assets/profile-x-ui.css?v=20260910-tabs2';
const PROFILE_SOCIAL_STATS_ORDER_STYLE_ID = 'sautilink-profile-social-stats-order';

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
  const style = document.createElement('style');
  style.id = PROFILE_SOCIAL_STATS_ORDER_STYLE_ID;
  style.textContent = `
.profile-surface .profile-social-stats > span:first-child { order: 1; }
.profile-surface .profile-social-stats > span:nth-child(2) { order: 2; }
`;
  document.head.append(style);
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
