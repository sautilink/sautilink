# SautiLink hosted Supabase email templates

These files are the canonical source for SautiLink Auth email templates and must stay aligned with `src/auth-email-contract.js`.

## Required hosted-project alignment

Apply the same OTP settings and matching templates to both hosted projects:

- production: `rggpyiterdbbugluejcs` (`sautilink`)
- staging: `bbrydwzlhweuqxpgbahu` (`sautilink-test`)
- Email OTP length / `mailer_otp_length`: **8**

Do not allow staging and production to use different email OTP lengths or different delivery modes for the same template.

## Canonical flow matrix

| SautiLink flow | Supabase template | Delivery | Canonical file | Subject |
| --- | --- | --- | --- | --- |
| Confirm signup | Confirmation | 8-digit OTP only | `confirmation-code-only.html` | `Your SautiLink verification code` |
| Passwordless sign-in | Magic Link | 8-digit OTP only | `magic-link-code-only.html` | `Your SautiLink sign-in code` |
| Change email address | Email Change | Secure confirmation link | `email-change-link.html` | `Confirm your new SautiLink email address` |
| Reset password | Recovery | Secure recovery link | `recovery-link.html` | `Reset your SautiLink password` |
| Reauthentication | Reauthentication | 8-digit OTP only | `reauthentication-code-only.html` | `{{ .Token }} is your SautiLink verification code` |

## Variable rules

### OTP-only templates

The Confirmation, Magic Link/passwordless and Reauthentication templates:

- must contain `{{ .Token }}`;
- must not contain `{{ .ConfirmationURL }}`;
- must not contain `{{ .TokenHash }}`;
- must match the website's exact 8-digit OTP input.

### Link-only templates

The Email Change and Recovery templates:

- must contain `{{ .ConfirmationURL }}`;
- must not ask the user to enter an OTP;
- Email Change also uses `{{ .NewEmail }}`;
- must match the website callback/action flow.

Do not switch Email Change or Recovery to code-only until the website has a dedicated OTP-entry completion flow for those actions.

## Shared brand contract

All five templates use:

- official logo: `https://sautilink.com/logo.png`;
- brand: **SautiLink Corporation**;
- office: **Uhuru Street, Mwanza, Tanzania**;
- automated sender wording for **noreply@sautilink.com**;
- a consistent account-security notice;
- copyright: **© SautiLink Corporation. All Rights Reserved.**

## Hosted Dashboard setup

For **each** hosted project:

1. Authentication → Providers → Email: set Email OTP Length to **8**.
2. Authentication → Email Templates → Confirm signup: paste `confirmation-code-only.html`.
3. Authentication → Email Templates → Magic Link: paste `magic-link-code-only.html`.
4. Authentication → Email Templates → Change Email Address: paste `email-change-link.html`.
5. Authentication → Email Templates → Reset Password / Recovery: paste `recovery-link.html`.
6. Authentication → Email Templates → Reauthentication: paste `reauthentication-code-only.html`.
7. Save each template and run the corresponding staging flow before treating the hosted configuration as accepted.

Hosted email-template changes are Auth service configuration, not SQL schema migrations.

## Other flows

Invite remains link-based and is outside this five-template branding convergence. Do not expose privileged invitation credentials in the browser.
