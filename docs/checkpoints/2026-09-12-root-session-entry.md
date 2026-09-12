# Root persisted-session entry fix — 2026-09-12

## Reported behavior
A browser that still had a persisted SautiLink session could open `/` and see the signed-out “Continue to SautiLink” account-choice page. After the user clicked Log in or Create account, the auth app eventually read the persisted session and redirected to Home.

## Root cause
The production root `index.html` was a static signed-out account-choice document with no persisted-session routing check. SautiLink browser auth persists its session under `sautilink.auth.session` in localStorage, so the static server response cannot know the browser session by itself.

## Narrow fix
The root document now runs a synchronous, early head script that reads the same persisted-session storage contract already used by the guest-entry gate. If a valid-looking persisted session shape is present, it routes with `window.location.replace('/home')` before the account-choice body paints.

This is routing only. `/home` still performs the normal Supabase session bootstrap and server-backed user validation, so the root guard does not grant access or weaken auth.

## Expected behavior
- persisted session in the same browser → `/` immediately routes to `/home`
- no session → existing “Continue to SautiLink” page remains unchanged
- malformed/unavailable localStorage → treat as signed out and keep the account-choice page
- expired/revoked persisted credentials may attempt `/home`, where the normal auth bootstrap remains authoritative

## Scope
No RLS, Supabase schema, Cloudflare binding, API route, login/signup form, member data, or feed UI changes.
