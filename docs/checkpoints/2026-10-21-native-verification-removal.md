# Native verification removal — 1.1.2 (47)

The Android Settings → Account control appears only when the current owner's
fresh profile has a Boolean `is_verified: true` and a matching owner ID. Badge
artwork and historical application approval do not authorize the control.
Removal reuses the existing production endpoint
`POST https://sautilink.com/api/account/verification/remove`; no backend, Web,
Supabase schema, authentication implementation or other account rules change.

The confirmation uses the same title, buttons and exact warning as Web:

> Your verification checkmark will be removed from your account. Your username will follow the normal change limits. To become verified again, you must submit a new application and complete every verification step again. Being verified before does not guarantee approval of a future application. This removal cannot be undone.

Only explicit confirmation sends the UUID `request_id` and
`confirmation: remove-verification-v1`. The same request ID is retained for a
retry within that dialog. The client blocks duplicate requests, redirects and
automatic retries, and checks the active owner before and after token retrieval
and the response. Only an HTTP 200 response with matching owner/profile IDs,
`removed` or `already_removed`, Boolean false verification, the standard badge
and Boolean true username unlock can update local identity. Failure, malformed
responses, cancellation and account changes do not demote a profile.

Confirmed removal demotes the owner's menu identity and cached own posts only.
All five feed modes become stale while retaining existing offline rows, original
five-minute TTL, media, counts, pagination and other authors' badges. Read
generations prevent old requests from overwriting cache; removal epochs also
demote stale page/detail results returned to UI. Later authoritative verification
remains visible. The verification screen labels a receipt-retired application as
historical and explains that a new application and full review are required.

Incoming chat bubbles use a neutral theme surface selected against the actual
wallpaper, plus a thin outline. Outgoing Blue, Teal and Neutral colors, shapes,
elevation, gestures, quoted-message navigation, attachments and receipts are
unchanged. Four offline Compose tests cover rendered colors across both themes
and all wallpapers, explicit white backgrounds and existing nested content.

The confirmation waits for its real dialog window to gain focus before focusing
Keep verification. The safe cancellation button remains focusable outside the
pending-removal state. The focused Samsung regression confirms Keep, Back and
keyboard Enter all dismiss without gateway calls.

Reviewed combined application source: `960c7a832edc8f811cba20920f32256589385e64`.
Its `native-android/app/src` tree is
`67db8df2d13bda8d541cca4eb52e8362f9f6dd6f`; the production
`app/src/main` tree is `61d0a165df7ceb874973bd50a5b6f59fc29f1da2`.
The pinned release47 signing trigger is
`1030cf74f43dc9b50e666b8e8762d0d98a0d2ea1`, workflow run
[39508685190](https://github.com/sautilink/sautilink/actions/runs/39508685190).
The workflow retains the existing signer, Firebase and bundletool pins,
production lint, caption/integrity, signature, manifest, checksum and 16KB ELF
checks; it builds artifacts without publishing them.

This native branch is stacked on
`048a66ef539b349d2953c58044c02c76cdf62592`.
[PR381](https://github.com/sautilink/sautilink/pull/381) remains a draft and must
not be merged into the Web main branch.

The earlier signed artifact from source `5456afe...` was verified but never
uploaded. It is explicitly superseded because the user added the chat fix before
delivery. Its evidence is preserved in `outputs/SautiLink-1.1.2-47`; combined
release evidence uses the distinct `outputs/SautiLink-1.1.2-47-final` directory.

All removal/protocol/cache fixtures are synthetic and do not remove a real
account's verification. Back and Enter target the actual production dialog;
API29 window inspection applies only to the two key-routing tests. On Samsung
SM-A057F/API35, the focused safe-cancel regression passed with no skipped tests.

All 51 connected-device tests passed on Samsung SM-A057F/API35, with no skips or
failures. Preview lint passed with zero errors. The four chat tests also passed
after test-only commit `86d3eaafb21c94db6c493d2e816a90cc9c3f64c0` moved the
preview capture before pointer interactions. That commit changes no production
source; its `app/src/main` is exactly the signed source tree above. Screenshots
show real production components with controlled local content, rather than a
network conversation or a real account removal.

The combined signing workflow succeeded. Artifact `12304968906` from run
`39508685190` was downloaded using the exact trigger/head metadata and archive
digest `3adc330cb561ba4e8fd854d9497a358012364a23168d651522478593e26a35e6`.
Independent local verification passed for `com.sautilink.app`, version 1.1.2
(47), min SDK26, target SDK36, non-debuggable manifest, all 600 signed payload
entries, original Firebase resources, original upload certificate, 16KB ELF
alignment and no registration/private-key assets. Production lint has zero
errors; the exact-source caption and offline integrity suites passed 191 and
63 checks. Integrity remains in monitor mode.

AAB SHA256: `8d6e43a9cb246cc6d78fce7e01ea9af5c9e0778e6c6a006dab2ec8f5d1db9641`.
Upload certificate SHA256:
`31c773a7229a563d92f7047a56735ad7b02027d27a6e020d8923dd5418f4b50f`.
Receipt: `outputs/SautiLink-1.1.2-47-final/verification.json`.
Device receipt: `outputs/SautiLink-1.1.2-47-final/device-verification.json`.

Latest exact-head Native Android build/lint CI passed at
`86d3eaafb21c94db6c493d2e816a90cc9c3f64c0`
([39509708291](https://github.com/sautilink/sautilink/actions/runs/39509708291));
Brand Guard also passed
([39509708598](https://github.com/sautilink/sautilink/actions/runs/39509708598)).
The separate main-only signing job was correctly skipped for the draft PR.
The pinned release-candidate workflow above supplies the verified signed bundle.

Play Console accepted the verified combined bundle. Existing Internal track
`4701517839586180426`, release 6, shows **Available to internal testers** for
`1.1.2 (47) - Verification and chat - Internal`, released 21 Oct 01:54.
The same uploaded 47 bundle was promoted to existing Closed Alpha track
`4698906409381683321`, release 6, at 100% of its existing audience. Submission
was accepted into **Changes in review**; Google quick checks are running before
review. Alpha approval/availability is not claimed.

Both release notes use the existing default `en-GB` locale. Console validation
reported only the non-blocking mapping-file/native-debug-symbol notices and no
loss of supported devices. Public Production, tester audiences, countries,
store assets and managed publishing were not changed. Managed publishing
remains off. No Play-installed production QA or 16KB runtime-device test is
claimed; the connected tests use the isolated preview package.

Console receipt: `outputs/SautiLink-1.1.2-47-final/play-console.json`.
Screenshots: `console-internal-available.png`, `console-alpha-in-review.png`,
`confirmation-light-390.png`, `confirmation-dark-320-font150.png` and
`incoming-light-outgoing-unchanged.png` in that evidence directory.
