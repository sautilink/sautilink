# Home and Feed language checkpoint

Date: 2026-09-05

## Saved product wording

- Use **Home** for the primary navigation item and page title.
- Use **Feed** or **Home feed** when referring to the chronological list of posts, its loading/error/empty states, filters, and safety exclusions.
- Use **Sautify posts** for posts inside a Sautify community.
- Use **Welcome to SautiLink, {first name}.** for the Home welcome card.
- The supporting welcome copy is: **Your Home feed brings together fresh posts from people and Sautify communities you follow.**

## Compatibility boundary

Internal identifiers such as `stream`, `stream-feed`, `loadStream`, CSS class names, existing routes, and database/API terminology remain unchanged. They are not user-facing and changing them would risk unrelated functionality.

## Release verification

- Added focused member and preview wording regressions.
- Full test suite: 288/288 passed after rebasing onto the latest `main` profile-activity release.
- Staging artifact allowlist verification passed.
- Production artifact verification passed.
- Production workflow cache-marker gate updated for this release.
- Browser cache marker: `20260905-homefeed`.
- Service worker cache: `sautilink-shell-v41`.
