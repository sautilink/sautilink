import { getLanguage, translateSystemText } from './language-preference.js';

const LANGUAGE_NAV_SELECTOR = '[data-language-preference-nav]';

function languageNavLabel() {
  return translateSystemText('Language', getLanguage());
}

function openLanguagePreference() {
  const settingsNav = document.querySelector('[data-member-view="settings"]');
  if (settingsNav instanceof HTMLElement) settingsNav.click();

  const openPanel = () => {
    const languageTab = document.querySelector('[data-settings-section="language"]');
    if (languageTab instanceof HTMLElement) languageTab.click();
  };

  // Settings routing updates synchronously today, but keep one frame of separation
  // so this remains safe if the existing router becomes asynchronous later.
  requestAnimationFrame(openPanel);
}

function installLanguageSidebarEntry() {
  const nav = document.querySelector('.app-nav');
  const settingsNav = nav?.querySelector('[data-member-view="settings"]');
  if (!nav || !settingsNav || nav.querySelector(LANGUAGE_NAV_SELECTOR)) return;

  const button = document.createElement('button');
  button.className = 'nav-item';
  button.type = 'button';
  button.dataset.languagePreferenceNav = '';
  button.setAttribute('aria-label', 'Language preference');
  button.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9"></circle>
      <path d="M3 12h18M12 3c2.4 2.5 3.7 5.5 3.7 9S14.4 18.5 12 21M12 3C9.6 5.5 8.3 8.5 8.3 12S9.6 18.5 12 21"></path>
    </svg>
    <span>${languageNavLabel()}</span>`;
  button.addEventListener('click', openLanguagePreference);

  settingsNav.insertAdjacentElement('afterend', button);
}

function refreshLanguageSidebarEntry() {
  const button = document.querySelector(LANGUAGE_NAV_SELECTOR);
  if (!(button instanceof HTMLElement)) {
    installLanguageSidebarEntry();
    return;
  }
  const label = button.querySelector('span');
  if (label) label.textContent = languageNavLabel();
  button.setAttribute('aria-label', translateSystemText('Language preference', getLanguage()));
}

function initializeLanguageSidebarEntry() {
  installLanguageSidebarEntry();
  window.addEventListener('sautilink:languagechange', refreshLanguageSidebarEntry);
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.body) initializeLanguageSidebarEntry();
  else document.addEventListener('DOMContentLoaded', initializeLanguageSidebarEntry, { once: true });
}
