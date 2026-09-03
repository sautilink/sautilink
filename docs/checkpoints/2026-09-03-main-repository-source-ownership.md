# Main repository source ownership checkpoint

**Date:** 2026-09-03  
**Decision:** `sautilink/sautilink` is the canonical source repository for the SautiLink web product.

## Why this checkpoint exists

The Home redesign must ship from `sautilink/sautilink` and serve `sautilink.com`, not remain owned by the former `sautilink/test` development repository. The owner explicitly selected migration-first before the Home UI/UX work.

## Exact migration boundary

- former source tree: `sautilink/test` `main` at `13aeaf7c52b2b8e879bcbe11e0cbb717ae674c5a`;
- target base: `sautilink/sautilink` `main` at `28a1a0a3514bf8125a7f485b813011745ddb843c`;
- imported source commit: `b2bca1c3619afb9674250df0d4549f5ec7e2449a`;
- migration branch: `migrate-social-app-source`;
- imported source blobs were copied byte-for-byte and their Git blob hashes were verified;
- a repository text scan found no credential, private-key, service-role or provider-token material.

## Preserved ownership boundaries

- the current target root entry page was preserved; the obsolete waitlist page from the former source was not restored;
- `wrangler.jsonc` remains the small root-site deployment configuration;
- social staging and preview deploys use `wrangler.social-staging.jsonc`;
- production continues to use `wrangler.production.jsonc` and the isolated Worker `sautilink-social-production`;
- production routes remain explicitly scoped to the social paths; there is no `sautilink.com/*` or `www.sautilink.com/*` catch-all;
- production Supabase remains `rggpyiterdbbugluejcs`, staging remains `bbrydwzlhweuqxpgbahu`, and production media remains `sautilink-media-production`.

## Product assets preserved

The approved official PNG verification assets remain canonical and unmodified:

- team badge: `app/assets/verification/verified-team.png`;
- primary user badge: `app/assets/verification/verified-user-primary.png`;
- secondary user badge: `app/assets/verification/verified-user-secondary.png`.

The approved Home author-line sizing contract is preserved until a deliberate visual review changes it: author name `12px`; badge `clamp(13px, 1.17em, 14px)`.

## Verification state

- dependency install: PASS;
- unit/regression suite after staging-config separation: **247/247 PASS**;
- isolated staging and production artifact builds: PASS before the final migration commit;
- full exact-head checks and production cutover evidence are recorded after the branch merges.

## Cutover rule

The former private repository must not remain a second automatic production owner. Disable its production-on-push path only after the canonical repository has completed a successful verified production deployment, preserving one recoverable deployment owner throughout the cutover.
