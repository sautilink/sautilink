# Phase 16: Text Sauti & Chronological Stream

## Status

Scope approved on 2026-08-31. Implementation begins from main checkpoint `5800b26e6ecfb5b853d9fa695eaab934848d759f`.

## Goal

Turn the existing disabled composer and empty Stream into the first canonical posting experience for SautiLink:

- signed-in members can publish a text-only Sauti;
- published Sauti appear immediately in a newest-first chronological Stream;
- the feed is bounded, paginated and safe under Row Level Security;
- an author can delete their own Sauti;
- Phase 13–15 profile, routing and profile-media behavior remains unchanged.

## Included

- Text-only public Sauti.
- Maximum 500 characters after trimming.
- Signed-in owner creation.
- Newest-first chronological Stream.
- Stable pagination using `created_at DESC, id DESC`.
- Initial page size of 20.
- Explicit loading, empty, error and retry states.
- Optimistic composer feedback only after the canonical insert succeeds.
- Owner-only delete.
- Author display name, username and profile image/fallback in Stream cards.
- Canonical Supabase Postgres storage.
- RLS and explicit grants.
- Worker create/delete API with authenticated user verification and request rate limiting.
- Regression and rollback-safe staging SQL tests.

## Excluded

- Images, video or audio attached to a Sauti.
- Replies/comments.
- Likes/reactions.
- Reposts/reshares.
- Follow-based ranking or Following feed.
- Circles audience.
- Followers-only audience.
- Polls.
- Mentions/notifications.
- Editing an already-published Sauti.
- Trending/ranking.
- Search indexing.
- General moderation actions beyond the existing backend foundation.

These remain later focused slices.

## Canonical post contract

The existing `public.social_posts` table remains the source of truth.

Phase 16 narrows the live browser contract to:

- `author_id = auth.uid()`;
- `circle_id IS NULL`;
- `reply_to_post_id IS NULL`;
- `visibility = 'public'`;
- `post_status = 'published'`;
- trimmed body length between 1 and 500 characters.

Existing wider foundation columns remain in place for future phases but are not exposed by the Phase 16 UI.

## Visibility contract

A Stream visitor may read a public, published top-level Sauti only when the author profile is discoverable.

The author may continue to read their own Sauti even when their profile is hidden.

Existing block relationships remain authoritative for authenticated readers.

This prevents a hidden profile from leaking its existence through a public Sauti row.

## Write boundary

The browser must not directly choose protected post fields.

Preferred live flow:

1. browser obtains the current Supabase session;
2. browser sends only `body` to the same-origin Worker API;
3. Worker validates the Supabase user;
4. Worker rate-limits the authenticated user;
5. Worker inserts with the user's JWT/RLS context and fixed Phase 16 fields;
6. canonical post is returned to the browser;
7. Stream refreshes/prepends from canonical data.

Delete follows the same owner-authenticated Worker boundary.

No service-role/secret Supabase key is permitted in browser code.

## Rate limiting

The Phase 16 Worker should use a Cloudflare Workers Rate Limiting binding when available.

Initial staging target:

- create Sauti: 10 requests per 60 seconds per authenticated user;
- delete Sauti: 20 requests per 60 seconds per authenticated user.

Rate limiting is abuse resistance, not accounting. Database/RLS remains authoritative.

## Chronological Stream

The first Stream is deliberately simple and explainable:

- strictly newest first;
- no algorithmic ranking;
- no forced engagement;
- no Following tab until follow relationships become a live product slice;
- no realtime requirement for Phase 16;
- load more uses a deterministic cursor boundary rather than unbounded offset pagination.

The canonical fallback is a bounded Supabase query.

The Phase 1 architecture still reserves Cloudflare D1 for derived feed read models. D1 projection may be activated within or after this slice only if it remains rebuildable and never becomes the sole copy of a Sauti.

## Delete behavior

Phase 16 uses owner-only canonical deletion.

The UI must require a deliberate delete action and remove the Sauti from the Stream only after the canonical delete succeeds.

No post editing is enabled in this phase.

## Security

- RLS remains enabled and forced on `social_posts`.
- `anon`/authenticated grants are explicit.
- Insert policy must require `auth.uid() = author_id`.
- Phase 16 insert policy must reject reply/circle/non-public variants.
- Public SELECT must require a discoverable author.
- Hidden authors remain able to read their own rows.
- Cross-user delete must fail.
- Browser cannot set `post_status`, `visibility`, `author_id`, timestamps or relationship fields through the Worker UI contract.
- Body is rendered with text nodes only; never `innerHTML`.

## Acceptance gate

Before Phase 16 can merge:

1. owner publishes a real 1–500 character Sauti on staging;
2. the Sauti appears at the top of the Stream after canonical success;
3. refresh preserves the Sauti;
4. a second Sauti proves newest-first ordering;
5. empty and over-500 input are rejected;
6. anonymous create is rejected;
7. cross-user delete is denied;
8. owner delete succeeds and survives refresh;
9. hidden-profile post leakage is denied to visitors;
10. profile routes and Phase 15 media still work;
11. Brand Guard, build/tests and Cloudflare dry-run pass;
12. final staging deployment passes;
13. every significant result/fix is written to this checkpoint;
14. explicit merge approval is tied to the exact final PR head SHA.

## Continuity rule

Every major Phase 16 implementation step, schema/security change, live acceptance result, runtime bug/fix, PR head, merge gate and exact next action must be recorded in this document before advancing.


## Implementation checkpoint — 2026-08-31

### Completed

- Activated the existing `social_posts` foundation for the Phase 16 live contract.
- Narrowed text Sauti to trimmed 1–500 character public top-level posts.
- Removed authenticated post-update permission for this phase.
- Added separate anonymous and authenticated SELECT policies.
- Added authenticated owner INSERT and DELETE policies.
- Added a same-origin Worker create/delete API that:
  - verifies the current Supabase user;
  - accepts only the text body from the browser;
  - fixes `author_id`, `visibility`, `post_status`, `circle_id` and `reply_to_post_id` server-side;
  - uses independent Cloudflare Rate Limiting bindings for create and delete;
  - contains no Supabase service-role/secret key.
- Activated the existing composer as a real 500-character text composer.
- Added a newest-first chronological Stream using `created_at DESC, id DESC`.
- Added bounded 20-row pages with a deterministic cursor.
- Added loading, empty, error, retry and Load more states.
- Added owner-only delete UI after canonical delete succeeds.
- Added profile links and profile-media avatar/fallback behavior to Stream cards.
- Rotated the service-worker shell cache to v5 and app assets to v16.
- Synchronized the generated browser bundle.
- Added Phase 16 Node regression coverage and rollback-safe staging SQL coverage.

### Security defect found and fixed

The original Phase 11 `social_posts_select_visible` policy referenced `social_blocks` for both anonymous and authenticated readers.

Because anonymous users intentionally have no SELECT privilege on the private block graph, an anonymous public-post read failed with:

`permission denied for table social_blocks`

Phase 16 fixed this without exposing block relationships:

- `social_posts_select_phase16_anon` checks only published/public/top-level state plus discoverable author;
- `social_posts_select_phase16_authenticated` additionally enforces the existing mutual block exclusion.

The staging SQL test then passed for both discoverable visibility and hidden-author non-leakage.

### Supabase verification

- owner public top-level insert: PASS;
- non-public Phase 16 insert: denied;
- cross-user delete: denied;
- discoverable public Sauti visible to anon: PASS;
- hidden-author Sauti invisible to anon: PASS;
- transaction rolled back after test.
- Security/performance advisors were run after the change.
- No new SECURITY DEFINER function was introduced.

Existing advisor warnings outside this Phase 16 slice remain:
- `public.complete_social_onboarding` is an existing callable SECURITY DEFINER function;
- leaked-password protection is disabled in the current Supabase configuration.

### Live gated staging verification

Phase 16 was deployed successfully to `test.sautilink.com` with the real Worker rate-limit bindings.

Automated live smoke checks passed:

- live `/app/` reports Phase 16;
- live browser bundle contains the Sauti API and canonical Stream code;
- anonymous `POST /api/sauti` returns HTTP 401 / `AUTH_REQUIRED`;
- Phase 15 profile-media capability remains `ready:true`;
- `/app/u/drcharlestz` remains HTTP 200;
- temporary bundle/deploy/smoke workflows were removed after use.

### Owner acceptance — first canonical Sauti

The signed-in owner published the first real Phase 16 text Sauti on live staging and confirmed:

- the create action completed without error;
- the new Sauti appeared immediately at the top of the Stream.

This verifies the real browser → Worker auth/rate-limit boundary → Supabase canonical insert → chronological Stream render path.

### Refresh persistence acceptance

The signed-in owner refreshed the live staging page and confirmed the first Sauti remained present in the Stream.

This verifies the Stream is reloading canonical persisted data rather than depending on browser-only state.

### Chronological ordering acceptance

The signed-in owner published a second Sauti on live staging and confirmed it appeared above the first Sauti.

This verifies the Stream is presenting canonical posts in newest-first chronological order.

### Owner delete acceptance

The signed-in owner deleted one live Sauti and refreshed the staging page.

Confirmed:

- the Sauti disappeared after canonical delete;
- the deleted Sauti did not return after refresh.

This verifies the owner-only Worker delete path, Supabase RLS delete boundary and canonical Stream refresh behavior.

## Phase 16 owner acceptance status

All required real owner flow checks are complete:

- first text Sauti create: PASS;
- immediate top-of-Stream render: PASS;
- refresh persistence: PASS;
- second Sauti chronological newest-first ordering: PASS;
- owner delete: PASS;
- deleted Sauti remains absent after refresh: PASS.

The remaining gate is repository/database finalization, clean-head CI and explicit exact-head merge approval.


## Database finalization checkpoint

The Phase 16 migration was registered successfully on the staging Supabase project under migration name:

`enable_phase16_text_sauti`

Before registration, a repeat-application mismatch was found: the staging schema already contained the tested Phase 16 policies, while the migration file did not yet drop those Phase 16 policy names before recreating them. The migration was made repeat-safe and then applied successfully.

Post-registration verification:

- rollback-safe Phase 16 SQL test: PASS;
- discoverable anon read: PASS;
- hidden-author non-leakage: PASS;
- non-public Phase 16 insert denied;
- cross-user delete denied;
- no new Phase 16 security advisor warning;
- existing unrelated `complete_social_onboarding` SECURITY DEFINER warning remains;
- existing leaked-password-protection warning remains;
- performance advisor notices remain informational unused-index notices on low-usage staging.

No unrelated advisor issue was changed inside this phase.

## Final merge preparation

Phase 16 implementation, database finalization and live owner acceptance are complete.

Before merge:

1. final clean branch head must pass Brand Guard, build/tests and Cloudflare dry-run;
2. no temporary Phase 16 workflow file may remain;
3. PR #14 must be Ready for review;
4. explicit approval must name the exact current PR head SHA.


## Phase 16 merge completion — 2026-08-31

The final merge gate was satisfied.

- Exact user-approved PR head: `88ca8ab4db5c2205c7e03ba5237d87aabd0b4a4f`.
- PR #14 was Ready for review and open at that exact head.
- Exact-head Brand Guard: PASS.
- Exact-head build/tests: PASS.
- Exact-head Cloudflare deployment validation: PASS.
- PR #14 merged successfully into `main`.
- Merge commit: `29493d1bd6e605892e46104a1c92c2b1d2c786c8`.
- Post-merge Brand Guard: PASS.
- Post-merge build/tests: PASS.
- Post-merge Cloudflare deployment validation: PASS.
- Post-merge deployment to `test.sautilink.com`: PASS.

## Phase 16 final status

Phase 16 — Text Sauti & Chronological Stream is complete.

Accepted live behavior now includes:

- signed-in members can publish public text Sauti up to 500 characters;
- canonical Supabase persistence survives browser refresh;
- the Stream is deterministic newest-first;
- owner delete survives refresh;
- hidden authors do not leak public Sauti to anonymous visitors;
- authenticated block relationships remain enforced without exposing the block graph to anonymous users;
- Phase 15 profile media and Phase 14 deep profile routes remain intact;
- Cloudflare write-rate limiting is active on staging.

The next phase must begin from `main` after this checkpoint and preserve all accepted Phase 13–16 behavior.

### Continuity rule

Every later phase must continue the established checkpoint discipline: scope, schema/security changes, live acceptance, bugs/fixes, PR exact heads, merge approval and post-merge deployment results are recorded in the repo before moving on.
