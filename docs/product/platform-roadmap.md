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
| Cloudflare Workers | API/media authorization, signed upload and delivery flows, event handling, authentication at the edge, and trusted server-side integration boundaries |
| Cloudflare Durable Objects | Short-lived, strongly coordinated realtime state for active sessions, WebSocket connections, presence, roles, speaker queues, and session lifecycle |
| Cloudflare Realtime | WebRTC/SFU media transport for approved live audio or video features; Durable Objects coordinate sessions but do not carry the media stream |
| Firebase | Push delivery and application operations: Firebase Cloud Messaging, Crashlytics, Performance Monitoring, App Distribution, and a reviewed App Check rollout |

Supabase remains the only canonical application database and identity system.
R2 remains the media origin. Durable Objects coordinate active realtime
sessions, while durable product records remain in Supabase. Firebase complements
these services; it does not replace them.

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
4. Apply long-lived immutable cache headers to versioned R2 objects and verify
   Cloudflare cache hits.
5. Use responsive image sources, explicit dimensions, lazy loading below the
   fold, and selective preloading for the first visible media.
6. Keep placeholders/skeletons stable so content does not jump while media is
   arriving.
7. Test with throttled mobile profiles and real low-bandwidth devices before
   production rollout.

Firebase Performance Monitoring may add useful client measurements later, but
it is not the primary fix for slow images. The delivery path, file sizes,
variants, cache behaviour, and rendering strategy must be corrected first.

### Acceptance gate

- representative feed images use appropriately sized variants;
- repeat visits demonstrate effective edge/browser caching;
- the first visible Sauti is prioritised without eagerly downloading the whole
  feed;
- media failure and slow-network states remain usable;
- before/after timings are recorded for staging and production-like tests;
- no regression to upload validation, media privacy, or R2 authorisation.

## Milestone 2 — Firebase and Durable Objects integration

**Priority:** Soon, after the media baseline is measured  
**Start rule:** The Firebase and Durable Objects implementation tracks begin on
the same scheduled start date.  
**Goal:** Add push notifications, release observability, and reliable realtime
coordination while preserving the existing Supabase/R2 architecture.

### Phase 2.1 — Shared environment and privacy foundation

- create separate Firebase configurations and Durable Object namespaces for
  staging and production;
- register only the SautiLink web/Android clients that are actually shipped;
- document data collection, retention, consent, deletion, and live-session
  behaviour;
- keep service credentials only in encrypted server/deployment secrets;
- authenticate every Durable Object connection through a trusted Worker using
  the existing Supabase identity and authorisation model;
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

### Phase 2.3 — Realtime coordination with Durable Objects

Begin with one isolated realtime coordinator per active live session. Its
responsibilities may include:

- authenticated WebSocket connections using the Hibernation API;
- participant presence and safe reconnect handling;
- host, moderator, speaker, listener, mute, and hand-raise state;
- speaker queue ordering and room lifecycle;
- rate limits, participant limits, idle cleanup, and abuse controls;
- emitting only the final product events that need durable persistence to
  Supabase;
- triggering privacy-safe FCM alerts for approved invitations or live events.

For live audio, Durable Objects coordinate the room while Cloudflare Realtime's
WebRTC/SFU layer transports audio. R2 stores a recording only if recording is
introduced as a separately approved, clearly disclosed, and consented feature.

After the live-session coordinator is proven, the same pattern may be reviewed
for lightweight presence, typing indicators, delivery state, or other
realtime interactions. These are not enabled automatically by this milestone.

### Phase 2.4 — Reliability and release tooling

- Crashlytics for Android crash diagnosis;
- Performance Monitoring for approved client performance signals;
- App Distribution for controlled staging builds;
- App Check only on compatible endpoints after staged enforcement proves that
  legitimate clients are not blocked;
- Durable Object alarms and WebSocket hibernation for safe cleanup and reduced
  idle cost;
- analytics remains optional and requires a separate privacy/consent decision.

### Acceptance gate

- no Firebase Auth, Firestore, or Realtime Database is introduced for canonical
  SautiLink accounts or product data;
- Durable Objects do not become a second identity, message, Room, or social
  database;
- existing Supabase Auth sessions and RLS behaviour remain unchanged;
- every live-session role and control action is authorised server-side;
- staging and production use separate Firebase configurations, Durable Object
  namespaces, and deployment migrations;
- WebSocket reconnect, hibernation, stale-session cleanup, host departure, and
  moderator handover pass in staging;
- live audio continues through the intended WebRTC/SFU media path rather than
  Durable Object WebSocket messages;
- no secrets are present in the repository or browser bundle;
- users can control notification categories;
- duplicate, stale, and invalid device tokens are handled safely;
- foreground, background, offline, denied-permission, logout, and
  account-deletion scenarios pass in staging;
- push payloads do not reveal private message content on a locked device;
- Firebase and Durable Objects can each be disabled independently without
  affecting the core website, Auth, database, or stored media.

## Explicitly out of scope for this milestone

- moving SautiLink Auth from Supabase to Firebase or Durable Objects;
- duplicating profiles, posts, Rooms, messages, or social relationships in
  Firestore, Firebase Realtime Database, or Durable Object storage;
- moving media objects from R2 to Firebase Storage or Durable Object storage;
- relaying live audio/video media through Durable Object WebSocket messages;
- treating Firebase, Durable Objects, WebSockets, or transport encryption as
  end-to-end encryption;
- sending E2EE message plaintext through notification payloads;
- recording live sessions without a separate product, privacy, retention, and
  consent review;
- enabling broad analytics before privacy review and consent requirements are
  agreed.

End-to-end encryption remains a separate security architecture milestone. If
introduced later, cryptographic keys and plaintext must remain outside Firebase
push payloads and outside server-readable coordination state by design.

## Recommended implementation order

1. Complete the media baseline and highest-impact image-delivery fixes.
2. On the same scheduled start date, open separate Firebase and Durable Objects
   implementation tracks.
3. Prepare separate staging and production Firebase configurations, Durable
   Object namespaces, bindings, and migrations.
4. Add the Supabase device-token/preferences migration with RLS tests.
5. Build a minimal Durable Object live-session coordinator with authenticated
   WebSocket hibernation and no audio transport.
6. Add the trusted Worker-to-FCM delivery path.
7. Integrate Cloudflare Realtime/WebRTC for the live-audio media path.
8. Integrate notification permission and token lifecycle in the client.
9. Add Crashlytics, Performance Monitoring, and App Distribution.
10. Trial App Check in monitor-only/staging mode before enforcement.
11. Run privacy, security, load, reconnect, performance, cost, and rollback
    checks.
12. Roll out gradually and compare measured results against the baseline.

Each implementation phase must use the normal branch, tests, pull request,
review, and verified deployment flow. Architecture boundaries in this roadmap
must not be widened silently during implementation.

## Technical references

- [Cloudflare Durable Objects overview](https://developers.cloudflare.com/durable-objects/)
- [Cloudflare Durable Objects WebSocket guidance](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- [Cloudflare Realtime SFU](https://developers.cloudflare.com/realtime/sfu/)
