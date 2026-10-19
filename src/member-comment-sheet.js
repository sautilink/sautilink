/* Reuse the canonical comments surface and its handlers inside a member modal.
 * Opening a sheet keeps the underlying route, feed, scroll and video intact. */
const HISTORY_KEY = 'sautilinkCommentSheet';

export function createMemberCommentSheet({ load, onClose } = {}) {
  const surface = document.getElementById('conversation-surface');
  const member = document.getElementById('member-view');
  if (!surface || !member) return null;

  const dialog = document.createElement('dialog');
  dialog.id = 'member-comment-sheet';
  dialog.className = 'member-comment-sheet';
  dialog.setAttribute('aria-label', 'Comments');
  const grip = document.createElement('div');
  grip.className = 'member-comment-sheet-grip';
  grip.setAttribute('aria-hidden', 'true');
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'member-comment-sheet-close';
  closeButton.setAttribute('aria-label', 'Close comments');
  closeButton.innerHTML = '<svg data-sl-icon-name="cancel-0-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="m6 6 12 12M18 6 6 18"></path></svg>';
  dialog.append(grip);
  document.body.append(dialog);

  let active = null;
  let pendingBack = null;
  let sequence = 0;
  let pointerOutside = false;
  let gripStart = null;
  const memberVisible = () => !member.hidden && !document.body.classList.contains('auth-entry');
  const locationKey = () => `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const announce = (open) => document.dispatchEvent(new CustomEvent('sautilink:comment-sheet-toggle', { detail: { open } }));

  function fitViewport() {
    if (!active) return;
    const viewport = window.visualViewport;
    const height = viewport?.height || window.innerHeight;
    const offset = viewport ? Math.max(0, window.innerHeight - height - viewport.offsetTop) : 0;
    dialog.style.setProperty('--comment-sheet-available-height', `${height}px`);
    dialog.style.setProperty('--comment-sheet-keyboard-offset', `${offset}px`);
  }

  function fitCommentMenus() {
    if (!active) return;
    const thread = surface.querySelector('#conversation-thread');
    if (!thread) return;
    const bounds = thread.getBoundingClientRect();
    for (const menu of thread.querySelectorAll('[data-comment-menu-panel]:not([hidden])')) {
      menu.style.setProperty('--comment-menu-offset-y', '0px');
      menu.style.setProperty('--comment-menu-max-height', `${Math.max(44, bounds.height - 12)}px`);
      const box = menu.getBoundingClientRect();
      const shift = Math.max(bounds.top + 6 - box.top, Math.min(0, bounds.bottom - 6 - box.bottom));
      menu.style.setProperty('--comment-menu-offset-y', `${shift}px`);
    }
  }

  function finish({ restoreFocus = true } = {}) {
    if (!active) return false;
    const previous = active;
    // Draft persistence and request cancellation remain owned by the app.
    onClose?.();
    active = null;
    if (dialog.open) dialog.close();
    surface.hidden = true;
    previous.marker.replaceWith(surface);
    closeButton.remove();
    document.body.classList.remove('member-comment-sheet-open');
    window.visualViewport?.removeEventListener('resize', fitViewport);
    window.visualViewport?.removeEventListener('scroll', fitViewport);
    window.removeEventListener('resize', fitViewport);
    if (restoreFocus && memberVisible() && locationKey() === previous.url) {
      if (previous.trigger?.isConnected && !previous.trigger.disabled && !previous.trigger.closest('[hidden]')) {
        previous.trigger.focus({ preventScroll: true });
      }
      window.scrollTo(previous.x, previous.y);
    }
    announce(false);
    return true;
  }

  function close({ history = true, restoreFocus = true } = {}) {
    if (!active) return false;
    const previous = active;
    const ownsEntry = window.history.state?.[HISTORY_KEY]?.token === previous.token;
    if (history && previous.pushed && ownsEntry && locationKey() === previous.url) {
      pendingBack = { url: previous.url };
      finish({ restoreFocus });
      window.history.back();
    } else {
      if (ownsEntry) {
        const state = { ...window.history.state };
        delete state[HISTORY_KEY];
        window.history.replaceState(state, '', locationKey());
      }
      finish({ restoreFocus });
    }
    return true;
  }

  function open(postId, trigger = document.activeElement) {
    if (!postId || !memberVisible() || typeof dialog.showModal !== 'function') return false;
    if (pendingBack) { pendingBack.reopen = { postId, trigger }; return true; }
    if (active) {
      onClose?.();
      active.postId = String(postId);
      active.trigger = trigger;
      load?.(active.postId);
      return true;
    }
    const scroll = { x: window.scrollX, y: window.scrollY };
    const marker = document.createComment('Canonical comments surface');
    surface.before(marker);
    const previousHidden = surface.hidden;
    surface.hidden = false;
    dialog.append(surface);
    surface.querySelector('.conversation-toolbar')?.append(closeButton);
    try {
      dialog.showModal();
    } catch {
      marker.replaceWith(surface);
      surface.hidden = previousHidden;
      closeButton.remove();
      return false;
    }
    active = { postId: String(postId), trigger, marker, token: `comments-${++sequence}`, url: locationKey(), ...scroll, pushed: false };
    try {
      window.history.pushState({ ...window.history.state, [HISTORY_KEY]: { token: active.token } }, '', active.url);
      active.pushed = true;
    } catch { /* The modal still works if this browser disallows history writes. */ }
    document.body.classList.add('member-comment-sheet-open');
    window.visualViewport?.addEventListener('resize', fitViewport);
    window.visualViewport?.addEventListener('scroll', fitViewport);
    window.addEventListener('resize', fitViewport);
    fitViewport();
    closeButton.focus({ preventScroll: true });
    announce(true);
    load?.(active.postId);
    return true;
  }

  closeButton.addEventListener('click', () => close());
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
  dialog.addEventListener('close', () => { if (active && !dialog.open) close(); });
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && dialog.querySelector('[data-comment-menu-toggle][aria-expanded="true"]')) {
      // Let the existing document handler close the menu before this sheet.
      event.preventDefault();
    }
  });
  const outside = (event) => {
    const bounds = dialog.getBoundingClientRect();
    return event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
  };
  dialog.addEventListener('pointerdown', (event) => { pointerOutside = event.target === dialog && outside(event); });
  dialog.addEventListener('click', (event) => {
    if (pointerOutside && event.target === dialog && outside(event)) close();
    pointerOutside = false;
    fitCommentMenus();
  });
  grip.addEventListener('pointerdown', (event) => { gripStart = { id: event.pointerId, y: event.clientY }; grip.setPointerCapture?.(event.pointerId); });
  grip.addEventListener('pointerup', (event) => {
    if (gripStart?.id === event.pointerId && event.clientY - gripStart.y > 64) close();
    gripStart = null;
  });
  grip.addEventListener('pointercancel', () => { gripStart = null; });

  window.addEventListener('popstate', (event) => {
    if (pendingBack) {
      const samePage = locationKey() === pendingBack.url;
      const reopen = pendingBack.reopen;
      pendingBack = null;
      if (samePage) { event.stopImmediatePropagation(); if (reopen) open(reopen.postId, reopen.trigger); return; }
    }
    if (active) {
      const samePage = locationKey() === active.url;
      finish({ restoreFocus: samePage });
      // Dismiss our same-URL modal entry without reloading the feed/video route.
      if (samePage) event.stopImmediatePropagation();
    }
  }, true);
  new MutationObserver(() => { if (active && !memberVisible()) close({ history: false, restoreFocus: false }); })
    .observe(member, { attributes: true, attributeFilter: ['hidden'] });
  new MutationObserver(() => { if (active && !memberVisible()) close({ history: false, restoreFocus: false }); })
    .observe(document.body, { attributes: true, attributeFilter: ['class'] });

  return { open, close, get isOpen() { return Boolean(active); }, get postId() { return active?.postId || ''; } };
}
