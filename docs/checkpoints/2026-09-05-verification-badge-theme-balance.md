# Checkpoint — Verification badge theme balance

Date: 2026-09-05

## Scope

This is a narrow follow-up to the responsive verification badge release. No social action, database contract, profile data flow, layout structure or unrelated feature is changed.

## Visual corrections

- Profile badge reduced slightly from `clamp(22px, .96em, 25px)` to `clamp(21px, .9em, 23px)`.
- Profile name-to-badge spacing increased from `.14em` to `.22em`.
- Canonical inline verified-name spacing increased from `.15em` to `.25em` across Home, captions, reposts, comments, notifications, messages, Settings and Sautify identity rows.
- Light theme now uses the official blue user badge.
- Dark theme now uses the official white user badge.
- Team verification continues to use its separate official team artwork in both themes.
- Switching themes re-hydrates every visible badge immediately through the existing canonical badge synchronizer.

## Light-theme correction

Explicit dark-theme foreground colours that remained on Home/profile and related identity surfaces are overridden only while `data-theme="light"` is active. Profile, notifications, messages, Discover, Settings and Sautify now use the existing semantic light-theme text, muted-text, panel and panel-soft tokens. Dark mode is unchanged.

## Release markers

- App assets: `20260905-badge2`.
- Service Worker: `sautilink-shell-v40`.

## Verification state

- Targeted badge/theme tests: **13/13 PASS**.
- Full unit/regression suite: **257/257 PASS**.
- Staging and production artifact verification: PASS.
- Production Wrangler dry deployment: PASS.
