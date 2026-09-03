# Phase 24 — Discover + Saved Sauti

Status: **COMPLETE**

Phase 24 activates the public discovery and private save/bookmark loop for the SautiLink web MVP. It deliberately stays chronological and functional instead of introducing personalized ranking or decorative feed experiments.

## Product rules carried into this phase

- Preserve the accepted SautiLink app shell.
- Prefer compact, recognizable icons over text-heavy controls on small screens.
- Core Sauti action row: **Comment · Repost · Like · Save · Share**.
- Saved state is private to the signed-in member.
- Share produces a usable SautiLink link without adding tracking parameters.
- Discover is a public browse/search surface, not a personalized algorithm.
- Reuse approved product patterns before inventing a new interaction model.

## Donor / open-source intake

Phase 24 reuses SautiLink's own approved app-shell preview as the immediate UI donor. That preview already documented Discover and Bookmark/Save patterns and was itself informed by open-source social product research.

Relevant product-pattern references recorded by SautiLink include:

- Bluesky — public discovery/search and accessible post-action patterns
- Mastodon — private bookmarks and public discovery patterns
- Lemmy — discussion-oriented discovery patterns

No donor branding, proprietary assets, tracking stack, authentication system or incompatible code is imported. Supabase and Cloudflare remain the canonical SautiLink architecture.

## Live scope

### Discover

Route: `/app/discover`

- discoverable public profiles
- recent public top-level Sauti
- search profiles by username or display name
- search public Sauti text
- browse without a query
- no personalized ranking
- block-aware visibility
- direct links to public profiles
- full Sauti interaction row inside Discover

Blank-query people are ordered by follower count and then recency. Public Sauti remain chronological.

### Saved

Route: `/app/saved`

- save/unsave any currently visible Sauti
- private account-only Saved list
- newest saved first
- current inaccessible/deleted content is not exposed
- saved state appears consistently across Home, Circle, Discover and Saved cards

### Share links

Every interactive Sauti card exposes Share.

Canonical Phase 24 share form:

`/app/?sauti=<post-uuid>`

The browser uses native `navigator.share()` where available, then falls back to copying the same link.

The target is loaded through ordinary `social_posts` RLS. A copied link cannot bypass:

- deleted state
- public/Circle visibility
- Circle membership
- block relationships
- profile visibility rules

No analytics/tracking parameters are appended.

## Core interaction row

Phase 24 changes the reusable Sauti card to an icon-first order:

1. Comment
2. Repost
3. Like
4. Save
5. Share

Report/Delete remain contextual safety/ownership controls rather than engagement actions.

On compact mobile layouts labels can collapse while icons, counts and accessible labels remain.

## Saved Sauti schema

New table:

`public.social_saved_posts`

Columns:

- `user_id uuid`
- `post_id uuid`
- `saved_at timestamptz`

Primary key:

- `(user_id, post_id)`

Foreign keys cascade with profile/post deletion.

Indexes:

- `social_saved_posts_user_saved_idx`
- `social_saved_posts_post_idx`

## Grants and RLS

The table uses both ENABLE RLS and FORCE RLS.

No anonymous privileges exist.

Authenticated browser privileges:

- SELECT
- DELETE
- INSERT only on `user_id, post_id`

No browser UPDATE privilege.

Policies:

- `social_saved_posts_select_own_phase24`
- `social_saved_posts_insert_own_phase24`
- `social_saved_posts_delete_own_phase24`

Insert requires:

- `auth.uid() = user_id`
- target Sauti must be readable through the caller's normal `social_posts` RLS

This prevents a member from creating a save relationship to a guessed post UUID that is blocked or outside their access.

## Synthetic database verification

Rollback-only staging test:

- own visible Sauti save: **PASS**
- cross-user save identity attempt rejected: **PASS**
- own unsave: **PASS**
- blocked/inaccessible Sauti save rejected: **PASS**
- another account cannot read the member's Saved rows: **PASS**

Observed metrics:

- `owner_save_visible = 1`
- `cross_user_save_rejected = 1`
- `owner_unsave_removed = 1`
- `blocked_post_save_rejected = 1`
- `other_user_cannot_read_a_saves = 1`

## Privilege audit

- anonymous Saved grants: **0**
- authenticated INSERT columns: **post_id, user_id**
- authenticated SELECT: **allowed**
- authenticated DELETE: **allowed**
- authenticated UPDATE: **denied**
- select/insert/delete owner policies: **present**

## Supabase advisor checkpoint

No new Phase 24 security warning was reported.

Pre-existing unrelated warnings remain:

- the intentional authenticated `complete_social_onboarding(...)` SECURITY DEFINER onboarding boundary
- leaked-password protection disabled in the current project/plan settings

Performance advisor output contains INFO-level unused-index notices on low-volume staging, including the new Saved indexes. They are retained because Phase 24 read ordering and post foreign-key cleanup need them.

## Mobile/navigation decision

The previous disabled global mobile compose-plus placeholder was removed.

Why:

- the real composer already lives at the top of Stream
- Discover is a live MVP navigation destination
- keeping a disabled ornamental plus consumed a high-value mobile navigation slot

Mobile navigation now keeps six useful destinations:

- Stream
- Discover
- Messages
- Notifications
- Circles
- Profile

Saved remains available from desktop navigation, the Discover toolbar, and every Sauti bookmark icon.

## Deferred

- personalized recommendation ranking
- trending algorithm
- topic/hashtag indexing service
- semantic/vector search
- search analytics
- public save counts
- bookmark folders/collections
- cross-network share integrations beyond native Web Share + canonical link

## Build and staging checkpoint

Phase 24 branch validation completed successfully:

- full application build/tests: **PASS**
- Phase 24 focused tests: **PASS**
- SautiLink Brand Guard: **PASS**
- Cloudflare deployment validation: **PASS**
- generated browser bundle synchronization: **PASS**
- deploy to `test.sautilink.com`: **PASS**
- production: **unchanged**

Successful branch staging workflow run: `33543645627`.

The temporary branch-only staging workflow was removed after the successful deploy.

## Staging gate

Before merging Phase 24, verify:

1. full Node test suite passes
2. Phase 24 SQL guards pass
3. Brand Guard passes
4. Cloudflare deployment dry-run passes
5. branch deploy to `test.sautilink.com` succeeds
6. Discover profile/public-post search is usable
7. Save/unsave is private and consistent
8. Share opens/copies a usable SautiLink link
9. copied link cannot bypass RLS
10. mobile five-action Sauti row remains usable
11. production remains unchanged


## Merge closure

Feature PR: **#24**

Merged feature head:

`06427366b73a4323963af3adb3f183b818727105`

Feature merge commit:

`f910e41b1309a84dabc0236f3d4a88b4a755baff`

Post-merge `main` verification:

- full build/tests: **PASS**
- Cloudflare validation: **PASS**
- SautiLink Brand Guard: **PASS**
- deploy `test.sautilink.com`: **PASS**

Draft PR #23 was closed without merging only because the connected GitHub mark-ready mutation failed on a GitHub GraphQL schema field. PR #24 replaced it from the exact same Phase 24 branch/head and was merged after fresh CI passed.
