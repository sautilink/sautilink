# Phase 17: Reactions, Comments, Reposts & Follow Relationships

## Status

Scope started on 2026-08-31 from main checkpoint `0d746e0f49767c75c9f27ba40099705f326e56c8`.

## Goal

Turn Phase 16's read/write text Stream into the first two-way social interaction layer while preserving the existing chronological, privacy-respecting product behavior.

Phase 17 activates:

- follow / unfollow;
- like / unlike;
- comment / delete own comment;
- repost / undo repost;
- live counts and owner interaction state;
- Stream rendering for original Sauti and repost events.

## Included

### Follow relationships

- Signed-in member can follow another discoverable profile.
- Signed-in member can unfollow.
- Self-follow is rejected.
- Existing block relationships continue to override follow visibility/actions.
- Profile surfaces show follower/following counts.
- Owner can see their own follow state toward another profile.
- Hidden profiles are not discoverable targets for new follows by non-owners.

### Reactions

- Phase 17 exposes one reaction type: `like`.
- Signed-in member can like/unlike a visible Sauti.
- One like per member per Sauti.
- Like counts are visible with the Sauti.
- Anonymous visitors can read counts but cannot mutate.
- Reaction-type expansion is intentionally deferred.

### Comments

- Comments are text-only, 1–500 characters.
- One-level comments only in Phase 17.
- Signed-in member can comment on a visible public Sauti.
- Author can delete their own comment.
- Comment author profile must remain subject to discoverability/block rules.
- Nested replies, editing, comment media and reactions-on-comments are deferred.

### Reposts

- Signed-in member can repost a visible public Sauti.
- One active repost per member per original Sauti.
- Signed-in member can undo their own repost.
- Reposts enter the Stream as timestamped social events.
- Repost cards reference the original canonical Sauti; no copy of original body becomes authoritative.
- Repost of a repost is not supported in Phase 17.

### Stream

- Original Sauti and repost events are merged into a newest-first chronological Stream.
- Original Sauti remains canonical in `social_posts`.
- Repost events remain canonical in a dedicated relation.
- Counts for likes, comments and reposts are bounded and derived from canonical Supabase rows.
- Feed ordering remains chronological; no ranking algorithm is introduced.
- Phase 16 pagination limits remain bounded.

## Excluded

- Notifications UI/delivery.
- Mentions.
- Reaction types beyond Like.
- Nested comment threads.
- Comment editing.
- Comment media.
- Reactions on comments.
- Quote reposts.
- Follow recommendations.
- Suggested users.
- Private/followers-only posts.
- Circles feed.
- Trending/ranking.
- D1-only counters or feed authority.
- Realtime WebSocket requirement.

## Canonical data model

Existing tables reused:

- `social_follows`
- `social_posts`
- `social_blocks`
- `social_profiles`

New canonical tables:

### `social_post_reactions`

- `post_id uuid`
- `user_id uuid`
- `reaction_type text` fixed to `like` in Phase 17
- `created_at timestamptz`
- primary key: `(post_id, user_id)`

### `social_post_comments`

- `id uuid`
- `post_id uuid`
- `author_id uuid`
- `body text`
- `created_at timestamptz`
- primary key: `id`

### `social_reposts`

- `post_id uuid`
- `user_id uuid`
- `created_at timestamptz`
- primary key: `(post_id, user_id)`

No binary content is added in Phase 17.

## Visibility and security contract

All public interaction reads must be anchored to a Phase 16-visible original Sauti.

A member may interact only when the original Sauti is:

- `post_status = 'published'`;
- `visibility = 'public'`;
- top-level;
- visible under current profile discoverability and block rules.

Follow rules:

- `follower_id = auth.uid()` for insert/delete;
- self-follow rejected;
- target must exist and be discoverable unless target is the current user;
- block relationships deny creation.

Reaction rules:

- `user_id = auth.uid()` for insert/delete;
- original Sauti must be currently visible to the member;
- duplicate like prevented by primary key.

Comment rules:

- `author_id = auth.uid()`;
- body trimmed 1–500 chars;
- original Sauti must be visible;
- cross-user delete denied.

Repost rules:

- `user_id = auth.uid()`;
- original Sauti must be visible;
- duplicate repost prevented by primary key;
- undo limited to own repost row.

All exposed new tables:

- enable and force RLS;
- receive explicit minimum grants;
- never use user-editable JWT metadata for authorization;
- never use service-role/secret keys in browser code.

## Worker write boundary

Browser mutation actions should go through same-origin Worker endpoints rather than selecting protected columns directly.

Planned endpoints:

- `POST /api/social/follow/<username>`
- `DELETE /api/social/follow/<username>`
- `POST /api/social/posts/<post-id>/like`
- `DELETE /api/social/posts/<post-id>/like`
- `POST /api/social/posts/<post-id>/comments`
- `DELETE /api/social/comments/<comment-id>`
- `POST /api/social/posts/<post-id>/repost`
- `DELETE /api/social/posts/<post-id>/repost`

Worker responsibilities:

- validate Supabase user;
- validate path/body;
- apply per-user Cloudflare rate limits;
- issue canonical writes using the user's JWT/RLS context;
- return bounded canonical response data.

## Rate-limit targets

Initial staging targets:

- follow/unfollow: 30 actions / 60 seconds;
- like/unlike: 60 actions / 60 seconds;
- comments: 20 creates / 60 seconds;
- comment delete: 30 / 60 seconds;
- repost/undo: 30 actions / 60 seconds.

These are abuse controls, not authorization.

## UI boundary

No redesign.

Phase 17 extends the accepted Phase 16 Sauti card with:

- Like button + count;
- Comment button + count;
- Repost button + count;
- owner/current-member interaction states;
- compact comments disclosure;
- repost attribution line.

Profile card gains:

- Followers count;
- Following count;
- Follow/Following button for non-owner discoverable profiles.

Existing spacing, typography, colors, profile routes, media behavior and chronological Stream rhythm must be preserved.

## Acceptance gate

Before Phase 17 merge:

1. follow a discoverable profile;
2. refresh and confirm Following state persists;
3. unfollow and confirm persistence;
4. like a visible Sauti;
5. refresh and confirm Like state/count persists;
6. unlike and confirm count/state reverts;
7. add a comment and confirm it renders;
8. refresh and confirm comment persists;
9. delete own comment and confirm it stays deleted;
10. repost a Sauti and confirm repost event appears in chronological Stream;
11. refresh and confirm repost persists;
12. undo repost and confirm it stays removed;
13. self-follow rejected;
14. anonymous mutations rejected;
15. cross-user delete/unfollow/comment-delete blocked;
16. hidden-profile/block visibility rules do not leak interactions;
17. Phase 13–16 profile/media/post behavior remains intact;
18. Brand Guard, build/tests and Cloudflare dry-run pass;
19. live staging deploy and smoke pass;
20. every major result/fix is recorded here;
21. explicit merge approval names the exact final PR head SHA.

## Continuity rule

Every major Phase 17 implementation step, schema/RLS change, live acceptance result, bug/fix, exact PR head, merge gate and next action must be recorded in this document before moving on.


## Implementation checkpoint — 2026-08-31

### Database and RLS

Phase 17 staging schema is active and migration history is registered as:

`enable_phase17_social_interactions`

Implemented:

- `social_profiles.followers_count`
- `social_profiles.following_count`
- `social_posts.like_count`
- `social_posts.comment_count`
- `social_posts.repost_count`
- `social_post_reactions`
- `social_post_comments`
- `social_reposts`
- security-invoker `social_stream_events` view

Server-owned counter triggers live in the private schema:

- `private.sync_social_follow_counts()`
- `private.sync_social_post_interaction_counts()`

Both are `SECURITY DEFINER` only for fixed trigger work, live outside the exposed API schema, and have EXECUTE revoked from `public`, `anon` and `authenticated`.

The rollback-safe synthetic staging test passed for:

- follow creation;
- self-follow rejection;
- follower/following counter synchronization;
- Like counter synchronization;
- comment counter synchronization;
- repost counter synchronization;
- cross-user comment delete denial;
- cross-user unfollow denial;
- hidden comment-author non-leakage;
- hidden reposter non-leakage;
- hidden target follow denial.

### Privacy boundary

- Like identity rows are readable only by the member who owns that Like.
- Public Sauti expose only aggregate Like count.
- Comment and repost attribution is readable only when the actor is discoverable and not blocked for the authenticated viewer.
- Follow row reads are limited to relationships involving the signed-in member.
- Follow counts are server-maintained on the public profile row.
- Repost events reference the original canonical Sauti and do not duplicate its body as authority.

### Worker boundary

Added `src/social-interactions-api.js` and same-origin routes for:

- Follow / Unfollow
- Like / Unlike
- Comment create / owner delete
- Repost / Undo repost

The Worker:

- validates the current Supabase user;
- accepts only bounded user input;
- fixes identity columns from the authenticated user;
- uses the publishable key + user JWT/RLS context;
- contains no service-role/secret Supabase key;
- fails closed when a required Cloudflare rate limiter is unavailable.

Staging rate limits:

- follow/unfollow: 30 / 60 seconds;
- Like/unlike: 60 / 60 seconds;
- comments: 20 creates / 60 seconds;
- comment delete: 30 / 60 seconds;
- repost/undo: 30 / 60 seconds.

### UI and Stream

No redesign was performed.

Accepted Phase 16 surfaces were extended with:

- Followers / Following counts on profiles;
- Follow / Following button on non-owner discoverable profiles;
- Like + count;
- Comment + count;
- inline one-level comments;
- Repost + count;
- repost attribution;
- merged newest-first chronology from `social_stream_events`.

The original Sauti body continues to render with text nodes only.

App assets moved to v17 and the service-worker shell cache moved to v6.

### Verification

- Phase 17 Node regressions: PASS.
- Phase 14–16 regression suite: PASS.
- Brand Guard: PASS.
- build/tests: PASS.
- Cloudflare dry-run: PASS.
- staging migration registration: PASS.
- post-registration rollback-safe RLS test: PASS.
- Phase 17 deployment to `test.sautilink.com`: PASS.
- live shell/bundle smoke: PASS.
- anonymous Follow mutation: HTTP 401 / `AUTH_REQUIRED`.
- anonymous Like mutation: HTTP 401 / `AUTH_REQUIRED`.
- anonymous Comment mutation: HTTP 401 / `AUTH_REQUIRED`.
- anonymous Repost mutation: HTTP 401 / `AUTH_REQUIRED`.
- Phase 15 profile media remains `ready:true`.
- deep `/app/u/drcharlestz` route remains HTTP 200.
- all temporary Phase 17 sync/deploy/smoke workflows were removed.

Supabase advisors show no new Phase 17 security warning. Existing unrelated warnings remain:

- callable `public.complete_social_onboarding` SECURITY DEFINER function;
- leaked-password protection disabled.

New unused-index notices are expected on low-traffic staging and are informational.

## Owner acceptance — Follow persistence

The signed-in owner followed the discoverable staging profile `@p12.p12mtdfvmej` and confirmed:

- the Follow action completed successfully;
- the button changed to `Following`;
- after refreshing the page, the `Following` state persisted;
- the related social count updated as expected.

This verifies the real browser → Worker follow endpoint → Supabase RLS insert → server-owned follower/following counter trigger → profile reload path.

## Owner acceptance — Unfollow persistence

The signed-in owner unfollowed the same discoverable staging profile and confirmed:

- the unfollow action completed successfully;
- the button returned to `Follow`;
- after refreshing the page, the `Follow` state persisted;
- the related social count returned to the expected value.

This verifies the real browser → Worker unfollow endpoint → owner-scoped Supabase RLS delete → server-owned follower/following counter trigger → profile reload path.

## Owner acceptance — Like persistence

The signed-in owner liked a visible live Sauti and confirmed:

- the Like action completed successfully;
- the interaction state changed to liked;
- the Like count increased;
- after refreshing the page, both the liked state and count persisted.

This verifies the real browser → Worker Like endpoint → owner-scoped reaction row → server-owned Like counter trigger → Stream hydration path.

## Owner acceptance — Unlike persistence

The signed-in owner removed the Like from the same visible Sauti and confirmed:

- the Unlike action completed successfully;
- the liked state cleared;
- the Like count decreased to the expected value;
- after refreshing the page, the cleared state and corrected count persisted.

This verifies the real browser → Worker Unlike endpoint → owner-scoped reaction delete → server-owned Like counter trigger → Stream hydration path.

## Owner acceptance — Comment persistence

The signed-in owner created a text comment on a visible Sauti and confirmed:

- the comment create action completed successfully;
- the comment rendered inline;
- the Comment count increased;
- after refreshing the page and reopening comments, the comment remained present.

This verifies the real browser → Worker comment endpoint → owner-scoped canonical comment insert → server-owned Comment counter trigger → comment reload path.

## Owner acceptance — Comment delete persistence

The signed-in owner deleted their own live comment and confirmed:

- the delete action completed successfully;
- the comment disappeared;
- the Comment count decreased;
- after refreshing the page and reopening comments, the deleted comment did not return.

This verifies the real browser → Worker owner comment-delete endpoint → owner-scoped Supabase RLS delete → server-owned Comment counter trigger → comment reload path.

## Owner acceptance — Repost persistence

The signed-in owner reposted a visible Sauti and confirmed:

- the Repost action completed successfully;
- the Repost count increased;
- the repost event appeared at the top of the chronological Stream;
- after refreshing the page, the repost event remained present.

This verifies the real browser → Worker repost endpoint → canonical repost insert → server-owned Repost counter trigger → security-invoker Stream event chronology → refresh persistence path.

## Owner acceptance — Undo repost persistence

The signed-in owner undid the same repost and confirmed:

- the Undo repost action completed successfully;
- the repost event disappeared from the Stream;
- the Repost count decreased;
- after refreshing the page, the repost event did not return.

This verifies the real browser → Worker undo-repost endpoint → owner-scoped canonical repost delete → server-owned Repost counter trigger → chronological Stream refresh path.

## Phase 17 owner acceptance status

All required real signed-in owner flows are complete:

- Follow + refresh persistence: PASS;
- Unfollow + refresh persistence: PASS;
- Like + refresh persistence: PASS;
- Unlike + refresh persistence: PASS;
- Comment create + refresh persistence: PASS;
- Comment delete + refresh persistence: PASS;
- Repost + newest-first Stream placement + refresh persistence: PASS;
- Undo repost + refresh persistence: PASS.

The remaining gate is final clean-head CI, PR Ready state and explicit exact-head merge approval.


## Phase 17 merge completion — 2026-08-31

The final merge gate was satisfied.

- Exact user-approved PR head: `6692fbf0070016cc28b836ad6ffd3f04212a8723`.
- PR #15 was Ready for review and open at that exact head.
- Exact-head Brand Guard: PASS.
- Exact-head build/tests: PASS.
- Exact-head Cloudflare deployment validation: PASS.
- PR #15 merged successfully into `main`.
- Merge commit: `28fa30dce0e773cc4af115c9d9ca32d1b0fd6827`.
- Post-merge Brand Guard run `33443981535`: PASS.
- Post-merge Phase 1 Authentication run `33443981661`: PASS.
- Post-merge build/tests: PASS.
- Post-merge Cloudflare deployment validation: PASS.
- Post-merge `Deploy test.sautilink.com` job `99658785530`: PASS.

## Phase 17 final status

Phase 17 — Reactions, Comments, Reposts & Follow Relationships is complete.

Accepted live behavior now includes:

- Follow / Unfollow discoverable profiles with persistent follower/following counts;
- Like / Unlike visible Sauti with persistent aggregate counts and member state;
- one-level text comments with owner delete and persistent counts;
- Repost / Undo repost with deterministic chronological Stream events;
- all interaction writes protected by Supabase RLS plus same-origin Worker authentication and Cloudflare rate limits;
- hidden-profile and block visibility protections for interaction attribution;
- server-owned interaction counters;
- Phase 13–16 profile, media and text-Sauti behavior preserved.

The next phase must begin from `main` after this checkpoint and preserve all accepted Phase 13–17 behavior.

### Continuity rule

Every later phase must continue the established checkpoint discipline: scope, schema/security changes, live acceptance, bugs/fixes, PR exact heads, merge approval and post-merge deployment results are recorded in the repo before moving on.
