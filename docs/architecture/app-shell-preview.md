# SautiLink app-shell preview

**Milestone:** Preview 01

**Branch:** `phase-1/app-shell-preview`

**Data boundary:** Seeded demonstration data only. The preview does not connect
to Supabase, Workers APIs, R2, D1, KV, Queues, analytics, or external media.

## Purpose

This milestone validates SautiLink's product language, information density,
navigation, responsive behavior, light/dark tokens, and overall visual
direction before the authenticated application is moved to React/Vite.

It deliberately does not implement canonical posts, profiles, uploads,
private messages, notifications, ranking, or moderation data.

## Included surfaces

- Stream with Selected and Following modes
- Share a Sauti composer preview
- Discover topics and suggested voices
- Circles and membership states
- Public post replies and thread entry points
- Notifications
- Saved Sauti
- Profile shell
- Desktop, compact desktop, tablet, and mobile navigation
- Light mode, dark mode, keyboard focus, skip navigation, and reduced motion

## Donor influence record

- Meadows informed the familiar microblogging rhythm and feed-density target.
- Bluesky informed cross-platform navigation and accessibility expectations.
- Telegram and Element were reviewed as donor references, but private messaging
  is intentionally deferred from the SautiLink MVP.
- Mastodon, Misskey, Lemmy, and X remain later product references; no source
  from those projects is present in this preview.

All React components and styles in this milestone are original SautiLink code.
No donor branding, assets, source components, SQL, auth, media workflow, or
backend code was copied.

## Visual contract implemented

- Flat, neutral white/near-black/gray surfaces
- One primary SautiLink coral action color per surface
- Existing SautiLink red remains available for brand/danger semantics
- No decorative gradients, rainbow navigation, glass cards, or external fonts
- Self-hosted Inter brand font and existing SautiLink logo
- Borders and typography provide hierarchy instead of heavy card effects

## Acceptance gates

The preview must pass:

1. full build and Node test suite;
2. restrictive no-connect CSP and noindex headers;
3. no production keys, account data, or network calls;
4. raw JavaScript below 260 kB and CSS below 40 kB;
5. desktop and mobile visual review in both themes;
6. Cloudflare dry-run; and
7. user visual approval before any port to `/app/` or merge to `main`.

After approval, the reusable authentication decisions from PR #8 will be
ported into this React shell as the Identity milestone. Production remains
unchanged until its own migration, redirect, E2E, and deployment gates pass.
