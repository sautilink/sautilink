# SautiLink Profiles and Circles preview

**Milestone:** Preview 03 — Profiles & Circles

**Branch:** `phase-1/profiles-circles-preview`

**Production impact:** None. The preview uses seeded browser state, blocks all
network connections and does not apply a database migration.

## Outcome

This milestone turns the static profile and Circle placeholders into a
reviewable interaction contract for:

- an owner profile and a separate public-member view;
- editable display name, bio, location, website and discoverability;
- avatar and header entry points reserved for the later R2 media milestone;
- follow/unfollow state, follower/following entry points and profile safety
  controls;
- owned, open, approval-based and private Circles;
- joined/discovery filters, membership states, Circle details and visible rules;
- profile Replies/Media and Circle Stream empty states; and
- responsive light/dark presentation with keyboard-accessible dialogs.

## Data boundary

The editor mirrors only fields already intended for `social_profiles`. It never
renders private `account_profiles` fields such as email or WhatsApp preferences.
The final implementation will keep Supabase as the canonical source of truth,
use explicit grants plus RLS on every exposed table, and place relationship
indexes on policy/filter columns.

No donor database, authentication, uploads or deployment configuration is
accepted. Meadows contributes interaction research for profile and community
rhythm; Mastodon and Lemmy contribute product-pattern research for visible
rules and safety controls. The code and visual system in this preview are
original SautiLink implementation.

## Production gate

Before these surfaces can replace production `/app/`:

1. the Preview 03 visual and interaction contract must be approved;
2. profile update queries must be typed and tested against current RLS;
3. follows, Circle membership, roles and blocks/mutes require dedicated
   migrations, explicit grants, indexes and SQL policy tests;
4. username changes require a rate-limited Worker workflow;
5. avatar/header uploads wait for the R2 media milestone; and
6. browser E2E, advisors and a Cloudflare production dry-run must pass.
