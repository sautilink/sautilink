# Media performance implementation resume checkpoint

**Date:** 2026-09-11  
**Status:** Approved and ready to start  
**Canonical repository:** `sautilink/sautilink`  
**Production branch:** `main`  
**Production domain:** `https://sautilink.com`

## Resume instruction

When Mr. X opens a new chat and says **"tuanze kuifanya"**, **"tuanze image
performance"**, or an equivalent instruction, begin the media-performance
milestone described here and in
[`docs/product/platform-roadmap.md`](../product/platform-roadmap.md).

Do not ask the user to repeat the decisions below. Start with a read-only audit
of the current production media path and repository configuration, then proceed
through the normal branch, preview, tests, pull request, exact-head verification,
merge, and production verification workflow.

## Confirmed production architecture

- `https://sautilink.com` is the public production website.
- `main` in `sautilink/sautilink` is the production source branch.
- Cloudflare Workers remains the production application/runtime boundary.
- Supabase remains the canonical Auth and PostgreSQL data system.
- Cloudflare R2 remains the media object store.
- `test.sautilink.com` is not the production target for this work.
- Use an isolated branch and preview deployment for safety before merging to
  `main`; do not move the product back to the old staging domain.
- Do not migrate SautiLink to Vercel as part of this milestone. Vercel was
  reviewed as technically possible for a frontend, but it would add a second
  delivery platform and would not directly solve the current image path.

## Approved user-visible outcome

Images must remain sharp and visible without requiring a click:

- preserve every original uploaded image in R2;
- generate responsive feed/thumbnail variants sized for the actual display
  surface and device pixel density;
- allow the browser to select an appropriate variant rather than downloading
  the original file for every feed card;
- load the first visible media promptly;
- lazy-load only below-the-fold media that the user has not reached;
- keep stable placeholders while media is arriving;
- open a higher-resolution/original asset for fullscreen or detailed viewing,
  while keeping the normal feed image fully visible and clear;
- apply edge/browser caching to versioned variants without reducing their
  visual quality.

Exact variant dimensions, formats, compression settings, cache lifetimes, and
migration behaviour must be chosen from measurements of the current code and
real media samples. Do not guess them before the audit.

## Safety boundaries

This milestone is incremental and must not redesign or replace unrelated
systems:

- do not delete, overwrite, recompress, or rename existing original R2 objects;
- do not change Supabase Auth, sessions, RLS, posts, profiles, Rooms, Messages,
  notifications, or moderation contracts unless a demonstrated media-specific
  blocker is separately reviewed;
- do not expose R2, Supabase service-role, Firebase, or other privileged secrets
  to the browser bundle;
- place the new delivery behaviour behind a reversible feature flag or an
  equally safe rollback boundary;
- preserve existing media authorisation and upload validation;
- keep the previous delivery path available until the replacement is verified;
- stop rollout and roll back if image quality, privacy, upload reliability, or
  core navigation regresses.

## Required implementation sequence

1. Audit the upload, storage, URL generation, feed rendering, profile rendering,
   Room rendering, cache headers, and current image dimensions.
2. Record a baseline for first-byte time, transferred bytes, decode time,
   Largest Contentful Paint, cache status, and representative slow-network
   behaviour.
3. Design the smallest compatible variant contract while preserving original
   object keys and existing database records.
4. Implement variant generation/delivery and responsive client selection behind
   the rollback boundary.
5. Prioritise above-the-fold media and lazy-load only later feed items.
6. Test upload, Home feed, post detail, profiles, Rooms, mobile, desktop,
   fullscreen, missing-image, unauthorised-media, offline, and throttled-network
   cases.
7. Compare image sharpness and measured timings against the baseline.
8. Merge only the verified exact PR head, then verify
   `https://sautilink.com` after deployment.

## Acceptance gates

- no user click is required to see a normal post image;
- representative feed images are visibly sharp on mobile and desktop;
- originals remain recoverable and unchanged in R2;
- transferred bytes are materially lower for oversized uploads;
- the first visible media is not blocked by below-the-fold downloads;
- repeat loads demonstrate working browser/edge caching;
- upload, access control, Home, profiles, Rooms, and fullscreen views pass;
- rollback is tested or otherwise demonstrated before production cutover;
- no unrelated product behaviour is changed.

## Later roadmap continuity

After the media baseline and highest-impact fixes are completed:

- Firebase and Cloudflare Durable Objects begin on the same scheduled start
  date, as recorded in the platform roadmap;
- Firebase supplies privacy-safe push delivery and approved app operations;
- Durable Objects coordinate active realtime session state;
- Cloudflare Realtime/WebRTC transports approved live audio;
- Supabase remains the canonical Auth/application database and R2 remains the
  media store;
- end-to-end encryption remains a separate reviewed security architecture
  milestone.

This checkpoint records decisions and readiness only. It does not claim that
the media-performance implementation has already been delivered.
