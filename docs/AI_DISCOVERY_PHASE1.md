# SautiLink AI Discovery — Phase 1 foundation (opt-in, not deployed)

## Scope

This change provides a tested Workers AI + Vectorize text-embedding and
candidate-ranking foundation. It does **not** change production For You,
Following, Short Videos, Supabase SQL, Android release, or deployment workflows.

The existing `social_home_feed` and RLS-aware reads remain authoritative.
Until an audited integration is enabled, production behavior stays unchanged.

## Verified live schema (2026-11-14)

`public.social_posts`: `id`, `author_id`, `body`, `visibility`,
`post_status`, `moderation_state`, `deleted_at`, `circle_id`,
`parent_post_id`, `created_at`, likes/comments/reposts. These are the fields
expected by `src/ai-discovery-core.js`.

Only top-level posts matching all of these may be indexed:

- `visibility = 'public'`
- `post_status = 'published'`
- `moderation_state = 'visible'`
- `deleted_at IS NULL`
- `circle_id IS NULL` and `parent_post_id IS NULL`

Followers-only, circle, deleted, and removed posts are explicitly excluded.
Profiles/relationships can add further eligibility restrictions.

## Model and index

- Workers AI: `@cf/google/embeddinggemma-2`
- Embedding dimensions: **256** for both document and query
- Vectorize metric: **cosine**
- Index name proposal (staging only): `sautilink-discovery-staging`
- Binding proposal: `DISCOVERY_VECTOR_INDEX`
- Workers AI binding: `AI`
- Vectorize metadata index: `visibility` (string)

Example setup, **only after access/plan/cost approval** and in an isolated
staging deployment:

```bash
npx wrangler vectorize create sautilink-discovery-staging --dimensions=256 --metric=cosine
npx wrangler vectorize create-metadata-index sautilink-discovery-staging --property-name=visibility --type=string
```

Wrangler example (do not blindly copy into production):

```json
{
  "ai": { "binding": "AI" },
  "vectorize": [
    { "binding": "DISCOVERY_VECTOR_INDEX", "index_name": "sautilink-discovery-staging" }
  ]
}
```

## Integration contract

1. Run an asynchronous ingestion job when a public post is published or edited,
   using a trusted server-side Supabase query (never user-submitted post JSON).
2. Before indexing, load current visibility/moderation state and author access
   state. Recheck again after processing for races with deletes/privacy changes.
3. On edit, replace the existing vector; on delete/visibility change/moderation
   removal, invoke `removePostVector`. Design retries and periodic reconciliation.
4. For a recommendation, retrieve semantic candidate IDs with
   `findSimilarPublicPostIds`. Treat Vectorize as **untrusted search data**,
   not an authorization authority.
5. Intersect candidates with **viewer-specific** Supabase RLS results, block/mute
   and reporting policy, age eligibility, moderation checks, and deduplicate.
   Set `viewer_authorized = true` only after server-side checks.
6. Use `rerankEligiblePublicPosts` **on the verified candidates** and preserve
   original post/media hydration through existing APIs.
7. Default disabled. No public AI API, raw vectors, authenticated identity
   leakage, or direct unauthenticated search endpoint.
8. Keep For You's old feed as a reliable fallback. Following stays chronological.
   Short Videos can receive a separate opt-in experiment only after testing.

Avoid AI inference per scroll, per item, and per feed request. Embed on changes
and fetch a bounded set of candidates asynchronously. Do not ingest private
messages, private media, OTPs, phone numbers, or internal moderation evidence.
Use Workers AI/Vectorize quotas, retry budgets, tracing, and rate limits.

## Tests

```bash
node --test tests/ai-discovery-core.test.mjs
npm test
npm run build:production
npm run verify:production-artifact
```

CI may run these on pull requests; do not claim these commands passed until
their actual results have been checked.

## Required gates before a live rollout

- GitHub proprietary repository privacy review and appropriate private branch
- Review current production/staging deployment ownership and binding permissions
- Confirm Workers AI model availability, account plan, Vectorize quotas and costs
- Implement trusted ingestion/retention pipeline with deletion reconciliation
- Implement viewer-scoped RLS eligibility (never trust client flags)
- Staging integration, Android/Web smoke tests, load tests and cache metrics
- Compare feed p50/p95 latency, candidate relevance, diversity, moderation
  leakage, per-request cost, engagement and failure rates
- Gradual server-side feature flag, measurable A/B test, monitored rollback
- Explicit approval before creating paid resources or changing production feeds

## Sources

- https://developers.cloudflare.com/workers-ai/models/embeddinggemma-2/
- https://developers.cloudflare.com/vectorize/get-started/intro/
- https://developers.cloudflare.com/vectorize/platform/limits/


## Phase 2: viewer-scoped semantic preview (staging only)

The Worker now recognizes exactly this URL:

\`GET https://test.sautilink.com/api/internal/ai-discovery/preview?q=technology\`

**It returns 404 by default** (no deployment/bindings/flag have been enabled).
The route is hard-restricted to \`test.sautilink.com\`, including when flags
are set incorrectly on production. It requires a valid Supabase user JWT and
returns IDs only, not post bodies, vectors, or private data.

Prerequisites for a controlled staging rollout:

- \`AI_DISCOVERY_PREVIEW_ENABLED=true\` on the staging Worker **only**
- \`DISCOVERY_SUPABASE_URL\`: official Supabase project URL, HTTPS
- \`DISCOVERY_SUPABASE_PUBLISHABLE_KEY\`: publishable/anon-only Supabase key
- \`AI\`: Workers AI binding
- \`DISCOVERY_VECTOR_INDEX\`: Vectorize index binding (256 dimensions)
- \`AI_DISCOVERY_PREVIEW_LIMITER\`: Cloudflare rate-limit binding with a strict
  per-authenticated-user limit. This is mandatory, not optional.

No \`service_role\` or elevated database key is allowed in the preview route.
The API performs \`/auth/v1/user\` verification and a **JWT-scoped SELECT from
\`social_posts\`** using PostgREST. Production Supabase policies for this
table currently enforce visibility, discoverability, moderation, and
bidirectional block plus mute relationships. We also recheck publication,
visibility, moderation, and top-level post flags before returning matches.

A failed auth request gives 401; failed database or AI calls give a generic
503 so the existing feed can remain the fallback. The preview's \`q\`
parameter is explicit user text, capped at 180 characters and rate-limited.
This endpoint is **not yet personalized ranking**; it is a staging-only
semantic-search verification probe. No Android/Web client change has been made.

Security reminder: user-scoped PostgREST/RLS must be preserved if later
refactoring this adapter. Do not replace it with \`service_role\`, cached
authorization flags, or a publicly accessible Vectorize endpoint.

Run this additional test:

\`\`\`bash
node --test tests/ai-discovery-preview-api.test.mjs
\`\`\`

No new paid resources have been provisioned. Review cloud costs and
availability before enabling indexing or serving requests. The privacy and
performance audit gates above still apply.
