# Home post header actions checkpoint

Date: 2026-09-06

## Scope

- Added an immediate Follow / Following control to non-owner post headers in Home.
- Hydrated existing follow state and reused the production follow endpoint and counter trigger.
- Added an adaptive post menu with View profile, Interested, Not interested, Copy link, and Report.
- Persisted private Interested author preferences with forced RLS and owner-only policies.
- Prioritized loaded Home posts from Interested authors.
- Reused the existing mute safety control for Not interested, removing that author's Home cards immediately and keeping recovery in Settings.
- Kept the new header controls scoped to Home; other feeds and verification badge styling are unchanged.

## Release markers

- App assets: `20260906-homehead`.
- Service Worker: `sautilink-shell-v43`.

## Verification

- Source syntax check.
- Application bundle and staged/production artifact verification.
- Full Node test suite, including Home header action and migration-contract coverage.
- Supabase migration metadata/RLS check and security/performance advisors.
