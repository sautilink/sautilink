# Web member presentation aligned with native v1.1.1 (46)

Messages builds its inert shell while hidden and links the complete final CSS in
the document head. First navigation reveals the prepared layout instead of
loading the old layout before its presentation modules. The viewport follows
the visible browser area and bottom navigation; the feed owns chat scrolling.
Photo, voice, file and reply bubbles use the native app's blue palette, compact
typography, asymmetric corners and a separate metadata row. Saved wallpapers
and all five bubble styles remain available. The composer grows within its
actual CSS height limit and remains scrollable beside a mobile keyboard.

Keyed timeline reconciliation retains unchanged cards, hydrated media, playback,
read receipts, keyboard focus and inline edits. It preserves the reader's anchor
while messages arrive or images resize, and follows the end only when already
near it. Async request/session guards stop an old conversation response from
replacing a new one. Initial positioning no longer waits for safety/read-state
requests or schedules a second delayed jump. The Send icon survives both success
and failure. Text/reply drafts entered during a send remain intact. Pending media
and microphone completions are bound to their original member/conversation;
stale completions cannot clear a different chat's preview, draft or busy state.

Rooms retains the Facebook Groups information architecture with native iOS
surfaces: full covers, real membership/privacy information, compact Room title,
all five icon sections, composer, Share/Invite and permission-gated management.
Selected sections show their label beside the animated icon. Discover restores
cards after switching from Your Rooms while retaining search/category filters.
Room information writes are idempotent, stopping observer feedback that rebuilt
the same metadata/about DOM while idle. Frame-coalesced layout prepares the
current Room without the old 90ms presentation delay. Existing post/member,
moderation, invitation, creation and privacy tools remain present.

Live verification additionally corrected the About card to read actual Room
privacy independently of join policy. Unknown/loading metadata stays neutral.
Repeated legacy branding leaves the enhanced Back icon and its action intact.

The web Menu follows the native app's profile card and grouped icon tiles, on
both the mobile overlay and dedicated Menu page. The refreshed presentation
retains existing routes, settings sections, theme controls, verification,
moderation gating, support/legal links, other SautiLink products and sign out.
Its final stylesheet is available before navigation. Existing action handlers
continue to own navigation and account behavior.

The remaining shared member surfaces follow the current native v1.1.1 (46)
hierarchy: compact feed cards and metadata, Home tabs, Discover search and people
rows, Saved posts, notification event icons, profile actions/activity, Settings,
Appeals and the professional dashboard. The presentation moves existing nodes
and retains their IDs, handlers, hidden/disabled states and permission gates.
Edit profile, Dashboard, Follow, Message, moderation and privacy controls remain
available under their existing rules. Only features already present on Web are
included; this does not introduce app-only features.

Dashboard Top content previews use the shared caption plain-text projection
before trimming to the existing 110-character limit. Balanced styling markers
are omitted while literal/unmatched characters, media-only fallback, dates,
metrics and stored captions remain intact. Analytics queries are unchanged.

The post composer uses a full mobile viewport and a compact desktop dialog with
the existing author identity, text styles and preview, photos/camera, image
editing, video trimming, polls, quotes, drafts, alternative text and publishing
actions. Audience and comment access become keyboard-operable choice chips
backed by the original selects and their change handlers, including dynamic Room
audiences and disabled options. The existing five-attachment limit remains
intact in normal and production builds and in the API contract. Static copy
continues to show the same five-item limit.

The Poll editor uses compact numbered choices, the existing two-to-four-choice
range and 44px add/remove targets. Removing an optional choice renumbers the
remaining rows without replacing their entered values. The intentional helper
copy is covered by `tests/photo-video-polls.test.mjs`; the behavioral composer
regression also verifies the existing choice limits and retained input values.
A browser check at 320px confirms three edited choices retain their content,
including “Tips and inspiration,” and all four composer tools fit the same row
with 44px touch targets.

Keyed attachment rows retain video playback and focused alternative-text fields
through upload state updates and reordering. Recovered previews deduplicate
pending requests, preserve the production video streaming path, and release
late or duplicate blob URLs when their exact draft item is no longer current.
Closing the composer or hiding the page pauses previews. A scoped viewport
controller follows the visible mobile keyboard area while the composer is open
and releases its listeners and dimensions on close, auth entry or page exit.

The shared trim dialog re-enables export and cancellation for each new clip;
its controls remain locked only during that clip's export. Preparing several
videos retains every successfully trimmed selection. Captured audio is routed
through a local 48 kHz audio graph before MP4 recording, preserving sound while
avoiding unsupported low-rate AAC capture. Audio nodes, owned tracks, timers and
object URLs are released after success or failure; video-only inputs do not
create an unnecessary audio context. The existing 60-second clip, two-minute
trim input and file-size limits remain unchanged.

Scope is browser presentation, async client UI lifecycle and regression tests.
Backend handlers, RPC/query contracts, database, auth implementation, native app,
deployment settings and environment variables are unchanged. The approved Web
login/signup presentation remains untouched. New styles and runtime decoration
are gated to member surfaces. A scoped cache key refreshes the new browser
bundle; existing component content hashes continue to version CSS. No test
messages, uploads, membership changes or other production writes are used for QA.

Final local canonical validation: `npm run check` passes all 1,029 tests with no
failures or skips. The unchanged build scripts produce and verify 140 staging
files, 179 production artifact files and 54 content-hashed production UI
stylesheets. Both `npm run deploy:dry` and `npm run deploy:production:dry` pass
against the final artifacts. Logs and compact receipts are saved in
outputs/SautiLink-Web-Chats-Rooms-20261020 in the task workspace. Coverage includes
out-of-order responses, preserved DOM/media/editing, scroll/resize anchoring,
stale media sends/uploads/microphone permission, draft retention, no-op Room DOM
updates, real metadata changes, existing message/Room privacy contracts, original
profile controls, choice-chip restoration, consecutive trims, audio graph
cleanup, keyboard viewport lifecycle and transformed preview identity guards.
The final receipt records stable SHA256 hashes for 15 reviewed runtime/test
files, including `tests/photo-video-polls.test.mjs`, across the canonical run.

An isolated local harness uses the actual source shell, transformed renderers,
timeline, production-transformed Room presentation and synthetic local data.
First-frame sampling confirms one prepared Messages shell and no legacy-shell
frames; an incoming update retained all 31 existing rows and four media nodes
without changing the reader's scroll position. The broad layout matrix passes
70 cases across seven views, five viewport sizes and two themes, without
horizontal overflow or oversized icons. An additional 28 state-layout cases
pass. Responsive visual evidence is saved alongside the validation logs.

An actual local browser export test uses a 62-second video with a 660 Hz tone.
The same trim dialog successfully exports a 1.15-second clip followed by a
59.94-second clip. The exported AAC audio is 48 kHz, has nonzero RMS around 0.088,
and retains the 660 Hz tone. The local structural media parser accepts the
result. This verifies browser export and file structure, not an authenticated
API upload or backend integration.

The synthetic harness does not load a real member session or prove authenticated
network behavior, account transitions or production writes. Login/signup and
backend integration are outside this presentation change. Local canonical
checks now pass, including esbuild and Wrangler; the reviewed PR's exact-head
GitHub checks are still required before publication. No build configuration or
verification gate is bypassed. Publish through the existing linked pipelines
only after those checks succeed.

## Cloned verification artwork follow-up

Production visual QA found that Menu and Short Videos clones removed or
namespaced inline SVG gradient IDs while retaining the old paint references.
The existing badge artwork generator now refreshes only the cloned SVG visual,
giving each team badge its own gradient ID and preserving all eight color stops.
Original verification wrappers, account status, theme, accessibility labels and
permission gates remain unchanged. The bundle's scoped native cache key advances
to v1112; auth, backend and deployment configuration stay unchanged.

Six behavioral regressions exercise the actual creator and clone callers,
including stripped and prefixed IDs, repeated clones, standard light/dark badges,
Menu ARIA references and independent gradient ownership. The canonical check
passes 1,035 tests without failures or skips. The real-source browser fixture
also confirms that source, drawer and Menu page team gradients resolve locally
with unique document IDs and no runtime errors. Evidence is stored alongside
the release logs as menu-badge-gradient-fixture-verification.json.
