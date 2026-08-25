# SautiLink Share a Sauti and Stream preview

**Milestone:** Preview 04 — Share a Sauti & Stream

**Branch:** `phase-1/share-stream-preview`

**Production impact:** None. The preview uses seeded browser state, blocks all
network connections and does not apply a database migration.

## Outcome

This milestone turns the Stream and composer placeholders into a reviewable
interaction contract for:

- a restrained 500-character composer with audience and reply controls;
- local drafts that can be saved, restored and kept while offline;
- a newly shared Sauti appearing immediately at the top of the Stream;
- Selected and Following Stream views using seeded chronological content;
- explicit loading, empty, offline and recoverable error states;
- visible reply, reshare, like, view, save and share affordances; and
- responsive light/dark presentation with keyboard-accessible dialogs.

## Donor intake

Meadows contributes product research for composer and feed rhythm. Bluesky
contributes product-pattern research for posting flow, state feedback and
accessible controls. Misskey is an AGPL product-pattern reference only; no
Misskey code is copied. The implementation, visual system and copy in this
preview are original SautiLink work.

No donor database, authentication, upload pipeline, analytics, deployment
configuration or brand assets are accepted. Supabase remains the canonical
source of truth, while Cloudflare Workers and R2 remain the planned API,
rate-limiting and media boundary.

## Production gate

Before these surfaces can replace production `/app/`:

1. the Preview 04 visual and interaction contract must be approved;
2. canonical posts, relationships and draft rules require migrations, explicit
   grants, indexes, RLS policies and SQL policy tests;
3. create-post requests require Worker rate limits, idempotency and moderation
   hooks;
4. feed pagination, ranking boundaries and realtime refresh need load and
   failure testing;
5. media actions wait for the dedicated R2 milestone; and
6. browser E2E, Supabase advisors and a Cloudflare production dry-run must pass.
