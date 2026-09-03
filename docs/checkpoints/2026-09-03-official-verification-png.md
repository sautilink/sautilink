# Checkpoint — Official SautiLink Verification PNG System

Date: 2026-09-03

## Official badge assets

The canonical source artwork is stored in the public `sautilink/sautilink` repository under `verified-badge/`.

The social app keeps local copies so rendering never depends on GitHub/raw URLs:

- `verified.png` → `app/assets/verification/verified-team.png`
  - Reserved for SautiLink employees, board members and the SautiLink team.
  - Source Git blob SHA: `0d76fae420117b5e11e7cc22b03b1c8a413c20b1`
- `verified 2.png` → `app/assets/verification/verified-user-primary.png`
  - Standard verified-member primary artwork.
  - Source Git blob SHA: `2069e335942b74d79b007b7093e46d7fcb6b3c14`
- `verified 3.png` → `app/assets/verification/verified-user-secondary.png`
  - Standard verified-member secondary artwork.
  - Source Git blob SHA: `580282e5d59a0a7528b8669bd684856eb96917ef`

All three source PNGs are 3264×3264 RGBA. Do not replace them with emoji, Unicode checks, CSS-drawn checks or the retired SVG badge unless explicitly requested.

## Verification classes

`public.social_profiles.verification_badge_type` is server-controlled and supports:

- `standard` — ordinary verified users
- `team` — SautiLink employees, board and team only

Default is `standard`. Members cannot update this field directly.

Staff assignment uses the guarded verification management path and verification changes remain audited.

## Profile interaction

The badge next to a profile name is clickable/tappable.

For another viewer:
- Standard: “This profile was verified as belonging to {display name}.”
- Team: “This profile was verified as belonging to {display name}, a member of the SautiLink Team.”

For the profile owner:
- Standard: explains that the profile is verified and verification may be removed if the owner violates SautiLink rules or policies.
- Team: additionally explains SautiLink Team requirements.

Team profiles receive the explicit `SautiLink Team` treatment in the verification information dialog.

## Sizing contract

Verification artwork follows the local display-name typography instead of using a fixed large profile size.

Base badge dimensions are `.82em × .82em`.

Current name contexts:
- Profile display name: 25px name context → badge about 20.5px
- Post author: 12px name context
- Comment author: 9px name context
- Quote author: 10px name context
- Discover profile: 11px name context
- Notifications: 12px name context
- Messages inbox: 11px name context
- Message conversation header: inherits the 11px name context

Do not reintroduce a fixed profile-only badge size that makes the badge larger than the name.

## Current surfaces

Official PNG verification identity is rendered on:
- Profile
- Posts
- Comments/replies
- Quoted posts
- Discover
- Notifications
- Messages inbox
- Message conversation header

## Release proof

PR #75 — Use official SautiLink verification PNG badges
- Merge SHA: `1cc988892b1f78c1f1b946fefa9ca5942a0ac2d8`
- Production migration: `enable_verification_badge_types`
- Production Worker deploy and cutover smoke: passed
- test.sautilink.com live readiness: passed

PR #76 — Show official verification badges in notifications and messages
- Merge SHA: `1c68a896b7a291b9a3167abc13039a4c50beb79f`
- Production Worker deploy and cutover smoke: passed
- test.sautilink.com live readiness: passed

Current cache contract:
- Service Worker: `sautilink-shell-v32`
- App asset marker: `20260903-badges2`

## Verified sample account

Production `@drcharlestz` remains:
- `is_verified = true`
- `verification_badge_type = standard`

Do not classify `@drcharlestz` as a SautiLink Team account unless explicitly requested.
