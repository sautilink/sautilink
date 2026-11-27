# Android Preview 55: profile continuity and Shorts viewer

Status: local Preview only, based on release 54 (`8ca3485`). No backend, web, GitHub push or Play Store deployment. The font project remains paused.

## Current behavior

- Profile Follow updates the relationship and follower count without refetching the loaded profile or public activity. Restricted activity permissions are checked independently. Home hides unknown relationship states and revalidates cached non-following states before offering Follow.
- Navigation/reaction outlines have a modest weight increase in their existing artwork slots. Profile navigation uses the original separate head/shoulder icon. Other-person Follow and Message buttons use blue fills; Message has no leading icon.
- A Home video tap opens the selected media in Shorts at its current playback time. A bounded, off-main-thread decoded-frame copy covers the handoff. The existing SurfaceView scroll optimization, authorization and single active player policy remain intact.
- Home and Shorts share immediate reaction state. A session-owned queue coalesces rapid taps, serializes idempotent writes, confirms with existing APIs and rolls back uncertain failures. A delayed read cannot overwrite a newer action. Repeated double taps request Like only, never Unlike or an extra count.
- Shorts uses the horizontal Like, Comment, Repost, Share, Save row, circular back/options controls and black playback footer. Menu actions include speed, actual quality choices, available subtitle tracks, Go to Post, authorized Download, app-private Offline videos, local Not interested and Report.
- Shorts always loops the current video. There is no automatic page advance, including when an older saved auto-advance preference is present. Next/back retains the player, position, a bounded set of decoded frames and healthy source descriptors within their existing owner/credential/expiry boundaries.
- Tap a long Shorts caption to expand or collapse it; no See more/less labels. Expanded text has a soft dark scrim. The timeline thickens while held, shows the selected time and previews the scrubbed position. It preserves the viewer's paused/playing intent on release; cancellation restores the original position.
- Double-tap feedback uses a large filled brand heart with quick oversized arrival, settling, alternating tilt and gentle upward fade. Each tap has its own bounded transient animation (maximum four), sized from the available media surface. It does not remeasure the video during animation. Side double taps retain the existing video seek gesture.
- Compose no longer has the Text style toolbar or its formatting preview. Existing post-format parsing/rendering and media-editor text overlays remain available, preserving historical posts.
- Visible email addresses use brand orange/pink in bio, comments, captions, posts, Rooms and message text through the shared text renderer. Email actions open a mail composer without sending; addresses are disjoint from mentions, hashtags and web URLs. Literal local-part underscores survive historical formatting.
- A cold Shorts load shows loading content. Offline videos is offered after loading finishes, not as a temporary label while fresh videos are fetched.

## Validation

Samsung SM-A057F, Preview package only. The focused device suite passed 31 tests, covering the live Home handoff and reaction confirmation/restoration, live Follow, Shorts options/navigation/offline playback, next/back/manual paging, seeking/looping, caption expansion, icon footprints, repeated double taps, historical formatting and email theme colors.

The live Home handoff reported same media, continuing playback and a decoded cover. Local Like/Repost/Save feedback measured 31/63/65 ms in this run; these are device-test observations, not universal latency or network guarantees. Original relationship/reaction states were restored. Live Follow reported `profileReloads=0 contentReloads=0`. The revisit probe reported zero descriptor requests on return, retained position/player, manual paging, looping and live scrub preview/resume. No post, message or report was submitted.

The JVM suite passed 309 tests with zero failures/errors/skips. Five focused device checks were rerun after the final additive-Like change and all passed, including actual viewer gesture invocation while the first Like was pending, confirmation, and original-state restoration. The repeated live Home probe measured local Like/Repost/Save feedback at 55/91/105 ms and reported `additiveDoubleTap=pass`.

A process-cold 24-second Samsung recording was inspected from launch through actual video playback. The loading state did not display Offline videos before the feed arrived. A separate on-device repeated-double-tap recording confirmed the heart proportions, pop/settle/upward fade and unchanged Like count. Final build/install/lint evidence is retained with the APK validation receipt.

## Boundaries

Captions require actual subtitle tracks. Offline copies retain original video audio, not a separately attached music stream. Offline storage is account scoped and bounded to ten videos / 500 MiB; server download authorization remains enforced. Not interested is local per account. The user reviews the Preview before publication.


## Home-to-Shorts playback ownership correction

A warm Home tap now transfers the existing authorized player, resources, live bearer relay and healthy playback read to the viewer. It no longer just transfers a bitmap/position before constructing a replacement player. The old Surface is detached while still valid; the live player continues through the handoff. Home relinquishes its visibility/arbiter teardown, and Shorts retires the transferred tuple on the first swipe or exit. Unclaimed transfers expire after three seconds; owner, auth instance, original grant deadline, credential and retry/failure checks remain enforced. READY and BUFFERING sources can transfer; idle/ended/failed players follow normal startup/recovery.

The normal Shorts preload engine is built after the transferred Surface renders a real frame, with an explicit immediate path if the viewer swipes away before then. The next/back path retains normal preloading and saved positions. This does not create a second playing video.

Validation: 314 JVM checks passed; 13 focused Samsung checks passed, including actual live-player identity, zero duplicate entry descriptors, a real decoded target frame, position continuity, Like/Repost/Save confirmation/restoration, additive double taps, first swipe/return/retirement, direct Shorts revisit/loop/scrub, playback controls, fullscreen/options and offline local decoding. Observed target-frame timings were 944 and 1317 ms after the actual open action in debug instrumentation; these differ from the automation's full wait/idle duration and are not universal latency guarantees. The earlier replacement-player baseline took 3779 ms including automation waits. Android lint completed with zero errors. No backend/web/Play Store changes.


## Home video matte correction

Published inline video covers now use the already established black Shorts cover renderer, including its empty black loading/missing-poster state. The previous generic photo renderer painted the light theme surface behind a fitted poster and during loading, changing from white to black when the decoder appeared. Actual photos retain their existing theme backgrounds; original video pixels and media alignment are unchanged.

Two new pixel regressions render the actual feed gallery in light/dark themes with isolated signed-out auth. Samples at both edges verify a black video stage and the unchanged theme-coloured photo control. The six-check Samsung recheck passed: both feed-gallery theme tests, both existing Shorts missing-cover tests, exclusive single-video playback and the live Home handoff/first swipe/return. The last live target-frame measurement was 1087 ms after the actual open action, with the same player and zero duplicate descriptors; reaction states were confirmed and restored. JVM checks remain 314 passed, zero failures/errors/skips. Final release-style Preview installation/build/lint evidence is in the APK validation receipt.
