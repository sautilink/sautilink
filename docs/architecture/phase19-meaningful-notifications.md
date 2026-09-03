# Phase 19 — Meaningful Notifications

## Scope

Phase 19 activates the notification foundation already present in the SautiLink MVP database. It does not add a second notification table or redesign the app.

Live events covered in this phase:

- new follower
- Like on your Sauti
- comment on your Sauti
- repost of your Sauti
- unread indicator
- mark one notification read
- mark all notifications read

## Privacy and safety boundaries

- notifications are recipient-private;
- authenticated members can only read their own rows;
- browser access is limited to SELECT plus UPDATE of `read_at`;
- protected notification identity columns remain immutable from the client;
- blocked relationships are filtered from notification reads;
- self-actions do not generate notifications;
- undoing Follow, Like, comment or repost removes the matching notification;
- notification creation runs in a private trigger function with EXECUTE revoked from public roles.

## Product boundaries

Deferred from this slice:

- push notifications
- email notification delivery
- mention parsing
- DM notifications
- Circles notifications
- safety/moderation system notices
- notification preferences beyond the existing account-level setting

These remain separate reviewed slices so Phase 19 stays lightweight and testable.

## Verification gate

Before merge:

1. database regression test for recipient isolation and client column permissions;
2. synthetic two-member staging test for Follow/Like/comment/repost generation and undo cleanup;
3. blocked-actor visibility test;
4. app unread/read acceptance on `test.sautilink.com`;
5. full build/tests and Cloudflare dry-run;
6. explicit exact-head merge approval.


## Staging checkpoint — 2026-09-01

Database verification:
- migration applied to staging project only;
- Follow, Like, comment and repost generated four distinct notification types;
- undoing Like removed the matching notification;
- blocking removed all remaining cross-member notifications;
- recipient RLS probe exposed the recipient row and hid the other member row;
- authenticated privileges allow SELECT plus UPDATE of `read_at` only.

Application verification:
- full build and test suite passed in the Phase 19 staging workflow;
- generated `app/assets/app.js` was synchronized from `src/app.js`;
- Cloudflare deployment to the existing `test` environment completed successfully;
- production was not changed.

Supabase advisors after migration reported no new Phase 19 security finding. Existing project-level warnings remain outside this slice.
