# Web parity with Android 1.1.9 (54)

This release preserves captions above media and the existing Rooms privacy and
permission model. It brings the recent native presentation and creator features
to the responsive web application.

- Shared Phosphor / Pulso reaction icons, filled hearts and bookmarks, orange
  repost state, compact positive counts, and opaque floating mobile navigation.
- Matching username/time and attached-music slots; music is available in Home,
  Discover, Saved, post conversations, Shorts and profile activity cards.
- Approved Music catalog, search, saved library, usage counts, recent-release
  labels, exact clip previews and independent music/original-video volumes.
- A same-origin public read adapter uses the existing Music service binding.
  It accepts no writes, private routes, member credentials or caller-selected
  territories. The Music service continues to enforce eligibility and clips.
- Music waits for a presented video frame, follows its clock, pauses during
  seeking/buffering/dialogs, and shares single-video playback ownership.
- Visual sticker drafts retain the existing validated text transport and native
  length limits. Picker previews use lightweight images; revisioned animation
  requests avoid stale Telemoji assets. Profile activity also hydrates stickers.
- Photo/video editor with 15 locally hosted Google Fonts, 18 filters, centered
  aspect crops, movable text, text cards, color, size and bold controls. Image
  changes export to JPEG; supported browsers export edited videos to MP4.
- Quick comment emoji, compact comment inputs, blue DM bubbles, SVG delivery
  ticks, and privacy-gated Online / Typing / Last seen / Privacy Mode.
- Native search, nested-comment totals, audio mixes and Trending achievement
  contracts copied from the already deployed native API release. Existing
  migrations are recorded here for source consistency, not reapplied.
- Android brand tones are reused for foreground push notifications when a
  signed-in visible browser has notification permission and permits playback.

## Validation and browser limits

`npm run check` builds and verifies both isolated artifacts and runs the full
repository suite. Production Wrangler dry-run verifies module/service bindings.
Browser checks use the actual modules with a local UI fixture, public Music
catalog, local-only saved-library data and generated disposable media. They do
not publish real posts or messages.

Observed browser exports: a 940×940 JPEG with Lobster text/card and a 3.00-second
640×360 MP4 with a selected 1–4-second source window, Noir filter and text/card.
Music selection, saved-library navigation, exact 12–17-second preview, visual
sticker insertion/caret and quick emoji were exercised through visible controls.

Browsers may require a tap before audible autoplay. MP4 export depends on the
browser's MediaRecorder support; unsupported browsers can retain the original
file and show an explicit explanation. Background notification sounds are
controlled by the browser/OS, not by the web page. These platform constraints
are not bypassed.

## Authenticated production follow-up

After the first deployment, the signed-in browser loaded the live catalog and
384-pixel cover variants, exercised a reversible saved-audio toggle, inserted a
visual motion emoji into an unpublished draft, opened the comment sheet and
prefilled a reply mention, and returned fuzzy user suggestions. Room discovery
and public information loaded; a non-member correctly could not read chat
history. No post or message was published during these checks.

The follow-up corrects duplicated Shorts icons and an opaque player overlay,
keeps the visual DM input and sticker control in the same grid row, makes
sticker-only timestamps readable, replaces wire tokens in inbox previews, and
protects saved-audio state against late reads during a tab change. A deliberately
slow local save followed immediately by the Saved tab retained the correct item.
