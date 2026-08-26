# Product Experience, Integration & Production Hardening Preview

**Phase:** 12  
**Visual milestone:** Preview 08  
**Status:** Seeded, network-disabled product contract. This document does not authorize a production merge or deployment.

## Included

- Functional Search and Discover filtering across public voices, Sauti and Circles.
- Ready, loading, offline, error and no-result search states.
- Notification categories, unread state, mark-all-read behavior and preference entry point.
- Account, privacy, safety, notification, accessibility, language and data-control settings.
- Responsive light/dark presentation and a dedicated mobile device lab.
- An explicit promotion path from the isolated preview to test.sautilink.com and later production.

Private DM / Messages remains outside the MVP and is not added by this milestone.

## Search production contract

Production search must use normalized bounded queries, cursor pagination, result-type limits and abuse throttles. Public profile visibility and discoverability settings must be enforced by PostgreSQL policies and server-side query construction, not only hidden in the client. Initial retrieval should use PostgreSQL full-text and carefully indexed matching before any separate search service is considered.

Search responses must never expose private account-profile fields, unpublished content, private Circle membership, moderation context or blocked/muted relationships. Every result type needs deterministic ordering and an opaque continuation cursor.

## Notification production contract

Notifications are derived records, not authorization. A notification can point to a resource only after the requesting member is authorized to read that resource. Creation should be idempotent, fan-out should be asynchronous, and reads should use bounded cursor pagination. Unread state must update atomically and support mark-one and mark-all operations without trusting a client-supplied member identifier.

Email delivery preferences belong in private account settings. Browser bundles must not receive service-role credentials, email-provider secrets or Queue credentials.

## Settings and data boundaries

Public profile choices belong with public social-profile fields. Email, sessions, notification delivery, accessibility choices and deletion state remain private. Security-sensitive changes require a recent authenticated session; destructive account operations require re-authentication, an auditable server workflow and a reversible grace period before permanent deletion.

Supabase Auth/PostgreSQL remains canonical. RLS protects member-owned data. Cloudflare Workers validate privileged writes, apply rate limits and structured errors, and keep credentials out of the browser. R2, Queues, KV and D1 are used only in their documented roles; no binding or production resource is created by this preview.

## Promotion gate

1. Keep the preview network-disabled and seeded until the visual and interaction contract is stable.
2. Add typed server contracts, SQL migrations, RLS tests, rate-limit tests and production-safe observability.
3. Deploy to test.sautilink.com with test accounts and non-production data.
4. Run desktop/mobile E2E, accessibility, rollback, session, privacy and abuse tests.
5. Promote the exact reviewed build to production only after the test environment passes.

No production table, migration, Worker route, R2 object, Queue message, notification or settings mutation is created by Preview 08.
