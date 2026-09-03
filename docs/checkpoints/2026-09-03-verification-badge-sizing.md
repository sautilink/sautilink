# Checkpoint — Balanced Verification Badge Sizing

Date: 2026-09-03

## Purpose

Official SautiLink verification PNG artwork remains unchanged. This checkpoint records the approved responsive sizing system so verified badges stay visually balanced with display names across the app.

The previous global `0.82em` badge box made small identity contexts—especially the Home/Stream post author row—look too weak. Do not restore that global sizing model.

## Sizing contract

The badge uses:

```css
width: var(--verification-badge-size, 1em);
height: var(--verification-badge-size, 1em);
flex-basis: var(--verification-badge-size, 1em);
```

Each identity surface owns a responsive `--verification-badge-size` that is tuned to its local name typography.

### Profile

Desktop display-name context: 25px.

Badge:
```css
clamp(19px, .88em, 22px)
```

Mobile display-name context: 22px. The profile name and badge must share the same responsive typography context; do not resize the H2 independently from its badge parent.

### Home / Stream post author

Name: 12px.

Badge:
```css
clamp(13px, 1.17em, 14px)
```

This intentionally restores the stronger visual proportion of the previously accepted Telegram-style SVG sizing while continuing to use the official PNG artwork.

### Comments / replies

Name: 9px.

Badge:
```css
clamp(10.5px, 1.3em, 12px)
```

### Quoted posts

Name: 10px.

Badge:
```css
clamp(11px, 1.2em, 12px)
```

### Discover

Name: 11px.

Badge:
```css
clamp(12.5px, 1.25em, 14px)
```

### Notifications

Name: 12px.

Badge:
```css
clamp(13px, 1.15em, 14px)
```

### Messages inbox

Name: 11px.

Badge:
```css
clamp(12px, 1.15em, 13px)
```

### Message conversation header

Name: 11px.

Badge:
```css
clamp(12px, 1.15em, 13px)
```

## Design rule

Badge sizing must be based on the local identity/name typography, not a single global pixel size and not viewport width alone.

Small name contexts are allowed a badge box slightly larger than the text font size because the official PNG artwork has its own transparent canvas/padding and needs enough rendered area for the visible verification shape to remain legible.

The result should feel like Instagram/Telegram-style identity treatment: immediately visible but visually subordinate to the display name.

## Unchanged verification architecture

Do not change these because of sizing work:

- Official PNG assets and their mapping.
- `standard` vs `team` badge type.
- Team-only restriction for `verified.png`.
- Verification audit/assignment controls.
- Profile verification information dialog.
- Viewer vs owner wording.
- `@drcharlestz` remains standard verified unless explicitly changed.

## Release proof

PR #78 — Balance verification badge sizing across SautiLink.

Merge SHA: `4892baabe31dc07d3b1bc041b93cc8bc4c42816e`.

Checks passed:
- SautiLink Brand Guard
- Build and Test
- Cloudflare deployment validation
- Full production repository verification
- Production Worker deployment
- Production cutover/account-entry smoke
- test.sautilink.com deployment
- test.sautilink.com live readiness

Cache contract after this release:
- Service Worker: `sautilink-shell-v33`
- CSS marker: `20260903-badges3`
- JS marker remains `20260903-badges2`

Do not reduce the Home/Stream verification badge back below the current balanced range unless explicitly requested after visual review.
