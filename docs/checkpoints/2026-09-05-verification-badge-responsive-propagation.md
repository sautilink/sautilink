# Checkpoint — Responsive verification badge propagation

Date: 2026-09-05

## Decision

SautiLink uses one canonical verified-name renderer and the approved official PNG badge assets on every live identity surface. Badge sizing is contextual: the public profile receives the strongest emphasis, Home/post authors use a balanced medium size, and dense rows such as notifications and messages use compact sizes.

## Root cause fixed

Each official 3264 × 3264 PNG contains a 1938 × 1940 visible artwork area inside a transparent canvas. Rendering the full canvas at the intended CSS size made the painted badge appear only about 59% as large as expected. The UI now compensates for that transparent canvas in CSS while preserving every official PNG byte-for-byte.

## Context sizing contract

- Profile name: `clamp(22px, 0.96em, 25px)`.
- Home/post author: `clamp(14px, 1.25em, 16px)`.
- Media caption author: `clamp(14px, 1.25em, 15px)`.
- Notifications: `clamp(13px, 1.2em, 15px)`.
- Message inbox/thread: `clamp(12px, 1.2em, 14px)`.
- Comments, quote posts, repost attribution, Discover, Settings lists and Sautify rosters use smaller local tokens suited to their typography.

## Identity surfaces covered

- Home and Sautify posts, media captions and repost attribution;
- profile, comments, quote posts and Discover;
- notification actors;
- message inbox and active message thread;
- current-member navigation rail and account identity;
- blocked and muted account lists;
- Sautify owner attribution, join requests and member roster.

The badge is appended only when the current canonical profile has `is_verified = true`; `verification_badge_type` continues to choose the server-controlled official artwork.

## Asset integrity

- `verified-team.png`: `6414f87f79f4b8fdf9814d53f85b27b257c567be566f40a0cdcba627ea4741d5`
- `verified-user-primary.png`: `812ac0e7f5b2c37f2630b56ac0e072b30837260e3eab4b1f1c2f04991104bfba`
- `verified-user-secondary.png`: `3481912943dc492580b2800327ddaee1f5b38de85d500a9d047eec64d044a602`

## Verification state

- Production profile audit: 21 profiles, one verified profile, and that verified profile has a valid server-owned badge type.
- Full unit/regression suite: **255/255 PASS**.
- Staging and production artifact verification: PASS.
- Production Wrangler dry deployment: PASS.
- Browser cache generation: `sautilink-shell-v39`.
- App asset marker: `20260905-badge1`.

## Release proof

The canonical pull request, merge commit, production workflow and live visual verification are recorded in the release handoff after deployment.
