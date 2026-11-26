import { SOCIAL_ICON_PATHS } from './social-icon-paths.js';
const NS = 'http://www.w3.org/2000/svg';
const names = { like: 'heart', heart: 'heart', comments: 'chat-circle', comment: 'chat-circle',
  share: 'paper-plane-tilt', notifications: 'bell', profile: 'user' };

export function createPostActionIcon(action) {
  const name = names[action] || action;
  const svg = document.createElementNS(NS, 'svg');
  svg.classList.add('sauti-canonical-icon'); svg.dataset.icon = name;
  svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
  svg.setAttribute('viewBox', SOCIAL_ICON_PATHS[name] ? '0 0 256 256' : '0 0 24 24');
  const path = (d, cls = '') => {
    const node = document.createElementNS(NS, 'path'); node.setAttribute('d', d);
    if (cls) node.setAttribute('class', cls); svg.append(node);
  };
  if (SOCIAL_ICON_PATHS[name]) {
    path(SOCIAL_ICON_PATHS[name], name === 'heart' ? 'icon-outline' : '');
    if (name === 'heart') path(SOCIAL_ICON_PATHS['heart-fill'], 'icon-filled');
  } else if (name === 'repost') {
    for (const d of ['m2 9 3-3 3 3', 'M13 18H7a2 2 0 0 1-2-2V6',
      'm22 15-3 3-3-3', 'M11 6h6a2 2 0 0 1 2 2v10']) path(d);
  } else if (name === 'save') path('M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-4-6 4V4.5Z');
  return svg;
}

export function installSocialIcons(root = document) {
  function update(node) {
    const selector = '[data-sauti-action], [data-short-action], [data-member-view="notifications"], [data-member-view="profile"]';
    const controls = [...node.querySelectorAll?.(selector) || []];
    if (node.matches?.(selector)) controls.unshift(node);
    for (const button of controls) {
      const action = button.dataset.sautiAction || button.dataset.shortAction || button.dataset.memberView;
      if (!names[action] && !['repost', 'save'].includes(action)) continue;
      const host = button.querySelector('.sauti-short-action-icon') || button;
      const old = host.querySelector('svg');
      if (old?.classList.contains('sauti-canonical-icon')) continue;
      const icon = createPostActionIcon(action); if (old) old.replaceWith(icon); else host.prepend(icon);
    }
  }
  update(root);
  new MutationObserver(changes => {
    for (const change of changes) for (const node of change.addedNodes) if (node.nodeType === 1) update(node);
  }).observe(root.body, { childList: true, subtree: true });
  root.addEventListener('click', event => {
    const icon = event.target.closest?.('[data-sauti-action], [data-short-action]')?.querySelector('.sauti-canonical-icon');
    if (!icon || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    icon.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.13)' }, { transform: 'scale(1)' }],
      { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }, { passive: true });
}
