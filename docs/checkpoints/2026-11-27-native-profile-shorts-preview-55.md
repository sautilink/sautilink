# Android Preview 55: profile continuity and Shorts viewer

Status: local Preview only, based on release 54 (`8ca3485`). No backend, web or Play Store deployment.

## Behavior

- Profile Follow uses the server-confirmed write response to update the relationship and follower count. It keeps the loaded profile, selected public posts, images and scroll mounted. Follower-only activity permissions are rechecked independently; unfollow revokes restricted content immediately.
- Shorts uses one horizontal action row: Like, Comment, Repost, Share, Save. Zero counts stay hidden; existing compact counts, filled heart/save and orange repost feedback remain.
- Circular back/options controls and a black playback footer provide timeline seeking, play/pause, remaining time, speed, mute and fullscreen.
- The rounded options sheet exposes five playback speeds, actual quality choices, available text tracks, persistent auto-advance, Go to Post, Download video, app-private Offline videos, local Not interested filtering and the existing report workflow.
- Menu, comments and offline viewing pause the active Shorts player and its attached soundtrack. Fullscreen orientation changes retain the player. Status-bar background remains black in Shorts. The options dialog explicitly keeps white status icons over the dark video while adapting navigation icons to its sheet theme.
- Navigation and reaction outlines have a modest weight increase without changing their artwork slots. Profile navigation restores the original separate head/shoulder icon. Other-person Follow and Message buttons use brand blue fills; Message has no leading icon.

## Validation

Samsung SM-A057F, Preview package only. The live Follow integration check restores its original relationship after checking that neither profile nor public activity was refetched. It returned `profileReloads=0 contentReloads=0`.

The focused device suite passed all 15 checks: small-screen action order, dark-mode options, icon footprints and filled-heart consistency, reaction feedback, unknown-state retries, offline account separation/corruption/cancellation, live Follow, and live Shorts integration. Live Shorts verified speed, quality, fullscreen, Go to Post/back, an authenticated download into app-private storage and successful playback directly from that local file. No post, message or report was submitted.

The JVM suite passed 297 tests with zero failures/errors. Android lint completed with zero errors (144 existing warnings and two hints). Preview performance builds use release runtime settings under the separate Preview package; the published app is untouched.

## Availability and boundaries

Captions operate on actual subtitle/text tracks; videos without them show an unavailable state. Offline copies retain the video's original audio, not a separately attached licensed music stream. Offline storage is scoped to the signed-in account and bounded to ten videos / 500 MiB; server download authorization remains enforced. Not interested is stored locally per account.

The user reviews the release-mode Preview before any Play Store publication. The font project remains paused.
