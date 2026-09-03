# Phase 20 — Circles MVP

Status: **staging acceptance gate**

Phase 20 activates the Circle foundation already present in SautiLink. It stays inside the existing app shell and does not redesign Stream, Notifications, Profile, or Trust & Safety.

## Live scope

- Create a Circle with an owner-selected membership policy:
  - `open`
  - `approval`
  - `private`
- Browse Circles available to the signed-in member.
- Open direct Circle routes under `/app/circles/:slug`.
- Join and leave Open Circles.
- Request access to Approval Circles.
- Allow the Circle owner to approve or decline pending requests.
- Keep Private Circles hidden from non-members.
- Automatically create the owner membership.
- Clean approved-request state after a member leaves so they can request again.
- Remove Circle memberships and requests across a newly blocked owner/member relationship.

## Deferred

Phase 20 intentionally does **not** activate:

- Circle-scoped Sauti/posts
- Circle notifications
- invites or private member-management UI
- moderator-role management
- DMs, push notifications, or email notifications

## Database boundary

Phase 20 reuses `public.social_circles` and `public.social_circle_members` from the existing MVP foundation and adds `public.social_circle_join_requests`.

All three live Circle tables use forced RLS and explicit browser grants. Anonymous users have no Circle table privileges.

Authenticated browser writes are constrained:

- Circle update: `name`, `description`, `join_policy`
- Join-request update: `status`
- Circle ownership and slug are not browser-updatable.
- Membership insertion is RLS-checked.
- Approval membership creation happens in an internal trigger that verifies `auth.uid()` is the Circle owner.

The policy helper lives in a dedicated `policy_private` schema. The existing `private` schema remains unavailable to authenticated users.

## Block boundary

The existing block enforcement trigger now also removes:

- join requests between a Circle owner and the blocked member
- non-owner memberships between that Circle owner and the blocked member

Circle visibility policies also hide those owner/member relationships while the block exists.

## Verification checkpoint — 2026-09-01

### Synthetic database tests

All tests ran inside transactions and were rolled back.

- owner memberships created: **3 / 3**
- Open Circle join: **PASS**
- Approval request creation: **PASS**
- Approval creates membership: **PASS**
- approval decision timestamp/state: **PASS**
- Private Circle hidden from non-member: **PASS**
- leave removes membership: **PASS**
- block removes cross-owner memberships: **PASS**
- blocked owner Circles hidden: **PASS**
- approve → leave → request again: **PASS**
  - membership after leave: `0`
  - fresh pending request after re-entry: `1`

### Privilege audit

- anonymous Circle table privileges: **0**
- authenticated Circle update columns: `description`, `join_policy`, `name`
- authenticated join-request update columns: `status`
- authenticated usage of existing `private` schema: **false**
- authenticated direct execution of approval trigger: **false**
- authenticated execution of the dedicated Circle policy helper: **true**

### Build and staging

Phase 20 branch validation completed successfully before the temporary staging workflow was removed:

- dependency install: **PASS**
- application build: **PASS**
- Phase 20 tests: **PASS**
- full test suite after forward-compatible historical guards: **PASS**
- generated browser bundle synchronized: **PASS**
- Cloudflare deploy to `test.sautilink.com`: **PASS**
- production: **unchanged**

Successful staging workflow run: `33529823640`.

### Supabase advisors

No new Phase 20 security finding was reported.

Existing unrelated warnings remain:

- intentional authenticated `public.complete_social_onboarding(...)` SECURITY DEFINER boundary
- leaked-password protection disabled on the current project plan/settings

Performance advisor output remains informational unused-index notices; no Phase 20 blocker was identified.

## Acceptance gate

Before Phase 20 can merge, verify on staging:

1. Circles appears in desktop and mobile navigation.
2. Create Open, Approval, and Private Circles.
3. A second account can join and leave an Open Circle.
4. A second account can request an Approval Circle; the owner can approve or decline.
5. A Private Circle is not discoverable to a non-member.
6. Direct routes `/app/circles` and `/app/circles/:slug` open correctly.
7. Blocking the Circle owner/member removes and hides the Circle relationship.
8. Mobile layout remains usable and the existing app visual language is unchanged.
