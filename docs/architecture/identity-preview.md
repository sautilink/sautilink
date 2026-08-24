# SautiLink Identity preview

**Milestone:** Preview 02 — Identity

**Branch:** `phase-1/identity-preview`

**Production impact:** None. The preview uses an in-browser demonstration
adapter, seeded identities and a `connect-src 'none'` content security policy.
It cannot create, read or modify Supabase accounts or profiles.

## Outcome

The approved React app shell now contains the complete visual and interaction
contract for:

- email and password sign-in;
- account creation and username availability;
- email OTP verification and resend;
- privacy-preserving account recovery;
- verified recovery password update;
- private-account/public-profile onboarding; and
- session entry and sign-out states.

The Identity component consumes an authentication service contract. The
preview supplies a local demonstration implementation. The production port
will supply `createSupabaseAuthService`, which implements the same operations
with `@supabase/supabase-js`.

## Security boundary

- The browser client accepts a Supabase publishable key through configuration;
  no key or project URL is embedded in the Identity preview.
- User metadata only prefills onboarding fields. Authorization continues to
  derive from `auth.uid()` and verified `auth.users` data in the guarded
  `complete_social_onboarding` RPC.
- Private `account_profiles` and public `social_profiles` are loaded
  separately.
- Recovery responses remain generic to avoid account enumeration.
- The preview cannot make network requests and is not indexed.
- Dependencies remain version-pinned and the lockfile remains committed.

## Production gate

The React Identity UI must not replace `/app/` until all of these are complete:

1. user visual approval of Preview 02;
2. merge and apply `20260823083626_add_social_onboarding.sql`;
3. approve and configure `https://sautilink.com/app/` as a Supabase Auth
   redirect URL;
4. confirm the email OTP template uses `{{ .Token }}`;
5. run SQL assertions and Supabase security advisors;
6. complete a dedicated sign-up, verification, sign-in, recovery, onboarding
   and sign-out E2E test; and
7. run the Cloudflare production dry-run before any deployment.
