# Voluntary verification removal

Verified members can choose **Settings → Account → Verification badge status → Remove verification**. The control is absent for unverified, loading and signed-out states. It follows the current profile checkmark, not a historical approved application.

The built-in destructive confirmation defaults to **Keep verification**. It explains that removal cannot be undone, normal username change limits apply, and future verification requires a new application and every review step again. Prior verification does not guarantee approval.

## Authorized scope

On 20 October 2026 the owner explicitly approved a backend exception for this setting only. This is required because the previous identity policy permanently retained `username_locked_at` even after verification ended. Voluntary removal clears that lock; staff revocation retains its existing restriction. The one-username-change-per-30-days rule, reserved names and all other identity limits remain unchanged.

## Server contract

- `POST /api/account/verification/remove` requires the current member's Bearer session, the existing account-control rate limiter, an application/json body bounded to 1 KiB, a UUID `request_id`, and the exact acknowledgement `remove-verification-v1`. Extra target/user arguments are rejected.
- `public.remove_my_social_verification(uuid,text)` is an authenticated-only invoker wrapper. Its private definer helper binds the target to `auth.uid()` and cannot grant verification.
- Private receipts make a retry idempotent without allowing a stale request to remove a later verification. A pending receipt in the same transaction is the only new exception to the username-lock trigger. Members cannot read or write receipts.
- The transaction removes the active badge, normalizes its type, clears the voluntary lock, records one audit event, cancels any active verification case and retires prior cases. Historical approval/evidence remains recorded. Retired cases cannot reopen or restore a badge; a fresh full application can receive a new staff review.
- The existing staff setter's role comparison is made NULL-safe. Its canonical live body and permissions otherwise remain unchanged, preventing ordinary members from bypassing the new reapplication requirement through that older setter.
- The frontend accepts only an authoritative owner-matching removal response. It guards cancellation, duplicate clicks, logout/account switches, stale identity/case responses and delayed enhancement timers. Other members' checkmarks are preserved.

Migration: `supabase/migrations/20261020195741_enable_self_verification_removal.sql`, created using Supabase CLI 2.121.0.

## Validation and rollout

- Canonical `npm run check`: 1,118 tests passed, no failures or skips; staging and production artifact verification passed.
- Local PGlite 0.5.10 executed the relevant canonical live functions/columns, migration and all 76 SQL regression statements successfully. Synthetic users and receipts rolled back to zero. This local fixture omits outbound notification/queue triggers and does not replace canonical validation.
- Browser preview uses real presenters, shared CSS/icons and the built-in dialog with synthetic in-memory responses; network access is blocked. Cancellation sent zero mock writes; loading/unverified/historical approval states hid the control; failure retained the checkmark; success reopened the full request flow while preserving another member's badge.
- Exact-head GitHub CI, reviewed migration application, canonical rollback SQL regression, advisor comparison, merge and Git-linked production deployment are required before reporting the setting live. The retired Supabase test project is inactive and is not resumed for this change.

Verification evidence is stored outside the repository in `outputs/SautiLink-Verification-Removal-20261020`.
