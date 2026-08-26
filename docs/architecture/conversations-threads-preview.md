# SautiLink Conversations and Threads preview

**Milestone:** Preview 06 — Conversations & Threads

**Branch:** `phase-1/conversations-preview`

**Production impact:** None. The preview uses seeded browser state, blocks all
network connections and does not create a database table, Worker route or production notification.

## Outcome

This milestone defines the reviewable interaction contract for:

- opening a Sauti as a focused conversation without losing its source context;
- direct and visually bounded nested replies;
- Relevant and Newest reply ordering;
- a 500-character reply composer with an explicit reply target;
- online, loading, offline queue and recoverable send-failure states;
- local like, Reshare, Quote Sauti, Saved and share actions;
- collapsed replies controlled by the member's safety settings;
- reply notifications that return to the source conversation; and
- responsive light/dark presentation with keyboard and touch-friendly controls.

All members, posts, replies, counters and timestamps are seeded fictional data.
No action leaves the browser preview.

## Canonical production model

Supabase Postgres remains the source of truth. A reply is a Sauti with:

- `parent_post_id` for its immediate parent;
- `root_post_id` for bounded conversation retrieval;
- author, visibility, moderation and lifecycle fields shared with top-level
  Sauti; and
- database constraints preventing self-parenting, cross-audience replies and
  invalid root relationships.

The public API returns a bounded depth for the reading surface. Deeper branches
open independently rather than creating an unbounded recursive query. Root and
reply pages use stable cursor pagination; counts are derived and repairable.

## Worker boundary

Production reply creation requires an authenticated Worker request with:

1. schema validation and a 500-character server limit;
2. target existence, audience and reply-permission checks;
3. account-state, block and mute enforcement;
4. per-account and per-conversation rate limits;
5. an idempotency key so retries cannot create duplicate replies;
6. moderation and abuse signals before fan-out;
7. one canonical Postgres transaction; and
8. asynchronous notification delivery through a Queue after commit.

Offline drafts remain local until the member explicitly retries. Failed or
queued UI state never implies that the canonical write succeeded.

## RLS and visibility

RLS must apply the root Sauti's audience, Circle membership, block relationships
and account state to every reply read. A member may edit or delete only their
own eligible reply. Moderators use separately audited service paths; the client
never receives a service-role credential.

Collapsed, muted and moderation-limited replies preserve conversation shape
without exposing restricted content. Quote Sauti stores a source reference and
renders an unavailable placeholder if the source later becomes inaccessible.

## Donor intake

Bluesky contributes post-thread and accessible context product research.
Meadows contributes comment rhythm research. Lemmy contributes bounded threaded
discussion and moderator-state research. Mastodon contributes content-warning,
mute and safety-language research. No donor component, SQL, authentication,
analytics, protocol code, assets or product copy is imported. This preview is
original SautiLink code and visual design.

## Production gate

Before conversations are enabled publicly:

1. Preview 06 must be approved;
2. posts/replies migrations need constraints, indexes, grants and RLS tests;
3. Worker create/read/delete routes need authentication, idempotency, rate-limit
   and authorization tests;
4. notification Queue jobs must be durable, deduplicated and observable;
5. moderation, block, mute, report, deletion and appeal behavior must pass;
6. cursor pagination and bounded-depth queries need load tests; and
7. browser E2E, Supabase advisors and a Cloudflare production dry-run must pass.
