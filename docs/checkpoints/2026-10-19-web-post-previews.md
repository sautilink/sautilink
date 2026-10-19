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

Live share-preview follow-up: metadata truncates by Unicode code point, so an
emoji at the title/description boundary cannot become replacement characters.
The existing text-card renderer now consumes a staged 1200×630 PNG rather than
an unsupported SVG and supplies the font required by Cloudflare Images. A
renamed, self-hosted static Inter/Noto Emoji face covers caption emoji; both OFL
licenses, pinned source hashes and a deterministic rebuild script are included.
The font is used only for server-rendered share cards, with no application-wide
font or browser runtime change. The version-3 card URL refreshes external image
caches. Public visibility is still checked before cache or fallback access.

The real Images binding produced a valid 79,640-byte caption PNG in an isolated
diagnostic Worker with public fixture data and no application/data bindings.
Visual inspection confirmed the sample caption and emoji without delimiters or
missing-glyph boxes. Regression coverage validates raster input, explicit font,
GET/HEAD fallback, missing/private post denial, Unicode boundaries and the exact
staged font/image/license assets.

Follow-up validation: all 963 tests pass, with 134 staged files, 172 production
artifact files, 49 stylesheet hashes and the production Wrangler dry run.
