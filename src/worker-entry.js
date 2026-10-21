import router from './asset-router.js';
import { handleDmRealtimeRequest } from './dm-realtime-api.js';
import { handleMaintenanceRequest } from './maintenance-premium-surface.js';
import { handlePublicIndexingRoutes } from './public-indexing-routes.js';
import { handleStoriesRequest, runStoriesAndStreamMaintenance } from './stories-api.js';

export { DmRealtimeHub } from './dm-realtime-hub.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    const maintenanceResponse = await handleMaintenanceRequest(request, url);
    if (maintenanceResponse) return maintenanceResponse;

    if (url.pathname.startsWith('/api/stories')) {
      const response = await handleStoriesRequest(request, env);
      if (response) return response;
    }

    if (url.pathname.startsWith('/api/dm-realtime/')) {
      const response = await handleDmRealtimeRequest(request, env);
      if (response) return response;
    }

    const indexingResponse = await handlePublicIndexingRoutes(request, env);
    if (indexingResponse) return indexingResponse;

    return router.fetch(request, env, ctx);
  },
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runStoriesAndStreamMaintenance(env));
  },
};
