# Original video index delivery: review checkpoint

**Current production: rollback verified, prior diagnostic Worker `ba09db25-80c4-49f3-8184-e124becc2680` at 100%. The ee173095 rollout FAILED its live regression gate.** This follow-up is a LOCAL proposal only and requires new owner approval under Issue #353 before deployment. It removes the two global duration exclusions while preserving the optional indexed-copy hook and existing web quality fallback. No original, database, schema, binding, dependency or native changes are included.

## Live failure and verified rollback

The owner approved ee173095 plus two derived MP4/two receipt writes. Root deployed Worker `0b2f1e3e-211d-47f1-85e4-994f060b45c4` at 100% and verified derivative full SHA readback. Subsequent Samsung QA exposed a third unindexed video with metadata 478×850 / 114 ms. The global <=1,000 ms check bypassed its existing 360p rendition before any cache lookup, forcing a 3.552-second unseekable original. The existing rendition was independently read and decoded: about 60 seconds, seekable in cached Media3, with actual seek/sample checks. Local execution of both actual API versions reproduces prior `video-v2;q=360` versus ee173095 `original` routing. Repeated playback resets were observed; their complete mechanics were not independently reproduced by the local routing test.

Root performed the approved bounded rollback at **2026-10-16 15:06:40 UTC**: both exact activation JSONs were deleted and GET404 verified **before** restoring ba09 at 100%; 27 bindings remained unchanged. Rollback deleted no originals or derived MP4s. Evidence: `outputs/Video-index-rollback-c1667a1.json`, `outputs/Video-third-Mariam-cached360-20261016.json`, and task-local `global-duration-guard-risk.json`. Postrollback Samsung playback is a separate live result.

Root's subsequent readback found both originally inspected source posts physically absent and unavailable live; root did not delete them. Cause/timing is not established here. This follow-up does not recreate posts or claim those two indexed-copy live tests passed.

The earlier tests incorrectly treated small duration metadata as grounds to bypass every cached rendition. The new regression cases require an existing healthy 360p cache to remain usable for 478×850 / 114 ms after an indexed-copy miss or invalid receipt. Against the deployed ee173095 code these focused tests produce **110 PASS / 8 FAIL**; the local follow-up produces **118 PASS / 0 FAIL**, including raw and actual production-transformed code. These are protocol tests, not Samsung or decoder claims.

## Problem and bounded change

Two inspected fragmented MP4 originals contain complete samples but expose short duration headers and no usable seek index. Stored media durations are 147/115 ms; cached Media3 1.11.1 reports 4.527/3.622 seconds and unseekable originals. Coco's existing 360p cache was independently found shortened. These findings do **not** establish the earlier HTTP 500's cause.

Separate derived copies repair fixed-width movie/track/media duration fields and append MFRA/TFRA/MFRO. Each changes 12 existing header bytes plus its index; all other source bytes, A/V samples, timestamps and codec configuration are preserved.

| Local copy | Source bytes | Derived bytes | Complete duration |
|---|---:|---:|---:|
| Coco | 5,440,719 | 5,441,215 | 62,860 ms |
| Mariam | 30,210,032 | 30,210,472 | 60,093 ms |

Both complete timelines exceed the existing one-minute transform limit. The proposed Worker reads only precomputed copies. It does not generate indexes during playback or download whole objects into Worker memory.

## Source and protocol scope

Historical ee173095 patch SHA256 is `ee1730959b65bfb276c316fdf5db4e247aff1cf2383f42636f86b18199b78630`. Its optional `src/original-video-index-delivery.js` hook and matching production transform are retained in this proposal. The only runtime follow-up removes the global duration checks from creation/serving of normal quality variants.

- Existing caller/RLS resolution occurs before any derived storage access. Only attached published video on `/api/sauti-media/<UUID>` is eligible. API URLs, auth, images, posters, ready uploads and protected pending Room-media delivery retain existing behavior.
- `<originalKey>.original-index-v1.mp4.receipt.json` activates `<originalKey>.original-index-v1.mp4`. The JSON must be <=4 KiB, valid UTF-8, exactly sized, supported version, and bound to owner/media IDs, actual original **and derived** ETags/sizes, SHA256 values, complete duration and verified preservation/repair flags.
- Candidate HEAD occurs first; absent candidates do not trigger receipt GET. Missing/stale/invalid optional cache data or optional probe failure returns to the existing requested-quality path. Selected source/body failures still surface. Derived GET is conditional on its HEAD ETag; a replacement or unexpected range returns a fixed 503 rather than combining representations.
- Selected copies use truthful size/duration, a strong content-based ETag, private five-minute revalidation and original quality even for quality requests. Valid single ranges are capped at 1 MiB with exact headers; invalid/multiple/unsatisfiable ranges return 416 without body GET. HEAD/If-None-Match/If-Range retain representation consistency.
- Missing/stale/invalid optional indexed data returns to the existing requested-quality path. Legacy quality eligibility and cached-rendition behavior remain unchanged; metadata alone cannot establish whether a rendition is truncated. Video cleanup still includes the exact derived and receipt keys.

The native app tree remains `ff171d2bb17168acd5101e8bd6bab4e9ed547438`, unchanged from `bab7cb2f283f32f5e1c324bbfd6b612bea214c37` by this proposal.

## Actual evidence

Evidence is retained in the task workspace under `work/video-original-index-proposal/` and `outputs/`; private MP4 binaries are not test dependencies or committed artifacts.

| Gate | Actual result |
|---|---|
| Historical ee173095 existing suite and full staging/production build/artifact checks | 854/854 PASS; production Wrangler dry run PASS (`work/outputs/video-original-index-sidecar-bab7.json`); superseded by live failure/rollback |
| Follow-up deterministic protocol tests | 118/118 PASS; raw and actual production-transformed code, opaque generated bytes, guarded temporary output cleanup. Before-fix control: 8 failures. No new broad build/full-suite claim. |
| Historical c166 repo-ready pure builder/local CLI and combined check | 27/27 PASS; all 141 new checks passed together against that primary checkpoint. Follow-up focused protocol checks: 118 PASS, now applied locally; no new full-suite or deployment claim. |
| Local real-copy HTTP protocol checks | 114/114 PASS, separately; synthetic R2 stubs, not provider execution |
| Pure index builder checks | 21 PASS in the original local proposal; additional repo-ready builder tests are separate evidence |
| Actual cached Media3 1.11.1 extractor checks | 72 PASS: repaired duration/index/seek map and sample equivalence; no Android decoder/network/lifecycle claim |
| Offline A/V decode comparison | Six original/derived/prototype copies PASS with identical decoded frames and timestamps |
| Current original provider readback | Root performed exactly two complete GETs; current sizes/SHA256 match retained sources and actual HTTP ETags were observed (`outputs/Video-original-current-source-readback-20261016.json`), zero storage writes |
| Local workerd/R2 runtime check | NOT VERIFIED: Windows workerd failed before startup with access violation |
| Historical ee173095 upload/deploy/live result | Owner-approved uploads/deploy occurred; Samsung regression gate FAIL; rollback verified. Original two posts now unavailable. Follow-up not deployed. |

The previous custom-metadata receipt draft is historical. The current sidecar avoids new credentials/configuration and works with ordinary pinned Wrangler PUTs. A GET metadata/readback operation must not be described as HEAD. HTTP ETags are observed, never inferred from hashes; actual correspondence to the Worker R2 HEAD remains a live gate.

## Local preparation tool

`scripts/prepare-original-video-index.mjs` accepts an explicitly hashed local source, creates a new MP4 and inactive preparation report, and makes no provider calls:

```sh
node scripts/prepare-original-video-index.mjs --input source.mp4 --output indexed.mp4 --receipt prepared.json --expected-sha256 <source-sha256>
```

Outputs must not exist. The report is not an activation receipt. The bounded builder supports the verified H.264/AAC fragmented layout, refuses unsupported/encrypted/edit-list/invalid input, and checks that only duration slots and the appended index differ. Generic synthetic fixtures are committed; private videos are not.

## Approval, rollout and rollback

Root owns all provider/device operations. Any revised rollout requires **new explicit owner approval under Issue #353** for its exact patch; the earlier ee173095 approval does not authorize this follow-up. Preserve the current ba09 Worker/bindings and originals. The now-unavailable source posts must not be recreated or reactivated as part of that approval.

The historical upload sequence was MP4 first, full readback SHA/size/ETag, and bounded receipt **last**. Any future approved activation still requires protected Worker HEAD to select the expected indexed size/duration/ETag, authorization and exact-range checks, followed by Samsung/web playback and seek tests. This follow-up plans no replacement posts, fixture creation or new copy uploads; the unavailable original pair cannot provide those live proofs.

Rollback uses activation receipt removal **first**, then the preserved Worker. The recorded rollback already completed this sequence for the exact original pair without deleting MP4s. Never replace/delete originals. When an optional index is absent, this follow-up preserves the legacy requested-quality delivery path.

## Remaining limits

The optional hook can repair only an explicitly verified indexed copy whose current caller-visible metadata and source binding remain valid. Future files without such an index remain OPEN; metadata alone does not prove a complete timeline. Existing legacy renditions may themselves be shortened and require separate evidence before correction. General ingestion normalization/inventory is separate work. Complete original delivery can use more bandwidth than a good adaptive rendition. Earlier HTTP500, network/startup stability and release readiness are not blanket PASS claims from these local checks.
