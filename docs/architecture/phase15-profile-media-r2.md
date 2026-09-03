# Phase 15: Profile Media with Cloudflare R2

## Status

Scope approved on 2026-08-31. Implementation is in progress on the isolated staging branch.

## Goal

Add safe owner-managed profile avatar and header images to the live SautiLink app while preserving the Phase 13/14 profile data and discoverability boundaries.

Phase 15 is deliberately narrower than the existing Media & R2 preview. It covers profile images only. Post attachments, video uploads, media galleries and general-purpose user media remain deferred.

## Included

- Owner avatar image upload.
- Owner header/cover image upload.
- Replace existing avatar/header image.
- Remove existing avatar/header image.
- Render approved avatar/header media on the owner's profile.
- Render approved avatar/header media on discoverable read-only profiles.
- Responsive desktop/mobile presentation.
- Loading, upload progress, validation failure, retry and safe-error states.
- Accessibility labels and sensible image alternative behavior.

## Excluded

- Video.
- Audio.
- Sauti/post attachments.
- Multi-image galleries.
- Image editing/cropping studio.
- Filters or generative image features.
- Public arbitrary-file storage.
- Username/display-name changes.
- Follows, reactions, comments or Circles.

## Existing database boundary

The current `social_profiles` schema already contains:

- `avatar_key`
- `header_key`

Both columns are constrained to keys scoped below:

`profiles/{user-id}/...`

No binary media is stored in Postgres.

Phase 15 must keep Supabase as the canonical metadata store and Cloudflare R2 as binary object storage.

## R2 architecture

A dedicated non-production R2 bucket must be bound to the staging Worker before live uploads are enabled.

The browser must never receive permanent R2 credentials.

Recommended flow:

1. The signed-in browser requests an upload authorization from the SautiLink Worker.
2. The Worker validates the authenticated user, requested media slot, declared MIME type and file size.
3. The Worker creates an unpredictable key below the authenticated user's own namespace:
   - `profiles/{user-id}/avatar/{object-id}`
   - `profiles/{user-id}/header/{object-id}`
4. The upload is accepted only for the requested operation and object key.
5. The server validates the resulting object before the profile metadata is finalized.
6. Only the approved object key is written to `social_profiles.avatar_key` or `social_profiles.header_key`.
7. Replaced, abandoned or rejected objects are removed idempotently.

## Validation contract

Initial Phase 15 profile uploads should accept image media only.

Before finalization the server must validate at least:

- authenticated owner identity;
- owner-scoped object key;
- allowed image MIME type;
- actual file signature/magic bytes;
- bounded file size;
- image dimensions;
- successful object existence;
- no executable or disguised file accepted as image.

Client-side validation is convenience only. Server-side validation remains authoritative.

## Proposed initial limits

These are conservative staging limits and can be reviewed before implementation:

- Avatar: JPEG, PNG or WebP; maximum 5 MB.
- Header: JPEG, PNG or WebP; maximum 8 MB.
- No SVG uploads in Phase 15.
- One active avatar and one active header per profile.

The UI may recommend square avatar images and wide header images without requiring browser-side destructive cropping.

## Access and privacy

- Only the authenticated owner can create, replace or remove their profile media.
- A visitor must never obtain write authorization for another user's namespace.
- A hidden/non-discoverable profile must continue to follow the Phase 14 profile visibility rules.
- Public media delivery must not expose private account fields, auth metadata or storage credentials.
- Object URLs must be derived from approved object keys, not arbitrary user-entered URLs.

## Database permissions

Phase 15 must not restore the broad `social_profiles` update grant removed in Phase 13.

If browser metadata finalization writes `avatar_key` or `header_key`, permissions must be explicitly bounded to those columns and backed by owner-only RLS.

A preferred alternative is server-owned finalization after object validation, so the browser never directly writes an unverified media key.

## Cleanup

Replacing or removing media must not leave unlimited orphan objects.

The design must support:

- idempotent delete;
- stale-upload cleanup;
- safe retry;
- object replacement without deleting the currently active image before the new image is finalized;
- eventual lifecycle cleanup for abandoned staging uploads.

## Rendering safety

- The profile UI consumes only server-approved media locations.
- Existing initials remain the fallback when no avatar exists or media fails.
- Existing Phase 14 read-only profile behavior remains intact.
- Owner-only media controls must never render on another member's profile.

## Deployment gate

Phase 15 implementation must not be enabled on staging until:

1. the scope is explicitly approved;
2. the staging R2 bucket and Worker binding are available;
3. server-side upload authorization/finalization is implemented;
4. owner and cross-user authorization tests pass;
5. MIME/signature/size validation tests pass;
6. replacement/removal/orphan cleanup behavior is tested;
7. generated browser assets are synchronized;
8. direct profile routes continue to pass live smoke tests; and
9. the final exact PR head receives explicit merge approval.

## Implementation checkpoint — 2026-08-31

### Completed

- Added Phase 15 owner UI for profile photo and header image.
- Added image-only client validation for JPEG, PNG and WebP.
- Added a same-origin Worker profile-media API with:
  - authenticated owner upload;
  - authenticated owner remove;
  - public/owner media reads that reuse existing profile visibility RLS;
  - server-side MIME/magic-byte matching;
  - server-side image-dimension inspection;
  - 5 MB avatar and 8 MB header limits;
  - UUID-based owner/slot-scoped R2 keys;
  - replace-after-finalize behavior;
  - best-effort old-object cleanup.
- Added a fail-closed capability endpoint. The browser keeps upload/remove controls disabled until the R2 binding actually exists.
- Applied the staging Supabase migration that:
  - preserves Phase 13 profile-basic grants;
  - adds owner-only `avatar_key` and `header_key` column grants;
  - tightens database constraints to exact owner + avatar/header slot + UUID + supported extension.
- Ran a rollback-only staging database test proving owner success, cross-user denial and invalid-slot rejection.
- Ran Supabase security/performance advisors after the migration. No new Phase 15 security-definer function was introduced.
- Rotated the app-shell cache and Phase 15 app asset version.

### Trusted storage model

R2 object creation is available only to the Worker binding. A browser may update only its own bounded metadata columns under the existing owner RLS policy; it cannot create an R2 object or write another user's profile row. A fabricated but syntactically valid owner key can therefore only point to a nonexistent object and does not grant storage access.

The Worker validates the current Supabase user through the Auth server before upload/remove operations. The Worker uses the staging publishable key plus the user's JWT and contains no Supabase secret/service-role key.

### Live gated staging acceptance

The Phase 15 application was deployed to `test.sautilink.com` without an R2 binding so the new media surface could be reviewed without pretending storage was ready.

Automated live smoke checks passed:

- the live `/app/` shell reports Phase 15 and loads the v15 browser bundle;
- the live Profile editor contains the profile-media panel;
- `/api/profile-media/status` returns `ready:false`;
- the existing `/app/u/drcharlestz` deep route still returns HTTP 200.

This proves the Phase 15 code is live in fail-closed mode and Phase 14 routing remains healthy.

### Cloudflare R2 activation — complete

R2 was enabled for the Cloudflare account on 2026-08-31.

The private staging bucket was then created successfully:

`sautilink-profile-media-staging`

The `test` Worker is bound to that bucket as:

`PROFILE_MEDIA`

The R2-backed Phase 15 staging deployment completed successfully.

### Live R2 activation smoke

Automated live checks against `test.sautilink.com` passed:

- `/api/profile-media/status` returned `ready:true`;
- an anonymous request to `/api/profile-media/upload` was rejected with HTTP 401 and `AUTH_REQUIRED`;
- `/app/u/drcharlestz` continued to return HTTP 200 after the R2 binding was activated.

This confirms the storage capability is live, the write API fails closed without authentication, and the Phase 14 deep-profile route remains healthy.

### Remaining acceptance gate

The final Phase 15 acceptance requires one authenticated owner session to exercise the real browser flow:

1. upload an avatar;
2. verify it renders on the owner profile;
3. replace it and confirm the old object no longer remains active;
4. remove it and confirm the initials fallback returns;
5. repeat upload/render/remove for the header image;
6. verify discoverable profile media is readable to a visitor and hidden-profile media remains inaccessible to non-owners.

These checks require a valid signed-in owner session and are intentionally not bypassed with a service-role credential or fabricated client session.

### Existing advisor notes

The staging Supabase security advisor still reports two pre-existing warnings outside this Phase 15 change:

- the previously existing `public.complete_social_onboarding` SECURITY DEFINER function is callable by authenticated users;
- leaked-password protection is disabled on the current plan/configuration.

These were not introduced or widened by Phase 15 and are not silently changed in this profile-media slice.

## Rollback

The Phase 15 UI and Worker upload endpoints must be removable without deleting existing account or profile rows.

If a rollback occurs after staging uploads exist:

- stop issuing new upload authorizations;
- keep existing approved object keys readable long enough for cleanup;
- clear profile media metadata only through an explicit migration/maintenance action if required;
- delete orphaned staging R2 objects separately and safely.

## Checkpoint

Phase 14 completed at merge commit `3f55c715202a34bf2dc45bc4cc8b41db3b734d47`.

Phase 15 scope begins from main checkpoint commit `862368be4edbdd32594ffa340e4ba8dc600c01b7`.


## Owner acceptance checkpoint — 2026-08-31

The signed-in owner completed the first real end-to-end browser test on `test.sautilink.com`.

Confirmed by the owner:

- Profile media service showed ready state.
- Profile photo upload was accepted.
- The uploaded avatar rendered correctly on the live owner profile.
- The owner described the result as working cleanly.

This confirms the full owner path is functioning across browser UI, Supabase Auth, Worker validation, R2 object storage, profile metadata finalization and profile rendering.

### Avatar replace acceptance

The signed-in owner replaced the existing avatar with a second image on live staging and confirmed the result is working cleanly.

This verifies the replace-after-finalize path from browser → Worker → R2 → Supabase metadata → profile render.

### Avatar remove acceptance

The signed-in owner removed the active avatar on live staging and confirmed the result is working cleanly.

The profile returned to the initials fallback after removal. This verifies the owner remove path, metadata clear, R2 cleanup request and safe UI fallback.

### Header upload acceptance

The signed-in owner uploaded a header image on live staging and confirmed it rendered correctly on the profile.

This verifies the authenticated header upload path from browser → Worker validation → R2 storage → Supabase metadata finalization → profile header render.

### Header remove acceptance

The signed-in owner removed the active header image on live staging and confirmed the result is working cleanly.

The profile returned to the default header treatment after removal. This verifies the owner header removal path, metadata clear, R2 cleanup request and safe visual fallback.

### Visitor visibility acceptance

A synthetic staging-only profile and R2 avatar fixture were used to validate visitor visibility without touching real member data.

Verified live:

- while the synthetic profile was discoverable, its avatar media endpoint returned HTTP 200 to a non-owner visitor;
- after the same profile was changed to non-discoverable, the same visitor media request returned HTTP 404 / MEDIA_NOT_FOUND;
- the synthetic R2 object was deleted after the test;
- the synthetic Supabase user/profile fixture was deleted and zero fixture social-profile rows remained.

This confirms Phase 14 discoverability rules also protect Phase 15 media delivery.

## Phase 15 completion checkpoint — 2026-08-31

Phase 15 implementation and staging acceptance are complete.

Completed and verified:

- private Cloudflare R2 staging bucket created;
- `PROFILE_MEDIA` Worker binding active;
- live media capability reports ready;
- anonymous writes are rejected;
- owner avatar upload renders correctly;
- avatar replacement works;
- avatar removal restores initials fallback;
- owner header upload renders correctly;
- header removal restores the default header treatment;
- server-side file signature, MIME, size and dimension validation is covered;
- owner-only media metadata and strict object-key constraints are active in Supabase;
- cross-user media metadata writes are denied;
- discoverable visitor media reads succeed;
- hidden-profile visitor media reads fail safely;
- Phase 14 deep profile routing remains healthy;
- temporary provisioning/deploy/smoke workflow files were removed;
- synthetic visibility fixtures were cleaned from R2 and Supabase.

### Final merge gate

The merge gate was satisfied.

- Exact approved PR head: `197b594ba3adac651597eecdbe79a5a38302447f`.
- PR #13 was explicitly approved for that exact head.
- PR #13 merged successfully into `main`.
- Merge commit: `513a6c5fe34aadc3058b013c5bf419fbd6db149a`.
- Post-merge SautiLink Brand Guard passed.
- Post-merge build/tests passed.
- Post-merge Cloudflare deployment validation passed.
- Post-merge deployment to `test.sautilink.com` passed.

## Phase 15 final status

Phase 15 — Profile Media with Cloudflare R2 is complete as of 2026-08-31.

The live staging app now has the accepted profile-media foundation: owner avatar/header upload, replace/remove flows, R2-backed storage, bounded Supabase metadata, visitor discoverability enforcement, cleanup behavior and regression coverage.

The next phase must begin from `main` after this checkpoint and must preserve all accepted Phase 13–15 profile, routing, media, security and staging behavior.

### Continuity rule

Every major Phase 15 step, live acceptance result, runtime defect, fix, PR head, merge gate and next action must be recorded in this checkpoint document before moving on. This is the source-of-truth handoff for continuing the project in a new chat/session without reconstructing history from memory alone.
