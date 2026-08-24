# Meadows open-source intake audit

**Audit date:** 2026-08-24

**SautiLink branch:** `open-source-audit`

**Donor:** [Meadows Social Media](https://github.com/hoangsonww/Meadows-Social-Media)

**Pinned upstream commit:** `8dc28e4d36a106390ddb5a754f902b9f4f85b728`

**Upstream commit date:** 2026-03-19

**License:** MIT, Copyright 2025 Son Nguyen

## Decision

Do **not** fork or deploy Meadows wholesale. Use it only as a selectively copied and substantially adapted UI/interaction donor.

The donor proves that the desired social product can be assembled quickly, and its MIT license permits reuse when the copyright and license notice are retained. However, its database authorization, media workflow, notification creation, dependency posture, CI, privacy choices, and scaling model do not meet SautiLink's production bar.

The recommended implementation path is:

1. Keep SautiLink's existing public site, Cloudflare Worker boundary, and Phase 1 auth/onboarding work.
2. Evolve the private `/app` into a React + Vite SPA served by the existing Worker/static-assets setup.
3. Port selected Meadows interaction patterns component by component, using SautiLink naming, visual identity, tests, accessibility, and data contracts.
4. Rewrite all database migrations, authorization, writes, uploads, notifications, and feed queries for the SautiLink hybrid architecture.

This gives us the useful part of a ready-made project without inheriting its production risks or the cost and bundle weight of Next.js SSR. The private `/app` does not need server-side rendering for search indexing.

## Executive findings

| Severity | Finding | Decision |
| --- | --- | --- |
| Critical | No RLS enablement or policies were found for public-schema tables | Block all donor SQL from SautiLink |
| Critical | Direct browser writes trust supplied actor/owner IDs | Rewrite behind RLS and secure Worker/RPC boundaries |
| High | Media uploads have no demonstrated size, MIME, magic-byte, ownership, or cleanup controls | Replace Supabase Storage flow with validated R2 flow |
| High | Post, media, attachment, and poll creation is non-transactional | Rewrite as atomic database operation plus compensating media cleanup |
| High | Notifications are assembled and inserted by the client | Derive server-side and dispatch asynchronously |
| High | Original production dependency audit reported 12 vulnerabilities: 9 high, 1 moderate, 2 low | Upgrade and minimize dependencies; copy no lockfile |
| High | Feed queries return every liker/voter identity per post | Replace with counts, viewer state, and keyset pagination |
| Medium | Global Vercel Analytics and external Google Fonts conflict with SautiLink privacy policy | Remove; keep self-hosted fonts and intentional telemetry only |
| Medium | CI runs Node 18, mutating format commands, mocked unit tests, and a simulated deploy step | Replace with SautiLink CI and current supported Node |
| Medium | The Next.js build is Cloudflare-compatible but heavy | Prefer React + Vite SPA for `/app` |

## What was verified

### Source and licensing

- The audit used the exact upstream commit shown above, not an unpinned branch snapshot.
- The repository contains an MIT license.
- No separate asset-license inventory or NOTICE file was found.
- Meadows logos, favicon, screenshots, product copy, and other branding will not be reused.
- Any substantial copied source must retain the upstream MIT copyright/license notice in SautiLink's third-party notices.

### Build, tests, and dependency health

The original locked donor checkout produced these results before Cloudflare adapter experiments:

- `npm ci`: passed; 717 packages installed.
- Jest: 4 suites and 31 tests passed.
- Coverage: 63.62% statements, 41.62% branches, 75.55% functions, 62.4% lines.
- Lint: passed, but uses the deprecated `next lint` command.
- Next production build: passed only after dummy public Supabase build variables were supplied.
- Shared first-load JavaScript: approximately 220 kB; routes were approximately 221–258 kB.
- `npm audit --omit=dev`: 12 production vulnerabilities: 9 high, 1 moderate, 2 low, 0 critical.

Important limitations:

- Tests are mocked unit tests. There are no RLS, database integration, storage-policy, end-to-end, abuse, or Cloudflare runtime tests.
- Top-level `__tests__` are outside Jest's configured roots and therefore do not run. At least one references a component path that no longer exists.
- Caret version ranges allow dependency drift. Installing the current Cloudflare adapter moved Next.js from the locked 15.5.9 to 15.5.23 in the temporary copy.
- CI uses `actions/checkout@v3`, `actions/setup-node@v3`, and Node 18. [Supabase has announced](https://supabase.com/changelog/45715-deprecation-notice-dropping-support-for-node-js-20) that its JavaScript client now requires Node 22 or newer after dropping Node 20 support.
- The CI “Deploy to Vercel” job only prints messages and sleeps; it does not deploy.

### Cloudflare compatibility experiment

The donor had no Wrangler or OpenNext configuration. In a disposable copy only, the audit added current `@opennextjs/cloudflare` and Wrangler configuration, then ran:

1. OpenNext production build with dummy public Supabase values.
2. `wrangler deploy --dry-run` with no deployment.

Results:

- OpenNext generated `.open-next/worker.js` successfully.
- Wrangler 4.125.0 completed the dry-run.
- Dry-run upload size: 5,335.19 KiB raw / 1,098.76 KiB gzip, plus 47 static asset files.
- One generated-bundle warning about comparison with negative zero was reported.
- No Cloudflare account resource was created and no deployment occurred.

Conclusion: Meadows is **compatible in principle** with Cloudflare Workers, but the upstream project is **not Cloudflare-ready as checked in**. Cloudflare supports the Pages Router, SSR, and SSG through OpenNext, and recommends testing in `workerd`, not relying only on the Node development server. See [Cloudflare's current Next.js guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/).

For SautiLink, this compatibility is useful evidence but not a reason to adopt the full Next.js runtime. A private social application shell gains little from SSR, while the audited bundle and dependency surface are materially larger than SautiLink's current Phase 1 preview.

## Supabase and Postgres blockers

Supabase requires RLS on tables exposed through the Data API. Current projects also require explicit API grants for newly created tables, so both policy and privileges must be deliberate. References: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) and [Data API grants change](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically).

### Authorization

No occurrence of the following was found across the donor's `migrations/` and `database/` SQL:

- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
- `CREATE POLICY`
- explicit `GRANT`
- explicit `REVOKE`

This creates two unacceptable outcomes depending on project defaults: tables may be unusable through the API, or exposed tables may lack row authorization. None of the donor SQL may be applied to SautiLink production.

### Schema integrity

- `migrations/profile.sql:1-7`: handle is nullable and has no uniqueness, format, or reserved-name constraint.
- `migrations/post.sql:1-10`: client-controlled timestamp, nullable author, random default on the author foreign key, no content-length constraint, and no author cascade.
- `migrations/follow.sql:1-7`: random defaults on foreign keys, no self-follow constraint, and no cascades.
- `migrations/like.sql:1-7`: random defaults on foreign keys and no cascades.
- `migrations/post_poll.sql:19-27`: a vote references a post and an option independently; no composite constraint proves that the option belongs to that post.
- SQL is duplicated across multiple folders and has unclear ordering; several scripts are not idempotent.

### Profile creation

`migrations/user_profile_management.sql:15-25` uses a `SECURITY DEFINER` trigger with an empty search path, which is a good start. It still copies user-editable metadata directly into canonical `name` and `handle` fields with no normalization, uniqueness, reserved-handle, or confirmation checks.

SautiLink should keep the stronger Phase 1 onboarding migration and validation from PR #8.

### Rate limiting

`migrations/20260316_add_daily_vibe_and_comments.sql:229-255` counts recent comments using the row's submitted `author_id`. Without database ownership enforcement, that identity can be spoofed. Concurrent requests can also race the count.

SautiLink needs both:

- Worker edge rate limiting for abuse and cost control.
- RLS/database enforcement that derives ownership from `auth.uid()` rather than submitted identity.

### Direct client writes and partial failures

`web/utils/supabase/queries/post.ts:345-460` inserts a post, uploads up to eight files, inserts attachment rows, updates a legacy attachment field, then inserts poll rows in separate operations. Any later failure can leave partial database state or orphaned files.

`web/utils/supabase/queries/comment.ts:110-133` and `:245-311` allow the browser to construct notification recipients, actors, types, and payloads. Notifications must instead be derived from authoritative server-side events.

## Media and privacy blockers

- Post paths are based on post ID rather than a strongly enforced owner namespace.
- No demonstrated file-size limit, MIME allowlist, magic-byte verification, image dimension limit, malware/moderation hook, or quota enforcement exists.
- Upload occurs before the complete relational workflow is known to have succeeded.
- Media cleanup is incomplete when later writes or comment deletion fail.
- `web/next.config.ts:6-13` accepts remote images from every HTTPS hostname (`**`). This is too broad and increases cost and abuse exposure.
- `web/pages/_app.tsx:10,39` mounts Vercel Analytics globally.
- The donor uses external Google Fonts.

SautiLink will use R2 through Worker bindings. The Worker will validate session, ownership, declared type, magic bytes, size, dimensions, quotas, and object key before finalization. R2 credentials will never be exposed to the browser. Media cleanup and database finalization must be idempotent.

## Scaling findings

- `web/utils/supabase/queries/post.ts:12-46` includes all liker IDs, reaction voter IDs, and poll voter IDs in every feed post. Payload size therefore grows with engagement.
- The following feed requires client-side round trips and uses offset pagination, which drifts under concurrent posting.
- `web/utils/supabase/queries/vibe-pulse.ts:151-183` fetches every page into browser memory.
- `web/utils/supabase/queries/vibe-pulse.ts:245-390` downloads circle statuses and reaction rows and aggregates them in the client.

SautiLink should return aggregate counts plus the current viewer's state, use keyset cursors, and keep D1 as a rebuildable derived read model when scale warrants it. Supabase Postgres remains the source of truth.

## Authentication findings

- `web/pages/signup.tsx:25-55` performs only presence checks, stores handle/name in user metadata, and routes to `/home` when `data.user` exists even when email confirmation may mean no session exists.
- No complete email-confirmation, OTP, recovery, handle-availability, reserved-handle, or strong password flow was found.
- Raw provider error messages are displayed to users.
- `web/pages/profile/[id].tsx:417-432` checks the wrapper object rather than `userData.user` before passing the user onward.

Do not replace SautiLink PR #8 auth. Keep its normalized validation, session handling, recovery/confirmation UX, onboarding, no-index private app behavior, and hardened SQL.

## Take / Adapt / Rewrite / Reject

| Action | Donor surface | SautiLink treatment |
| --- | --- | --- |
| Take | General card composition, responsive three-column rhythm, empty/loading states, infinite-scroll interaction ideas | Recreate with SautiLink tokens and accessibility; retain MIT notice for substantial copied code |
| Take | Zod-at-boundary idea and React Query invalidation patterns | Use generated Supabase types plus stricter schemas and stable query keys |
| Adapt | Profile, follow, post card, comments/replies, mentions, search, reactions, and poll UI | Rename to SautiLink language; simplify payloads; connect only to SautiLink contracts |
| Adapt | Familiar microblog interaction rhythm | Preserve familiar usability while using Stream, Discover, Circles, Saved, and “Share a Sauti” identity |
| Rewrite | All SQL, triggers, functions, RLS, grants, and indexes | Author ordered SautiLink migrations with tests and rollback notes |
| Rewrite | Signup, login, onboarding, confirmation, and recovery | Continue PR #8 implementation |
| Rewrite | Post/comment/follow/reaction writes | Enforce `auth.uid()`, ownership, constraints, rate limits, and idempotency |
| Rewrite | Upload and deletion workflows | Worker-controlled R2 validation/finalization and cleanup |
| Rewrite | Notifications | Server-derived events plus Cloudflare Queues |
| Rewrite | Feed and pulse aggregation | Keyset pagination; aggregate counts; D1 derived feed later |
| Rewrite | Cloudflare configuration and CI | Current Wrangler, generated bindings, `workerd` tests, observability, real dry-run/deploy gates |
| Reject | Meadows branding, copy, logo, favicon, screenshots, and landing page | Keep SautiLink's existing public homepage and identity |
| Reject | Vercel Analytics and external Google Fonts | Privacy-first telemetry only; self-hosted fonts |
| Reject | Supabase Storage media flow | R2 is the SautiLink media store |
| Reject | Local-storage-only bookmarks | Implement Saved as authenticated server data |
| Reject for Phase 1 | Vibe Pulse and weekly recap | Revisit later as privacy-reviewed derived aggregates |
| Reject | Donor Docker/fake deploy pipeline | Use SautiLink's own CI/CD |

## Proposed implementation slices

Each slice gets its own branch, tests, review, and PR. Nothing is merged without explicit approval.

1. **Finish PR #8** — review and merge only after explicit approval; then deploy auth migration and `/app` separately.
2. **App shell migration** — React + Vite inside `/app`, preserve public pages, SautiLink navigation/brand tokens, bundle budget, no data-model expansion.
3. **Profiles and Circles** — typed queries, RLS tests, follow/unfollow constraints, search limits, block/mute foundations.
4. **Share a Sauti** — text-only creation first, transactional database API, abuse controls, edit/delete policy.
5. **Stream** — keyset timeline, aggregate engagement, optimistic UI with reconciliation, cache rules.
6. **R2 media** — signed/authorized upload lifecycle, validation, quotas, cleanup, moderation hooks.
7. **Replies, reactions, notifications** — server-derived events, queues, preference controls, unread state.
8. **D1 read model** — introduce only after measured Supabase/feed pressure; source-of-truth reconciliation and rebuild tooling are mandatory.

## Acceptance gates for imported code

No donor-derived component enters production unless it passes all applicable gates:

- SautiLink naming, design tokens, and accessibility review.
- Generated database types and explicit runtime validation.
- RLS and privilege tests for every table/API path.
- Ownership derived from authenticated identity.
- No service-role secret in browser code.
- No unrestricted external image hosts.
- Bundle impact measured against a documented budget.
- Unit, integration, and `workerd`-runtime coverage.
- Dependency and license review.
- Privacy review for telemetry and exposed social graph data.
- Explicit PR approval before merge.

## Final recommendation

Proceed with Meadows as a **controlled reference implementation**. It can shorten UI and interaction work, but it should not define SautiLink's database, security, storage, deployment, or product identity.

The next coding step remains PR #8 review/approval. After that, start a small React + Vite `/app` shell proof rather than importing the Meadows repository. That proof should port only the Stream shell and one static Sauti card, measure its bundle, and leave production data untouched.
