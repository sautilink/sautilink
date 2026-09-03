# Phase 29 — Moderation, Admin & Appeals

## Status

**Completed:** 2026-09-02  
**Feature PR:** #36  
**Final clean feature head:** `0e74f4350e7ceea1271ca38169243f07596b16aa`  
**Squash merge:** `8d66d7c4aaadfc967214566ff787eb876ca3f8ba`

Phase 29 completed all database, role/RLS, application, Worker, live staging and post-merge gates. Production remains unchanged.

## Goal

Turn the seeded Trust & Safety Preview 07 contract into a real least-privilege moderation system without turning the browser into a superuser console.

This phase completes:

- server-owned staff authorization;
- report queue and assignment;
- captured report context;
- proportionate moderation decisions;
- member moderation notices;
- member appeals;
- senior appeal review;
- immutable audit history.

Phase 30 remains responsible for broader member settings/privacy/account controls.

## Roles

### Reviewer

May:

- read report and appeal queues;
- read captured case context;
- claim reports and appeals;
- dismiss reports;
- limit visibility of reported posts/comments;
- escalate cases.

May not:

- provision staff;
- remove content;
- decide appeals;
- read global audit history;
- read reporter identity.

### Senior reviewer

Includes reviewer permissions and may additionally:

- remove reported posts/comments;
- uphold appeals;
- reverse appeals and restore content;
- read global moderation audit history.

### Auditor

Read-only:

- may inspect case queues;
- may read global audit history;
- cannot claim, update or decide cases.

## Staff authorization

`private.moderation_staff` is the canonical server-owned staff source.

The private roster is outside the Data API and has no browser table grants.

The browser can read only the derived `public.moderation_staff_self` security-invoker view, which returns the current account's role through a narrow private helper. It has no INSERT, UPDATE or DELETE path and no staff-provisioning endpoint.

Staff provisioning remains a protected database/admin operation. Phase 29 does not guess or auto-promote any existing member.

This avoids user-editable metadata, avoids broad staff-table exposure, and avoids relying on stale JWT role claims.

## Reporter privacy

Moderators do not receive `social_reports.reporter_id`.

Authenticated report SELECT is column-scoped and intentionally excludes reporter identity.

At submission, the report validator captures a bounded `context_snapshot` of the reported object so review remains possible even when the live object later changes or becomes unavailable.

The snapshot contains reported-target context, never the reporter's account identity.

## Report lifecycle

Reports begin `open`.

A reviewer may claim a case, moving it to `reviewing`.

Supported decisions:

- `dismissed`;
- `visibility_limited`;
- `content_removed` — Senior Reviewer only;
- `escalated`.

Limit/remove apply only to posts and comments in Phase 29.

Profile and private-message reports may be dismissed or escalated; account sanctions are intentionally deferred.

Every decision requires:

- reason;
- policy version;
- unique UUID request id.

The request id makes decision submission idempotent.

## Moderation visibility

Posts/comments receive a separate server-owned `moderation_state`:

- `visible`;
- `limited`;
- `removed`.

Limited or removed content:

- disappears from other members and anonymous reads;
- remains readable by its author for notice/appeal;
- is readable by staff only when that exact object has a report case.

Moderation staff do not receive broad access to every Sauti or reply.

Existing audience, Circle, block and mute boundaries remain unchanged for ordinary members.

## Member notice and appeals

Visibility-limit, content-removal and appeal decisions create a generic `safety` notification for the affected member.

The notification does not expose the reporter.

`/app/appeals` lists appealable moderation actions affecting the signed-in member.

One appeal may be created per appealable action.

Appeals progress:

- `open`;
- `reviewing`;
- `upheld`;
- `reversed`.

Reviewer may claim an appeal.

Only Senior Reviewer may uphold or reverse it.

A reversed post/comment action restores `moderation_state = visible`.

## Staff workspace

`/app/moderation` is routed through the existing app shell.

The Moderation navigation item remains hidden until `GET /api/moderation/session` confirms an active server-owned role.

Workspace tabs:

- Reports;
- Appeals;
- Audit.

Auditor remains read-only.

## Worker API

Member:

- `GET /api/appeals`
- `POST /api/appeals`

Staff:

- `GET /api/moderation/session`
- `GET /api/moderation/reports`
- `POST /api/moderation/reports/:id/claim`
- `POST /api/moderation/reports/:id/decision`
- `GET /api/moderation/appeals`
- `POST /api/moderation/appeals/:id/claim`
- `POST /api/moderation/appeals/:id/decision`
- `GET /api/moderation/audit`

Queue limits are bounded.

The Worker uses the existing Supabase publishable key plus the member JWT. No service-role or Supabase secret key is added.

## Audit

`social_moderation_actions` is append-only from the browser perspective.

`social_moderation_audit` is written only by protected private trigger functions.

Audit functions use:

- private schema;
- SECURITY DEFINER only for the narrowly required audit/notification insert;
- empty fixed `search_path`;
- revoked direct execution from public, anon and authenticated.

Senior Reviewer and Auditor can read global audit history.

## Non-goals

Phase 29 does not add:

- account suspension or ban;
- automated moderation/AI takedowns;
- keyword or phrase filters;
- moderator staff provisioning UI;
- bulk moderation;
- content-strike scoring;
- legal-request workflows;
- production launch.

## Security gate

Before Phase 29 completion:

1. full repository build/tests pass;
2. migration rollback rehearsal passes;
3. migration + synthetic role test pass inside one rollback transaction;
4. migration applies only to `sautilink-test`;
5. standalone synthetic regression returns `PHASE29_SYNTHETIC_RLS_PASS`;
6. generated Supabase types refresh;
7. security/performance advisors are reviewed;
8. exact Phase 29 feature head passes Brand Guard, Wrangler validation and Workers Build;
9. branch deploy to `test.sautilink.com` passes live signed-out API boundary smoke;
10. final PR exact head is clean and mergeable;
11. post-merge `main` CI and staging deployment pass;
12. durable checkpoint advances to Phase 30.

A real authenticated staff live decision test is performed only if an explicitly provisioned staging staff account exists. No credential or staff role is fabricated for smoke testing.

## Rollback

Rollback order:

1. hide Moderation and Appeals UI routes;
2. remove Phase 29 Worker routes;
3. restore prior post/comment SELECT policies;
4. remove Phase 29 triggers/functions;
5. remove moderation tables/columns only after staging moderation/appeal data is intentionally discarded.

Production remains untouched throughout the phase.

## Completion evidence

- Staging migrations:
  - `enable_phase29_moderation_admin_appeals`
  - `add_phase29_moderation_fk_indexes`
- Staging Supabase project only: `sautilink-test` / `bbrydwzlhweuqxpgbahu`.
- Pre-apply migration + synthetic-role rehearsal completed inside one transaction and rolled back cleanly.
- Post-apply synthetic RLS result: `PHASE29_SYNTHETIC_RLS_PASS`.
- RLS + FORCE RLS verified on `social_moderation_actions`, `social_moderation_appeals` and `social_moderation_audit`.
- Private staff roster has no anon/authenticated table grants; `moderation_staff_self` grants authenticated SELECT only.
- Moderator report SELECT grant excludes `reporter_id`.
- Generated Supabase types contain Phase 29 moderation/appeal/self-role objects.
- Performance advisor's new uncovered foreign-key findings were fixed by the follow-up index migration.
- Security advisor added no Phase 29-specific warning; pre-existing onboarding SECURITY DEFINER and leaked-password-protection warnings remain.
- Branch live-smoke Worker: `59fabdc6-1c9b-4ab9-8174-edeedbf7918b`.
- Branch smoke verified Phase 29 shell markers and signed-out moderation/appeal endpoints returning HTTP 401 `AUTH_REQUIRED`.
- Temporary branch staging workflow was removed before merge.
- Post-merge staging Worker: `caa4a276-ec91-4cc4-b850-c22b496dbcc6`.
- Production/main-domain services were not changed.
