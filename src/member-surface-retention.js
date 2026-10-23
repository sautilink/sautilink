/** Presentation freshness only: no records, media bytes or authorization are cached. */
export function createMemberSurfaceRetention({ now = Date.now, freshForMs = 30000 } = {}) {
  const rendered = new Map();
  const owns = (surface, memberId, context = '') => {
    const entry = rendered.get(surface);
    return Boolean(memberId && entry?.memberId === memberId && entry.context === context);
  };
  return Object.freeze({
    owns,
    isFresh(surface, memberId, context = '') {
      if (!owns(surface, memberId, context)) return false;
      const age = now() - rendered.get(surface).completedAt;
      return age >= 0 && age < freshForMs;
    },
    completed(surface, memberId, context = '') {
      if (!memberId) return;
      rendered.delete(surface);
      rendered.set(surface, { memberId, context, completedAt: now() });
      while (rendered.size > 8) rendered.delete(rendered.keys().next().value);
    },
    invalidate(surface) {
      if (surface === undefined) rendered.clear();
      else rendered.delete(surface);
    },
  });
}
