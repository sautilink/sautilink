# SautiLink Phase 1: Hybrid Foundation

Status: proposed in `phase-1/mvp-foundation`. This document defines the
platform boundary; it does not change the current public website or waitlist.

## Deployment boundary

- `sautilink.com` remains the current public website, waitlist, and legal
  surface during Phase 1.
- The social application will be built and deployed independently before any
  launch cutover.
- The API will run on Cloudflare Workers. The current static Worker deployment
  remains unchanged by this foundation slice.

## Source-of-truth ownership

| Concern | Authoritative service | Notes |
| --- | --- | --- |
| Authentication and sessions | Supabase Auth | JWT-based identity; no authorization decisions use user-editable metadata. |
| Private account record | Supabase `account_profiles` | Email/WhatsApp preferences remain private and owner-only. |
| Public social profile | Supabase `social_profiles` | Contains only fields safe for public discovery. |
| Posts, comments, follows, reactions, reports | Supabase Postgres | Added in separate feature migrations and protected by RLS. |
| Images, video, and audio | Cloudflare R2 | Postgres stores object keys and metadata, never binary media. |
| Feed and trending read models | Cloudflare D1 | Derived and rebuildable; never the only copy of user content. |
| Hot cache and configuration | Cloudflare KV | Eventual consistency is acceptable for cached values only. |
| Upload/media processing | Cloudflare Queues | Work is retriable and stays off the request path. |
| API gateway and rate limits | Cloudflare Workers | Verifies identity, applies limits, and coordinates services. |

## Consistency rules

1. Supabase is the canonical database for social writes.
2. D1 receives derived feed and counter updates asynchronously.
3. A D1 miss or outage falls back to a bounded Supabase query.
4. D1 data must be rebuildable from canonical events and records.
5. Media uploads go directly to R2 using short-lived authorization; the API
   records metadata only after the object is accepted.

## Security rules

- RLS is enabled on every exposed Supabase table.
- Browser clients use only Supabase publishable keys. Secret/service-role keys
  remain in server-managed secrets.
- `account_profiles` is private. Public discovery reads `social_profiles`.
- Public usernames are synchronized from the authoritative account record and
  cannot be edited directly through the Data API.
- R2 object keys are scoped to `profiles/{user-id}/...` for profile media.
- Turnstile, request limits, content-type validation, and file-size limits are
  required before public uploads are enabled.

## Phase 1 pull-request sequence

1. Foundation: architecture, public/private profile boundary, RLS, and tests.
2. Authentication: sign-up, sign-in, sign-out, recovery, and onboarding.
3. Profiles: profile editing, username rules, and R2 avatar/header uploads.
4. Text posts and chronological feed.
5. Reactions, comments, reposts, and follow relationships.
6. Reports, blocks, account deletion, and moderation foundations.

Each feature is reviewed and tested in its own pull request. Nothing is merged
to `main` without explicit approval.
