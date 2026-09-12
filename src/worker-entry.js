import router from './asset-router.js';
import { handleDmRealtimeRequest } from './dm-realtime-api.js';
import { handlePublicIndexingRequest } from './public-indexing-api.js';

export { DmRealtimeHub } from './dm-realtime-hub.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/dm-realtime/')) {
      const response = await handleDmRealtimeRequest(request, env);
      if (response) return response;
    }

    const indexingResponse = await handlePublicIndexingRequest(request, env);
    if (indexingResponse) return indexingResponse;

    return router.fetch(request, env, ctx);
  },
};
