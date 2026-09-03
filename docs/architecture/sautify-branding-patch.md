# Sautify Branding Patch

## Status

**Completed:** 2026-09-02  
**Feature PR:** #38  
**Final clean feature head:** `00b3221ddefcf0a7582ee2a9a2643cc4e34d3126`  
**Squash merge:** `f060d627fab04f32cbbc1dd951a9482db6a2cb2b`

This pre-Phase 30 branding patch is complete. It does not alter the Phase 29 completion state and does not start Phase 30.

## Product language

SautiLink's community feature is branded **Sautify** in all user-facing product surfaces.

Examples:

- Sautify
- Create Sautify
- Join Sautify
- Leave Sautify
- Sautify Stream
- Sautify members
- Sautify rules
- Sautify notifications

The previous public product word **Circle/Circles** is treated as legacy copy.

## Routes

Canonical routes:

- `/app/sautify`
- `/app/sautify/:slug`

Backward-compatible routes:

- `/app/circles`
- `/app/circles/:slug`

Legacy routes are accepted so old links do not break, then the browser canonicalizes to the Sautify route.

Visible short addresses use:

- `/sautify/:slug`

## Internal compatibility

This patch is intentionally a product-language and routing change, not a database rewrite.

The following remain unchanged:

- `public.social_circles`
- `public.social_circle_members`
- `public.social_circle_join_requests`
- `circle_id`
- existing migrations and RLS policy names
- internal function/variable names where changing them would add risk without user value

This preserves Phase 20–22 database/security behavior.

## Post composer wording

The previous phrase **Share a Sauti** is removed from the live app and preview.

Use familiar action wording:

- composer launcher: **Create Post**
- submit action: **Post**
- Sautify composer submit action: **Post**

The underlying Sauti data model and SautiLink content identity are unchanged.

## Validation

The patch must pass:

1. full repository build/tests;
2. Brand Guard;
3. Wrangler validation;
4. Workers Build;
5. live staging verification that:
   - the app shows Sautify;
   - the main composer shows Create Post / Post;
   - `/app/sautify` resolves through the app shell;
   - legacy `/app/circles` still resolves;
6. final clean-head merge and post-merge staging deployment.

Production remains unchanged.

## Completion evidence

- User-facing community brand is **Sautify** across the live app shell, membership copy, notifications, stream language and preview surfaces.
- Canonical routes are `/app/sautify` and `/app/sautify/:slug`.
- Legacy `/app/circles` and `/app/circles/:slug` remain readable for backward compatibility.
- Visible short addresses use `/sautify/:slug`.
- Main composer launcher is **Create Post** and submit action is **Post**.
- The phrase **Share a Sauti** is absent from the live app shell and app preview.
- Internal circle database/API identifiers were intentionally preserved; no Supabase migration was required.
- Shell cache advanced to `sautilink-shell-v19`.
- Branch live staging smoke passed on Worker version `e2d2687c-046b-4ec8-9c3e-17144b32b07d`.
- Live branch smoke returned HTTP 200 for:
  - `/app/`
  - `/app/sautify`
  - `/app/sautify/east-africa-builders`
  - `/app/circles`
  - `/app/circles/east-africa-builders`
- Temporary `.github/workflows/sautify-brand-staging.yml` was removed before merge.
- Final clean feature head passed Brand Guard, full repository build/tests, Wrangler validation and Workers Build.
- Post-merge `main` passed Brand Guard, full build/tests, Wrangler validation, Workers Build and automatic staging deployment.
- Post-merge staging Worker version: `855ad9c3-abdf-44ff-83b7-37e4c722debb`.
- Production/main-domain services were not changed.
