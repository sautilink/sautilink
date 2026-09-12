# Messages Durable Objects realtime — 2026-09-12

## Scope
- Add Cloudflare Durable Objects as an additional realtime transport for one-to-one Messages.
- Phase 36 is limited to ephemeral online presence and typing indicators.
- Supabase remains the source of truth for messages, attachments, read state, inbox state and safety rules.
- Existing Supabase Realtime stays active during the rollout as the fallback transport.

## Durable Object design
- `DmRealtimeHub` is one SQLite-backed Durable Object namespace keyed by conversation ID.
- WebSocket Hibernation APIs are used through `acceptWebSocket`, `getWebSockets` and serialized socket attachments.
- The Durable Object does not store message bodies, attachment metadata, R2 object keys or message history.
- Accepted client events are bounded to typing state and ping/pong health traffic.

## Authorization and privacy
- The edge Worker authenticates the signed-in Supabase session before forwarding a WebSocket to the Durable Object.
- Conversation access is checked through the existing `dm_conversations` participant RLS policy.
- Blocks are checked in both directions before connection.
- `social_member_preferences.activity_status` must be enabled before presence/typing can connect.
- Only publishable Supabase keys are configured; no service-role or privileged database key is introduced.
- The browser does not put the access token in the URL query string. The authenticated WebSocket protocol value is consumed by the edge Worker and is not forwarded to the Durable Object.

## Browser rollout
- The Durable Objects client runs alongside the existing Supabase Realtime channels.
- If the Durable Objects socket is unavailable, closes, or fails to reconnect, Supabase Realtime continues to provide the existing behavior.
- The existing text-message insert path, media send path, read receipts and message safety controls are unchanged.
- Same-origin WebSocket CSP is explicitly allowed for `sautilink.com` and `test.sautilink.com`.

## Environments
- Production uses the `DM_REALTIME_HUB` Durable Object binding and production Supabase publishable identity.
- `test.sautilink.com` uses its own Durable Object namespace but authenticates against the same production Supabase account backend used by the staging frontend, so browser sessions and RLS remain consistent.
- No Supabase migration is required for Phase 36.

## Rollout gates
- Focused Phase 36 tests verify Hibernation APIs, server-side authorization, no privileged credentials, fallback preservation, build integration and Wrangler configuration.
- Production artifact verification checks the Durable Object client, Worker entrypoint, authorization layer and SQLite-backed binding.
- Production cutover must return `ready: true` from `/api/dm-realtime/status` after deployment.
- Production is not merged from the feature branch unless exact-head repository CI and Wrangler validation pass.

## Rollback
- Durable Objects can be removed from the browser injection, Worker entrypoint and Wrangler binding without migrating message data.
- Supabase Realtime remains intact throughout this phase, so rollback does not require restoring message persistence or history.

## Follow-up after stability
- After real-world presence/typing behavior is stable, evaluate whether any Supabase realtime presence/broadcast traffic can be reduced. Do not remove it during this rollout.
- Re-authorize on future socket leases if we later need immediate remote revocation for block/activity-status changes on already-open sockets.
