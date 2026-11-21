# SautiLink AI Discovery — Phase 2 Engineering Handoff
Date: 2026-11-14

## Current status
PR: https://github.com/sautilink/sautilink/pull/431
Branch: `feat/ai-discovery-foundation-20261114`

Changes are in a **draft PR**. No production deployment has been authorized.
The code provides opt-in building blocks, NOT a production-ready recommendation
feed. Android Play Store release and existing For You/Following/Short Videos
behavior remain unchanged.

## Implemented
- `src/ai-discovery-core.js`: EmbeddingGemma 2 (256 dimensions),
  Vectorize ID search and deterministic ranking; filters disallowed content.
- `src/ai-discovery-preview-api.js`: staging-only semantic-search probe,
  authenticated with Supabase JWT, protected by a mandatory rate-limit binding,
  and using viewer JWT-scoped PostgREST/RLS to hydrate public posts.
- `src/worker-entry.js`: route integration, disabled by default.
- `src/ai-discovery-ingestion.js`: queue-ready ingestion helper with
  two DB eligibility reads around inference, vector cleanup on privacy
  changes and safe failure on database errors. No route is exposed.
- Tests in `tests/ai-discovery-*.test.mjs`.

## Verified production data contracts
Supabase project `sautilink` uses PostgreSQL 17 in `eu-west-1`.
`public.social_posts` includes visibility, moderation, post_status,
deleted_at, audience_owner_id, author_id, body and updated_at. Current SELECT
RLS checks public availability, discoverability and block/mute relationships.
The preview must ALWAYS use a per-viewer JWT, never the service role.

## Missing / gated
1. Staging-only Cloudflare Workers AI and Vectorize bindings. Nothing has been
   provisioned yet; obtain plan/price approval before any billable resources.
2. A staging-specific rate-limit binding. Preview refuses to run without one.
3. Server-only Supabase ingestion adapter. Implement trusted `fetchPost` and
   `authorAndAudienceDiscoverable` readers with authoritative permissions.
   Never accept indexing records from the client.
4. Queue trigger for publish/edit/delete/moderation/visibility changes.
   Scheduled reconciliation and idempotency are needed for out-of-order events
   and eventual consistency of Vectorize writes/deletes.
5. End-to-end staging verification of actual Workers AI model response,
   Vectorize metadata filtering, protected Supabase reads and quota behavior.
6. Personalized user interests. The current preview uses a user-supplied
   semantic query; it is NOT yet personalized For You. Design privacy-respecting
   interest features and candidate retrieval.
7. Android Kotlin/Jetpack Compose integration after API contract and security
   reviews. Ensure zero breaking changes and server-controlled gradual rollout.
8. CI results for the newest PR commits and performance/cost benchmarks.

## Recommended rollout sequence
- Keep AI flags disabled; no production traffic or Android changes.
- Validate new unit tests, existing full suite and production build.
- Configure staging-only AI/Vectorize/rate limits after approval.
- Build trusted ingestion and reconciliation; seed only eligible public posts.
- Exercise authenticated semantic preview with test users, including blocked,
  muted, deleted and undiscoverable authors.
- Compare old feed versus AI-enhanced candidate ranking on performance,
  privacy, discovery diversity and real costs.
- Review every change; deploy gradually with kill switch and rollback.

Never use Vectorize search results as authorization. Never send private messages,
OTP codes, secret keys or restricted content to Workers AI. Do not introduce
separate database copies of users or bypass existing Supabase RLS.

## Tests
`node --test tests/ai-discovery-core.test.mjs`
`node --test tests/ai-discovery-preview-api.test.mjs`
`node --test tests/ai-discovery-ingestion.test.mjs`
`npm test`
`npm run build:production`
`npm run verify:production-artifact`

Report actual results only. The PR must not be merged/deployed until security
checks and a responsible reviewer approve the rollout.
