# Phase 26 — Conversations & Threaded Replies

Status: **COMPLETE**

Phase 26 turns one-level comments into canonical Sauti replies and activates focused conversation routes without changing the accepted SautiLink shell.

## Product and donor intake

This phase starts from the approved Conversations & Threads preview and the standing reuse-before-reinventing rule.

Product-pattern references already approved in the repo:

- Bluesky — post-thread context and accessible conversation navigation
- Lemmy — bounded nested discussion and branch continuation
- Meadows — reply rhythm and compact discussion presentation
- Mastodon — block/mute/moderation language and restricted-content handling

No donor branding, proprietary assets, authentication stack, analytics code, protocol implementation or incompatible licensed code is imported.

## Canonical model

A reply is now a row in `public.social_posts`.

New fields:

- `parent_post_id uuid` — immediate parent
- `root_post_id uuid` — conversation root
- `thread_depth smallint`
- `audience_owner_id uuid` — root Sauti author controlling audience inheritance
- `client_request_id uuid` — optional per-author idempotency key

Existing `reply_to_post_id` remains synchronized to `parent_post_id` for compatibility.

Thread shape:

- top-level Sauti: parent/root null, depth 0
- reply: parent/root non-null, depth 1–32
- no self-parent/root references

Indexes:

- `social_posts_parent_created_idx`
- `social_posts_root_created_idx`
- `social_posts_root_depth_created_idx`
- `social_posts_audience_owner_visibility_idx`
- unique `social_posts_author_client_request_uidx`

## Legacy comment transition

`public.social_post_comments` is no longer the canonical write model.

The migration:

1. backfills any historical one-level comment into `social_posts` using the same UUID when no collision exists
2. inherits the parent audience/Circle
3. sets parent/root/depth
4. revokes authenticated INSERT on the legacy table
5. removes legacy comment count and notification triggers

Legacy rows are retained as compatibility/audit data rather than being dropped.

Staging had zero legacy comments before Phase 26, so there was no live-data collision during activation.

## Audience inheritance

Replies never choose their own audience.

The Phase 26 BEFORE INSERT trigger reads the visible parent and forces:

- `root_post_id`
- `thread_depth`
- `reply_to_post_id`
- `audience_owner_id`
- `visibility`
- `circle_id`

This prevents a browser from replying to a private/follower/Circle Sauti and changing the reply to public.

Follower visibility is evaluated against `audience_owner_id`, which is the root author. It is not evaluated against the reply author.

Circle replies inherit the root Circle.

Block filtering covers both:

- the visible reply author
- the root audience owner

## Reply permissions

The Phase 26 insert trigger rechecks the immediate parent:

- Everyone
- People the parent author follows
- Only people mentioned

The parent author can always reply to their own Sauti.

The Worker API also performs the friendly pre-check from Phase 25, but the database trigger is authoritative.

Maximum canonical thread depth: **32**.

The browser does not render all 32 levels as indentation. It visually bounds a branch and uses **Continue thread** for deeper context.

## Quote compatibility

The Phase 25 public Quote Sauti rule is folded into the Phase 26 insert trigger.

A Quote target must remain:

- visible to the caller
- public
- outside a Circle
- published
- not deleted

Public reply Sauti can themselves be quoted because replies are canonical Sauti.

## Idempotent reply creation

New API route:

`POST /api/social/posts/:postId/replies`

Backward-compatible alias:

`POST /api/social/posts/:postId/comments`

Browser payload:

- `body`
- `client_request_id`

The Worker:

1. authenticates
2. uses the existing social comment/reply rate limiter
3. checks parent visibility and reply permission
4. checks whether the same member/request ID already created a reply
5. inserts a `social_posts` reply
6. handles a concurrent unique-key race by re-reading the existing reply

This prevents retry/double-click duplication.

Delete route:

`DELETE /api/social/replies/:replyId`

Backward-compatible comments-path alias remains.

## Direct conversation routes

Canonical route:

`/app/sauti/:postId`

Phase 24 query links such as `/app/?sauti=<uuid>` are converted to the canonical route.

Share links now use the direct route.

The Cloudflare asset router serves `/app/sauti/:uuid` through the existing app shell.

## Conversation UI

Focused surface contains:

- conversation root
- explicit reply target
- 500-character reply composer
- Relevant / Newest sibling ordering
- reply total
- nested Sauti cards
- bounded visual depth
- Continue thread control
- focused branch state
- mobile-safe indentation

A reply uses the same Sauti card as the main Stream. Therefore it can use the familiar core actions:

- Comment / Reply
- Repost
- Like
- Save
- Share

and the existing contextual:

- Report
- Delete
- Quote Sauti

This avoids creating a weaker “comment-only” object.

## Thread reading boundary

The browser resolves the requested Sauti through normal RLS.

If the requested Sauti is a reply:

- its root is resolved through normal RLS
- the thread is queried by `root_post_id`
- at most 120 visible replies are loaded for the MVP surface
- visual nesting is capped at four levels before Continue thread is used

Relevant ordering is a local, non-personalized sibling score using visible Like/reply counts and light recency. It is not a For You/recommendation algorithm.

Newest orders sibling replies by timestamp.

## Device-local thread draft

Each signed-in member/root conversation receives a separate local-storage key.

The draft stores:

- text
- reply target
- stable `client_request_id`
- saved timestamp

If offline:

- Reply changes to Save draft
- no network write is attempted
- the same idempotency key is retained for later retry

Draft contents are not sent to Supabase until the member explicitly sends.

## Direct reply counts

`comment_count` now means direct child-reply count for any Sauti.

A private internal trigger increments/decrements the immediate parent when a reply Sauti is inserted/deleted.

Counters were recalculated after legacy migration.

## Notifications

Reply notifications are now generated by reply `social_posts` inserts.

Notification recipient:

- immediate parent author

Notification `post_id`:

- newly created reply Sauti

This makes notification clicks open the exact reply conversation branch.

Deletion removes the reply notification by reply post ID.

Circle reply notifications retain Circle context.

Notification RLS remains recipient-only.

During synthetic verification an initial metric appeared as zero because the test attempted to read Account A's notification while authenticated as Account B/C. Re-running as the actual recipient produced the expected notification and confirmed an unrelated account could not read it.

## Home Stream isolation

`public.social_stream_events` remains `security_invoker=true`.

Only top-level Sauti are admitted:

`parent_post_id is null`

Replies do not leak into Home as independent posts.

## Grants and RLS

Authenticated `social_posts` INSERT is now column-scoped to:

- `author_id`
- `body`
- `circle_id`
- `client_request_id`
- `parent_post_id`
- `post_status`
- `quote_post_id`
- `reply_access`
- `visibility`

Server-owned/inherited fields are not browser-insertable:

- root
- depth
- audience owner
- counters
- timestamps
- delete state

Phase 26 private insert/count trigger functions are not directly executable by authenticated users.

Legacy comment INSERT privilege: **denied**.

## Synthetic staging verification

Rollback-only tests proved:

- top-level root shape valid: **PASS**
- follower can read follower-audience root: **PASS**
- non-follower cannot read follower-audience root: **PASS**
- first reply inherits root audience/root/depth: **PASS**
- nested reply inherits same root and depth increments: **PASS**
- root direct reply count increments: **PASS**
- reply direct child count increments: **PASS**
- duplicate client request rejected by unique DB guard: **PASS**
- replies excluded from Home Stream: **PASS**
- legacy comment INSERT denied: **PASS**
- reply recipient sees reply notification: **PASS**
- unrelated account cannot read recipient notification: **PASS**

## Privilege/security audit

Observed staging state:

- authenticated post INSERT columns: exact Phase 26 allow-list
- direct authenticated execute on `private.enforce_phase26_post_insert()`: **false**
- direct authenticated execute on `private.sync_phase26_reply_counts()`: **false**
- authenticated Phase 26 SELECT policy: **present**
- anonymous Phase 26 SELECT policy: **present**
- legacy comment INSERT grant: **0**
- Home Stream security invoker: **true**

No service-role/secret key is added to browser code.

## Supabase platform notes

Current Supabase guidance was rechecked for:

- RLS
- security-invoker views
- explicit Data API grants

The 2026 Data API default change makes explicit grants especially important; Phase 26 uses explicit browser privileges rather than relying on automatic exposure.

## Supabase advisors

No new Phase 26 security warning was reported.

Existing unrelated project warnings remain:

1. intentional authenticated `complete_social_onboarding(...)` SECURITY DEFINER onboarding boundary
2. leaked-password protection disabled in current project/plan settings

Performance advisor output contains INFO-level unused-index notices on low-volume staging, including new thread indexes. They are retained because thread lookup, parent count updates, root pagination and FK cleanup require them at real usage volume.

## Deferred

- media replies / R2 — Phase 27
- mute/collapse safety completion — Phase 28
- moderation/admin review — Phase 29
- personalized thread ranking
- live WebSocket reply streaming
- server-synced thread drafts
- infinite/unbounded recursion

## Build and staging checkpoint

Phase 26 branch validation completed successfully:

- full application build/tests: **PASS**
- Phase 26 focused tests: **PASS**
- Phase 26 SQL/RLS guard: **PASS**
- SautiLink Brand Guard: **PASS**
- Cloudflare deployment validation: **PASS**
- generated browser bundle synchronization: **PASS**
- deploy to `test.sautilink.com`: **PASS**
- production: **unchanged**

Successful branch staging workflow run: `33561959160`.

The staging workflow started at `139972943f13c8c5ae90b9d1021f8bb5eb32aa04`. Its bundle synchronization advanced the feature branch before the temporary workflow was removed. The deployed working tree therefore contains the generated browser bundle produced by the same successful build.

The temporary branch-only staging workflow was removed after successful deployment.

## Staging acceptance gate

Before merge:

1. full Node build/tests pass
2. Phase 26 SQL/RLS guard passes
3. SautiLink Brand Guard passes
4. Cloudflare deployment validation passes
5. branch deploy to `test.sautilink.com` succeeds
6. root and nested reply creation works
7. direct `/app/sauti/:id` routes work on refresh
8. Relevant/Newest ordering is usable
9. follower/Circle audience remains enforced through replies
10. reply permission modes remain enforced
11. notification click returns to exact Sauti branch
12. offline reply draft persists and retries safely
13. mobile thread indentation remains readable
14. production remains unchanged


## Merge closure

Feature replacement PR: **#29**

The original draft PR **#28** was closed without merging only because the connected GitHub mark-ready mutation failed on the known `fullDatabaseId` GraphQL schema field. PR #29 reopened the exact same branch/head as non-draft and received fresh CI.

Final feature head:

`501e7601a3150ca19de0433a21fdce147bf136a2`

Feature merge commit:

`ae09c862f0457ae917fbe3afec7bc219373f38ea`

Final replacement-PR verification:

- Phase 1 Authentication run `33562198012`: **PASS**
- SautiLink Brand Guard run `33562197976`: **PASS**

Post-merge `main` verification:

- Phase 1 Authentication / build / Cloudflare validation / test deploy run `33562289927`: **PASS**
- SautiLink Brand Guard run `33562289920`: **PASS**
- deploy `test.sautilink.com`: **PASS**
- production: **unchanged**

The durable project checkpoint now advances to **Phase 27 — Sauti Media + Cloudflare R2**.
