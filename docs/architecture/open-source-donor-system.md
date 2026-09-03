# SautiLink open-source donor system

**Decision date:** 2026-08-24

**Status:** Accepted product and engineering direction. This document does not
authorize a production deployment or merge.

## Product direction

SautiLink will not be a rebranded fork of one social network. It will be a
SautiLink-native product assembled from audited open-source donors, established
interaction patterns, and original implementation.

The product should feel as immediate, professional, and lightweight as X while
remaining visually and structurally distinct. Familiar behavior is welcome;
copied branding, layouts, assets, wording, or unsafe backend code are not.

## Non-negotiable rules

1. Import only a clearly bounded component or pattern, never an entire donor
   repository by default.
2. Pin every donor to an exact commit and record its license and provenance.
3. MIT/Apache/BSD code may be adapted after security, dependency, asset, and
   attribution review.
4. AGPL/GPL projects are product and interaction references unless a separate
   legal review explicitly accepts their source-disclosure obligations.
5. Never import donor SQL, RLS, authentication, uploads, secrets, analytics, or
   deployment configuration without a SautiLink-specific rewrite and tests.
6. Supabase Auth/Postgres remains the source of truth. Cloudflare Workers, R2,
   Queues, KV, and later D1 keep their existing platform roles.
7. A donor's logo, screenshots, illustrations, fonts, product copy, and brand
   assets are excluded unless their license is separately verified.
8. Every imported dependency must be necessary, pinned in the lockfile, and
   pass license, vulnerability, bundle-size, and runtime checks.

## Donor map

| Donor | What SautiLink may learn or adapt | Intake mode |
| --- | --- | --- |
| [Meadows](https://github.com/hoangsonww/Meadows-Social-Media) | Feed cards, composer rhythm, profiles, infinite scroll, comments, polls, reactions, search, responsive layout | Selectively adapt audited UI patterns; MIT notice required for substantial copied code |
| [Bluesky Social App](https://github.com/bluesky-social/social-app) | Cross-platform navigation, accessibility, post threads, media viewer, moderation controls, mobile interaction quality | Audit MIT source component by component; exclude Bluesky brand assets and protocol-specific data code |
| [Mastodon](https://github.com/mastodon/mastodon) | Reporting, block/mute, content warnings, moderation queues, appeals, safety language | Product-pattern reference only; AGPL source is not copied into the proprietary core |
| [Misskey](https://github.com/misskey-dev/misskey) | Rich composer, reactions, polls, lists, visibility controls, power-user settings | Product-pattern reference only; AGPL source is not copied |
| [Lemmy](https://github.com/LemmyNet/lemmy) | Circle roles, threaded discussion, moderator permissions, moderation logs, restore/lock flows | Product-pattern reference only; AGPL source is not copied |
| [Telegram Android](https://github.com/DrKLO/Telegram) and [Telegram Desktop](https://github.com/telegramdesktop/tdesktop) | Fast messaging feel, drafts, delivery states, media viewer, keyboard efficiency, offline-tolerant interactions | UX reference only for web; GPL code and Telegram identity/assets are not copied |
| [Element Web](https://github.com/element-hq/element-web) | Mature inbox, rooms, unread state, device/session UX, encrypted-chat concepts | Product-pattern reference only; do not import the AGPL/GPL application |
| [X recommendation algorithm](https://github.com/twitter/the-algorithm) | Candidate sourcing, ranking stages, social signals, safety filtering, feed observability | Later architecture reference only; no Phase 1 algorithm import and no AGPL source copy |
| [TanStack Query](https://github.com/TanStack/query) | Query caching, pagination, background refresh, optimistic mutations, reconciliation | Approved MIT library candidate after version and bundle verification |

This map is intentionally expandable. A new donor is added only after a small
intake record answers: exact commit, license, assets, dependencies, security,
data access, runtime fit, performance cost, selected surfaces, and rejection
list.

## SautiLink implementation stack

SautiLink will use a small number of mainstream languages deliberately instead
of mixing languages merely to look "large."

| Layer | Primary technology | Reason |
| --- | --- | --- |
| Web/PWA application | TypeScript, React, Vite | Fast client application, strong ecosystem, shared types, small Cloudflare-compatible output |
| Edge/API/security | TypeScript on Cloudflare Workers | One language across UI and edge contracts; fast global execution and simple operations |
| Canonical data | PostgreSQL/SQL on Supabase | Transactions, constraints, relational integrity, search foundations, and RLS |
| Media and async work | Workers, R2, Queues | Direct object storage, retriable processing, and no binary data inside databases |
| Derived feed/cache | D1 and KV when measurements justify them | Rebuildable read models and cache only; never canonical user data |
| Performance services later | Rust, only behind a measured boundary | Suitable for ranking, media, or high-throughput services when TypeScript/SQL becomes a proven bottleneck |
| Native mobile later | React Native/TypeScript first; Kotlin/Swift only for native gaps | Reuse product logic and ship sooner while keeping an upgrade path to platform-native modules |

Telegram Desktop uses C++, Telegram Android is a Java/Android project, and X's
published recommendation system includes large Scala and Rust services. Those
choices fit their scale and history; they are not automatically better for a
Cloudflare + Supabase MVP. SautiLink will add another language only when a
profiled workload proves the need.

## Product language

SautiLink keeps familiar interaction meaning but uses its own product terms:

| Familiar concept | SautiLink term |
| --- | --- |
| Home timeline | Stream |
| Explore | Discover |
| Communities/lists | Circles |
| Bookmark | Saved |
| Post | Sauti |
| Create-post action | Share a Sauti |
| Repost | Reshare |
| Direct messages | Deferred from MVP |

Common verbs such as Like, Reply, Follow, Search, Report, Block, and Mute remain
plain because clarity is more important than renaming every standard action.

## Visual contract

The application must be calm and information-first:

- Neutral white, near-black, and restrained gray surfaces form the interface.
- Only one SautiLink coral/red accent is prominent on a screen. Existing brand
  blue and yellow are used sparingly and by semantic role, never as competing
  card colors.
- No neon gradients, rainbow navigation, glassmorphism, decorative shadows,
  oversized rounded cards, or animation that slows reading.
- Borders, spacing, typography, and hierarchy carry the design.
- Light and dark modes share the same visual structure.
- The SautiLink logo, self-hosted Inter brand system, naming, icons, empty
  states, and motion make the identity distinct from X.
- Desktop uses a focused three-region layout only where useful. Mobile is not a
  squeezed desktop view; navigation and composer actions are mobile-native.
- Accessibility, reduced motion, keyboard navigation, touch targets, and slow
  network behavior are acceptance requirements.

Exact color tokens are approved from the first app-shell visual preview rather
than being hidden inside implementation work.

## Mandatory preview gate

Every major visual milestone must have a reviewable web preview before merge.
The preview is a product gate, not a final screenshot after the code is already
accepted.

Each preview handoff includes:

1. a temporary browser URL isolated from production;
2. desktop and mobile views, plus light/dark mode where applicable;
3. realistic seeded test content and no production personal data;
4. a short list of donor influences and what was rebuilt originally;
5. bundle size, main accessibility results, test status, and known gaps; and
6. explicit user approval before merge or production deployment.

The preview sequence is:

1. **App shell:** Stream, Discover, Circles, Saved, profile rail, public reply
   entry points, composer entry, desktop/mobile navigation, light/dark tokens.
2. **Identity:** sign-up, sign-in, recovery, onboarding, session states.
3. **Profiles and Circles:** public profile, edit profile, follow state, Circle
   membership and empty states.
4. **Share a Sauti and Stream:** composer, text Sauti, chronological feed,
   loading/error/offline states.
5. **Media:** R2 image upload, galleries, progress, validation, failure, delete.
6. **Conversation:** replies, reactions, Reshare, Saved, notifications.
7. **Trust and operations:** reports, blocks, mutes, appeals, moderator/admin
   queues, audit views, and safety settings.

Backend-only milestones still provide an API/test report, but they do not need
a decorative visual preview when there is no user-facing state to review.

## Effect on current branches

- `open-source-audit` remains the intake and decision branch.
- PR #8 remains unmerged while its authentication SQL, security decisions, and
  flow logic are separated from its temporary UI shell.
- The first implementation branch after this audit will create only the
  React/Vite app-shell preview. It will use seeded data and will not change the
  production database or public homepage.
- After the shell is visually approved, PR #8's reusable authentication work
  is rebased or ported into that shell. Closing, superseding, or merging PR #8
  requires an explicit decision after the preview.

## Definition of success

The result should feel familiar within seconds, stay responsive on modest
phones and slow connections, expose powerful controls without visual clutter,
and remain recognizably SautiLink. Open source accelerates delivery; SautiLink's
data contracts, security, visual system, operations, and identity remain its
own.
