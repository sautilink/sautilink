/** One disposable first-page read. Admission still belongs to the existing
 * account/profile flow; no feed records or authorization are persisted here. */
export function createHomeFeedStartupRead({ request, context, now = Date.now,
  setTimer = setTimeout, clearTimer = clearTimeout, freshForMs = 10000, requestTimeoutMs = 5000,
  initialPageSize = 5 } = {}) {
  let record = null, generation = 0, authKnown = false, authOwner = null;
  const pending = new Set();
  const cancelled = () => Object.assign(new Error('Initial Home read was invalidated.'), { code: 'HOME_STARTUP_INVALIDATED' });
  const sameAuthorization = (item) => Boolean(item && item.generation === generation
    && (!authKnown || authOwner === item.ownerId));
  const home = (value) => /^\/(?:home|app)\/?$/.test(value.pathname || '')
    && ['for-you', 'following'].includes(value.mode) && !value.recovery;
  function valid(item, value = context()) {
    const age = now() - item.startedAt;
    return !item.controller.signal.aborted && sameAuthorization(item) && age >= 0 && age < freshForMs
      && home(value) && value.mode === item.mode;
  }
  function cancel(item) {
    if (!item) return;
    clearTimer(item.expiryTimer);
    item.controller.abort();
    if (record === item) record = null;
  }
  function invalidate(item) {
    if (item) { cancel(item); return; }
    cancel(record);
    for (const operation of [...pending]) cancel(operation);
  }
  return Object.freeze({
    begin(ownerId) {
      invalidate();
      const value = context();
      if (!ownerId || !home(value) || value.hasFeed || (authKnown && authOwner !== ownerId)
        || !Number.isInteger(value.requestEpoch)) return null;
      const item = { ownerId, mode: value.mode, requestEpoch: value.requestEpoch, pageSize: initialPageSize,
        generation, startedAt: now(), admitted: false, controller: new AbortController() };
      record = item; pending.add(item);
      item.expiryTimer = setTimer(() => cancel(item), freshForMs);
      item.promise = new Promise((resolve) => {
        let done = false;
        const finish = (outcome) => {
          if (done) return;
          done = true; clearTimer(item.requestTimer); pending.delete(item);
          resolve(item.controller.signal.aborted ? { error: cancelled() } : outcome);
        };
        item.controller.signal.addEventListener('abort', () => finish({ error: cancelled() }), { once: true });
        item.requestTimer = setTimer(() => item.controller.abort(), requestTimeoutMs);
        // Assimilate the Supabase thenable exactly once and capture rejection
        // immediately, including when account admission never consumes it.
        Promise.resolve().then(() => {
          if (item.controller.signal.aborted) throw cancelled();
          return request({ mode: item.mode, offset: 0, limit: item.pageSize + 1, signal: item.controller.signal });
        }).then((value) => finish({ value }), (error) => finish({ error }));
      });
      return item;
    },
    admit(ownerId) {
      if (!record) return;
      if (record.ownerId !== ownerId || !valid(record) || context().memberId !== ownerId) cancel(record);
      else record.admitted = true;
    },
    take({ ownerId, mode, offset, requestId, reset, requestFresh, pageSize = initialPageSize }) {
      const item = record;
      if (!item) return null;
      const eligible = () => item.admitted && item.ownerId === ownerId && item.mode === mode && offset === 0 && reset === true
        && item.pageSize === pageSize
        && requestId === item.requestEpoch + 1 && context().requestEpoch === requestId
        && context().memberId === ownerId && valid(item);
      if (!eligible()) { cancel(item); return null; }
      record = null;
      return item.promise.then((outcome) => {
        clearTimer(item.expiryTimer);
        if (!eligible()) {
          cancel(item);
          const value = context();
          if (sameAuthorization(item) && typeof requestFresh === 'function' && value.memberId === ownerId && value.mode === mode
            && value.requestEpoch === requestId && home(value)) return requestFresh();
          throw cancelled();
        }
        if ('error' in outcome) throw outcome.error;
        return outcome.value;
      });
    },
    invalidate,
    authorization(ownerId) {
      const item = { ownerId, generation };
      return ownerId && sameAuthorization(item) ? Object.freeze(item) : null;
    },
    isCurrentAuthorization: sameAuthorization,
    reconcile() {
      if (record && !valid(record)) cancel(record);
      for (const operation of [...pending]) if (!valid(operation)) cancel(operation);
    },
    auth(event, session) {
      const previousGeneration = generation;
      const owner = session?.user?.id || null;
      if (event === 'SIGNED_OUT' || event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN'
        || (['INITIAL_SESSION', 'TOKEN_REFRESHED'].includes(event) && authKnown && authOwner !== owner)) {
        generation++; invalidate();
      } else if (event === 'INITIAL_SESSION' && record && record.ownerId !== owner) {
        generation++; invalidate();
      }
      if (['INITIAL_SESSION', 'SIGNED_IN', 'SIGNED_OUT', 'TOKEN_REFRESHED', 'PASSWORD_RECOVERY'].includes(event)) {
        authKnown = true; authOwner = event === 'SIGNED_OUT' ? null : owner;
      }
      return generation !== previousGeneration;
    },
  });
}
