const MOBILE_NAV_SELECTOR = '.mobile-nav';
const MOBILE_NAV_STYLE_HREF = '/app/assets/mobile-nav-icon-style.css?v=20260907-nav1';
const SVG_NS = 'http://www.w3.org/2000/svg';

const MOBILE_NAV_ICONS = Object.freeze({
  stream: [
    ['path', { d: 'M3.8 10.7 12 4l8.2 6.7v8.4c0 1-.8 1.8-1.8 1.8h-4.6v-6.2h-3.6v6.2H5.6c-1 0-1.8-.8-1.8-1.8v-8.4Z' }],
  ],
  discover: [
    ['circle', { cx: '10.7', cy: '10.7', r: '6.5' }],
    ['path', { d: 'm15.6 15.6 4.5 4.5' }],
  ],
  messages: [
    ['path', { d: 'M5.2 4.7h13.6c1 0 1.8.8 1.8 1.8v8.7c0 1-.8 1.8-1.8 1.8H9.3L4 20.4v-4.7a1.8 1.8 0 0 1-.6-1.4V6.5c0-1 .8-1.8 1.8-1.8Z' }],
  ],
  notifications: [
    ['path', { d: 'M18.3 9.2c0-3.6-2.4-5.9-6.3-5.9S5.7 5.6 5.7 9.2c0 4.9-1.8 5.7-2.6 7.2-.3.6.1 1.2.8 1.2h16.2c.7 0 1.1-.6.8-1.2-.8-1.5-2.6-2.3-2.6-7.2Z' }],
    ['path', { d: 'M9.4 20.3h5.2' }],
  ],
  circles: [
    ['circle', { cx: '12', cy: '12', r: '7.3' }],
    ['path', { d: 'M16.1 7.9c-4.6.4-7.8 3.5-8.2 8.2 4.7-.4 7.8-3.6 8.2-8.2Z' }],
    ['path', { d: 'm8.9 15.1 6.2-6.2' }],
  ],
  profile: [
    ['circle', { cx: '12', cy: '8.2', r: '3.5' }],
    ['path', { d: 'M5.1 20.2c.8-4.2 3.1-6.3 6.9-6.3s6.1 2.1 6.9 6.3' }],
  ],
});

function ensureMobileNavStylesheet() {
  if (document.querySelector(`link[href="${MOBILE_NAV_STYLE_HREF}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = MOBILE_NAV_STYLE_HREF;
  document.head.append(link);
}

function createMobileNavIcon(view) {
  const shapes = MOBILE_NAV_ICONS[view];
  if (!shapes) return null;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('mobile-nav-icon');

  shapes.forEach(([tagName, attributes]) => {
    const shape = document.createElementNS(SVG_NS, tagName);
    Object.entries(attributes).forEach(([name, value]) => shape.setAttribute(name, value));
    svg.append(shape);
  });

  return svg;
}

export function styleMobileNavigation(nav = document.querySelector(MOBILE_NAV_SELECTOR)) {
  if (!(nav instanceof Element)) return;

  ensureMobileNavStylesheet();
  nav.dataset.iconStyle = 'bold-outline';

  nav.querySelectorAll('button[data-member-view]').forEach((button) => {
    const icon = createMobileNavIcon(button.dataset.memberView);
    const existingIcon = button.querySelector('svg');
    if (!icon || !existingIcon) return;
    existingIcon.replaceWith(icon);
  });
}

function installMobileNavigationStyle() {
  styleMobileNavigation();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installMobileNavigationStyle, { once: true });
} else {
  queueMicrotask(installMobileNavigationStyle);
}
