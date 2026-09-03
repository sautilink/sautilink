# SautiLink Project Operating Checkpoint

**Updated:** 2026-09-03  
**Current completed milestone:** Phase 34 — Advanced Real-Time Messaging  
**Web MVP roadmap:** COMPLETE  
**Post-MVP operations baseline:** ACTIVE  
**Post-MVP product development:** ACTIVE

This is the durable source-of-truth handoff for continuing SautiLink work in a new conversation.

## Current live state

SautiLink social web MVP is live with clean canonical social routes:

- `https://sautilink.com/login`
- `https://sautilink.com/signup`
- `https://sautilink.com/home`
- `https://sautilink.com/messages`
- `https://sautilink.com/sautify`
- profile routes under `/u/:username`
- post routes under `/post/:id`
- production APIs under `/api/*`
- legacy `/app/*` routes remain readable for backward compatibility

The existing public marketing/waitlist/legal website remains intact at the main-domain root and continues to be sourced from `sautilink/sautilink`.

The private social source remains in `sautilink/test`.

### Exact current production release

Phase 32 remains the launch architecture baseline:

- Phase 32 feature PR: #46;
- launch squash merge: `46ca421a9b719f0cc302f7c125ef588d590ccaa5`;
- credential-scope recovery PR: #47;
- recovery squash merge: `db25eb06ce8ea764d01c0bbbb92682f5778c2305`.

The latest verified production source is the identity-controls + clean-route convergence merged after the Auth/Post hotfixes:

- identity controls + clean social routes PR: #63;
- PR #63 final exact head: `c5a843cb2b7683e4b13877d2417cd6267a40bc3f`;
- PR #63 merge commit: `d7488841c6aa0912c5360e0b35c0a5d363ed854b`;
- query-safe clean-route hotfix PR: #64;
- PR #64 final exact head: `c2b5a3acdabfc62e0fc0b8eb38c06b976b1edca0`;
- PR #64 squash merge/current runtime source: `5432ac603e4a97401f1358bae502296ac8dcfe69`;
- Phase 33 operations baseline PR: #49;
- Phase 33 squash merge: `71bb9a851241cd028b1ebc0e6b591e09637c803d`;
- Phase 34 feature PR: #51;
- Phase 34 final clean PR head: `d6a64c0bcc6865d7bf98a30cbaf0d4120926c976`;
- Phase 34 squash merge: `2f88ebb6c75cc80502f2a1e0ff95d72f10a7104d`;
- signup verification hotfix PR: #53;
- hotfix final clean PR head: `1738445ca5b3a1fa3844de54b70536537acb9bc3`;
- signup verification hotfix squash merge: `9ff0b64d097bf9f64000452a2e4f56e51f53ce6d`;
- OTP-length hotfix PR: #55;
- OTP-length hotfix final clean PR head: `db5380b5aad9594505fe49dc5bc1772529e10f1e`;
- OTP-length hotfix squash merge: `67a296407d577f8688b5f47465e3fa22a200cc8f`;
- code-only Auth OTP convergence PR: #57;
- PR #57 final clean exact head: `d694354bf2edcc8f731a14adcef163be528e906a`;
- code-only Auth OTP convergence squash merge/current runtime source: `04cd0f4f0e37dff9ff35cf483bc3a0602f7dab5c`;
- production Worker: `sautilink-social-production`;
- current production Worker version: `78755134-9491-4351-bfe7-61683330e74e`;
- production R2 bucket: `sautilink-media-production`;
- code-only Auth production deployment workflow run: `33691301752`;
- code-only Auth production deploy job: `100450508606`;
- code-only Auth staging deployment workflow run: `33691301450`;
- code-only Auth staging deploy job: `100450556165`;
- current staging Worker version: `1fe3b50a-1922-4e01-bbd2-70451eb40368`;
- Phase 34 staging Realtime smoke run: `33685271704`;
- Phase 34 production Realtime preflight run: `33685657131`;
- latest permanent Phase 33 readiness monitor observed before this release: run `33680643320`, successful;
- Phase 34 production migration remains applied successfully to Supabase `rggpyiterdbbugluejcs`.

Latest post-merge live cutover verification for the code-only Auth OTP convergence hotfix passed and confirmed:

- apex `/app/` HTTP 200;
- `www` `/app/` HTTP 200;
- `/api/health` HTTP 200 with `environment: production`;
- assets/media/rate-limit health checks are ready;
- production app has no staging noindex response;
- request-ID correlation works;
- signed-out protected account API returns HTTP 401 `AUTH_REQUIRED`;
- main-domain root remains HTTP 200 with the `Join the Waitlist` ownership marker;
- staging health/app/robots checks are HTTP 200 and staging signed-out account API remains HTTP 401.

### Signup verification / code-only Auth contract

Three successive live reports exposed one underlying configuration-and-cache drift:

1. signup website/email delivery mode disagreed;
2. production sent 8 digits while an older browser bundle still truncated at 6;
3. staging and production hosted Supabase email templates were not aligned, and invalid OTP state could fall back to login.

The resolved application contract after PR #57 is now:

- SautiLink email OTP length is exactly **8 digits**;
- signup Confirmation is OTP-only in the website contract;
- passwordless Email OTP is OTP-only in the website contract;
- reauthentication remains OTP-only;
- signup/passwordless code emails use `{{ .Token }}`, not `{{ .ConfirmationURL }}` or `{{ .TokenHash }}`;
- signup and passwordless requests no longer depend on confirmation-link redirect URLs;
- OTP completion uses `supabase.auth.verifyOtp({ email, token, type: 'email' })`;
- pending signup state is retained in `sessionStorage`;
- invalid/expired codes stay on the verification surface and show a dedicated error instead of returning to login;
- app JS/CSS are network-first under Service Worker shell cache v26;
- the app JS URL has a dedicated cache-busting suffix so previously cached six-digit code cannot remain authoritative;
- canonical hosted templates are stored under `supabase/templates/`.

Hosted Supabase Auth configuration remains a per-project control plane setting and is not a database migration. The Supabase connector available during this fix did not expose an Auth-config/template PATCH action, so the code is deployed but the operator must still align hosted Auth settings in both projects:

- production `rggpyiterdbbugluejcs`: `mailer_otp_length = 8`;
- staging `bbrydwzlhweuqxpgbahu`: `mailer_otp_length = 8`;
- Confirm signup template: code-only canonical template;
- Magic Link / passwordless template: code-only canonical template;
- Reauthentication template: code-only canonical template.

Password recovery, secure email change and admin invitations remain link-based until dedicated OTP-entry product flows are implemented; changing those hosted templates to code-only now would break their current website actions.

PR #57 initially failed two stale regression assertions that still required signup confirmation links. Those tests were corrected rather than bypassed. Final exact-head gates all passed: SautiLink Brand Guard, Phase 1 Authentication, and Phase 32 Production Release verification. Post-merge production and staging deployments passed their live readiness checks.

## Production/staging boundaries

### Production Supabase

- project name: `sautilink`
- ref: `rggpyiterdbbugluejcs`
- URL: `https://rggpyiterdbbugluejcs.supabase.co`

### Staging Supabase

- project name: `sautilink-test`
- ref: `bbrydwzlhweuqxpgbahu`
- staging domain: `test.sautilink.com`

Production and staging social schema fingerprints were exact before launch across selected columns, RLS policies, social/DM/onboarding functions and indexes. See `docs/architecture/phase32-production-launch-main-domain.md` for hashes and evidence.

Checked-in social source remains staging-safe. Production assets/Worker are generated through `scripts/build-production-release.mjs` and verified by `scripts/verify-production-artifact.mjs` so staging Supabase identifiers cannot silently leak into the production artifact.

## Main-domain routing contract

The production social Worker remains explicitly path-scoped. It owns:

- legacy app routes: `/app`, `/app/*`;
- APIs: `/api/*`;
- query-safe clean social prefixes: `/login*`, `/signup*`, `/home*`, `/discover*`, `/saved*`, `/appeals*`, `/moderation*`, `/settings*`, `/notifications*`, `/messages*`, `/sautify*`;
- path-scoped public identities/content: `/u/*`, `/post/*`;
- the same explicit route set on `www.sautilink.com`.

Cloudflare Workers route matching considers the full URL including query strings, so the clean root social prefixes intentionally end with `*`. The Worker router only serves the app shell for recognized clean social paths and passes through production paths that merely share one of those prefixes.

Never broaden this Worker to `sautilink.com/*` or `www.sautilink.com/*` without a deliberate migration of the existing public website.

The existing marketing/legal/waitlist root is intentionally preserved outside the social Worker.

## GitHub Cloudflare credential note

The repository's working Cloudflare account credentials currently live in the GitHub **staging environment**. Phase 32 production deployment therefore uses `environment: staging` only as a credential-storage scope.

This does not make the deployment a staging deployment. Production targets remain:

- Worker `sautilink-social-production`;
- Supabase `rggpyiterdbbugluejcs`;
- R2 `sautilink-media-production`;
- production route set above;
- production rate-limit namespace range `3201`–`3215`.

A dedicated GitHub production environment can replace this credential scope later after the equivalent Cloudflare secrets are configured there.

## Standing execution authorization

For normal post-MVP development, the project owner has authorized ChatGPT to carry focused changes through the full lifecycle without pausing for routine Ready/merge approval:

1. inspect current source-of-truth and relevant docs;
2. create a focused branch;
3. implement the requested scope;
4. run application/database/security/regression tests;
5. deploy/test on staging first when the change can be staged;
6. fix failures until all applicable gates are green;
7. verify exact head and mergeability;
8. merge automatically without asking again when the approved scope and gates are satisfied;
9. verify post-merge behavior;
10. update durable documentation/checkpoint for meaningful milestones.

Never bypass failed CI, RLS/security, deployment or mergeability checks.

For changes that materially alter production data, global routing, irreversible account state, billing/monetization, or other unusually high-impact production boundaries, preserve the same fail-closed review discipline used in Phase 32.

## Product construction rule: reuse before reinventing

SautiLink should not create every interaction pattern from scratch.

Before implementing a social feature:

1. inspect SautiLink's approved existing implementation first;
2. inspect suitable open-source social-network projects for proven patterns;
3. reuse/adapt compatible ideas where license and architecture allow;
4. keep Supabase/Cloudflare/SautiLink security boundaries canonical;
5. never copy branding, proprietary assets, product copy, tracking stacks or incompatible licensed code.

Documented donor/product-pattern references include:

- Bluesky — posting/conversation/accessibility patterns;
- Mastodon — moderation/mute/safety/public-social patterns;
- Lemmy — bounded discussion/thread/moderator-state patterns;
- Meadows — composer/feed/gallery research;
- Misskey — AGPL product-pattern reference only unless explicit compatible intake is approved;
- Telegram — delivery/offline messaging/media research.

SautiLink must remain recognizably SautiLink, not a clone of a single network.

## Branding and UI contract

Public community branding is **Sautify**.

- User-facing copy/routes should use Sautify.
- Canonical routes: `/sautify` and `/sautify/:slug`.
- Legacy `/app/sautify`, `/app/sautify/:slug` and `/app/circles` routes remain accepted for backward compatibility.
- Stable internal database/API identifiers such as `social_circles`, `circle_id`, etc. remain unchanged unless a dedicated migration is explicitly justified.
- Main composer action: **Create Post**.
- Submission action: **Post**.
- Avoid awkward forced wording such as `Share a Sauti`.

The social UI should remain functional and restrained rather than decoration-heavy. Familiar icons and compact controls matter.

Core interactive Sauti action row:

- Comment
- Repost
- Like
- Save
- Share

Report/Delete remain contextual safety/ownership actions rather than primary engagement actions.

## Security architecture rules

- Supabase is canonical for auth/database.
- Cloudflare Workers enforce server/rate-limit/media boundaries.
- R2 stores media binary objects.
- Never expose Supabase service-role/secret keys in browser code.
- Use explicit Data API grants plus RLS.
- Prefer SECURITY INVOKER for browser-callable DB functions unless a reviewed, narrowly scoped exception is required.
- Preserve reporter privacy and moderator least privilege from Phase 29.
- Preserve owner-scoped privacy/account controls from Phase 30.
- Preserve production artifact isolation introduced in Phase 32.
- Preserve Phase 34 private Realtime participant authorization and block boundaries.
- Never put persistent DM body text in Realtime signal payloads.
- Typing/presence remain opt-in through `activity_status`, and read receipts remain gated by `read_receipts`.

### Known production Supabase advisor state

Five security warnings are currently known after the identity-controls migration:

1. `complete_social_onboarding(text,text)` is an intentional authenticated SECURITY DEFINER bootstrap exception bound to `auth.uid()`.
2. `change_social_identity(text,text,uuid)` is an intentional authenticated SECURITY DEFINER identity-control RPC. It is bound to `auth.uid()`, enforces server-side change windows, and cannot self-assign verification.
3. `identity_change_requests_for_staff()` is an intentional SECURITY DEFINER staff read RPC gated by the existing Phase 29 moderation role helper.
4. `review_social_identity_request(uuid,text,text)` is an intentional SECURITY DEFINER staff decision RPC gated to reviewer/senior-reviewer roles.
5. Supabase leaked-password protection is disabled. This remains a tracked post-launch platform-setting improvement.

The identity RPCs use `search_path=''`, explicit EXECUTE grants, owner/staff checks, and rollback synthetic tests. Production and staging advisors showed no new RLS leakage.

Performance advisor may show `unused_index` INFO while production traffic is still low; do not remove launch-critical indexes merely because they are initially unused.

## Completed web MVP milestones

- Phase 13 — Live Profile Basics
- Phase 14 — Discoverable Profile Routes
- Phase 15 — Profile Media
- Phase 16 — Text Sauti / Chronological Stream
- Phase 17 — Reactions, Comments, Reposts, Follows
- Phase 18 — Trust & Safety Foundations
- Phase 19 — Meaningful Notifications
- Phase 20 — Circles MVP (public brand later renamed Sautify)
- Phase 21 — Circle/Sautify Stream MVP
- Phase 22 — Circle/Sautify Notifications + Member Management
- Phase 23 — Real Direct Messages MVP
- Phase 24 — Discover + Saved Sauti
- Phase 25 — Advanced Sauti Composer
- Phase 26 — Conversations & Threaded Replies
- Phase 27 — Sauti Media + Cloudflare R2
- Phase 28 — Mute + Safety Completion
- Phase 29 — Moderation, Admin & Appeals
- Phase 30 — Settings, Privacy & Account Controls
- Phase 31 — MVP Launch Hardening
- Phase 32 — Production Launch / Main Domain

Detailed web-MVP phase evidence lives under `docs/architecture/phase13-*.md` through `docs/architecture/phase32-production-launch-main-domain.md`.

## Completed post-MVP milestones

- Phase 33 — Post-MVP Production Operations & Reliability
- Phase 34 — Advanced Real-Time Messaging

### Phase 33 operating evidence

- feature PR #49;
- final exact head `eb142330299f39c9335308b706dacbbead9f8762`;
- squash merge `71bb9a851241cd028b1ebc0e6b591e09637c803d`;
- read-only production readiness probe installed;
- permanent monitor runs every six hours and supports manual dispatch;
- monitor requires no Cloudflare/Supabase deployment secret;
- production operations/rollback runbook lives at `docs/operations/production-runbook.md`;
- PR and post-merge Brand Guard, repository tests, staging Wrangler and production Wrangler/artifact verification passed;
- post-merge Phase 33 production monitor run #4 passed with `PRODUCTION_READINESS_PASS`;
- post-merge production deployment produced Worker version `12eba3cb-8dc2-4429-b663-a19edda63e12`;
- post-merge staging deployment produced Worker version `be8145ea-5951-4031-a476-38767626b0c1`;
- no Supabase migration, production data mutation, UI redesign, route widening or new secret was introduced.

Detailed Phase 33 evidence lives at `docs/architecture/phase33-post-mvp-production-operations.md`.


### Phase 34 operating evidence

- feature PR #51;
- final clean PR head `d6a64c0bcc6865d7bf98a30cbaf0d4120926c976`;
- squash merge/current release source `2f88ebb6c75cc80502f2a1e0ff95d72f10a7104d`;
- staging and production migrations applied successfully;
- private per-user Realtime topics refresh inbox/unread/read state;
- private per-conversation channels provide opt-in typing and online presence;
- message bodies remain canonical in `public.dm_messages` behind existing participant RLS;
- database Realtime signals contain only bounded IDs/operation metadata, never persistent DM body text;
- block relationships prevent conversation typing/presence channel authorization;
- existing `activity_status` and `read_receipts` privacy preferences remain canonical;
- staging synthetic authorization/regression tests passed;
- staging live Realtime smoke run `33685271704` passed;
- production Realtime transport preflight run `33685657131` passed;
- production Supabase advisors showed no new Phase 34-specific security/performance finding;
- post-merge Brand Guard, app/auth verification, production artifact verification and production deployment passed;
- production Worker version is `448a7f5b-e256-4479-9b33-97ddbe38bb82`;
- production cutover passed on the first convergence attempt with production health ready and signed-out protected API returning HTTP 401;
- no group chat, voice/video, media/file DM, disappearing messages or E2EE claim was introduced.

Detailed Phase 34 evidence lives at `docs/architecture/phase34-advanced-realtime-messaging.md`.

## Post-MVP work

The planned web MVP roadmap is complete and the Phase 33 production-operations baseline is active. Future work is post-MVP product development and operations rather than unfinished launch scope.

Deferred examples include:

- group chat;
- voice/video calls;
- personalized recommendation ranking;
- live audio/video;
- monetization/ads;
- marketplace;
- native Android/iOS/desktop apps;
- privileged data-export archive processing/delivery;
- final automated Auth/account purge after deletion recovery windows;
- dedicated GitHub production credential environment;
- enabling Supabase leaked-password protection when available/approved for the account plan.

### Next recommended product phase

Unless the project owner redirects scope, the next logical post-MVP product candidate is **Phase 35 — Group Chat MVP**.

Keep it deliberately bounded:

- text-first group conversations;
- membership/admin roles;
- existing block/safety rules respected;
- private participant-only data/realtime access;
- no voice/video calls yet;
- no E2EE claim unless a dedicated cryptographic architecture is designed and reviewed;
- reuse the Phase 23/34 DM patterns where appropriate rather than creating a parallel messaging stack from scratch.

## Most important continuation rule

Before any future change, read this file and the most relevant phase architecture document. Treat `main`, the permanent Phase 33 production readiness monitor, live production health/cutover checks, and the current Supabase/Cloudflare state as source-of-truth. Do not assume staging and production are interchangeable even when schema parity exists.


## Auth email template consistency checkpoint — 2026-09-03

The current website/Auth contract and the five hosted email templates were converged into one guarded source of truth.

Feature PR:
- PR #59 — `Auth: align all hosted email templates with runtime flows`;
- final exact head `a43de08ef777dcf533c77276cdbb6212b98f1f4e`;
- squash merge `068f9ad46d3979aed78e0b10094c1ced105ac6a1`.

Canonical current flow matrix:
- Confirm Signup → exact 8-digit OTP → `{{ .Token }}` only;
- Passwordless Email OTP / Supabase Magic Link template → exact 8-digit OTP → `{{ .Token }}` only;
- Reauthentication → exact 8-digit OTP → `{{ .Token }}` only;
- Change Email Address → secure confirmation link → `{{ .ConfirmationURL }}` plus `{{ .NewEmail }}`;
- Reset Password / Recovery → secure recovery link → `{{ .ConfirmationURL }}`;
- Invite remains link-based and outside this five-template branding convergence.

Canonical hosted-template files:
- `supabase/templates/confirmation-code-only.html`;
- `supabase/templates/magic-link-code-only.html`;
- `supabase/templates/reauthentication-code-only.html`;
- `supabase/templates/email-change-link.html`;
- `supabase/templates/recovery-link.html`.

All five templates share:
- official SautiLink logo;
- SautiLink Corporation header/footer;
- Uhuru Street, Mwanza, Tanzania;
- noreply@sautilink.com automated-security wording;
- matching security notice and copyright treatment.

Regression protection:
- `tests/auth-email-flow-contract.test.mjs` now checks template existence, shared branding, OTP-vs-link variable separation, and forbids code-entry wording in link-only templates;
- `src/auth-email-contract.js` remains the website delivery-mode/code-length authority;
- no website runtime semantics, database schema, RLS policy, production data, secret, or route scope was changed.

PR #59 exact-head gates:
- SautiLink Brand Guard run `33695424135`: PASS;
- Phase 1 Authentication run `33695424141`: PASS;
- Phase 32 Production Launch PR verification run `33695424076`: PASS.

Post-merge main verification for `068f9ad46d3979aed78e0b10094c1ced105ac6a1`:
- SautiLink Brand Guard run `33695505742`: PASS;
- Phase 1 Authentication run `33695505804`: PASS;
- staging deploy job `100463534341`: PASS;
- staging Worker version `b527bd97-87c5-448e-a279-d74ac12a2a49`;
- Phase 32 Production Launch run `33695505759`: PASS;
- production deploy job `100463500701`: PASS;
- production Worker version `70045068-c37e-4518-9757-85cc587ab79c`;
- production cutover: health 200, app 200, www app 200, root 200;
- staging readiness: health 200, app 200, robots 200.

Hosted Supabase Dashboard configuration remains project-level Auth configuration rather than repository/SQL state. Both production `rggpyiterdbbugluejcs` and staging `bbrydwzlhweuqxpgbahu` must keep Email OTP Length at exactly 8 and use the matching canonical hosted template for each flow.


## Production post creation hotfix + Post terminology convergence — 2026-09-03

A production blocker was identified from a real failed owner post attempt.

Observed production evidence:
- Supabase API logged `POST /rest/v1/social_posts` → HTTP 403 at `2026-09-02T23:54:40Z`;
- production Postgres logged `permission denied for table social_posts` at the same timestamp;
- the media object/metadata validation path succeeded before the post insert failed;
- therefore the 1.8 MB image size was not the cause.

Root cause:
- `src/sauti-posts-api.js` still sent legacy `reply_to_post_id: null` for root-post creation;
- after Phase 26 made threaded replies canonical through `parent_post_id`, authenticated INSERT grants no longer include `reply_to_post_id`;
- PostgREST rejected the entire insert with table permission denied, affecting both text-only and media posts.

Fix:
- removed `reply_to_post_id` from the root create payload;
- preserved `parent_post_id` for threaded replies;
- verified all remaining root-post insert fields and media-attach update fields are allowed in both production and staging;
- no DB migration/RLS/secret/route-scope change was required;
- rotated service worker cache to `sautilink-shell-v27`;
- cache-busted app JS with `31-hardening1-authotp2-posthotfix1`;
- changed current user-facing standalone content terminology from **Sauti** to familiar **Post/Posts**, while preserving the brands **SautiLink** and **Sautify** and all stable internal identifiers/routes.

Regression protection:
- Phase 16 source test now forbids `reply_to_post_id: null` in the root create payload;
- runtime branding test forbids standalone `Sauti` copy in current app/API/preview runtime surfaces;
- historical internal names such as `/api/sauti`, `social_posts`, DOM ids, and architecture phase names remain stable.

Feature PR:
- PR #61 — `Fix production post creation and standardize Post terminology`;
- final exact head `9b88baafcea7f8e4c5d83b4bb9fb3e92bb2bb39d`;
- squash merge `d3454a8e0ae7d206207610dc1f7c7dee5bc74190`.

Exact-head gates:
- Brand Guard run `33697588651`: PASS;
- Phase 1 Authentication run `33697588796`: PASS;
- Phase 32 Production Launch PR verification run `33697588694`: PASS.

Post-merge:
- Brand Guard run `33697658640`: PASS;
- Phase 1 Authentication run `33697658676`: PASS;
- staging deploy job `100470067309`: PASS;
- staging Worker version `bc303c38-7c6b-45c8-9d06-0309a20d6a2f`;
- staging readiness: health 200, app 200, robots 200;
- Phase 32 Production Launch run `33697658638`: PASS;
- production deploy job `100470052089`: PASS;
- production Worker version `710ca230-d383-4848-8cd3-f1862fd2809a`;
- production cutover: health 200, app 200, www app 200, root 200.

Next acceptance action:
- retry one text-only Post and one image+caption Post on production;
- if either fails, inspect the new production request timestamp immediately before any further feature work.


## Identity controls + clean social URL convergence — 2026-09-03

The owner requested familiar profile identity controls and mainstream social URL structure.

### Identity policy now enforced server-side

Migration source:

- `supabase/migrations/20260903003000_enable_identity_change_controls.sql`;
- production migration recorded as `20260903003705_enable_identity_change_controls`.

Rules:

- unverified member display name: maximum **2 changes per rolling 14 days**;
- verified member display name: cannot change immediately; a **name-change request** is created and must be approved by SautiLink moderation;
- username: maximum **1 change per rolling 30 days** for all members;
- `is_verified` is server-owned and authenticated members cannot update it directly;
- account `full_name` and social `display_name` stay synchronized through the guarded identity flow;
- owner-only identity history/request RLS is active;
- verified-name review is integrated into the moderation workspace under **Name requests**.

Rollback synthetic DB tests passed on both staging and production with marker:

- `IDENTITY_CHANGE_CONTROLS_PASS`.

The test proves:

- first and second unverified name changes succeed;
- third name change inside 14 days is blocked;
- second username change inside 30 days is blocked;
- verified display name stays unchanged until review;
- verified request is created;
- member self-update of `is_verified` is denied.

### Clean canonical social URLs

Canonical social navigation now uses:

- `/login`
- `/signup`
- `/home`
- `/discover`
- `/saved`
- `/appeals`
- `/moderation`
- `/settings`
- `/notifications`
- `/messages`
- `/messages/:conversation_id`
- `/sautify`
- `/sautify/:slug`
- `/u/:username`
- `/post/:post_id`

Legacy `/app/*` URLs remain readable and are canonicalized by the browser where appropriate.

The marketing/waitlist/legal root remains outside the social Worker.

### PR/deployment evidence

Feature PR #63:

- final exact head: `c5a843cb2b7683e4b13877d2417cd6267a40bc3f`;
- merge commit: `d7488841c6aa0912c5360e0b35c0a5d363ed854b`;
- exact-head Brand Guard, Phase 1 Authentication, and Phase 32 production verification all passed;
- first post-merge production deployment correctly failed closed because exact Cloudflare route patterns did not match query strings.

Query-safe route hotfix PR #64:

- final exact head: `c2b5a3acdabfc62e0fc0b8eb38c06b976b1edca0`;
- squash merge/current runtime source: `5432ac603e4a97401f1358bae502296ac8dcfe69`;
- exact-head Brand Guard, Phase 1 Authentication, and Phase 32 production verification all passed;
- production run `33701016524`: PASS;
- production deploy job `100480226188`: PASS;
- production Worker version: `78755134-9491-4351-bfe7-61683330e74e`;
- final production convergence: health 200, app 200, login 200, signup 200, home 200, www app 200, root 200;
- signed-out protected production account API: HTTP 401;
- staging run `33701016552`: PASS;
- staging deploy job `100480257096`: PASS;
- staging Worker version: `1fe3b50a-1922-4e01-bbd2-70451eb40368`;
- staging readiness converged to health 200, app 200, robots 200, signed-out protected API 401.

Cloudflare query-safe routing remains narrow: there is still no broad `sautilink.com/*` or `www.sautilink.com/*` social Worker route.
