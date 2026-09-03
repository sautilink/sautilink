# Phase 22 — Circle Notifications + Member Management

Status: **staging acceptance gate**

Phase 22 extends the Phase 21 Circle Stream with meaningful Circle activity notifications and a focused owner-only member roster. It preserves the accepted app shell and does not introduce moderator roles, invites, DMs, push, email, or media changes.

## Live scope

- Notify a Circle owner when someone requests to join an Approval Circle.
- Notify the requester when the owner approves or declines the request.
- Remove the stale owner join-request notification after the request is decided.
- Notify a member when the Circle owner removes them.
- Notify Circle Sauti authors for Circle Like, Comment and Repost activity.
- Attach Circle context to notifications when the recipient is still allowed to see the Circle.
- Open the Circle route from a Circle notification only when the Circle is visible through normal RLS.
- Let a Circle owner view the Circle membership roster.
- Let a Circle owner remove any non-owner member.
- Keep self-leave separate from owner removal.
- Suppress owner-removal notifications when membership disappears because of a block relationship.

## Deferred

Phase 22 intentionally does **not** activate:

- moderator/admin role management
- owner transfer
- private invitations
- manual member add
- member bans independent of the existing block system
- Circle notification preferences
- push notifications
- email notifications
- DMs
- Circle media

## Notification schema

Phase 22 extends `public.social_notifications` with:

- `circle_id uuid` — optional Circle context
- `circle_event text` — optional membership event subtype

Allowed membership event subtypes:

- `join_request`
- `request_approved`
- `request_declined`
- `member_removed`

The existing notification types remain unchanged. Circle Sauti interactions continue to use:

- `like`
- `reply`
- `reshare`

with a non-null `circle_id`.

Browser clients still have no INSERT or DELETE privilege on `social_notifications`. Notification creation remains trigger-owned.

## Member-management RLS

Phase 22 replaces the Phase 20 self-only member SELECT/DELETE policies with policies that allow:

- any member to read their own membership row
- a Circle owner to read all membership rows for their own Circle
- any non-owner member to leave their own Circle
- a Circle owner to remove a non-owner member

The owner row remains undeletable through this policy.

Owner checks use the dedicated non-exposed `policy_private.is_phase22_circle_owner(uuid)` helper to avoid RLS recursion between Circles and membership rows.

## Notification lifecycle

### Approval request

1. requester inserts a pending join request
2. owner receives `notification_type='circle'`, `circle_event='join_request'`
3. owner approves or declines
4. stale owner `join_request` notification is deleted
5. requester receives `request_approved` or `request_declined`

### Circle Sauti interaction

Like, Comment and Repost reuse the existing Phase 19 internal trigger. Phase 22 now records the Circle context rather than suppressing Circle notifications.

### Owner removal

When the owner explicitly removes a member, the removed member receives `member_removed`.

No `member_removed` notification is generated for:

- self-leave
- owner row deletion
- block-driven membership cleanup
- non-owner/non-authorized deletion paths

## Verification checkpoint — 2026-09-01

All synthetic behavior tests ran inside transactions and were rolled back.

### Membership roster and removal

- ordinary member sees roster rows: **1** (self only)
- owner sees roster rows: **2** (owner + member)
- owner removal deletes membership: **PASS**
- member row after owner removal: **0**
- owner removal notification: **1**
- self-leave removal notification: **0**
- membership after owner/member block cleanup: **0**
- block-generated removal notification: **0**

### Circle notifications

- Circle Like notification: **1**
- Approval join-request notification: **1**
- Approval decision notification: **1**
- stale join-request notification after decision: **0**
- decline decision notification: **1**

### Privilege audit

- authenticated browser notification INSERT/DELETE privileges: **0**
- owner roster SELECT policy: **present**
- owner member DELETE policy: **present**
- authenticated owner policy helper execution: **allowed**
- authenticated direct execution of Circle notification trigger: **denied**

### Supabase advisors

No new Phase 22 security warning was reported.

Existing unrelated warnings remain:

- intentional authenticated `public.complete_social_onboarding(...)` SECURITY DEFINER onboarding boundary
- leaked-password protection disabled on the current project plan/settings

The initial performance advisor identified the new Circle notification foreign key as lacking a covering index. Phase 22 added `social_notifications_circle_id_idx`; the foreign-key warning is now cleared. Remaining performance notices are staging unused-index information only.

## Build and staging

Phase 22 branch validation completed before the temporary staging workflow was removed:

- application build: **PASS**
- full test suite: **PASS**
- Phase 22 focused tests: **PASS**
- SautiLink Brand Guard: **PASS**
- Cloudflare deployment validation: **PASS**
- generated browser bundle synchronized: **PASS**
- deploy to `test.sautilink.com`: **PASS**
- production: **unchanged**

Successful staging workflow run: `33536971381`.

The temporary branch-only staging workflow was removed after successful deployment.

## Staging acceptance gate

Before Phase 22 can merge, verify on `test.sautilink.com`:

1. From Account B, request to join an Approval Circle owned by Account A.
2. On Account A, confirm a Circle join-request notification appears.
3. Approve the request and confirm the stale join-request notification disappears from the owner after refresh.
4. On Account B, confirm an approval notification appears and opens the Circle.
5. Repeat with a declined request and confirm the requester receives a decline notification.
6. In an owned Circle, open the Members section and confirm owner + joined members appear.
7. Remove a non-owner member and confirm the roster updates.
8. On the removed account, confirm a removal notification appears.
9. Let a member leave by themselves and confirm no owner-removal notification is created.
10. Like, comment and repost a Circle Sauti from another member and confirm the Sauti author receives Circle-context notifications.
11. Confirm a non-owner does not receive the owner-only roster.
12. Confirm desktop/mobile layouts remain stable.
