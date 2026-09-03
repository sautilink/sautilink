# Phase 18 — Reports, Blocks, Account Deletion & Moderation Foundations

Status: IN PROGRESS  
Environment: staging only  
Base main: `8fb3ba6f1c1079d78c592f06bddeb5a52268a47d`

## Goal

Turn the existing trust/safety database primitives into a live member-facing foundation without duplicating earlier schema.

Phase 18 must preserve the Phase 13–17 profile, Stream and social interaction behavior while adding enforceable reports, blocks, account-deletion requests and moderation lifecycle foundations.

## Existing primitives found during audit

The staging project already contains:

- `public.social_blocks`
  - composite primary key `(blocker_id, blocked_id)`
  - self-block prevention constraint
  - RLS enabled
  - member SELECT/INSERT/DELETE grants
  - blocker/blocked foreign keys with `ON DELETE CASCADE`
  - existing `blocked_id` index
- `public.social_reports`
  - report reasons and lifecycle status constraints
  - RLS enabled
  - authenticated INSERT only
  - reporter/status indexes
  - no member SELECT/UPDATE/DELETE grant
- Phase 17 already checks blocks for follows and authenticated reads of posts/comments/reposts.
- `public.social_stream_events` remains a security-invoker view over canonical posts + reposts.

These objects will be evolved, not recreated.

## Scope

### 1. Blocks

- block/unblock discoverable members;
- no self-block;
- inserting a block removes existing follow relationships in both directions;
- blocked relationships deny new follows, Likes, comments and reposts;
- if another member blocked you, their profile is unavailable to you;
- if you blocked another member, their public profile shell may remain reachable so you can undo your own block, while their posts/interactions remain hidden;
- no destructive deletion of historical posts/comments merely because a block was created.

### 2. Reports

Live report targets in this phase:

- profile;
- post;
- comment.

Existing future target types such as message/circle remain schema-compatible but are not exposed in the Phase 18 member UI.

Report rules:

- authenticated reporter only;
- target must currently be visible to the reporter;
- no self-report for profile/post/comment;
- reasons remain: spam, harassment, hate, impersonation, privacy, other;
- details maximum remains 2,000 characters;
- duplicate active reports for the same reporter + target are rejected;
- reporter cannot read or mutate moderation-only fields.

### 3. Moderation foundation

`social_reports` remains the canonical intake table.

Add server-owned lifecycle metadata:

- status update timestamp;
- reviewed timestamp;
- resolved timestamp;
- moderation note.

Add a private immutable status-transition audit table populated by a private trigger. No live admin dashboard is introduced in this phase.

### 4. Account deletion request foundation

Add an owner-scoped deletion-request table with:

- pending;
- cancelled;
- completed.

Member behavior:

- requesting deletion immediately hides the public profile by setting discoverability off;
- cancelling restores the previous discoverability choice;
- requests can be re-opened after cancellation;
- a member cannot mark their own deletion completed;
- the final privileged Supabase Auth user purge is intentionally deferred until a dedicated secure backend processor is provisioned.

This avoids exposing a service-role/admin secret in the browser or the Cloudflare Worker.

## API surface

Cloudflare Worker endpoints:

- `POST /api/safety/report`
- `GET /api/safety/block/<username>`
- `POST /api/safety/block/<username>`
- `DELETE /api/safety/block/<username>`
- `GET /api/safety/deletion-request`
- `POST /api/safety/deletion-request`
- `DELETE /api/safety/deletion-request`

All endpoints require a verified Supabase session and use the member JWT against RLS-protected Data API tables. No service-role key is used.

## UI surface

Without redesigning the approved app shell:

- non-owner profile gets Report and Block/Unblock controls;
- each Sauti gets a Report action;
- each visible comment gets a Report action;
- owner account security gets a deletion-request card;
- report uses a restrained modal with reason + optional details;
- success/error feedback uses existing SautiLink toast/form-message patterns.

## Non-goals

- no admin moderation dashboard;
- no appeals workflow;
- no automatic content takedown;
- no final Auth user purge;
- no DM/circle report UI;
- no algorithmic moderation;
- no redesign of Stream/profile/auth UI.

## Security requirements

- staging project only: `bbrydwzlhweuqxpgbahu`;
- never touch `rggpyiterdbbugluejcs`;
- explicit grants + RLS;
- no `service_role` / `sb_secret_` in browser or Worker;
- any SECURITY DEFINER trigger helper must live in `private`, use fixed empty search_path, and have EXECUTE revoked from public/client roles;
- views remain security-invoker;
- run Supabase security/performance advisors after DDL;
- run synthetic RLS tests and full repository CI before live staging acceptance.

## Merge gate

Scope approval, staging deployment and live acceptance do not authorize merge.

Merge requires:
1. PR Ready;
2. exact current head SHA;
3. explicit owner approval of that exact head;
4. immediate re-fetch before merge;
5. merge with `expected_head_sha`;
6. post-merge main CI + actual staging deployment;
7. final durable checkpoint on main.


## Implementation checkpoint — 2026-09-01

Implemented on staging only:

- Supabase migration `20260901133800_enable_phase18_trust_safety_foundations`;
- follow-up audit FK index migration `20260901133834_index_phase18_report_status_audit`;
- profile/post/comment reporting with duplicate active-report and self-report denial;
- private moderation status audit;
- block-triggered bidirectional follow cleanup;
- block enforcement for follow, Like, comment and repost creation;
- authenticated profile visibility denies a member who has been blocked by the profile owner;
- owner deletion-request lifecycle with discoverability hide/restore;
- live Worker `/api/safety/*` routes and dedicated Cloudflare rate-limit namespaces 1801–1803;
- member UI controls for Report, Block/Unblock and account deletion request/cancel;
- app shell cache generation advanced to `sautilink-shell-v8`.

Verification completed:

- synthetic staging RLS transaction: `PHASE18_SYNTHETIC_RLS_PASS`;
- Supabase performance advisor regression from Phase 18 fixed by adding the private audit FK index;
- remaining advisor findings are pre-existing/unused-index informational findings plus previously known Auth/onboarding warnings;
- SautiLink Brand Guard passed;
- Phase 1 Authentication build/tests and Cloudflare dry-run passed at head `f67a10441e3f35bf28f941539336dff345974fef`.

Generated browser bundle sync and live staging acceptance remain pending. No merge authorization has been given.


### Live staging deployment checkpoint

- Phase 18 branch deployed successfully to `test.sautilink.com`.
- Cloudflare Worker live version: `24fa6ebe-e937-4694-80c5-8a052ff8fce4`.
- GitHub-runner live HTTP smoke passed with marker `PHASE18_LIVE_STAGING_SMOKE_PASS`.
- Live app shell confirmed Phase 18 profile Report/Block controls and account-deletion request control.
- Live `app/assets/app.js?v=19` confirmed the report, block and deletion-request routes.
- Signed-out requests to the live deletion-request and block endpoints returned `401 AUTH_REQUIRED`.
- Temporary bundle/deploy workflows were removed after use.
- Member-authenticated acceptance is still required before PR readiness/merge approval.


## Owner live acceptance — Phase 18 member safety controls

Date: 2026-09-01

Owner completed authenticated live staging acceptance on `https://test.sautilink.com`.

Acceptance results:

### Report

- report action opened from live member/content surfaces;
- report submission completed successfully;
- live UI returned the expected SautiLink success feedback.

Status: **PASS**

### Block / Unblock

- block action completed;
- existing relationship behavior updated as expected;
- blocked-state restrictions behaved correctly;
- unblock restored normal access.

Status: **PASS**

### Account deletion request / cancel

- deletion request completed;
- public discoverability was hidden while pending;
- cancellation completed;
- previous discoverability state was restored.

Status: **PASS**

Owner response:
**"Report pass, Block/Unblock pass, Delete/Cancel pass."**

## Phase 18 acceptance summary

- database migration + RLS regression: PASS;
- Supabase advisor regression remediation: PASS;
- Worker/API regression: PASS;
- generated browser bundle sync: PASS;
- live staging deployment: PASS;
- live signed-out HTTP smoke: PASS;
- authenticated Report: PASS;
- authenticated Block/Unblock: PASS;
- authenticated Delete/Cancel: PASS.

Phase 18 is functionally accepted on staging.

Merge remains separately gated by:
1. final exact-head CI;
2. PR Ready state;
3. explicit owner approval of that exact head SHA.


## Final merge and deployment checkpoint — 2026-09-01

PR #17 — **Phase 18: reports, blocks, deletion and moderation foundations** — is complete.

Owner merge authorization:
`Nimeweka Ready; Ninaidhinisha PR #17 exact head 3fda900fe710f31f7ea00f8c205376bf5abcb2d0`

Pre-merge gate:
- PR state: open;
- Draft: false / Ready;
- approved exact head: `3fda900fe710f31f7ea00f8c205376bf5abcb2d0`;
- mergeable: true.

Merge:
- expected head SHA enforced: `3fda900fe710f31f7ea00f8c205376bf5abcb2d0`;
- merge result: SUCCESS;
- merge commit: `21e352cad4ca363d21588162b57023d90aaed843`;
- merged at: `2026-09-01T15:27:40Z`.

Post-merge main verification for `21e352cad4ca363d21588162b57023d90aaed843`:
- SautiLink Brand Guard run `33525873922`: PASS;
- Phase 1 Authentication run `33525873800`: PASS;
- full build/tests: PASS;
- Cloudflare deployment validation: PASS;
- actual `Deploy test.sautilink.com` job `99916642486`: PASS;
- live custom-domain deployment: PASS;
- live Worker version: `00aa427b-1aa8-411e-8b91-8e6f8ec4ceb7`.

Owner live acceptance before merge:
- Report: PASS;
- Block/Unblock: PASS;
- Account deletion request/cancel: PASS.

Status: **COMPLETE**

Next roadmap phase:
- Phase 19 — Notifications & Activity Centre.
