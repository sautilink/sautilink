# Phase 21 — Circle Stream MVP

Status: **staging acceptance gate**

Phase 21 turns the Phase 20 Circle membership foundation into a usable member conversation surface. It extends the existing canonical Sauti model instead of creating a separate Circle-post system, and it keeps the accepted app shell and Circle UI intact.

## Live scope

- Share text Sauti inside a Circle.
- Read a chronological Circle Stream from the Circle detail route.
- Allow Circle owners and current members to read and post.
- Reuse the existing Like, Comment, Repost, Delete and Report interaction surfaces.
- Keep Open Circle content member-only even though the Circle itself is discoverable.
- Keep Approval Circle content limited to approved members.
- Keep Private Circle content limited to members and keep the Circle itself hidden from non-members.
- Preserve existing block enforcement.
- Preserve direct `/app/circles/:slug` routes.
- Keep Home Stream and Circle Stream isolated.

## Deferred

Phase 21 intentionally does **not** activate:

- Circle notifications
- Circle moderator/admin roles
- private invitations or manual member-management controls
- Circle media uploads
- DMs, push notifications, or email notifications

## Canonical data boundary

Phase 21 reuses `public.social_posts`.

Public Home Sauti remain:

- `visibility = 'public'`
- `circle_id is null`

Circle Sauti use:

- `visibility = 'circle'`
- a non-null `circle_id`

The authenticated post policy permits Circle reads and writes only when the current user has a row in `public.social_circle_members` for that Circle. Post authorship, published status, top-level scope and Circle membership are enforced by RLS rather than trusted browser input.

Anonymous users retain public read-only behavior and receive no Circle access.

## Home / Circle isolation

`public.social_stream_events` remains a security-invoker read model, but Phase 21 explicitly limits both original-post and repost branches to public, non-Circle Sauti.

Circle Stream reads query canonical `social_posts` by `circle_id` and `visibility = 'circle'`.

This prevents a Circle post or a repost of a Circle post from entering the Home Stream merely because the authenticated user is allowed to read it.

## Notification boundary

Circle notifications remain deferred.

The existing internal Phase 19 notification trigger now checks the target post's `circle_id`. Likes, comments and reposts on Circle Sauti update the normal counters but do not create notification rows. Existing public Sauti and follow notifications continue to work.

Direct browser execution of the notification trigger remains revoked.

## Verification checkpoint — 2026-09-01

All database behavior tests below ran inside transactions and were rolled back.

### Visibility and stream isolation

- member sees Circle Sauti: **PASS**
- owner sees Circle Sauti: **PASS**
- owner sees own Private Circle Sauti: **PASS**
- non-member sees Open Circle Sauti: **0**
- non-member sees Private Circle Sauti: **0**
- non-member sees Private Circle: **0**
- Circle Sauti appearing in Home Stream: **0**
- Private Circle Sauti appearing in Home Stream: **0**
- public Sauti remains visible in Home Stream: **PASS**

### Existing interactions reused

- Circle Like count: **1**
- Circle Comment count: **1**
- Circle Repost count: **1**
- Circle interaction notifications created: **0**
- public interaction notification still created: **1**

### Block boundary

After the Circle owner blocks the member:

- member Circle membership remaining: **0**
- blocked member can still read that Circle Sauti: **0**

### Privilege audit

- anonymous post write privileges: **0**
- authenticated post UPDATE privileges: **0**
- Phase 21 authenticated SELECT policy: **present**
- Phase 21 authenticated INSERT policy: **present**
- direct authenticated/anonymous execution of the private notification trigger: **0**

### Supabase advisors

No new Phase 21 security issue was reported.

Existing unrelated warnings remain:

- intentional authenticated `public.complete_social_onboarding(...)` SECURITY DEFINER onboarding boundary
- leaked-password protection disabled on the current project plan/settings

Performance advisor output remains informational unused-index notices. The existing `social_posts_circle_created_idx` is retained because Phase 21 now queries Circle posts by Circle and chronology.

## Build and staging

Phase 21 branch validation completed before the temporary staging workflow was removed:

- application build: **PASS**
- full test suite: **PASS**
- Phase 21 focused tests: **PASS**
- Cloudflare deployment dry-run: **PASS**
- generated browser bundle synchronized: **PASS**
- deploy to `test.sautilink.com`: **PASS**
- production: **unchanged**

Successful staging workflow run: `33533908572`.

The temporary branch-only staging workflow was removed after the successful deployment.

## Staging acceptance gate

Before Phase 21 can merge, verify on `test.sautilink.com`:

1. Open a Circle you own and share a Circle Sauti.
2. From a second joined account, confirm the Circle Sauti is visible.
3. Like, comment and repost that Circle Sauti.
4. Delete a Circle Sauti you authored.
5. Confirm a non-member of an Open Circle cannot read its Circle Stream.
6. Confirm an unapproved requester cannot read an Approval Circle Stream.
7. Confirm a Private Circle remains unavailable to a non-member.
8. Confirm Circle Sauti do not appear in the Home Stream.
9. Confirm desktop and mobile Circle detail layouts remain usable and visually consistent.
