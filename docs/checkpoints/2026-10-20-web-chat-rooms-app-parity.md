# Web Messages and Rooms app parity

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

Scope is browser presentation, async client UI lifecycle and regression tests.
Backend handlers, RPC/query contracts, database, auth implementation, native app,
deployment settings and environment variables are unchanged. The feature cache
marker refreshes the new browser bundle; existing component content hashes
continue to version CSS. No test messages, uploads, membership changes or other
production writes are used for QA.

Validation: 152 focused tests pass with no failures or skips. Coverage includes
out-of-order responses, preserved DOM/media/editing, scroll/resize anchoring,
stale media sends/uploads/microphone permission, draft retention, no-op Room DOM
updates, real metadata changes and existing message/Room privacy contracts.
An isolated local harness uses the actual source shell, transformed renderers,
timeline, production-transformed Room presentation and synthetic local data.
First-frame sampling confirms one prepared Messages shell and no legacy-shell
frames; an incoming update retained all 31 existing rows and four media nodes
without changing the reader's scroll position. Responsive visual evidence is
saved in outputs/SautiLink-Web-Chats-Rooms-20261020 in the task workspace.

The managed Windows environment blocks esbuild's child-process service, so the
existing GitHub full build/test/artifact/Wrangler checks remain the publication
gate. No build configuration or verification gate is bypassed. Publication must
wait for the reviewed commit's checks and then use the existing linked pipelines.
