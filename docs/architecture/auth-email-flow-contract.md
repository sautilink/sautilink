# SautiLink Auth Email Flow Contract

Status: active cross-cutting auth contract for staging and future production rollout.

This document is the source of truth that keeps the website, Supabase Auth behavior, and SautiLink-branded email templates aligned. No authentication surface may invent a different delivery method, code length, or instruction copy.

## Canonical sender and brand

- Sender name: `SautiLink Corporation`
- Sender email: `noreply@sautilink.com`
- Office: Uhuru Street, Mwanza, Tanzania
- Website: `https://www.sautilink.com`
- Facebook: `https://facebook.com/sautilink`
- Instagram: `https://instagram.com/sautilink_africa`
- LinkedIn: `https://linkedin.com/company/sautilink`
- Authentication email templates use the official SautiLink logo and consistent security/fraud warnings.

Custom SMTP is configured per Supabase project. Staging `sautilink-test` must not silently inherit assumptions from another Supabase project.

## Canonical delivery matrix

| Flow | Supabase template | Email delivers | Website must ask user to do | Code length |
| --- | --- | --- | --- | --- |
| Confirm signup | Confirmation | OTP code only | Enter the OTP on SautiLink | Exactly 8 digits |
| Magic Link / Email OTP | Magic Link | OTP code only | Enter the OTP on SautiLink | Exactly 8 digits |
| Change email address | Email Change | Secure confirmation link | Open email-change confirmation link | None |
| Reset password | Recovery | Secure recovery link | Open recovery link, then choose a new password | None |
| Reauthentication | Reauthentication | OTP only | Enter the reauthentication OTP on SautiLink | Exactly 8 digits |
| Invite user | Invite | Secure invitation link | Open invitation link and continue account setup | None |

## OTP rule

The website OTP contract is defined in:

`src/auth-email-contract.js`

Current display expectation:

`EMAIL_OTP_LENGTH = 8`

Canonical SautiLink email OTP length:

- `EMAIL_OTP_MIN_LENGTH = 8`
- `EMAIL_OTP_MAX_LENGTH = 8`

Supabase Auth supports configurable email OTP length, but SautiLink intentionally standardizes both hosted projects on `mailer_otp_length = 8`. The website therefore accepts exactly eight digits. Staging and production must never intentionally use different OTP lengths.

Any future website OTP input must import/use this contract instead of hardcoding a different length in copy or validation.

## Current live website behavior

### Signup confirmation

The signup website is OTP-only.

After `supabase.auth.signUp()` returns without a session, SautiLink opens a verification form that accepts exactly eight digits and verifies the submitted code with `supabase.auth.verifyOtp({ email, token, type: 'email' })`.

The canonical hosted Confirmation template contains `{{ .Token }}` and intentionally omits `{{ .ConfirmationURL }}` and `{{ .TokenHash }}`. Signup and resend calls do not depend on an email redirect URL.

Pending signup state is retained in `sessionStorage` so refreshes and transient Auth `SIGNED_OUT` events do not throw the user back to the login panel. Invalid/expired OTPs remain on the verification panel with an explicit error.

### Password recovery

The current reset-password flow is link-based.

The website calls `supabase.auth.resetPasswordForEmail()`, tells the user a recovery link is being sent, and only opens the new-password form after the recovery session has been established.

The recovery email therefore uses `{{ .ConfirmationURL }}`.

## Future surfaces

Magic Link / OTP, Change Email, Reauthentication, and Invite User may be enabled in product UI later. When implemented:

- use `AUTH_EMAIL_FLOWS` rather than inventing flow semantics;
- OTP inputs must derive their accepted length from `EMAIL_OTP_LENGTH`;
- button/instruction copy must match the configured email template;
- no UI may say "click a link" for an OTP-only flow;
- no UI may ask for a code for a link-only flow;
- signup is intentionally OTP-only: the hosted Confirmation template must use `{{ .Token }}` and must not expose a confirmation link;
- no email may send a code that the website has no place to enter;
- no email may advertise a link that the target website route cannot complete.

## Security wording contract

All security-sensitive templates should consistently tell users:

- never share passwords, verification codes, recovery information, or authentication links;
- SautiLink staff will never ask for a verification code or password by phone, social media, chat, or email;
- unexpected requests should not be approved;
- authentication emails are automated and should not be forwarded.

## Verification gate

Before any auth email/UI change can be considered complete:

1. confirm the Supabase template mode and variables;
2. confirm the website action matches the same mode;
3. run `tests/auth-email-flow-contract.test.mjs`;
4. test the real staging email end-to-end;
5. record the live result in this document or the active phase checkpoint;
6. do not merge if the website/email instructions disagree.

## Current patch status

This contract was added after Phase 17 to prevent auth email and website drift before Phase 18 begins.

The existing live signup and recovery website flows were audited and are already link-based, matching the SautiLink confirmation and reset-password templates.


## Implementation checkpoint — 2026-09-01

Branch: `auth-email-flow-contract`

Draft PR: #16 — `Auth: align email templates and website flow contract`

Implementation head before this checkpoint:
`0d5e73d071321d1f3984da21d78565794e7373a5`

Added:

- `src/auth-email-contract.js` with the canonical flow modes and one `EMAIL_OTP_LENGTH` value;
- `tests/auth-email-flow-contract.test.mjs` to block website/email delivery mismatches;
- this durable architecture contract.

Verification on implementation head:

- SautiLink Brand Guard run `33452769320`: PASS;
- Phase 1 Authentication run `33452769816`: PASS;
- build/tests: PASS;
- auth-email-flow-contract tests: PASS as part of the full test suite;
- Cloudflare deployment validation: PASS;
- PR branch actual staging deploy remains skipped by the normal workflow, as expected.

No live UI redesign or new authentication method was introduced. Existing signup and password recovery behavior remains unchanged and link-based.

A real SMTP/email end-to-end acceptance remains separate from this code contract because hosted Supabase email templates and custom SMTP settings are configured at the project level in Supabase Dashboard. The final SMTP/email acceptance must confirm the actual sender, branding, link/code mode and resulting website action on `sautilink-test`.


## Live SMTP incident — 2026-09-01

Observed on real staging after custom SMTP was enabled on `sautilink-test`:

- signup returned a generic request failure in the browser;
- password recovery returned the same generic request failure;
- Supabase Auth logs showed `535 "Authentication Failed"` from the SMTP server;
- affected Auth paths included `/signup` and `/recover`;
- the Supabase project itself remained `ACTIVE_HEALTHY`;
- existing authenticated session/token activity continued to return HTTP 200.

This confirms the immediate outage is custom SMTP credential/server authentication, not a database or Phase 17 social regression.

Zoho Mail account rules relevant to remediation:

- Free Organization / personal-class SMTP commonly uses `smtp.zoho.com`;
- paid Organization custom-domain SMTP uses `smtppro.zoho.com`;
- the exact server must be taken from the account's Zoho Mail Server Configuration Details;
- SMTP authentication must use the full mailbox/account email with the correct password;
- when MFA is enabled, an application-specific password must be used;
- if `noreply@sautilink.com` is only an alias, authentication credentials must belong to the Zoho account that owns that alias.

Repository-side UX hardening was added so known SMTP delivery failures are shown as a temporary SautiLink email-service outage rather than the previous generic request-failed message.

External remediation remains required in the Supabase Dashboard custom SMTP configuration before live email acceptance can pass.


## Live SMTP recovery acceptance — 2026-09-01

After correcting the `sautilink-test` custom SMTP configuration, the live staging signup flow recovered successfully.

Observed in Supabase Auth logs:

- custom SMTP configuration reloaded at `2026-09-01T00:24:44Z`;
- signup `POST /signup` returned HTTP `200` at `2026-09-01T00:24:52Z`;
- no `535 "Authentication Failed"` error occurred on that successful request;
- the confirmation flow reached `GET /verify` with HTTP `303` at `2026-09-01T00:26:17Z`;
- Supabase recorded `user_signedup` and an implicit login;
- subsequent `GET /user` checks returned HTTP `200`.

Owner reported: "Now imekaa poa."

Result: custom SMTP signup delivery and confirmation are live-accepted on staging.

Password-recovery delivery can reuse the same authenticated SMTP channel, but a separate recovery-email smoke test should still be performed if we want explicit acceptance for that flow before merge.


## Website action layer — contextual verification results

The staging app now exposes a matching website action for every authentication email flow we configured.

### Confirm signup

Website trigger:
- `supabase.auth.signUp(... emailRedirectTo: /app/?auth_action=signup)`
- resend keeps the same `signup` action marker.

Return behavior:
- direct Supabase confirmation links are supported through the implicit callback;
- optional token-hash callbacks are supported at `/app/auth/confirm`;
- success message: **You're now verified**;
- users without an account/social profile continue directly into onboarding.

### Magic Link / Email OTP

Website trigger:
- passwordless sign-in is available from the login panel;
- `signInWithOtp()` uses `shouldCreateUser: false`;
- redirect marker: `auth_action=magiclink`.

Email-to-website contract:
- the SautiLink Magic Link / OTP email may expose both the secure sign-in link and `{{ .Token }}`;
- website provides a matching numeric OTP input;
- OTP validation derives from the shared email-OTP contract, displays 8 positions for the current production behavior, and accepts 6–10 digits;
- successful link or OTP sign-in displays **Sign-in verified**.

### Change email address

Website trigger:
- signed-in account security surface provides a change-email form;
- client calls `supabase.auth.updateUser({ email }, { emailRedirectTo })`;
- redirect marker: `auth_action=email_change`.

Return behavior:
- successful confirmation displays **Email address verified**;
- the account email badge refreshes from the authenticated Supabase user;
- the website does not claim the email changed until the confirmation flow succeeds.

### Reset password

Website trigger:
- recovery form calls `resetPasswordForEmail()`;
- redirect marker: `auth_action=recovery`.

Return behavior:
- recovery callback opens the new-password panel;
- contextual status displays **Recovery link verified**;
- password is only updated after the recovery session is valid.

### Reauthentication

Website trigger:
- signed-in account security surface calls `supabase.auth.reauthenticate()`;
- website reveals the reauthentication form only after the email request succeeds;
- code length comes from `EMAIL_OTP_LENGTH`.

Sensitive action:
- the OTP is supplied as `nonce` to `supabase.auth.updateUser({ password, nonce })`;
- successful completion displays **Password updated**.

This makes the reauthentication template a real website action instead of an unused email.

### Invite user

Acceptance behavior:
- the app recognizes `type=invite` returns from Supabase;
- `/app/auth/confirm` also supports token-hash invite links;
- successful acceptance displays **Invitation accepted**;
- invited accounts without profile setup continue into onboarding.

Sending invitations remains intentionally restricted to authorized admin tooling. The browser does not use `auth.admin.inviteUserByEmail()` and no `service_role`/secret key is exposed to members.

## Callback result rules

The app captures the auth redirect type before Supabase clears implicit-flow URL fragments. It combines that with the explicit `auth_action` marker when available.

Supported result states:

| Action | Success title |
| --- | --- |
| signup | You're now verified |
| magiclink / email OTP | Sign-in verified |
| recovery | Recovery link verified |
| email_change | Email address verified |
| invite | Invitation accepted |
| reauthentication/password update | Password updated |

Invalid or expired token-hash links display a clear verification error and remove sensitive callback parameters from the browser URL.

## Token-hash callback support

Route:
`/app/auth/confirm`

The Worker asset router rewrites this deep route to the SautiLink app shell. The client validates the supported email OTP type, calls `verifyOtp({ token_hash, type })`, removes `token_hash` and auth parameters from the visible URL, and then presents the task-specific status.

Supported token-hash types:
- `email`
- `signup`
- `magiclink`
- `recovery`
- `email_change`
- `invite`

This route is available for future template hardening and avoids coupling the product UI to Supabase-branded confirmation pages.


### Secure Email Change completion semantics

Supabase may require two confirmations when Secure Email Change is enabled: one at the current address and one at the new address.

SautiLink therefore does not blindly claim the email changed after the first `email_change` callback.

- if the authenticated user still exposes `new_email`, SautiLink shows **Email confirmation received** and explains that another confirmation may still be required;
- once `new_email` is no longer pending, SautiLink shows **Email address changed**;
- the account-email badge is refreshed from the authenticated user state.

### Passwordless OTP continuity

The pending passwordless email is stored only in `sessionStorage`, not durable local storage. This lets the member refresh the page and still enter the emailed OTP while avoiding long-term persistence of the account email on the device.

### Recovery completion

After a valid recovery link opens the new-password form, SautiLink first shows **Recovery link verified**. After the password update itself succeeds, the status advances to **Password updated**.


## Live staging deployment — contextual auth action layer

The complete auth website action layer was published to the real staging Worker without merging PR #16.

Deployment source application state:
- auth action implementation and synchronized browser bundle from PR #16;
- temporary deployment workflow commit: `d830e0ea2bc71170b558dab41439c206d134519e`;
- the temporary workflow contained no application behavior and was removed immediately after deployment.

GitHub Actions staging deployment:
- workflow: `Deploy Auth Email Staging`;
- run: `33455981891`;
- job: `99695913830`;
- install pinned dependencies: PASS;
- full build and test: PASS;
- build staging assets: PASS;
- `Deploy existing test Worker`: PASS;
- job conclusion: SUCCESS.

Destination:
- `https://test.sautilink.com`

The deployed staging application now contains:
- task-specific auth result banner;
- signup confirmation callback result;
- passwordless Magic Link / 6-digit OTP request and verification UI;
- recovery callback plus new-password completion state;
- signed-in email-change request UI with secure two-confirmation-aware status;
- signed-in reauthentication OTP plus nonce-protected password update;
- invite-link acceptance handling and onboarding continuation;
- `/app/auth/confirm` token-hash callback support;
- shared `EMAIL_OTP_LENGTH = 6` contract;
- no browser service-role/admin invite secret.

The temporary staging deploy workflow was deleted after successful deployment. The live staging application remains deployed; the PR remains unmerged and Draft pending owner smoke acceptance.


## Owner live acceptance — signup confirmation callback

Date: 2026-09-01

Owner confirmed the live staging signup confirmation flow is working correctly on `https://test.sautilink.com`.

Acceptance result:
- fresh signup flow completed;
- confirmation email link returned to the SautiLink website;
- contextual verification result displayed instead of a silent redirect;
- owner response: **"Iko sawa"**.

Status: **PASS**

Next live acceptance target:
- Magic Link / 6-digit Email OTP.


## Owner live acceptance — Magic Link sign-in

Date: 2026-09-01

Owner confirmed the live staging Magic Link sign-in flow is working correctly on `https://test.sautilink.com`.

Acceptance result:
- passwordless sign-in email was requested;
- secure Magic Link was used;
- callback returned to SautiLink successfully;
- contextual sign-in verification result displayed;
- owner response: **"Iko vzuri"**.

Status: **PASS**

Next live acceptance target:
- 6-digit Email OTP sign-in using the same passwordless email.


## Owner live acceptance — 6-digit Email OTP sign-in

Date: 2026-09-01

Owner confirmed the live staging Email OTP sign-in flow is working correctly on `https://test.sautilink.com`.

Acceptance result:
- passwordless sign-in email was requested;
- the 6-digit verification code from the SautiLink email was entered on the website;
- website validation matched the shared `EMAIL_OTP_LENGTH = 6` contract;
- OTP verification completed successfully;
- contextual sign-in verification result displayed;
- owner response: **"iko sawa"**.

Status: **PASS**

Next live acceptance target:
- Reset Password / Recovery flow through final password update.


## Owner live acceptance — Reset Password / Recovery

Date: 2026-09-01

Owner confirmed the complete live staging password recovery flow is working correctly on `https://test.sautilink.com`.

Acceptance result:
- recovery email request succeeded;
- recovery email was received;
- secure reset-password link returned to SautiLink;
- contextual status displayed **Recovery link verified**;
- new password form became available only after the recovery session was valid;
- password update completed successfully;
- contextual completion status displayed **Password updated**;
- owner response: **"zote ziko sawa nimejaribu"**.

Status: **PASS**

Remaining live acceptance targets:
- Change Email;
- Reauthentication OTP + sensitive password update;
- Invite acceptance when an authorized admin invite is available.


## Owner live acceptance — remaining auth actions

Date: 2026-09-01

Owner confirmed the remaining live staging authentication actions are working correctly on `https://test.sautilink.com`.

### Change Email

Acceptance result:
- signed-in change-email request completed;
- confirmation email flow worked;
- SautiLink callback/status behavior matched the secure email-change state;
- final account email change completed correctly.

Status: **PASS**

### Reauthentication

Acceptance result:
- reauthentication email was sent;
- 6-digit verification code was accepted;
- sensitive password update completed using the reauthentication nonce;
- completion status displayed correctly.

Status: **PASS**

### Invite acceptance

Acceptance result:
- authorized invitation email/link was tested;
- invite callback returned to SautiLink;
- invitation acceptance completed;
- SautiLink displayed the matching invitation result and continued the account setup flow correctly.

Status: **PASS**

Owner response covering all three:
**"Zote hizo nimejaribu na ziko ok"**

## Final owner acceptance summary

All live auth email/website action flows in PR #16 have now passed owner acceptance:

- Confirm Signup: PASS
- Magic Link: PASS
- 6-digit Email OTP: PASS
- Reset Password / Recovery: PASS
- Change Email: PASS
- Reauthentication: PASS
- Invite acceptance: PASS

PR #16 is functionally accepted on staging. Merge remains separately gated by:
1. final exact-head CI;
2. PR Ready state;
3. explicit owner approval of that exact head SHA.


## Final merge and deployment checkpoint — 2026-09-01

PR #16 — **Auth: align email templates and website flow contract** — is complete.

Owner merge authorization:
`Nimeweka Ready; Ninaidhinisha PR #16 exact head f5d2a47c57fc4ff981953f2b725499a702ffae11`

Pre-merge gate:
- PR state: open;
- Draft: false / Ready;
- approved exact head: `f5d2a47c57fc4ff981953f2b725499a702ffae11`;
- mergeable: true.

Merge:
- expected head SHA enforced: `f5d2a47c57fc4ff981953f2b725499a702ffae11`;
- merge result: SUCCESS;
- merge commit: `091068421b6f091e732f085590c6c08464d47a3b`;
- merged at: `2026-09-01T01:02:52Z`.

Post-merge main verification for `091068421b6f091e732f085590c6c08464d47a3b`:
- SautiLink Brand Guard run `33457192746`: PASS;
- Phase 1 Authentication run `33457192762`: PASS;
- full build/tests: PASS;
- Cloudflare deployment validation: PASS;
- actual `Deploy test.sautilink.com` job `99699671936`: PASS;
- staging assets build: PASS;
- actual existing test Worker deployment: PASS.

Live destination:
`https://test.sautilink.com`

Owner live acceptance before merge covered every scoped flow:
- Confirm Signup: PASS;
- Magic Link: PASS;
- 6-digit Email OTP: PASS;
- Reset Password / Recovery: PASS;
- Change Email: PASS;
- Reauthentication: PASS;
- Invite acceptance: PASS.

Status: **COMPLETE**

Next project action:
- proceed to Phase 18 scope only after re-reading current main schema and existing trust/safety primitives so no report/block infrastructure is duplicated.


## Production signup verification mismatch correction — 2026-09-03

Owner reported on the live `https://sautilink.com/app/` signup flow that the website said a confirmation link had been sent while the actual confirmation email contained a verification code and there was no signup code-entry field.

Root cause:
- repository contract still described Confirm Signup as link-only;
- the live hosted Supabase Confirmation template was delivering an OTP code;
- the website verification panel therefore had no action that matched the received email.

Correction:
- Confirm Signup is now a `link_or_otp` website flow;
- the signup verification panel includes a shared-contract OTP input;
- OTP verification uses `verifyOtp({ email, token, type: 'email' })`;
- secure confirmation-link callbacks remain supported;
- resend copy says **Resend verification email** so UI does not drift from hosted template mode;
- regression tests lock the signup OTP field, shared OTP length, and verification method.

No database schema, RLS policy, service-role key, route scope, or production data mutation is required for this correction.


## Production OTP length mismatch correction — 2026-09-03

After PR #53 added signup OTP entry, the owner tested the real production signup email and reported a second mismatch: the SautiLink verification input visually exposed six positions while the received Supabase confirmation code contained eight digits.

Current Supabase configuration documentation allows email OTP length to be configured between 6 and 10 digits. SautiLink therefore no longer treats six digits as a universal invariant.

Correction:
- live display expectation is 8 digits, matching the observed production confirmation email;
- signup, passwordless, and reauthentication inputs accept 6–10 numeric digits;
- inputs normalize at the 10-digit upper bound rather than truncating at six;
- code-entry hints are length-neutral;
- the signup input displays eight placeholder positions;
- Supabase remains the authority that validates whether the submitted OTP is correct;
- confirmation-link fallback remains unchanged;
- no database schema, RLS policy, service-role credential, route scope, or user data mutation is involved.


## OTP-only convergence and stale-bundle correction — 2026-09-03

The owner reported three live inconsistencies after the initial production OTP hotfixes:

1. the verification form visually showed eight positions, but input still stopped at six digits;
2. an incorrect verification code could cause the app to fall back to the login surface instead of showing an error;
3. staging still sent a confirmation link while production sent an OTP code.

Root causes:
- the checked-in/generated browser bundle and Service Worker cache could retain the older six-digit normalization logic even after HTML changed;
- the global Auth `SIGNED_OUT` handler did not preserve the pending signup verification surface;
- hosted Supabase Auth templates are project-specific configuration and had drifted between `sautilink-test` and production.

Current correction:
- `EMAIL_OTP_LENGTH = 8` is exact, not a 6–10 UI range;
- signup, passwordless email sign-in and reauthentication OTP inputs accept exactly eight digits;
- the app bundle URL is cache-busted and app JS/CSS become network-first under Service Worker v26;
- pending signup state persists in `sessionStorage`;
- invalid/expired OTPs display a dedicated verification-code error and do not navigate to login;
- signup and passwordless website copy is code-only;
- signup/passwordless requests no longer depend on auth redirect URLs;
- canonical code-only hosted templates live under `supabase/templates/`;
- both hosted projects must set `mailer_otp_length = 8`;
- Confirm signup and Magic Link templates must use `{{ .Token }}` only, with no `{{ .ConfirmationURL }}` or `{{ .TokenHash }}`.

Password recovery, secure email change and invitations remain link-based until their website surfaces receive dedicated OTP-entry flows.
