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

The focused device suite passed all 16 checks: small-screen action order, dark-mode options, icon footprints and filled-heart consistency, reaction feedback, unknown-state retries, offline account separation/corruption/cancellation, live Follow, and live Shorts integration. Live Shorts verified speed, quality, fullscreen, Go to Post/back, an authenticated download into app-private storage and successful playback directly from that local file. No post, message or report was submitted.

The JVM suite passed 301 tests with zero failures/errors. Android lint completed with zero errors (146 warnings and two hints). Preview performance builds use release runtime settings under the separate Preview package; the published app is untouched.

## Availability and boundaries

Captions operate on actual subtitle/text tracks; videos without them show an unavailable state. Offline copies retain the video's original audio, not a separately attached licensed music stream. Offline storage is scoped to the signed-in account and bounded to ten videos / 500 MiB; server download authorization remains enforced. Not interested is stored locally per account.

The user reviews the release-mode Preview before any Play Store publication. The font project remains paused.


## Follow-up: Home-to-Shorts interaction continuity

Reference: the user's 39-second recording demonstrating Home entry, immediate Like/Repost/Save feedback and uninterrupted playback.

A Home video tap now seeds the viewer with the selected media, nearby accessible feed rows, the current playback position and the known reaction/follow states. A bounded, off-main-thread PixelCopy retains the decoded Home frame until the destination renders a real frame; a normal authorized poster remains the fallback. The existing SurfaceView scroll optimization, media authorization, replay cache boundaries and single active player policy remain in use. Returning to Home restores its media position and uses the same reaction presentation.

A session-scoped reaction queue displays the desired state immediately, coalesces rapid taps, serializes idempotent writes, and confirms them with the existing API. Failed requests restore the last confirmed presentation. An uncertain request is read before another write; delayed reads cannot overwrite a newer tap. No automatic mutation retry or action-triggered feed refresh was introduced. Saved lists remove an unsaved item after confirmation, and fresh feed reads reconcile counts only when their action revision still matches.

Four additional JVM checks cover rapid taps, optimistic counts, failure/retry reconciliation, stale reads, owner changes and unknown initial state. The live Samsung probe verifies the exact media, continuing clock, decoded-frame cover, reactions while playback continues, confirmed API results, restoring original Like/Repost/Save states, and returning to Home. Its initial successful run measured local feedback at 35 ms / 75 ms / 77 ms; these are device-test observations, not network or universal latency guarantees.

The final focused device suite passed all 16 checks. The repeated Home-to-Shorts probe reported 33 ms / 76 ms / 72 ms for local Like/Repost/Save feedback, with API confirmation and original states restored. The final performance Preview is installed on Samsung; publication remains pending user review.
