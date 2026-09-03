# SautiLink MVP feature scope

**Status:** Active product guard

SautiLink is launching as a privacy-first, lightweight social network. The MVP
must make the core public loop useful before adding operationally expensive
features. Every new surface needs to fit this scope before it enters the app
shell, navigation, seed data, or backend contracts.

## Must-have now

- Account creation, verified email sign-in, recovery, and safe session handling
- Public profile, profile editing, follow/unfollow, and basic Circles
- Stream, Discover, Saved Sauti, and meaningful notifications
- Basic one-to-one text Messages with unread state and safety controls
- Share a Sauti with audience and reply controls
- Public replies and threads, including basic like, reshare, quote, and save
- Image/video accessibility and upload validation foundations
- Block, mute, report, moderation review, and appeal foundations
- Account, privacy, notification, session, data-export, and deletion controls
- Privacy, accessibility, abuse-prevention, and account-deletion boundaries

## Deferred until there is a clear product or traffic need

- Group chats, voice/video calls, large file sharing, disappearing messages,
  and advanced real-time messaging
- Personalized recommendation ranking and algorithmic feed tuning
- Live audio/video, monetization, ads, marketplace, and advanced analytics
- Native mobile applications and other high-cost platform expansions

Basic one-to-one Messages are now part of the web MVP. Their first contract is
text-only and includes a conversation list, timestamps, unread state, send,
block, report, and delete controls. The seeded preview never reaches production
accounts or a backend. Public replies and threads remain a separate part of the
open Sauti conversation loop.

## Scope rule

If a feature is not a must-have above, it stays deferred until its user value,
privacy and safety implications, operational cost, and support requirements
are documented in a separate milestone. Deferred features must not be added as
placeholder UI that suggests the feature is already available.

The visual system also remains SautiLink-native: coral/red interactive accents,
neutral surfaces, restrained typography, and original copy. We do not mirror
X/Twitter's blue identity or copy donor product surfaces.
