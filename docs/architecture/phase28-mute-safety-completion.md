# Phase 28 — Mute + Safety Completion

## Status

Phase 28 completed on 2026-09-02.

- Feature PR: #34.
- Squash merge: `2cf03db4613e61b59bde9a70ad472e076029bd7e`.
- Staging Supabase migration: applied to `sautilink-test`.
- Synthetic RLS test: `PHASE28_SYNTHETIC_RLS_PASS`.
- Branch live smoke: passed.
- Branch staging Worker version: `490159b1-2b75-4c69-a545-db909af088b0`.
- Post-merge `main` CI and `test.sautilink.com` deployment: passed.
- Post-merge staging Worker version: `888ef397-8726-421c-a6c2-a42fca60ece0`.
- Production remains unchanged.

## Goal

Finish the member-facing safety layer without duplicating Phase 18 or entering the Phase 29 moderation/admin scope.

Phase 18 already delivered reports, block/unblock and account deletion request/cancel. Phase 28 adds a distinct private mute relationship and makes existing safety boundaries consistent across Sauti, replies, reposts, notifications, Discover and Direct Messages.

## Mute versus block

### Mute

Mute is a private preference owned by the muter.

- does not notify the muted member;
- does not unfollow either account;
- does not prevent follows;
- does not prevent Direct Message delivery;
- does not delete conversation history;
- hides the muted member's Sauti and threaded replies from the muter;
- hides repost events created by the muted member;
- hides and suppresses social notifications from the muted actor;
- removes muted accounts from generic Discover suggestions while allowing explicit search so the member can find and unmute them;
- keeps a muted DM conversation available but excludes it from the unread badge.

### Block

Block remains the stronger Phase 18 boundary.

- removes existing follows between the accounts;
- denies new follows and social interactions;
- hides blocked content/profile access according to existing RLS;
- prevents new DM delivery;
- keeps historical DM content where the existing Phase 23 model allows it.

Block supersedes mute. Creating a block clears the blocker's existing mute relationship. Unblocking does not silently recreate the old mute.

## Database contract

`public.social_mutes` stores:

- `muter_id`;
- `muted_id`;
- `created_at`.

The pair is unique and self-mute is prohibited.

RLS is forced. Authenticated members may only select, insert and delete mute rows where they are the muter.

Phase 28 extends authenticated SELECT boundaries for:

- `social_posts`;
- `social_post_comments`;
- `social_reposts`;
- `social_notifications`.

Profile visibility and DM delivery RLS are intentionally not changed by mute.

## Notification lifecycle

A private BEFORE INSERT trigger suppresses a social notification when its recipient currently mutes its actor.

Creating a mute also removes existing notifications from that actor so an unmute does not reveal a backlog of old events.

These helpers live in `private`, are SECURITY DEFINER only where table-side cleanup requires it, use a fixed empty `search_path`, and revoke execution from browser roles.

## Worker API

Authenticated endpoints:

- `GET /api/safety/mute/<username>`
- `POST /api/safety/mute/<username>`
- `DELETE /api/safety/mute/<username>`

The Worker uses the member JWT against RLS and the existing publishable-key boundary. No Supabase service-role or secret credential is added.

A dedicated staging rate-limit namespace `SAFETY_MUTE_LIMITER` bounds mute reads/writes.

## Browser experience

Without redesigning the accepted shell:

- non-owner profiles expose Mute/Unmute alongside Report and Block;
- blocked profiles hide Mute because block already supersedes it;
- DM thread controls expose Mute/Unmute separately from Block;
- muted DMs remain readable/sendable;
- muted peers contribute zero to the message unread badge;
- generic Discover suggestions omit muted members;
- explicit Discover search may show a muted member with a Muted label;
- mute/unmute refreshes the relevant Stream, Discover, notification and message state.

## Non-goals

Phase 28 does not add:

- moderator/admin case processing;
- appeals;
- content takedown decisions;
- moderator roles;
- keyword mutes;
- phrase filters;
- Circle-specific moderation;
- group chat;
- DM delivery blocking through mute.

Those belong to later roadmap work where applicable.

## Security gate

Before completion:

1. full repository build/tests pass;
2. migration rollback rehearsal passes on `sautilink-test`;
3. Phase 28 migration is applied only to staging;
4. synthetic RLS regression returns `PHASE28_SYNTHETIC_RLS_PASS`;
5. generated Supabase types are refreshed;
6. security/performance advisors are reviewed;
7. Wrangler validation and Workers Build pass;
8. branch deploy to `test.sautilink.com` passes;
9. live signed-out mute endpoints return `401 AUTH_REQUIRED`;
10. final PR exact head is mergeable and green;
11. post-merge `main` CI and staging deployment pass;
12. durable project checkpoint advances to Phase 29.

## Rollback

If Phase 28 must be rolled back:

- remove or disable mute controls first;
- revert authenticated SELECT policies to the Phase 26/19/legacy predecessors;
- remove Phase 28 triggers and helper functions;
- remove `social_mutes` only after any staging mute rows are intentionally discarded.

Production remains untouched throughout this phase.


## Completion evidence

The final Phase 28 gate recorded:

- migration rollback rehearsal passing before staging DDL;
- full repository build/tests passing on the final clean feature head;
- Brand Guard and Wrangler validation passing;
- Cloudflare Workers Build passing;
- `social_mutes` RLS and FORCE RLS enabled with owner-only policies;
- no anonymous grants on `social_mutes`;
- synthetic tests proving muted content/notifications are suppressed while follows remain intact;
- synthetic tests proving self-mute and cross-user mute deletion are denied;
- block-over-mute cleanup passing;
- generated Supabase types refreshed;
- live staging shell exposing profile and DM Mute/Unmute controls;
- live unauthenticated GET/POST/DELETE mute calls each returning HTTP 401 `AUTH_REQUIRED`;
- post-merge `main` staging deployment succeeding.

Supabase performance lint reports the new `social_mutes_muted_id_idx` as unused immediately after creation; it is retained until real staging traffic provides meaningful usage evidence.
