# Native video transport — 17 October 2026

Continues PR #352 from `56dbd9c`, preserving approved runtime `688dffe`.
No merge, backend deployment, schema change or Play publication.

## Actual investigation

- Live Worker readback still showed `ba09db25-80c4-49f3-8184-e124becc2680` at 100%.
- Web's current Mchongo and Coco clips actually advanced, using authenticated API video sources. Coco advanced from 0.008 to 7.807 and 15.961 seconds, duration 17.74 seconds, without a media error.
- Exact same current clips played on Samsung SM-A057F in the existing RoomsQA package/session. The four initial clips reached READY; Coco reached 17.628 seconds with duration 17.741 seconds and was seekable.
- Switching Coco to Original exposed an actual `EOFException` at the server's 1 MiB response boundary. Media3 retried at the next offset. The following 10,510,333-byte Original clip showed repeated boundary EOFs and multiple actual BUFFERING intervals.
- Response metadata and sanitized Worker events correlate through CF Ray IDs. They show HTTP206 for these cases, **not a newly reproduced HTTP500**. The earlier position0 HTTP500's originating exception remains unproven; do not label these later EOFs as that exception.

Private local evidence: `outputs/Video-http-Samsung-20261016T220338739507Z.json`, `outputs/Video-http-Samsung-20261016T220656610674Z.json`, associated sanitized tail files, and `outputs/Video-HTTP500-investigation-20261017.json`. Native instrumentation records only allowlisted metadata; no credentials, bodies or raw request/header dumps.

## Targeted change

`NativeVideoDataSourceFactory` wraps the existing authenticated HttpDataSource in Home and Shorts. Other routes pass through. No dependencies, auth header construction, UI controls, timers, navigation, audio preference, gesture semantics or backend API are changed.

- Expose the Content-Range document size to Media3. Read consecutive capped responses as one logical stream; a 1 MiB boundary is not end of file.
- Preserve request bounds and forward existing request headers/transfer listeners. Close each completed response before continuing; do not download the entire video into memory or disk.
- Pin response variant, total size and ETag in the player's bounded in-memory factory. When a cold quality URL returns the original, subsequent chunks/seeks use its existing original URL. A newly warmed smaller rendition cannot inherit an original byte offset.
- Reject changed or malformed response identity before joining bytes. A genuinely truncated body or upstream HTTP500 remains an error; no synthetic playback success or swallowed failures.
- An exact EOF seek on a known resource returns EOF without an unsatisfiable R2 request. Greater offsets remain out-of-range errors.

This addresses the demonstrated chunk/EOF defect and the independently reproduced original-to-rendition range hazard. It is **not proof that every historic HTTP500 had either cause**.

## Verification

Focused checks: **43 PASS**, using the actual product adapter and cached Media3 1.11.1 DataSpec APIs with explicitly local URI/HTTP fixtures. Covers byte fidelity across chunks, bounds, cold rendition warming, seeks, EOF, preserved authorization, HTTP200 range ignoring, representation changes, truncated responses, malformed ranges and propagated upstream failures. This is not an Android decoder/live-provider test.

Reproduce with `native-android/validation/run-video-http-check.ps1` and explicit Java/Android SDK/output paths. Java URI/TextUtils fixtures are validation-only and never shipped.

Full QA assembly/lint and Samsung retest of this changed adapter are **pending** at this source checkpoint. Required: the same Original clip, Auto, pause/±5s seek, quality switching, Home playback, paging and lifecycle/session audio. Record actual results before acceptance. Earlier HTTP500 attribution stays open until matching live evidence or an explicitly bounded resolution is established.


## Home controls and network follow-up (17 October)

The Home overflow button invoked `onOpenPost` directly. It now opens a dropdown
anchored in the card (View profile, Copy link, Share, View post, and Report for
another account). Report uses the existing safety API/dialog. Opening/cancelling
controls leaves the feed and player mounted. There is no new safety endpoint.

The native Auto policy previously received the default empty network model.
Both Home and Shorts now observe the existing Media3 transfer meter, validated
network handoffs, metering and Android Data Saver. Initial bandwidth guesses and
samples below 512 KiB/200 ms are excluded; measured estimates expire after 30 s
and reset on network handoff. The existing web quality thresholds remain.
During a clip Auto can lower quality; upgrades wait for another clip, avoiding
repeated decoder restarts. Explicit quality, pause, seek and session sound remain.

The initial local build of 886e585 was intentionally stopped during lint so these
newly requested fixes could be included together. Its runner restored the exact
QA Gradle/Firebase configuration. It did not produce a certified new APK and is
not a lint PASS. Latest build, full lint and Samsung checks remain pending here.


## Proven end-of-video loop (Samsung, 17 October)

Installed 754 RoomsQA transport passed 43 actual Android fixture checks. Five
real clips played; Coco Original advanced to 17,785 / 17,832 ms without load
errors. The 10,510,333-byte Cheka Original completed as one logical load with
zero EOFException, but exposed a separate native duration-clamp failure.

Metadata-only AnalyticsListener instrumentation captured two automatic SEEKs:
8,045 -> 8,010 ms and 8,091 -> 8,010 ms, with the native Shorts onEvents
listener present on the calling stack. Those seeks canceled loading of the next
repeat and repeatedly fetched the tail. Auto 720 completed three normal 8-second
repeats before the deliberately selected Original comparison. No HTTP500 was
captured; this does not explain the historical server exception.

The two matching onEvents duration clamps are removed from Home and Shorts.
Media3 now owns end-of-stream draining/repeat. User seek commands still use the
existing bounds and source changes retain their position/pause policy. This is
a demonstrated technical reason to change that earlier guard; no backend,
metadata, original media, routes, audio preference or reaction API is changed.
The original UTF-8 UI punctuation is retained.

754 Home overflow -> Report -> Cancel actually passed without preview navigation
(on a photo card; the video-card case is still pending). Rooms full lint passed.
The obsolete D2 lint was intentionally stopped after assembly for this proven
runtime correction; its QA configuration was restored. New APK/full lint and
original-repeat/Home-video/network/seek retests remain pending.
