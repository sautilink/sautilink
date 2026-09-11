# SautiLink platform roadmap

**Status:** Active  
**Last updated:** 2026-09-11  
**Next delivery window:** Soon

This roadmap records the near-term platform plan for improving SautiLink's
performance and adding reliable mobile/web operational services without
splitting the product's source of truth across multiple databases.

## Approved service boundaries

| Service | SautiLink responsibility |
| --- | --- |
| Supabase | Canonical Auth, profiles, posts, Rooms, follows, reactions, comments, messages, notification records, preferences, moderation data, and Row Level Security |
| Cloudflare R2 | Images, video, audio, avatars, Room covers, generated media variants, and other large objects |
| Cloudflare Workers | API/media authorization, signed upload and delivery flows, event handling, and server-side integration boundaries |
| Firebase | Push delivery and application operations: Firebase Cloud Messaging, Crashlytics, Performance Monitoring, App Distribution, and a reviewed App Check rollout |

Supabase remains the only canonical application database and identity system.
R2 remains the media origin. Firebase complements these services; it does not
replace them.

## Milestone 1 — Media delivery and perceived-speed stabilization

**Priority:** Immediate  
**Goal:** Reduce slow image arrival and make the Stream feel responsive,
including on constrained mobile networks.

Planned work:

1. Measure the current image path end to end: upload size, transformation time,
   first-byte time, download size, decode time, and Largest Contentful Paint.
2. Generate bounded thumbnail and feed-sized variants instead of serving
   original uploads everywhere.
3. Prefer modern image formats where client compatibility permits.
4. apply long-lived immutable cache headers to versioned R2 objects and verify
   Cloudflare cache hits;
5. use responsive image sources, explicit dimensions, lazy loading below the
   fold, and selective preloading for the first visible media;
6. keep placeholders/skeletons stable so content does not jump while media is
   arriving;
7. test with throttled mobile profiles and real low-bandwidth devices before
   production rollout.

Firebase Performance Monitoring may add useful client measurements later, but
it is not the primary fix for slow images. The delivery path, file sizes,
variants, cache behavior, and rendering strategy must be corrected first.

### Acceptance gate

- representative feed images use appropriately sized variants;
- repeat visits demonstrate effective edge/browser caching;
- the first visible Sauti is prioritized without eagerly downloading the whole
  feed;
- media failure and slow-network states remain usable;
- before/after timings are recorded for staging and production-like tests;
- no regression to upload validation, media privacy, or R2 authorization.

## Milestone 2 — Firebase operational-services integration

**Priority:** Soon, after the media baseline is measured  
**Goal:** Add reliable push notifications, release testing, crash reporting,
and performance visibility while preserving the existing Supabase/R2
architecture.

### Phase 2.1 — Environment and privacy foundation

- create separate Firebase configurations for staging and production;
- register only the SautiLink web/Android clients that are actually shipped;
- document data collection, retention, consent, and deletion behavior;
- keep Firebase service-account credentials and FCM server credentials only in
  encrypted server/deployment secrets;
- exclude message bodies and other sensitive content from default push payloads.

### Phase 2.2 — Push notifications with FCM

- add a Supabase device-registration table tied to the authenticated user;
- protect token reads/writes with RLS and server-side validation;
- store notification preferences in Supabase;
- send FCM messages only from a trusted Worker/server path;
- derive pushes from canonical SautiLink notification events;
- begin with follows, reactions, comments, reposts, Room invitations, and
  privacy-safe message alerts;
- add idempotency, retry handling, invalid-token cleanup, rate limits, and
  abuse controls;
- revoke or detach device tokens on logout, account deletion, or explicit
  notification disablement.

FCM is a delivery channel, not the notification database. The in-app
notification record and read state remain in Supabase.

### Phase 2.3 — Reliability and release tooling

- Crashlytics for Android crash diagnosis;
- Performance Monitoring for approved client performance signals;
- App Distribution for controlled staging builds;
- App Check only on compatible endpoints after staged enforcement proves that
  legitimate clients are not blocked;
- analytics remains optional and requires a separate privacy/consent decision.

### Acceptance gate

- no Firebase Auth, Firestore, or Realtime Database is introduced for canonical
  SautiLink accounts or product data;
- existing Supabase Auth sessions and RLS behavior remain unchanged;
- no secrets are present in the repository or browser bundle;
- users can control notification categories;
- duplicate, stale, and invalid device tokens are handled safely;
- foreground, background, offline, denied-permission, logout, and
  account-deletion scenarios pass in staging;
- push payloads do not reveal private message content on a locked device;
- rollout can be disabled without affecting the core website or database.

## Explicitly out of scope for this milestone

- moving SautiLink Auth from Supabase to Firebase;
- duplicating profiles, posts, Rooms, messages, or social relationships in
  Firestore or Firebase Realtime Database;
- moving media objects from R2 to Firebase Storage;
- treating Firebase or Durable Objects as end-to-end encryption;
- sending E2EE message plaintext through notification payloads;
- enabling broad analytics before privacy review and consent requirements are
  agreed.

## Recommended implementation order

1. Complete the media baseline and highest-impact image-delivery fixes.
2. Prepare separate Firebase staging and production projects.
3. Add the Supabase device-token/preferences migration with RLS tests.
4. Add the trusted Worker-to-FCM delivery path.
5. Integrate notification permission and token lifecycle in the client.
6. Add Crashlytics, Performance Monitoring, and App Distribution.
7. Trial App Check in monitor-only/staging mode before enforcement.
8. Run privacy, security, performance, and rollback checks.
9. Roll out gradually and compare measured results against the baseline.

Each implementation phase must use the normal branch, tests, pull request,
review, and verified deployment flow. Architecture boundaries in this roadmap
must not be widened silently during implementation.
