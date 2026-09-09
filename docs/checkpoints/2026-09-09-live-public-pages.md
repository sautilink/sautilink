# SautiLink live public pages refresh — 2026-09-09

## Scope
Refresh public-facing pages that still described SautiLink as pre-launch or waitlist-only after the social network became live.

## Updated
- `help.html` — live Help Centre covering accounts, posts/media, Rooms, direct messages, verification, safety, appeals, export and deletion.
- `about.html` — removes waitlist CTAs and describes the live SautiLink product and mission.
- `contact.html` — preserves the existing contact form and routing while replacing obsolete waitlist help copy.
- `account-deletion.html` — aligns public documentation with the live recoverable deletion contract: pending request, 14-day cancellation window, final privileged processing, active-system deletion target and backup limits.
- `sw.html`, `fr.html`, `es.html`, `nb.html`, `no.html` — replaces obsolete localized waitlist landing pages with current live-service entry pages linking to sign-up and login.
- `sitemap.xml` — refreshes public URLs and `2026-09-09` modification dates; the noindex account-choice root is not advertised as an indexable content URL.
- `tests/public-pages-live-current.test.mjs` — prevents stale pre-launch/waitlist claims from returning and protects current account-deletion/help/form contracts.

## Product facts preserved
- SautiLink is live.
- Core access currently does not require a subscription; future optional paid/commercial features remain possible with disclosure.
- Rooms are current group-style community spaces.
- Direct messages must not be represented as end-to-end encrypted unless a feature is explicitly labelled that way.
- Account deletion uses a 14-day recovery window before final privileged processing.
- Active-system deletion target remains within 30 days, with backups potentially retained up to 90 days as described in the Privacy Policy.

## Non-goals
No database, auth, feed, Rooms, messaging, moderation, contact-form API or account-deletion backend behaviour is changed by this refresh.
