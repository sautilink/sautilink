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

Validation: all 23 connected Samsung SM-A057F / Android 15 tests pass, with no
skips. These include actual image editor UI/export and source preservation,
62-second input video clipped to a later 1.5-second interval with decoded frame
and audio checks, comments at 320dp/150% text, fixed-header scrolling, Marketplace
copy, menu destinations, 85 vector icons and existing auth/keyboard policies.
Kotlin caption and media-policy checks pass. Full local preview lint and signed
production lint pass with zero errors. Release checks retain
the existing upload certificate/Firebase pins and validate bundle manifest,
caption/integrity behavior, 16KB library alignment, checksums and exact artifacts.

Samsung exposed an XML bitmap-tint inconsistency and narrow text measurement.
The final notification mask is actual white RGB with the approved original
alpha, and tab labels have explicit full-tab text width. The icon regression
allows neutral white 8-bit premultiplied-alpha rounding observed on Samsung,
while still rejecting colored/dark interior pixels and an opaque background.
The later measurement/docs commit changes no app/src/main content; its exact
tree remains 9568065c2d2e31e3f894fc84114a528e1059fac5, matching candidate
086ffa73af86756c1feae2ecd239d73454519a6d built by the release46 workflow.

Release46 workflow 39301680613 completed successfully. Its exact artifact
12213221255 was downloaded with its archive digest checked and independently
verified offline: package com.sautilink.app, version 1.1.1 (46), minSdk 26,
targetSdk 36, non-debuggable, original upload signer, all 600 payload entries
signed, production Firebase identities, all five checksums, 191 caption checks,
63 monitor-only integrity checks and 16KB-aligned 64-bit ELF load segments.
AAB SHA-256: a0b114ffc3d95e2bae966a206fd1b24cb1bc741fff6209d10e71b276839ede20.
The normal Native Android, Brand Guard and Phase 1 Authentication PR checks also
passed on 3e828ca0abb2797b1140b20dfb391ae913daa795. This final receipt update
changes documentation only and leaves the tested app/src/main tree unchanged.

On 19 October 2026 at 21:48 EAT, Play Console confirmed release46 available to
internal testers on the existing Internal track (release 5). The same uploaded
bundle was promoted to existing Closed Alpha with 100% rollout to that track's
existing audience and submitted to Google. At 21:49 EAT Publishing overview
confirmed “Changes in review” for “1.1.1 (46) - Web parity - Closed Alpha”, with
Google quick checks still running. Public production access, tester lists,
countries, store assets and managed publishing settings were not changed.
No claim is made of Alpha approval, Play-installed testing or physical 16KB
device runtime testing. Google displayed only the two non-blocking mapping and
native-symbol upload recommendations. Local release evidence and screenshots
are in outputs/SautiLink-1.1.1-46 in the task workspace, outside this worktree.
