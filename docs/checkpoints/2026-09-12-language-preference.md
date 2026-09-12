# Language preference checkpoint — 2026-09-12

## Goal
Add a safe SautiLink interface language preference without changing auth, RLS, media, posting, or database behavior.

## Languages
- English (`en`) — default and fallback
- Kiswahili (`sw`)
- Français (`fr`)

## Product-label rule
Core SautiLink feature names remain original rather than being translated. This includes Home, Rooms, Sautify, Messages, Notifications, Discover, Saved, Appeals, Moderation, Settings, and Profile.

## Implementation
- Runtime: `src/language-preference.js`
- Preference key: `sautilink.language` in browser localStorage
- Settings gets an isolated Language section and selector at runtime.
- Changes apply immediately without a page reload.
- `<html lang>` follows the selected language.
- Missing translations fall back to the original English copy.
- User-authored content (posts, captions, comments, profile bios, messages, Sautify descriptions, names/usernames) is excluded from automatic translation.
- No Supabase/API/database request is made by the language runtime.
- `scripts/build-app.mjs` injects the runtime into the existing app bundle.

## Safety boundary
No changes to Supabase auth/session handling, RLS policies, database schema, media APIs, posting APIs, Workers, or route authorization.

## Verification
`tests/language-preference.test.mjs` verifies supported languages, English fallback, preserved product labels, user-content exclusions, browser-local persistence, repeated language switching support, settings-router isolation, and production app bundling.
