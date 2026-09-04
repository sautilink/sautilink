# Home viewer experience checkpoint

**Date:** 2026-09-04  
**Canonical repository:** `sautilink/sautilink`  
**Production destination:** `sautilink.com`

## Product decision

SautiLink Home now uses a media-first social viewer inspired by familiar large-network patterns while preserving SautiLink's own identity and feature set. This is an experience redesign, not an Instagram clone.

## Durable Home contract

- posts with media render the author header first, then large image/video media;
- post text moves below the media action row as an inline caption;
- the caption begins with a bold linked username;
- captions longer than 180 characters use a word-aware preview and accessible `more` / `less` control;
- text-only posts keep their normal readable body presentation;
- the action row retains Like, Comment, Repost, Share and Save, with Save aligned at the far edge;
- single media preserves its recorded aspect ratio and uses `object-fit: contain` to avoid destructive cropping;
- multi-media posts keep the established grid viewer;
- desktop feed width is `680px`; mobile cards become edge-to-edge for a larger viewer;
- lazy media loading, async image decoding, reduced-motion behavior and smooth scrolling remain enabled.

## Theme contract

- the member experience has neutral dark and white/light palettes;
- a labelled theme control is available in the desktop stream header and mobile app header;
- the browser saves the choice under `sautilink.theme`;
- first visit follows the operating-system light preference and otherwise falls back to dark;
- a small pre-style bootstrap applies the saved choice before CSS, preventing a theme flash;
- the browser theme colour and theme-aware verification artwork update with the active choice.

## Preserved SautiLink contracts

- all existing interaction data attributes and server-backed actions remain intact;
- official PNG verification files remain byte-exact;
- approved post-header verification sizing remains `clamp(13px, 1.17em, 14px)` beside the `12px` name contract;
- production still uses the canonical production Supabase project and production R2 bucket;
- the production Worker remains path-scoped and does not claim a broad `sautilink.com/*` route;
- the root website continues to own the login redirect.

## Verification before merge

- app browser bundle: PASS;
- CSS syntax parse: PASS;
- dedicated Home/theme contract tests: **3/3 PASS**;
- complete repository regression suite: **250/250 PASS**;
- staging artifact allowlist and secret scan: PASS, 69 files;
- production-isolated artifact verification: PASS, 22 files;
- staging Worker dry deployment: PASS;
- production Worker dry deployment: PASS.

## Deployment rule

Merge only after all canonical repository pull-request checks pass. After merge, require both the staging deployment and the production live-readiness workflow to pass before marking this checkpoint released.
