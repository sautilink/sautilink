# Checkpoint — Unified SautiLink Account Backend

Date: 2026-09-03

## Decision

SautiLink now has one canonical Auth/social data source: the production Supabase project `rggpyiterdbbugluejcs`.

`test.sautilink.com` is a noindex frontend/staging surface only. It must not create or read accounts from a separate staging Supabase project.

## Root cause fixed

The social app source previously referenced the staging Supabase project and the production build rewrote those references during deployment. This created separate account universes between `test.sautilink.com` and `sautilink.com`.

## Current contract

- `sautilink.com`: canonical production website and account system.
- `test.sautilink.com`: staging/preview frontend using the same production Auth/social backend.
- Auth recovery/email-change returns use `https://sautilink.com/home`.
- App/Worker source and CSP point directly at the production Supabase project.
- Build-time staging-to-production Supabase rewriting is retired.
- Regression tests reject the retired staging Supabase ref in the staged social runtime.
- Service Worker cache rotated to `sautilink-shell-v29`.
- App asset marker: `20260903-unified1`.
- The production `sautilink-waitlist` Edge Function accepts both main and test SautiLink origins while writing to the production project.

## Verification badge check

Production profile `@drcharlestz` is verified in the canonical production social database. Verification badge rendering remains enabled across profile, posts, comments, quotes, and Discover.

## Release proof

PR #72 — Unify SautiLink on the production account backend.

Merge SHA: `c869af53a391d879fecd25f278f1f1675857fee6`.

Post-merge checks passed:
- Brand Guard
- authentication build/test
- Cloudflare validation
- test.sautilink.com deploy + live readiness
- production full repository verification
- production Worker deploy
- production cutover smoke for health/app/login/signup/home/www/root

Do not reintroduce a separate social/Auth database for test.sautilink.com.
