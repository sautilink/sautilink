# Phase 25 — Advanced Sauti Composer

Status: **implementation / staging gate**

Phase 25 turns the approved composer preview into a live web-MVP contract for audience selection, reply permissions, device-local drafts, offline safety and Quote Sauti while preserving the accepted SautiLink app shell.

## Product and donor intake

This phase reuses the approved SautiLink composer preview before inventing a new surface.

Documented product-pattern references:

- Bluesky — posting flow, state feedback and accessible controls
- Meadows — composer/feed rhythm
- Mastodon — audience/privacy and public-social interaction patterns
- Misskey — product-pattern reference only; no code copied

No donor branding, proprietary assets, authentication stack, tracking system or incompatible code is imported. Supabase and Cloudflare remain canonical.

## Live scope

### Audience

The main Stream composer supports:

- Public
- Followers
- any Circle the signed-in member currently belongs to

Circle choices are hydrated through existing Circle RLS. A stored device draft can only restore a Circle choice if that Circle remains available in the current audience selector.

### Reply permissions

Every Phase 25 Sauti carries `reply_access`:

- `everyone`
- `following` — people the Sauti author follows
- `mentioned` — only accounts explicitly mentioned by `@username` in the Sauti body

The author can always reply to their own Sauti.

The browser and Worker/API provide clear feedback, but the database INSERT policy is canonical enforcement.

### Quote Sauti

`social_posts.quote_post_id` optionally references another Sauti.

Privacy rules:

- only an available public Sauti can be quoted
- followers-only Sauti cannot become a public quote target
- Circle Sauti cannot become a public quote target
- deleted/removed/inaccessible targets are rejected
- quote-only Sauti may have an empty body
- a normal non-quote Sauti still requires 1–500 trimmed characters

A SECURITY INVOKER BEFORE INSERT trigger validates the quote target through the caller's existing RLS. Direct execution by `authenticated` is revoked.

If a previously quoted target later becomes unavailable, the rendering degrades to “Quoted Sauti unavailable” rather than bypassing its access boundary.

### Repost / Quote menu

The familiar Repost action opens a compact menu:

- Repost / Undo repost
- Quote Sauti

Quote is disabled on non-public source Sauti.

The main Sauti action row remains:

**Comment · Repost · Like · Save · Share**

### Device-local drafts

Drafts are intentionally local to the browser/device in Phase 25.

- scoped by signed-in member id
- current unsent composer state is persisted
- up to 5 explicit saved drafts are retained
- drafts preserve text, audience, reply mode and public quote reference
- signing out clears only in-memory composer state, not that account's device drafts
- signing back into the same account can restore them
- another account uses a different storage key
- no draft contents are sent to Supabase

Offline behavior:

- the composer exposes an offline status
- submitting while offline saves a device draft instead of attempting a network post
- returning online restores normal Share behavior

Circle-specific inline composer posting is disabled offline; the global Stream composer can save a Circle-targeted device draft.

## Database changes

Migration:

`20260901205349_enable_phase25_advanced_sauti_composer.sql`

Adds to `public.social_posts`:

- `reply_access text not null default 'everyone'`
- `quote_post_id uuid null`

Constraints:

- reply mode allow-list
- quote FK with `ON DELETE SET NULL`
- no direct self-quote
- body rule supporting quote-only Sauti

Index:

- `social_posts_quote_post_id_idx`

Follow-up hardening migration:

`20260901205615_harden_phase25_reply_permissions.sql`

removes the older permissive `social_post_comments_insert_phase18` policy so Phase 25 reply restrictions cannot be bypassed through PostgreSQL permissive-policy OR semantics.

## Followers audience RLS

Authenticated post SELECT now permits follower-audience Sauti only when:

- the caller is the author, or
- the caller follows the author

Existing block filtering remains active.

Anonymous users remain public-only.

## Home Stream

`public.social_stream_events` remains `security_invoker=true`.

It can include public + follower-audience post/repost rows, while underlying table RLS decides which rows each caller can actually see.

Circle Sauti remain excluded from Home.

## Synthetic database verification

Rollback-only staging tests proved:

- follower can read follower-audience Sauti: **PASS**
- non-follower cannot read follower-audience Sauti: **PASS**
- anonymous user cannot read follower-audience Sauti: **PASS**
- public Quote Sauti target allowed: **PASS**
- follower-only quote target rejected: **PASS**
- author-followed account can reply under “People you follow”: **PASS**
- unrelated account rejected under “People you follow”: **PASS**
- mentioned account can reply under “Only people mentioned”: **PASS**
- unmentioned account rejected: **PASS**

Recorded metrics:

- `follower_can_read_followers_post = 1`
- `nonfollower_cannot_read_followers_post = 1`
- `anon_cannot_read_followers_post = 1`
- `quote_public_target_allowed = 1`
- `followers_target_quote_rejected = 1`
- `following_allowed = 1`
- `following_restricted = 1`
- `mentioned_allowed = 1`
- `mentioned_restricted = 1`

An early synthetic run exposed the old Phase 18 permissive comment INSERT policy. That was treated as a blocking security finding, removed in the Phase 25 hardening migration, and the restriction tests were rerun successfully.

## Security/privilege audit

Current staging audit:

- direct authenticated execution of `private.enforce_phase25_post_insert()`: **false**
- authenticated comment INSERT policies: **1**
- Phase 25 comment INSERT policy present: **1**
- legacy Phase 18 broad INSERT policy present: **0**
- Home Stream `security_invoker`: **true**

No service-role or secret Supabase key is added to browser code.

## Supabase advisors

No new Phase 25 security warning was reported.

Existing project warnings remain:

1. authenticated `public.complete_social_onboarding(...)` is an intentional pre-existing SECURITY DEFINER onboarding boundary
2. leaked-password protection remains disabled in the current project/plan settings

Performance advisor output contains INFO-level unused-index notices on low-volume staging, including `social_posts_quote_post_id_idx`. The Quote FK index is retained for relationship lookup and deletion/update cleanup; staging inactivity alone is not a reason to remove it.

## API boundaries

`src/sauti-posts-api.js` now validates and forwards:

- `visibility`
- `circle_id`
- `reply_access`
- `quote_post_id`

The API rejects invalid audience/reply/quote fields and translates quote-target database rejection into a safe user-facing error.

`src/social-interactions-api.js` performs a friendly pre-check for reply permission before comment creation, while RLS remains authoritative.

## UI boundaries

The accepted shell remains intact.

New composer controls are restrained and compact:

- Audience select
- Replies select
- quote preview/remove
- device draft save/list/restore/delete
- offline status
- Text/Media/Poll icon affordances

Media remains disabled until Phase 27. Poll remains deferred rather than presented as live functionality.

## Deferred

- media uploads and R2 — Phase 27
- full threaded Sauti/reply model — Phase 26
- polls
- scheduled publishing
- location attachment
- personalized ranking/recommendations
- cloud-synced drafts
- cross-device draft sync

## Build and staging checkpoint

Phase 25 branch validation completed successfully:

- full application build/tests: **PASS**
- Phase 25 focused tests: **PASS**
- Phase 25 SQL/RLS guards: **PASS**
- SautiLink Brand Guard: **PASS**
- Cloudflare deployment validation: **PASS**
- generated browser bundle synchronization: **PASS**
- deploy to `test.sautilink.com`: **PASS**
- production: **unchanged**

Successful branch staging workflow run: `33559708578`.

The branch deploy started at `ac3e0d9dcf34ff6ff6dda1b2c84246ce286985bc`, synchronized the generated browser bundle to the same branch, then deployed that synchronized working tree successfully. The temporary branch-only staging workflow was removed after deployment.

## Staging acceptance gate

Before merge:

1. full Node build/tests pass
2. Phase 25 RLS SQL guard passes
3. Brand Guard passes
4. Cloudflare validation passes
5. branch deployment to `test.sautilink.com` succeeds
6. Public / Followers / Circle audiences post correctly
7. Followers privacy is enforced
8. reply modes are enforced at DB level
9. Quote can only target public Sauti
10. draft save/restore survives refresh/sign-out for same account
11. device draft keys remain account-scoped
12. offline submit saves draft rather than posting
13. Repost / Quote menu remains usable on mobile
14. production remains unchanged
