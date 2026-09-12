# Language sidebar visibility fix — 2026-09-12

## Problem
The first Language Preference release added the Language section dynamically inside Settings, while the product request expected Language Preference to be visible in the main sidebar. Some clients could also retain an older app bundle.

## Fix
- Add a first-class Language entry to the existing `.app-nav` sidebar immediately after Settings.
- Clicking Language opens the existing Settings view and then its Language panel.
- Keep the existing language preference implementation, English fallback and user-content exclusions unchanged.
- Bundle the sidebar entry through the normal app build.
- Bump the service-worker shell to v51 and reload app assets from network before using cached fallback.

## Safety boundary
No changes to Supabase, auth, RLS, database schema, APIs, posts, media, messages, Rooms/Sautify logic or profile data.

## Verification
`tests/language-sidebar.test.mjs` covers sidebar placement, Settings-panel opening, language-change synchronization, production bundling and service-worker refresh behavior.
