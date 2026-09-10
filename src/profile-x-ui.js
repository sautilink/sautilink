const PROFILE_X_UI_STYLE_ID = 'sautilink-profile-x-ui';
const PROFILE_X_UI_STYLESHEET = '/app/assets/profile-x-ui.css?v=20260910-csp1';

function ensureProfileXUiStyles() {
  if (document.getElementById(PROFILE_X_UI_STYLE_ID)) return;
  const link = document.createElement('link');
  link.id = PROFILE_X_UI_STYLE_ID;
  link.rel = 'stylesheet';
  link.href = PROFILE_X_UI_STYLESHEET;
  document.head.append(link);
}

function installProfileXUi() {
  const surface = document.getElementById('profile-surface');
  if (!surface) return;
  ensureProfileXUiStyles();
  surface.dataset.profilePresentation = 'x-style';
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installProfileXUi, { once: true });
} else {
  installProfileXUi();
}
