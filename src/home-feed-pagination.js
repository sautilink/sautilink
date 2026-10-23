/** One scroll intent can request one existing Home page; content stays owned by
 * loadStream. No post data, credentials or authorization are cached here. */
export function installHomeFeedPagination({ feed, more, button, state, loadMore,
  win = window, doc = document, Observer = globalThis.IntersectionObserver, now = Date.now,
  debounceMs = 100, cooldownMs = 1000 } = {}) {
  if (!feed || !more || !button || typeof Observer !== 'function') return null;
  let stopped = false, near = false, armed = false, timer = null, flight = null;
  let contextKey = '', lastRequest = '', lastStarted = -Infinity;
  let scrollIntentUntil = 0;
  const key = value => JSON.stringify([value.ownerId, value.mode, value.epoch]);
  const connected = () => feed.isConnected && more.isConnected && button.isConnected;
  const eligible = value => connected() && value.active && value.authorized && Boolean(value.ownerId)
    && ['for-you', 'following'].includes(value.mode) && !value.busy && value.hasMore
    && !more.hidden && !button.disabled && Number.isSafeInteger(value.offset) && value.offset > 0;
  function cancel() { if (timer !== null) win.clearTimeout(timer); timer = null; }
  function current() {
    const value = state(), nextKey = key(value);
    if (nextKey !== contextKey) {
      contextKey = nextKey; armed = false; lastRequest = ''; scrollIntentUntil = 0; cancel();
      // A new owner/refresh must not inherit a pending old page's local latch.
      flight = null;
    }
    if (scrollIntentUntil && now() > scrollIntentUntil) {
      armed = false; scrollIntentUntil = 0; cancel();
    }
    if (!eligible(value)) { armed = false; scrollIntentUntil = 0; cancel(); }
    return value;
  }
  function queue() {
    const value = current();
    if (stopped || !armed || !near || flight || timer !== null || !eligible(value)) return;
    const requestKey = `${contextKey}:${value.offset}`;
    if (requestKey === lastRequest) return; // A failed page keeps its manual retry.
    const snapshot = { context: contextKey, offset: value.offset };
    timer = win.setTimeout(() => {
      timer = null;
      const fresh = current();
      if (stopped || !armed || !near || flight || !eligible(fresh)
        || contextKey !== snapshot.context || fresh.offset !== snapshot.offset) return;
      armed = false; scrollIntentUntil = 0; lastStarted = now();
      const operation = {}; flight = operation;
      let pending;
      try { pending = loadMore(); } catch { pending = Promise.resolve(); }
      // loadStream increments its request epoch synchronously before awaiting.
      // Adopt that one transition so observer churn cannot release this flight.
      contextKey = key(state());
      lastRequest = `${contextKey}:${snapshot.offset}`;
      Promise.resolve(pending).catch(() => {}).finally(() => {
        if (flight === operation) flight = null;
        // Deliberately do not rearm from DOM growth or a still-near footer.
      });
    }, Math.max(debounceMs, cooldownMs - (now() - lastStarted)));
  }
  const observer = new Observer(entries => {
    if (stopped) return;
    for (const entry of entries) if (entry.target === more) near = entry.isIntersecting;
    if (!near) cancel();
    queue();
  }, { rootMargin: '0px 0px 700px 0px', threshold: 0 });
  const reconcile = () => { if (!stopped) current(); };
  const scroll = () => {
    if (stopped) return;
    const value = current();
    if (!eligible(value) || flight || !scrollIntentUntil || now() > scrollIntentUntil) return;
    armed = true; queue();
  };
  const gesture = event => {
    if (event.type === 'keydown' && (!['ArrowDown', 'PageDown', 'End', ' '].includes(event.key)
      || event.target?.closest?.('input, textarea, select, [contenteditable="true"]'))) return;
    const value = current();
    if (!stopped && eligible(value) && !flight) scrollIntentUntil = now() + 3000;
  };
  const suspend = () => { armed = near = false; scrollIntentUntil = 0; cancel(); };
  const resume = () => { reconcile(); observer.unobserve(more); observer.observe(more); };
  const mutations = typeof globalThis.MutationObserver === 'function'
    ? new globalThis.MutationObserver(reconcile) : null;
  mutations?.observe(more, { attributes: true, attributeFilter: ['hidden'] });
  mutations?.observe(button, { attributes: true, attributeFilter: ['disabled'] });
  observer.observe(more);
  win.addEventListener('scroll', scroll, { passive: true });
  win.addEventListener('wheel', gesture, { passive: true });
  win.addEventListener('touchmove', gesture, { passive: true });
  win.addEventListener('keydown', gesture);
  win.addEventListener('popstate', reconcile);
  win.addEventListener('sautilink:routechange', reconcile);
  win.addEventListener('pagehide', suspend);
  win.addEventListener('pageshow', resume);
  doc.addEventListener('visibilitychange', reconcile);
  current();
  return Object.freeze({ destroy() {
    stopped = true; suspend(); flight = null;
    observer.disconnect(); mutations?.disconnect();
    win.removeEventListener('scroll', scroll);
    win.removeEventListener('wheel', gesture);
    win.removeEventListener('touchmove', gesture);
    win.removeEventListener('keydown', gesture);
    win.removeEventListener('popstate', reconcile);
    win.removeEventListener('sautilink:routechange', reconcile);
    win.removeEventListener('pagehide', suspend);
    win.removeEventListener('pageshow', resume);
    doc.removeEventListener('visibilitychange', reconcile);
  } });
}
