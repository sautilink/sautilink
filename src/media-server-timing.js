// Numeric stage durations only. Caller data, paths and authorization never
// become timing labels or descriptions, and failed responses remain untouched.
export function createMediaServerTiming(clock = () => performance.now()) {
  const started = clock();
  const durations = { rls: 0, ready: 0, hls: 0 };
  const bounded = value => Number.isFinite(value) ? Math.min(120000, Math.max(0, value)) : 0;
  async function measure(stage, operation) {
    const begin = clock();
    try { return await operation(); }
    finally { durations[stage] += bounded(clock() - begin); }
  }
  return Object.freeze({
    rls: operation => measure('rls', operation),
    ready: operation => measure('ready', operation),
    hls: operation => measure('hls', operation),
    response(response) {
      if (![200, 206].includes(response.status)) return response;
      const header = [
        `rls;dur=${bounded(durations.rls).toFixed(1)}`,
        `ready;dur=${bounded(durations.ready).toFixed(1)}`,
        `hls;dur=${bounded(durations.hls).toFixed(1)}`,
        `edge;dur=${bounded(clock() - started).toFixed(1)}`,
      ].join(', ');
      const headers = new Headers(response.headers);
      headers.set('Server-Timing', header);
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    },
  });
}
