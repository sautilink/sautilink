# Phase 30 — Settings, Privacy & Account Controls

## Status

Completed on 2026-09-02.

- Feature PR: #41
- Final clean feature head: `c595af46548bd3f0302afe05706fa01e4c9d8283`
- Squash merge SHA: `ed64a917d1142ff6156f5ad4539d93b8f290286c`
- Branch live-smoke Worker: `104dc778-78ca-46ae-b08a-696ea3461051`
- Post-merge main Worker: `3c4689fc-83bd-425f-b22b-913035a5dd46`
- Staging Supabase synthetic result: `PHASE30_SYNTHETIC_RLS_PASS`

Production remained unchanged.

## Goal

Turn the seeded Settings & Privacy preview into real owner-scoped controls without exposing private account state through the public profile or giving the browser elevated credentials.

## Live settings surface

`/app/settings` uses the existing SautiLink app shell and exposes:

- Account;
- Privacy;
- Notifications;
- Safety;
- Your data.

Desktop navigation includes Settings directly. Mobile keeps the compact six-item bottom navigation and exposes Settings from the signed-in member's own Profile.

## Account

The member can:

- review username and verified account email;
- request the existing password-change email flow;
- sign out every other Supabase session while keeping the current session.

Supabase Auth remains canonical. No password, refresh token or service-role key is stored in the social database.

## Privacy

Public-profile fields:

- `is_discoverable`;
- `allow_external_indexing`;
- `dm_access` = `following`, `everyone`, or `none`.

`allow_external_indexing` is only an owner preference in staging because staging remains globally `noindex`. Production crawler behavior is deferred to the launch phase.

Private owner settings live in `social_member_preferences`:

- read receipts;
- activity-status permission;
- post-activity notifications;
- message badges;
- follower notifications;
- Sautify notifications;
- email digest preference.

The private preferences table has RLS + FORCE RLS and owner-only grants/policies.

## Direct-message privacy

Phase 30 reuses the Phase 23 DM model.

New-conversation creation and new message delivery both enforce the recipient's current `dm_access` setting.

For `following`, delivery is allowed only when the recipient follows the sender.

Read receipts are not exposed by reading another member's conversation-state row. A narrow privacy-gated helper returns the peer's read timestamp only when:

1. the caller belongs to the conversation; and
2. the peer currently permits read receipts.

If receipts are disabled, the browser receives `null`.

## Notifications

Existing notification creation is preserved but a protected before-insert trigger suppresses disabled categories:

- follow → follower preference;
- reply/like/reshare → post-activity preference;
- Sautify membership activity → Sautify preference.

The owner SELECT policy also hides older rows from categories later disabled, so changing a preference has immediate effect.

Safety/moderation notices remain available.

Message notification preference controls the local unread badge; DM history remains available.

## Safety lists

Blocked and muted lists remain private and reuse the existing Phase 18/28 RLS tables.

Unblock/unmute uses owner-scoped row deletion by target UUID, so recovery still works even when the target profile is no longer discoverable.

## Data export

`social_data_export_requests` stores owner-scoped export request state.

The browser may:

- create an idempotent pending request;
- read its own request;
- cancel an active request.

The browser may not mark an export processing/ready. Archive preparation and secure delivery require a future privileged processor.

The Worker uses the existing publishable key plus the member bearer JWT and an independent Cloudflare rate limiter.

## Recoverable account deletion

Phase 30 extends the Phase 18 deletion request instead of duplicating it.

A new pending request:

- requires the literal confirmation `DELETE` at the Worker boundary;
- requires a sign-in within the previous 24 hours;
- hides the profile immediately;
- records `scheduled_for = now() + 14 days`.

The member may cancel during the pending recovery window and the prior discoverability state is restored.

Final Auth deletion remains a privileged backend operation and is not exposed to browser code.

## Non-goals

Phase 30 does not add:

- final automated Auth-user purge;
- export archive processor or email delivery;
- exact last-seen timestamps;
- production search indexing;
- MFA enrollment UI;
- native-app settings;
- production launch.

## Security gate

Before completion:

1. full repository build/tests pass;
2. migration + synthetic role/privacy flow passes inside one rollback transaction;
3. rollback leaves staging schema unchanged;
4. migration applies only to `sautilink-test`;
5. standalone synthetic regression returns `PHASE30_SYNTHETIC_RLS_PASS`;
6. generated Supabase types refresh;
7. security/performance advisors are reviewed;
8. exact feature head passes Brand Guard, Wrangler validation and Workers Build;
9. branch deploy to `test.sautilink.com` passes Settings/API signed-out boundary smoke;
10. final PR exact head is clean and mergeable;
11. post-merge `main` CI and staging deployment pass;
12. durable checkpoint advances to Phase 31.

Production remains untouched throughout the phase.


## Completion evidence

- Migration rehearsal plus the Phase 30 synthetic owner/peer flow passed inside a single transaction and rolled back cleanly before staging apply.
- Staging-only migration `enable_phase30_settings_privacy_account_controls` applied successfully to `sautilink-test`; production Supabase was not touched.
- The standalone staging regression returned `PHASE30_SYNTHETIC_RLS_PASS`.
- RLS and FORCE RLS are enabled on `social_member_preferences`, `social_data_export_requests`, and the pre-existing `social_account_deletion_requests`.
- Authenticated browser mutation grants remain column-scoped. The browser cannot mark an export ready or complete final Auth deletion.
- Generated Supabase TypeScript types were refreshed and include Phase 30 settings/export/DM-read contracts.
- Supabase security advisors showed no new Phase 30-specific warnings. The existing authenticated `complete_social_onboarding` SECURITY DEFINER warning and leaked-password-protection warning remain unchanged.
- Performance advisors showed no new unindexed-foreign-key debt caused by Phase 30. New/low-traffic indexes may still appear as `unused_index` INFO until staging traffic exercises them.
- Branch live smoke passed on `test.sautilink.com` after propagation-safe retries. It verified the Phase 30 Settings shell, assets, privacy-gated DM read-receipt code, and signed-out account/deletion API boundaries returning HTTP 401 `AUTH_REQUIRED`.
- Temporary `.github/workflows/phase30-staging.yml` was removed before final clean-head CI and was not merged to `main`.
- Final clean feature head passed Brand Guard, full build/tests, Wrangler validation and Workers Build; PR #41 was non-draft, mergeable, and clean before merge.
- Post-merge `main` passed Brand Guard, full build/tests, Wrangler validation and Workers Build, then deployed successfully to `test.sautilink.com` as Worker `3c4689fc-83bd-425f-b22b-913035a5dd46`.
- The next active milestone is **Phase 31 — MVP Launch Hardening**.
