const PROFILE_ROUTE_STYLESHEET = '/app/assets/profile-route-states.css';

function ensureProfileRouteStylesheet() {
  if (document.querySelector(`link[href="${PROFILE_ROUTE_STYLESHEET}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = PROFILE_ROUTE_STYLESHEET;
  document.head.append(link);
}

function createUnavailableIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('profile-route-unavailable-icon');

  const head = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  head.setAttribute('cx', '9');
  head.setAttribute('cy', '8');
  head.setAttribute('r', '3.25');

  const shoulders = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  shoulders.setAttribute('d', 'M3.7 19c.6-3.6 2.3-5.5 5.3-5.5 1.3 0 2.4.35 3.25 1.02');

  const slash = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  slash.setAttribute('d', 'm15 10 6 6M21 10l-6 6');

  svg.append(head, shoulders, slash);
  return svg;
}

function ensureProfileRouteVisuals(state) {
  const mark = state.querySelector('.profile-route-mark');
  if (!mark || mark.dataset.branded === 'true') return mark;

  const logo = document.createElement('img');
  logo.className = 'profile-route-brand-logo';
  logo.src = '/assets/brand/logo-compact.webp';
  logo.alt = 'SautiLink';
  logo.width = 92;
  logo.height = 48;
  logo.decoding = 'async';

  const spinner = document.createElement('span');
  spinner.className = 'profile-route-brand-spinner';
  spinner.setAttribute('aria-hidden', 'true');

  mark.replaceChildren(logo, spinner, createUnavailableIcon());
  mark.dataset.branded = 'true';
  return mark;
}

function profileRouteUsername() {
  const match = window.location.pathname.match(/^\/(?:app\/)?u\/([a-z0-9][a-z0-9._]{2,29})\/?$/i);
  return match ? `@${match[1]}` : '';
}

function syncProfileRouteState() {
  const state = document.getElementById('profile-route-state');
  if (!state) return;

  const mark = ensureProfileRouteVisuals(state);
  const title = document.getElementById('profile-route-title');
  const message = document.getElementById('profile-route-message');
  const home = state.querySelector('.profile-route-home');
  const type = state.dataset.state || 'loading';
  const username = profileRouteUsername();

  if (mark) mark.dataset.visual = type === 'loading' ? 'loading' : 'unavailable';
  if (home) home.textContent = 'Back to Home';

  if (type === 'loading') {
    if (title) title.textContent = 'Loading profile…';
    if (message) message.textContent = username
      ? `Opening ${username} on SautiLink.`
      : 'Opening this profile on SautiLink.';
    return;
  }

  if (type === 'unavailable') {
    if (title) title.textContent = 'This account isn’t available';
    if (message) message.textContent = 'The account may not exist, the username may be misspelled, or the profile may no longer be available.';
    return;
  }

  if (title) title.textContent = 'We couldn’t load this profile';
  if (message) message.textContent = 'Something went wrong while opening this profile. Please try again in a moment.';
}

function installProfileRouteStates() {
  if (window.__sautilinkProfileRouteStatesInstalled) return;
  window.__sautilinkProfileRouteStatesInstalled = true;
  ensureProfileRouteStylesheet();

  const state = document.getElementById('profile-route-state');
  if (!state) return;

  syncProfileRouteState();
  new MutationObserver(syncProfileRouteState).observe(state, {
    attributes: true,
    attributeFilter: ['data-state', 'hidden'],
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installProfileRouteStates, { once: true });
} else {
  installProfileRouteStates();
}
