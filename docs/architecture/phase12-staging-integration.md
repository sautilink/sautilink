# Phase 12 — Isolated staging backend validation

## Source of truth

The permanent review environment is `test.sautilink.com`. Phase 11 on that site
ends at **Staging Backend Foundation** and explicitly gates the next phase on a
separate Supabase staging environment.

This phase does not modify the production Supabase project or
`www.sautilink.com`.

## Protected data contract

The existing `social_profiles` table plus ten new tables form the eleven-table
MVP contract:

1. `social_profiles`
2. `account_settings`
3. `circles`
4. `circle_members`
5. `follows`
6. `blocks`
7. `sautis`
8. `notifications`
9. `conversations`
10. `messages`
11. `reports`

All are protected by RLS. Private member data has no anonymous grant.
Notification creation and moderation lifecycle changes remain server-owned.
One-to-one conversations are canonical pairs, and database triggers reject new
relationships or messages when either member has blocked the other.

## Staging order

1. Create an isolated Supabase staging project in the approved organization and
   region after cost confirmation.
2. Apply the repository migrations in order to staging only.
3. Run `supabase/tests/phase12_staging_contract.sql`.
4. Run security and performance advisors and resolve relevant findings.
5. Generate TypeScript types from the staging project.
6. Configure the web build with the staging project URL and publishable key.
7. Store privileged credentials only in the Cloudflare Worker secret store.
8. Deploy the integrated build to `test.sautilink.com`.
9. Test ownership, follower visibility, Circle visibility, block enforcement,
   unread notifications, canonical conversations and cross-user message denial.

## Promotion gate

No production migration or deployment occurs from this branch. Promotion
requires successful staging E2E, RLS, accessibility, abuse, rollback and
performance checks plus explicit approval.
