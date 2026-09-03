# Phase 27 — Sauti Media + Cloudflare R2

## Status

Phase 27 completed on 2026-09-02.

- Feature PR: #32.
- Squash merge: `78a8dd63ca40909e6e89e21cb1f11af504af3c02`.
- Staging Supabase migration: applied to `sautilink-test`.
- Branch live smoke: passed.
- Post-merge `main` CI and `test.sautilink.com` deployment: passed.
- Cloudflare staging Worker version: `d8226d62-5597-4c6a-ba88-b59fc3981cd5`.
- Production remains unchanged.

## Goal

Add first-party image and short-video attachments to Sauti while keeping Supabase as canonical metadata and Cloudflare R2 as binary storage.

The browser never receives permanent R2 credentials.

## Initial media contract

A Sauti may contain up to four attachments.

Supported staging formats:

- JPEG, PNG and WebP images up to 8 MB each.
- MP4 video up to 25 MB and 90 seconds.
- Maximum validated image/video dimension: 8192 px.
- Alternative text: up to 1,000 characters per attachment.

Media-only Sauti are supported after the server has validated every attachment.

## Upload lifecycle

1. A signed-in member selects media in the composer.
2. The browser requests `POST /api/sauti-media/begin`.
3. The Worker validates the declared MIME type, size, owner and rate limit.
4. The Worker creates an unpredictable owner-scoped key below `sauti/{owner-id}/{media-id}.{ext}`.
5. The browser uploads the file through the authenticated same-origin Worker endpoint.
6. The Worker validates actual bytes:
   - JPEG/PNG/WebP signatures and dimensions;
   - MP4 container, dimensions and duration.
7. The validated object is written to the staging R2 binding with owner/media validation metadata.
8. `POST /api/sauti-media/finalize/{id}` verifies the stored R2 object and marks metadata ready.
9. Sauti creation re-checks the ready row and R2 object before attaching it.
10. If attachment finalization fails, the Sauti publish fails closed.

This keeps operation authorization short-lived and owner-scoped without exposing an R2 access key or secret to the browser.

## Storage layout

Phase 27 uses a dedicated Worker binding:

`SAUTI_MEDIA`

The staging account currently maps this binding to the existing private staging media bucket while using a separate `sauti/` key namespace. Profile avatar/header objects remain below `profiles/`, so the object namespaces and APIs are isolated.

No binary bytes are stored in Postgres.

## Database model

`public.social_post_media` stores only approved metadata and the R2 object key.

Important fields include:

- owner;
- attached Sauti;
- media kind and MIME type;
- size, dimensions and video duration;
- alternative text;
- gallery position;
- upload/finalization state;
- expiry/finalization/attachment timestamps.

RLS keeps unattached media visible only to its owner. Attached media inherits visibility through the existing `social_posts` RLS boundary.

Explicit grants are used for `anon` and `authenticated`.

## Browser experience

The live composer includes:

- image/video picker;
- maximum-four guard;
- upload progress;
- waiting-for-connection state;
- retry and remove;
- alternative text editor;
- durable offline media bytes in browser-managed Cache Storage;
- finalized and waiting media metadata in device-local composer/draft snapshots;
- automatic upload resume after refresh/reconnect;
- media-only sharing.

The Stream renders compact one-to-four-item galleries. Selecting media opens a focused viewer. Signed-in media reads use the current authorization token before producing a local blob URL so follower/Circle visibility is not accidentally bypassed by anonymous image requests.

## Cleanup

Unattached media may be explicitly removed by its owner. Starting a new upload also lazily sweeps a bounded batch of that owner's expired unattached rows and their R2 objects.

Deleting a Sauti captures attached object keys before the database delete, cascades metadata with the post, and then best-effort deletes the corresponding R2 objects.

Failed Sauti attachment finalization also deletes the affected R2 objects.

A later hardening slice may add a scheduled global lifecycle sweep if staging telemetry shows it is required; Phase 27 already performs bounded owner-scoped expiry cleanup and does not expose a public arbitrary-file bucket.

## Security boundaries

- No service-role key in browser or Worker.
- No R2 access/secret key in browser.
- R2 write access exists only through the Worker binding.
- Server validates actual bytes, not only browser MIME.
- MP4 duration is server-inspected and bounded.
- Object key owner/media identifiers must match metadata.
- Sauti creation re-checks R2 validation metadata before attach.
- Existing Sauti visibility, Circle membership and block rules remain authoritative through `social_posts` RLS.

## Phase gate

Before completion:

1. full build/tests pass;
2. Wrangler dry-run passes;
3. staging migration is applied only to `sautilink-test`;
4. Supabase security/performance advisors are reviewed;
5. staging R2 binding reports ready;
6. anonymous write attempts fail;
7. authenticated image upload/finalize/share/render/delete passes;
8. authenticated short MP4 validation passes;
9. direct Sauti/profile/Circle/conversation routes remain healthy;
10. PR is ready, exact head is verified, merged, and post-merge staging deployment passes.

## Rollback

If Phase 27 must be rolled back:

- stop exposing the Sauti-media routes;
- stop issuing new upload rows;
- keep existing attached metadata readable long enough for safe cleanup;
- remove the `SAUTI_MEDIA` binding only after attached staging objects are no longer required;
- revert `media_count` and `social_post_media` only through an explicit migration after data cleanup.

Production remains untouched throughout this phase.


## Completion evidence

The final Phase 27 gate recorded:

- full application/regression tests passing;
- Brand Guard passing;
- Wrangler deployment validation passing;
- Cloudflare Workers Build passing;
- live staging shell exposing Phase 27 media controls;
- `GET /api/sauti-media/status` returning ready after deployment;
- unauthenticated `POST /api/sauti-media/begin` returning HTTP 401 with `AUTH_REQUIRED`;
- RLS enabled on `social_post_media` with five policies;
- explicit anon/authenticated Data API grants;
- generated TypeScript types refreshed from the migrated staging schema;
- post-merge `main` Worker deployment to `test.sautilink.com` succeeding.

The GitHub Ready-for-review connector failed on a GraphQL response-field defect. Draft PR #31 was therefore closed and replaced by non-draft PR #32 at the exact same clean head; no code gate was bypassed.
