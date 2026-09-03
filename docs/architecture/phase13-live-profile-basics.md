# Phase 13: Live Profile Basics

## Goal

Make the signed-in member's existing `social_profiles` row visible and safely editable in the permanent app shell. This is a deliberately narrow first profile slice, not a general social-profile system.

## Included

- Desktop and mobile Profile navigation.
- Authenticated owner's live display name, username, bio, location, website and discoverability state.
- Owner edits for `bio`, `location`, `website_url` and `is_discoverable` only.
- Loading, empty, view, edit and safe-error states.
- Keyboard focus, labels, 44-pixel controls and responsive layout.

## Excluded

- Avatar or header uploads.
- Display-name or username changes.
- Other-user profile routes, follows, Circles, Sautis, Stream queries and search.

## Security contract

The browser uses the staging publishable key and refreshes the authenticated user immediately before saving. The update is filtered by that user's UUID and contains only the four approved fields. This frontend boundary is backed by two independent database controls:

1. Column-level `UPDATE` privilege is granted only for the four approved fields.
2. Existing `social_profiles_update_own` RLS requires `auth.uid() = id` in both `USING` and `WITH CHECK`.

The migration revokes any broad update grant before adding the bounded column grant. A rollback-only staging test proves owner success, cross-user denial and denial of a display-name update.

## Validation

- Bio: at most 500 characters.
- Location: empty or at most 100 characters.
- Website: empty or a complete HTTP(S) URL, at most 2,048 characters, without embedded credentials.
- Discoverability: boolean.

Database constraints remain the final data-integrity boundary. Rendering uses text nodes, and the website link is normalized before it becomes an `href`.

## Open-source study protocol

Mastodon, Misskey and Bluesky may be studied for profile-state concepts and safety patterns only. No donor code, UI, copy, branding or assets are copied. SautiLink keeps its own compact visual language and product boundaries.

## Rollback

Revoke the four column-level update privileges from `authenticated`. The read-only profile remains available through the existing select policy, and no profile data or schema columns need to be removed.
