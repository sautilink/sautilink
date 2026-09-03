# Phase 12: isolated staging backend validation

## Environment

- Repository: `sautilink/test`
- Branch: `phase-12/isolated-staging-integration`
- Staging Supabase project: `sautilink-test`
- Staging project ref: `bbrydwzlhweuqxpgbahu`
- Production project ref: `rggpyiterdbbugluejcs`
- Region: `eu-west-1`
- Project cost returned at creation: USD 0 monthly
- Permanent web gate: `test.sautilink.com`

The two project references differ. No production schema, data or secret was changed.

## Database activation

All six repository migrations were applied in order to the isolated project. The
staging database now contains 15 empty public tables: the four earlier
waitlist/contact/account/profile tables and the eleven Phase 11 social MVP
tables.

The Phase 11 migration was first executed inside a transaction and rolled back
to validate the complete SQL. The migration tool rejected the original
23,334-byte payload, so the same SQL was submitted without comments and
indentation as one migration. The versioned source remains
`20260826142952_create_social_mvp_foundation.sql`.

## Verification

- 11/11 Phase 11 tables exist.
- RLS is enabled and forced on all 11 Phase 11 tables.
- 45 public-schema policies are present.
- Anonymous access to settings, notifications, messages and reports is absent.
- Authenticated users cannot create notifications, read reports or update
  conversations directly.
- Required feed, membership, reply, unread and message indexes exist.
- Two-user transactional tests passed for follower visibility, Circle
  visibility, notification isolation, DM participant access, cross-user write
  denial and block enforcement.
- Test fixtures were rolled back; every public table remains empty.
- TypeScript types were generated from the staging project.

## Advisor review

The security advisor reports one warning for
`public.complete_social_onboarding(text, text)`. This is the intentionally
callable authenticated onboarding RPC created before Phase 11. It:

- derives identity from `auth.uid()`;
- requires a verified email in `auth.users`;
- validates username and display name;
- uses an empty `search_path`;
- revokes execution from `public` and `anon`;
- grants execution only to `authenticated` and `service_role`.

The warning is accepted for this staging validation and remains covered by the
onboarding SQL tests. It must be reassessed before production promotion.

Performance advisor findings are only unused-index notices on the new empty
database. The indexes are retained because they protect the documented feed,
relationship, notification and message access paths.

## Browser boundary

The staging app uses:

- `https://bbrydwzlhweuqxpgbahu.supabase.co`
- the staging project's modern `sb_publishable_` key

The production project ref and production publishable key are absent from
`src/app.js` on this branch. No secret or service-role credential is committed.

## Staging Auth and Edge Function activation

- Auth Site URL: `https://test.sautilink.com`
- Allowed recovery redirect: `https://test.sautilink.com/app/`
- Edge Function: `sautilink-waitlist` version 1, status `ACTIVE`
- Function project ref: `bbrydwzlhweuqxpgbahu`
- JWT gateway verification remains disabled because the existing public signup,
  OTP and username-check flow is intentionally anonymous; the handler enforces
  an exact origin allowlist, POST/OPTIONS methods, a 4 KiB request ceiling,
  action validation and input validation.
- CORS smoke test from `https://test.sautilink.com`: 204.
- Read-only username availability smoke test: 200.
- Unapproved-origin smoke test: 403 `ORIGIN_NOT_ALLOWED`.
- No server secret is present in browser code or committed function source.

The staging asset builder now copies `app/` into `dist-preview-site/app/`, which
matches Cloudflare Workers static-asset routing for the permanent `/app/` path.

## Remaining gate

Before merge or promotion:

1. confirm repository CI and the updated Cloudflare staging build;
2. run browser E2E, accessibility, privacy, abuse and session tests on `/app/`;
3. review the draft pull request;
4. obtain Mr. X's explicit approval before merging.
