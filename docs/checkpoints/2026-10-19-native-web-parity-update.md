# Native web parity update — 1.1.1 (46)

Android comments share one compact identity/caption component across post,
Short Video, Room and nested-reply surfaces: profile photo, display name,
adjacent server verification badge and inline timestamp. Handles stay available
for profile/media navigation without being displayed in the identity row.
Thumbs-up/down and comment-bubble actions retain the existing reaction, reply,
count and owner-delete behavior.

Home uses the existing following/for_you/trending feed modes in a grouped,
equal-width selector under the app bar. The selector stays outside the scrolling
list; changing mode returns the feed to its beginning. Bottom discovery uses the
same Huge search artwork as web. The adjacent Marketplace button opens an honest
coming-soon announcement with the approved verification/certification and
always-free registration wording. Marketplace has no commerce or signup API.
Its future delivery is recorded in the platform roadmap.

The composer edits media locally before using the existing upload lifecycle.
Images support aspect crop, zoom/framing, rotation, brightness and contrast.
Video export clips only the chosen interval, at most the existing 60-second
limit. Image and playable video previews stay after upload. Existing four-file,
image/video size, caption, alt-text, retry, removal and pending-ready recovery
rules remain in place. Local owned files and players/exporters are cleaned on
cancel/disposal; selected originals are never modified. Media3 Transformer is
pinned to the same 1.11.1 as the existing player.

Appeals is a native screen over the existing authenticated GET/POST /api/appeals
contract. Room detail app bars say “Room” while the room's real title remains in
its content. Firebase's default and foreground small icons use the approved
brand alpha in white, replacing the unrelated equalizer. The menu's Other
SautiLink Products section opens the fixed Cloud Engine and Router Setup hosts.

Changes are restricted to native UI/client presentation, local media processing,
tests, roadmap and a build-only pinned release workflow. Backend/Web source,
Supabase files, auth implementation, existing production settings and existing
release workflows remain unchanged. The native branch stays stacked on the
previous native candidate; it must not be merged into the Web main branch for
testing releases.

Validation in progress: production and test Kotlin compile, pure Kotlin caption
and media-policy checks pass. Connected Samsung Compose/export tests and full
lint must pass before pinning the signed release candidate. Release checks retain
the existing upload certificate/Firebase pins and validate bundle manifest,
caption/integrity behavior, 16KB library alignment, checksums and exact artifacts.
