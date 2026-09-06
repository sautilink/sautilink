# Optimistic social actions checkpoint

Date: 2026-09-06

## Scope

- Profile Follow / Following changes immediately without reloading the profile route or showing its loading card.
- Profile follower count and the signed-in member's following count update optimistically and roll back on failure.
- Matching Home follow buttons stay synchronized with the open profile.
- Like, repost, and save states update immediately across matching post cards, including their counts and accessible labels.
- Repost no longer reloads the full Home feed, and removing a saved post no longer reloads the full Saved surface.
- Server responses still reconcile displayed counts in the background; failed mutations restore the previous UI state.
- Navigation, verification badges, profile media, safety actions, and unrelated surfaces are unchanged.

## Release markers

- App assets: `20260906-optimistic`.
- Service Worker: `sautilink-shell-v44`.
