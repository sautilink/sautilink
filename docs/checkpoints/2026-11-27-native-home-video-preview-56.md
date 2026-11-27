# Android Preview 56: Home video framing and scrolling chrome

Preview 1.1.11-preview (56), based on release 55 source commit `bf57d9d`. The user reviews this Preview before any Play Store release. No web, backend, global font, authorization or playback ownership changes.

## Behavior

- Home videos have a full-width maximum-height 2:3 frame. Taller sources use centered zoom/crop; 4:5, square and landscape sources keep their own ratio. Frame dimensions come from attachment metadata before poster/decoder readiness. Unknown dimensions retain the previous stable fallback. Other galleries and image framing retain their previous defaults.
- Native feed PlayerViews clip their real SurfaceView layer to their outline. The existing first-frame Compose graphics layer also clips its bounds. `clipChildren` alone did not contain a zoomed decoder: the original Preview exposed video behind the reaction row and following author's header. Retaining SurfaceView avoids undoing the earlier scroll performance work.
- Only Home navigation translates/fades out on a deliberate downward drag and returns on upward movement. Small alternating deltas do not flicker the bar. Its Scaffold slot stays fixed, so hiding it does not resize the feed/decoder or move the composer button. A reset/top-of-feed return restores navigation; non-Home tabs remain visible.
- Following / For You / Trending have 44dp visible gradient glass, 48dp touch targets, a moving selection, theme-aware ink and larger-font support. These three labels use the bundled Google Sans at the user's request. No live video backdrop blur. The app theme has an unspecified label line height, so measurement uses an explicit sp fallback rather than attempting an invalid density conversion.
- Samsung showed horizontal white bands behind tab labels when the gradient glass had an elevated shadow. A device diagnostic isolated this to the shadow layer, including a control without selectable semantics. Removing the glass and selection shadows retains the gradient/border and clears the bands. Diagnostic scaffolding was removed; a pixel regression guards continuous gradient behind the labels.

## Verification

The standalone surface tests decode a local red video into wide/tall zoomed frames and sample actual window screenshots, including the hardware surface. Magenta surrounds must remain intact on all four sides. Compose-only image captures cannot verify decoder surface overflow.

Focused Samsung checks cover frame geometry, original image/carousel behavior, real surface clipping, tab selection and larger fonts, gradient pixels, navigation hide/return without layout movement, missing-cover mattes, exclusive video playback and existing reaction/navigation visuals. The live Home-to-Shorts probe verifies player identity, zero duplicate entry descriptors, position continuity, a decoded handoff cover, confirmed/restored reactions and first swipe/return.

321 JVM tests passed with no failures/errors/skips. The 23-check focused Samsung suite and live handoff test passed; the four chrome checks passed again after applying the scoped Google Sans change. The live source was 1080x1920 in a 1080x1620 crop frame. Its measured first target frame was 1057ms after the open action, with the same player and zero duplicate entry descriptors. Local Like/Repost/Save feedback measured 36/61/67ms, with original reaction states confirmed and restored. These are observations from one device/run.

Timing interpretation: the historical 1500ms debug assertion was exceeded by both the unchanged 4:5 control (2147ms) and the new frame on this device. The default assertion remains unchanged; this device's comparison run supplies a 2500ms budget. Report actual observations with player/descriptor evidence rather than promising a universal startup time.

Final build, test totals, signed APK hash and observed device timings are recorded in `outputs/SautiLink-Preview-56/validation.json` in the workspace. Preview only; release 56 is not submitted to Play.
