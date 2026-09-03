# Phase 14: Discoverable Profile Routes

## Goal

Add the first safe, canonical route for viewing a SautiLink member by username while preserving the Phase 13 owner profile editor and its database boundaries.

## Canonical route

- `/app/u/<username>` is the canonical in-app profile route.
- Usernames are normalized to lowercase before lookup.
- Direct navigation, refresh, browser Back and browser Forward resolve the same route state.
- `/app/` remains the authenticated member Stream entry point.

A tiny Worker asset router serves the existing `/app/` shell for valid deep profile paths. It does not add a second application shell and it does not proxy API traffic.

## Visibility contract

Another member is resolved only when `social_profiles.is_discoverable = true`.

The browser requests only:

- `username`
- `display_name`
- `bio`
- `location`
- `website_url`
- `is_discoverable`

Private account data, email addresses, authentication metadata and owner-only controls are never queried by this route.

The existing `social_profiles_select_discoverable_or_own` RLS policy remains the final row-authorization boundary. Phase 14 does not broaden database grants.

## Owner versus visitor

When the route username belongs to the signed-in member, the existing Phase 13 owner profile remains authoritative and the Edit profile action is available.

When the route belongs to another discoverable member, the profile is read-only. The Edit profile action and owner editor remain hidden.

A signed-out visitor may view a discoverable profile because the existing RLS policy permits discoverable rows to `anon`. A non-discoverable profile remains invisible to signed-out visitors.

## Safe route states

The route exposes four explicit states:

1. **Loading** — the username lookup is in progress.
2. **View** — a discoverable profile exists.
3. **Unavailable** — the username does not exist or is not discoverable. These cases intentionally share one visitor-facing state.
4. **Error** — the lookup failed safely and no stale profile card remains visible.

The unavailable state intentionally avoids confirming whether a hidden account exists.

## Navigation

- Choosing Profile while signed in pushes the owner's canonical `/app/u/<username>` route.
- Choosing Stream returns to `/app/`.
- `popstate` reapplies the route so browser Back and Forward remain functional.
- Uppercase route input is replaced with the lowercase canonical path after validation.

## Rendering safety

Profile copy is written with DOM `textContent`; visitor content is never inserted as HTML. Website links continue through the Phase 13 HTTP(S)-only stored-data contract and are rendered with `rel="noopener noreferrer"`.

## Validation

Phase 14 adds:

- Node regression tests for route parsing, discoverability filtering, owner/visitor UI boundaries, history handling and deep-link Worker routing.
- A rollback-only staging SQL test proving:
  - anonymous visitors can read a discoverable profile;
  - anonymous visitors cannot read a hidden profile;
  - an authenticated owner can still read their own hidden profile.

## Rollback

Remove the Phase 14 route code, route-state markup/styles, asset router and Wrangler asset binding. No schema rollback is required because Phase 14 does not alter tables, policies or grants.


## Staging acceptance checkpoint — 2026-08-31

The first Phase 14 staging review exposed two runtime-delivery defects even though the source-level checks were green:

1. `src/app.js` contained the new route behavior but the committed browser bundle `app/assets/app.js` was still the Phase 13 bundle.
2. Direct navigation to `/app/u/<username>` reached the static asset layer without a reliable application-shell rewrite, producing a not-found response.

The repair kept the product scope unchanged and added deployment correctness only:

- synchronized the generated app browser bundle;
- cache-busted the Phase 14 app CSS/JS references;
- rotated the app-shell service-worker cache;
- staged `sw.js` and `_redirects` with the allowlisted preview output;
- added a `200` rewrite from `/app/u/*` to the existing `/app/` shell while preserving the canonical browser URL;
- retained the Worker asset-router fallback;
- extended regression coverage for staged routing support files.

A temporary staging deployment workflow and a temporary live smoke workflow were used only to verify the repaired runtime and were removed immediately afterward.

### Verified live staging evidence

- repaired Phase 14 build deployed successfully to the existing `test` Worker;
- live `/app/` returned the Phase 14 shell and cache-busted bundle reference;
- live `/app/u/drcharlestz` returned HTTP 200 rather than a 404;
- the live browser bundle contained the canonical `/app/u/` route logic and unavailable-profile state;
- the user confirmed the repaired staging experience before Phase 14 was advanced to review.

### Merge gate

The merge gate was satisfied at final approved head `f040ce47ba667c3521c8eaa8523dd6e6b364b009`.

## Completion checkpoint — 2026-08-31

- PR #12 was explicitly approved at exact head `f040ce47ba667c3521c8eaa8523dd6e6b364b009`.
- PR #12 merged successfully into `main`.
- Merge commit: `3f55c715202a34bf2dc45bc4cc8b41db3b734d47`.
- Post-merge SautiLink Brand Guard passed.
- Post-merge application build and tests passed.
- Post-merge Cloudflare staging deployment to `test.sautilink.com` passed.
- Phase 14 is complete.

### Next planned slice

Phase 15 returns to the Phase 1 profile roadmap and should cover profile media: safe avatar and header uploads backed by Cloudflare R2, with owner-scoped upload authorization, strict file validation, bounded object keys and rollback-safe tests. The Phase 15 scope must be reviewed before implementation.
