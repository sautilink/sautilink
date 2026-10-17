# Native signup phone policy

Status: **owner approved and applied to the existing production backend on
15 October 2026**. The approved SQL was applied after preflight checks and backups,
then reconciled with server migration history as
[`20261015004334_native_optional_phone.sql`](../../supabase/migrations/20261015004334_native_optional_phone.sql).
The applied migration and archived draft have the same SHA256:
`7D379DECBD235A66411DE5C17E7CC7C5BABBF037E0C37B1397B7B26AB15D9FAB`.

The server now advertises `phoneRequired:false`. Native continues defaulting a
missing capability to `true`, preserving safe behavior with an older server.
This approved backend change does not merge the draft PR or publish an app.

## Scope

The owner requested email as required and phone as optional in native signup.
The native form permits a blank phone and never submits fake phone metadata.
A supplied phone remains validated and goes through the existing phone-change
verification. Email verification and accepted Terms/Privacy remain required.
Existing passwords, OTP routes, encrypted sessions, accounts, profiles and RLS
are preserved. DOB displays DD/MM/YYYY and is sent to the existing private date
column as YYYY-MM-DD.

The applied migration adds a server-owned `private.signup_policy.phone_required` flag,
defaults it to `false`, exposes the `phoneRequired` boolean through the existing
authenticated requirements RPC and replaces the mandatory-phone trigger
condition. It makes the required primary email explicit in the insert
trigger: new accounts after activation need both a nonblank Auth email and its
confirmed timestamp, including trusted inserts. The existing verified-email
onboarding RPC and consent records stay intact. No user metadata is trusted as
proof of verification or authorization.

Read-only production metadata confirms ordinary authenticated clients have no
INSERT grant and no INSERT policy on `account_profiles`; they use the onboarding
RPC. The other repo admission path is the privileged waitlist insert, which
already verifies email OTP first. Making phone optional removes the second
identity prerequisite, so the migration explicitly enforces the owner's mandatory
email rule at the shared insert boundary too. Existing profiles, UPDATE paths,
pre-activation exemptions and privileged agreement/phone handling are unchanged.

The original SQL remains archived unchanged under `sql-drafts` as the exact
approved source. The local migration was generated through the Supabase CLI and
reconciled to the actual server history version after application. Production and
read-only staging were not used for write probes or synthetic signup fixtures.

## Shared backend effect

The admission policy is shared by native and web. Existing web signup still asks
for and requires phone locally; no web code was changed. Previously released
native/web clients still use the original fields and continue requesting phone.
Changing the backend permits phone-free admission for clients that implement the
new capability. It does not remove phones or phone login from existing accounts.

## Actual verification and remaining checks

- **PASS:** the cached Kotlin compiler compiled `AuthInputValidation.kt` with
  `native-android/validation/AuthInputValidationCheck.kt`, and the behavior harness
  ran successfully. It checks strict DOB dates, formatting/resume/cursor mapping,
  username/phone validation and signup admission predicates. These are local
  behavior checks, not a fresh Samsung signup.
- **PASS:** read-only checks after application confirmed the server-owned
  `phone_required` flag is `false`, the requirements capability is present and
  verified-email and consent guards remain present.
- **PASS:** read-only checks confirmed `account_profiles` RLS remains enabled;
  anonymous requirements access is denied, authenticated requirements access is
  allowed, authenticated access to the private trigger function is denied and
  direct authenticated profile INSERT remains denied.
- **NOT PERFORMED:** the synthetic SQL verification script has not been run.
  Its prepared cases do not constitute observed database behavior results.
- **NOT PERFORMED:** no fresh end-to-end signup after the policy change has been
  completed. The owner currently has no spare unused signup contacts.

Remaining native QA includes build/lint and live username/password,
unchanged email/password, email and phone OTP, session restore, DOB slash
editing/paste and form layout.

Run `sql-drafts/native-optional-phone-verification.sql` only in an approved
disposable/local database: missing consent blocked, verified email plus consent
and blank phone accepted, unverified email blocked, trusted inserts with missing
or unverified email blocked, profile UPDATE still allowed, old-account exemption
preserved and policy rollback requiring phone blocked until phone is confirmed.
The script rolls back all fixtures.

Verify interrupted signup resume there too. Keep fresh Samsung signup marked
not performed until an unused owned email is available and the test is completed.

## Behavior rollback

With separate approval, set `private.signup_policy.phone_required = true` for the
singleton row. The same RPC advertises `phoneRequired:true` and the same trigger
again blocks new profile creation without a confirmed phone. Existing profiles
and phone-free members are preserved; no account deletion or rewriting is needed.
Keep the additive column/functions in place to avoid breaking clients. Incomplete
phone-free signups will require a phone after rollback; communicate that effect
before applying it.
