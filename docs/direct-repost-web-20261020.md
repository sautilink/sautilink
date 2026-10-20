# Direct Repost on web

Selecting Repost now immediately calls the existing repost toggle, without a
Repost/Quote choice menu. Selecting Undo repost uses the same existing DELETE
operation. Feed, Discover, Saved, Room and shared-post cards share the core
handler; profile activity already uses a direct action. Short Videos forwards
to that original core control and mirrors its active/pending state, label and
count. The same per-post guard prevents duplicate requests across rendered
copies; failed requests restore the prior state and count.

Quote creation controls, composer state and unused menu/preview styles are
removed from web. Legacy current and saved drafts discard only quote metadata,
preserving the author's body, media and other fields. Quote-only empty drafts
cannot publish, and the browser's post payload no longer includes quote_post_id.
Existing quoted posts remain readable with their original links. Backend,
database, policies, APIs and Android code are unchanged.

The composer choices anchor before `.composer-meta` after the removed quote
preview. The isolated conversation design preview also directly toggles Repost.
The scoped `repost=20261020-direct1` asset key refreshes clients through the
normal production build and deployment pipeline.

The main profile display name uses 20px type with a 26px line height, reduced
from 22px/28px, through the existing shared own/public profile rule. Font
weight, wrapping, verification-badge alignment, post-author names and bio stay
unchanged. The normal production CSS content hash refreshes the stylesheet.

Validation: canonical `npm run check` passes 1,051 tests without failures or
skips. Seven real-function regressions cover direct routing, POST/DELETE,
pending duplicate guards, both failure rollbacks, Short Videos forwarding,
legacy draft preservation and the quote-free publication payload. A source-backed
loopback browser fixture runs the original renderer/event handlers and full
Short Videos module with in-memory data only; no production posts or accounts
are mutated. Evidence belongs in `outputs/SautiLink-Direct-Repost-20261020`
outside the repository. Release requires successful exact-head CI, the existing
Git-linked deployment and production bundle verification.

## Profile identity spacing follow-up

The profile's 20px name now uses a 26px row with 18px verification artwork,
replacing the old 44px badge layout row. Category text uses a compact 20px row;
the decorative information glyph is removed while its original details dialog
and accessible button remain. Both buttons retain expanded 44px touch areas.
Username/category/stats spacing and the avatar-toolbar gap are reduced, and a
soft circular shadow sits behind the existing 92px avatar. Own/public actions,
image overlap, badge identity, editor/save logic and APIs remain unchanged.
The `profileui=20261020-compact1` bundle key and existing stylesheet content
hashes deliver the update. Canonical checks pass all 1,051 tests. Source-backed
browser review covers Company, long-name and unverified profiles, dialogs,
touch boundaries, and light/dark layouts down to 320px. Release evidence is
stored outside the repository in `outputs/SautiLink-Profile-Polish-20261020`.
