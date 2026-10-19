# Web notification post and caption previews

Post notifications now use the existing member SPA router while signed in,
preserving the current member UI and the original post/comment destination.
The signed-out fallback and notification read behavior are unchanged.

The public guest post preview uses a compact layout, the existing Huge icon
runtime, and the same safe rich-caption renderer as member posts. It recognizes
the stored session envelopes already supported by member bootstrap. A late
confirmed member render removes only the post overlay and restores the previous
accessibility locks. Visible anonymous profile shells cannot release the gate.

Open Graph, Twitter metadata, JSON-LD and generated text cards use a plain-text
projection of the same formatting grammar before truncation. Public fallback
HTML retains escaped rich formatting. Raw post bodies and public JSON remain
unchanged. Literal and unpaired markers, URLs, hashtags and usernames survive.
The text-card image URL has a new presentation cache key; other sites may retain
previously scraped metadata until they refresh their own preview caches.

No database, API contract, auth policy, media access, Worker route, binding or
environment configuration changes are included.

Validation: full package check (956 tests), 128 staged files, 166 production
artifact files, 49 stylesheet content hashes, and production Wrangler dry run.
Browser QA covers the user's public post at 320px dark, 390px light and desktop,
all six Huge icons, formatting and links, no overflow, and the gated comment
dialog. Runtime regressions cover signed-in notification navigation, session
restoration, anonymous-profile isolation and reduced motion.
