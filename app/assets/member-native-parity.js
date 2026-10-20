/* Existing member surfaces, presented like native 1.1.1 (46). No data or actions
   are owned here: move existing controls, retain their identities and gates. */
(() => {
  const installation = '__sautilinkMemberNativeParity';
  if (window[installation]) return;
  let frame = 0;
  let contentObserver = null;
  let suspended = false;
  const postSurfaceIds = ['stream-surface', 'saved-surface', 'discover-surface', 'profile-surface', 'circles-surface', 'conversation-surface'];

  const memberVisible = () => !document.body.classList.contains('auth-entry')
    && Boolean(document.getElementById('member-view') && !document.getElementById('member-view').hidden);

  function moveControl(parent, control, before = null) {
    if (!parent || !control || (control.parentNode === parent && control.nextSibling === before)) return;
    const focused = control.contains(document.activeElement) ? document.activeElement : null;
    if (control.isConnected && parent.isConnected && typeof parent.moveBefore === 'function') parent.moveBefore(control, before);
    else parent.insertBefore(control, before);
    if (focused?.isConnected && control.contains(focused) && document.activeElement !== focused) {
      focused.focus?.({ preventScroll: true });
    }
  }

  function graphic(name, paths) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.dataset.slIconName = name;
    for (const [attribute, value] of Object.entries({ viewBox: '0 0 24 24', width: '24', height: '24',
      fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round',
      'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })) svg.setAttribute(attribute, value);
    for (const d of paths) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      svg.append(path);
    }
    return svg;
  }

  function arrangePostHeaders() {
    for (const id of postSurfaceIds) {
      document.getElementById(id)?.querySelectorAll('.sauti-card-head').forEach((head) => {
        const identity = head.querySelector('.sauti-card-identity');
        if (!identity) return;
        const handle = identity.querySelector('a');
        const time = head.querySelector('time');
        const edited = head.querySelector('.sauti-edited-label');
        let metadata = identity.querySelector('.native-post-metadata');
        if (!metadata && (handle || time || edited)) {
          metadata = document.createElement('div');
          metadata.className = 'native-post-metadata';
          identity.append(metadata);
        }
        if (!metadata) return;
        // Keep the actual timestamp, edit marker and profile link. Their source
        // controllers still find these descendants under the same card header.
        for (const control of [handle, time, edited]) {
          if (control && control.parentNode !== metadata) moveControl(metadata, control);
        }
      });
    }
  }

  function decorateDiscover() {
    const form = document.getElementById('discover-form');
    const search = form?.querySelector('button[type="submit"]');
    if (search && !search.dataset.nativeParitySearch) {
      const caption = document.createElement('span');
      caption.className = 'sr-only';
      caption.textContent = search.textContent.trim() || 'Search';
      search.replaceChildren(graphic('arrow-right-0-2', ['M4 12h16M14 6l6 6-6 6']), caption);
      search.dataset.nativeParitySearch = 'true';
    }
    document.querySelectorAll('#discover-profile-list .discover-profile-row').forEach((row) => {
      const copy = row.querySelector('.discover-profile-copy');
      const open = row.querySelector('.discover-profile-open');
      if (copy && open && open.parentNode !== copy) moveControl(copy, open);
    });
  }

  const notificationIcons = Object.freeze({
    follow: ['user-add-0-1', ['M15 20c-.5-4-2-6-6-6s-5.5 2-6 6', 'M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8', 'M19 7v6M16 10h6']],
    like: ['heart', ['M20.8 8.2c0 5-8.8 10.3-8.8 10.3S3.2 13.2 3.2 8.2A4.3 4.3 0 0 1 12 6.8a4.3 4.3 0 0 1 8.8 1.4Z']],
    reply: ['message-0-1', ['M4 4h16v13H9l-5 4V4Z', 'M8 9h8M8 13h5']],
    mention: ['mail-0-1', ['M3 5h18v14H3V5Z', 'm3 7 9 6 9-6']],
    reshare: ['repeat', ['M4 7h14l-3-3M20 17H6l3 3M18 7v5M6 17v-5']],
    circle: ['user-group', ['M3 20c.5-4 2-6 6-6s5.5 2 6 6M15 14c4-1 6 1 6 5', 'M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8M18 5a3 3 0 1 1-2 5']],
    message: ['mail-0-1', ['M3 5h18v14H3V5Z', 'm3 7 9 6 9-6']],
    safety: ['shield-check', ['M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z', 'm8 12 3 3 5-6']],
  });
  const neutralNotification = ['notification', ['M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9', 'M10 21h4']];

  function decorateNotifications() {
    document.querySelectorAll('#notifications-list .notification-item').forEach((item) => {
      const avatar = item.querySelector('.notification-avatar');
      if (!avatar) return;
      const [name, paths] = notificationIcons[item.dataset.notificationType] || neutralNotification;
      let mark = avatar.querySelector('.native-notification-event');
      if (!mark) {
        mark = document.createElement('span');
        mark.className = 'native-notification-event';
        mark.setAttribute('aria-hidden', 'true');
        avatar.append(mark);
      }
      if (mark.dataset.eventIcon !== name) {
        mark.dataset.eventIcon = name;
        mark.replaceChildren(graphic(name, paths));
      }
    });
  }

  function arrangeProfile() {
    const main = document.querySelector('#profile-card .profile-main');
    if (!main) return;
    const bio = document.getElementById('profile-bio');
    const counts = main.querySelector('.profile-social-stats');
    if (bio?.parentNode === main && counts && counts.nextElementSibling !== bio) moveControl(main, counts, bio);
    const follow = document.getElementById('profile-follow-button');
    const message = document.getElementById('profile-message-button');
    let publicActions = main.querySelector('.native-profile-public-actions');
    if (follow && message && !publicActions) {
      publicActions = document.createElement('div');
      publicActions.className = 'native-profile-public-actions';
      main.append(publicActions);
    }
    // Preserve each button's hidden/disabled state, handler and original ID.
    if (publicActions) {
      if (follow?.parentNode !== publicActions) moveControl(publicActions, follow);
      if (message?.parentNode !== publicActions) moveControl(publicActions, message);
    }
    const ownerActions = document.getElementById('profile-owner-dashboard-actions');
    if (ownerActions && ownerActions.parentNode !== main) moveControl(main, ownerActions);
  }

  function refresh() {
    frame = 0;
    if (suspended || !memberVisible()) return;
    arrangePostHeaders();
    decorateDiscover();
    decorateNotifications();
    arrangeProfile();
  }

  function schedule() {
    if (!frame && !suspended && memberVisible()) frame = requestAnimationFrame(refresh);
  }

  function suspendContent() {
    contentObserver?.disconnect();
    contentObserver = null;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  }

  function sync() {
    if (suspended || !memberVisible()) { suspendContent(); return; }
    if (!contentObserver) {
      contentObserver = new MutationObserver(schedule);
      for (const id of [...new Set([...postSurfaceIds, 'notifications-list'])]) {
        const surface = document.getElementById(id);
        if (surface) contentObserver.observe(surface, { childList: true, subtree: true });
      }
    }
    schedule();
  }

  const visibilityObserver = new MutationObserver(sync);
  function mount() {
    visibilityObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    const member = document.getElementById('member-view');
    if (member) visibilityObserver.observe(member, { attributes: true, attributeFilter: ['hidden'] });
    sync();
  }
  window[installation] = { refresh: schedule };
  window.addEventListener('pagehide', () => { suspended = true; suspendContent(); visibilityObserver.disconnect(); });
  window.addEventListener('pageshow', () => { suspended = false; mount(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
