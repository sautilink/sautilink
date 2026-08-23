# Phase 1 Authentication

Status: proposed in `phase-1/authentication`. The social preview lives at
`/app/`; the existing public website and waitlist remain unchanged.

## Account flows

| Flow | Supabase operation | Result |
| --- | --- | --- |
| Create account | `signUp` + email OTP | Verified Auth user, then guarded social onboarding RPC |
| Sign in | `signInWithPassword` | Persisted, auto-refreshed browser session |
| Recover account | `resetPasswordForEmail` | Verified recovery session, then `updateUser` |
| Existing waitlist member | Recovery flow | Replaces the random waitlist password with a member-owned password |
| Sign out | `signOut` | Revokes the session and clears browser auth state |

The browser receives only the Supabase publishable key. Secret and
service-role keys remain server-managed.

## Onboarding boundary

`complete_social_onboarding(username, display_name)` is the only client-facing
way to create an account/social profile pair. It:

1. requires an authenticated Supabase user;
2. confirms the email against `auth.users`;
3. validates and reserves the username transactionally;
4. creates exactly one private account record;
5. creates or completes the public social projection; and
6. keeps direct inserts and username changes unavailable to browser roles.

User metadata can prefill the onboarding form, but it is never trusted for an
authorization decision.

## Deployment checklist

1. Merge and apply `add_social_onboarding` before publishing `/app/`.
2. Allow `https://sautilink.com/app/` in Supabase Auth redirect URLs.
3. Keep email confirmation enabled and the OTP template using `{{ .Token }}`.
4. Run the SQL assertions, Supabase security advisors, `npm run check`, and
   `npm run deploy:dry`.
5. Test sign-up, sign-in, recovery, onboarding, and sign-out with a dedicated
   non-production email identity before advertising the preview.

Supabase leaked-password protection is a paid-plan feature. On the current
free plan, SautiLink compensates with a 12–72 character client requirement
covering uppercase, lowercase, number, and symbol characters. The paid
protection should be enabled before a broad public launch.
