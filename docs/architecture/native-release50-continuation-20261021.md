# Native Stream and Stories release 50 — continuation checkpoint

Updated: 21 October 2026, after authenticated Google Play Console verification at 17:24 UTC / 20:24 EAT.

## Current result

PR [#387](https://github.com/sautilink/sautilink/pull/387) is merged into its intended native base, `feat/native-verification-removal-20261021`. The signed SautiLink **1.1.5 (50)** AAB passed independent downloaded-byte verification. The merged native source is identical to the source used for that signed bundle.

**Google Play availability is now confirmed for both existing testing tracks.** After the user restored Console access, authenticated live inspection found version **1.1.5 (50)** already published: **Available to internal testers** on Internal testing and **Available to testers on Google Play** on Closed testing - Alpha, both with full rollout. This continuation verified the existing releases; it did not upload a duplicate bundle or start a new rollout. The earlier signed-out observation is superseded by this authenticated evidence.

## Exact source and artifact identity

| Item | Verified value |
| --- | --- |
| Native PR | #387, closed and merged |
| Native head before merge | `6d08c71c47254cc4a4a272f0fe83ddab4b8b0708` |
| Intended base | `feat/native-verification-removal-20261021` |
| Base before merge | `142ca4fed1952484b7deeb65bb6ea2ce29f73c79` |
| Merge commit | `ecb00c3ed9dc50ba98b9ceef5207ead30c931af2` |
| Merge time | 21 Oct 2026, 19:36:26 EAT / 16:36:26 UTC |
| Immutable signed source | `bbf26ada068742ca86c863cf3385a54572208161` |
| Signed source repository tree | `1957e47f7f3dfc4e639a0fa92f81172371f6ba93` |
| `native-android/app/src` tree | `c00b7c6518b79d0eb9e02caf9d082d10919069ac` |
| `native-android/app/src/main` tree | `efc8716d80647feff75e4c395c2ced75a1f8f4d8` |
| Successful candidate run | [39587274909](https://github.com/sautilink/sautilink/actions/runs/39587274909) |
| GitHub artifact ID / name | `12340874127` / `SautiLink-Play-Release50-39587274909` |
| Artifact archive SHA256 | `3414ea39cf4d6c9f65acf626e505ec3fe688e93f1bf7b0d734aecb8af63b60d5` |
| AAB SHA256 | `8dccfb11ad280082c9b597d4469a1a06bd24322b73e99fb5406146cf47952ca0` |
| Existing upload certificate SHA256 | `31c773a7229a563d92f7047a56735ad7b02027d27a6e020d8923dd5418f4b50f` |
| Package / version | `com.sautilink.app` / `1.1.5 (50)` |
| SDK / manifest | minSdk 26; targetSdk 36; non-debuggable; `extractNativeLibs=false` |

A direct GitHub tree read after merge confirmed both native source-tree hashes above at the merge commit. The signed source-to-PR-head comparison changes only four CI gate/workflow files; it changes no application source. Do not merge or retarget this native work into web `main`.

## Validation completed

The candidate workflow and latest exact-head Native Android and Brand Guard checks passed. The sealed candidate receipt records 128 JVM tests across 19 suites, 191 caption/text-entity checks, 63 integrity checks and 43 video-transport checks. The eight realtime and eight Room-invitation tests are included in the 128-test manifest.

This continuation independently verified the downloaded artifact:

- GitHub archive digest, CRC/path/duplicate-entry checks, and all six published SHA256 checksums.
- OpenSSL CMS signature, expected existing upload certificate, signed manifest digest and all 600 payload-entry digests.
- Absence of registration-proof and private-key files in the published payload.
- All eight native libraries across four ABIs have 16 KiB ELF LOAD alignment.
- Official checksum-pinned Google bundletool 1.18.3 validated the AAB and independently decoded its package, version, SDK and non-debuggable manifest.
- BundleConfig enables uncompressed native libraries and `PAGE_ALIGNMENT_16K`.
- Actual production lint XML contains 0 Error/Fatal, 129 Warnings and 2 other notices.

The current [Google Play target API requirement](https://support.google.com/googleplay/android-developer/answer/11926878?hl=en), checked on 21 October 2026, requires API 36 for phone app updates from 31 August 2026. This candidate targets API 36. Its lint `OldTargetApi` advisory does not mean that it misses that published submission threshold. Most other lint warnings are spelling, Kotlin convenience APIs, intent-filter structure and existing compatibility advisories; they are not reported as Error/Fatal.

Prior PR evidence reports 101 Samsung Android 15 instrumentation tests, real Home startup of 2.925–6.303 seconds (median 3.716), Story startup of 3.452–4.661 seconds, and eight advancing observation windows with zero buffering transitions. Those are **earlier recorded tests**. This continuation performed **no new physical Samsung, Play-installed, or 16 KiB device runtime test**. Variable startup latency remains a qualified observation.

## Backend dependency

Backend PR [#398](https://github.com/sautilink/sautilink/pull/398) was merged as `5a90518c0108b1c839f9a66dc3608e84c0e9f4f1`.

Production workflow [39636252694](https://github.com/sautilink/sautilink/actions/runs/39636252694) succeeded at 16:37:56 UTC / 19:37:56 EAT. Its verification job passed all 1,432 tests, the actual local Workers realtime-authorization gate, and the production Wrangler dry-run. That deployment's Worker version was `ec4c186e-88f0-4beb-8f61-747a775fbb24`, subsequently replaced by the PR #399 deployment below.

The post-deploy checks passed for health, realtime status, root/app/JavaScript/login/signup/Home/menu and www routes; signed-out protected account access remained HTTP 401. Indexing/privacy, Android App Links and PWA origin checks passed. The post-merge Brand Guard, Authentication and Android APK workflows also succeeded. No placement change or new physical Samsung performance result is claimed.

Live web QA subsequently reproduced a separate protected HLS fragment failure (`fragLoadError`, HTTP 401) after the media-session lifetime. The focused correction is [PR #399](https://github.com/sautilink/sautilink/pull/399), reviewed head `8159978a282ee5d4188939528c27b7466c2c6d8e`, merged as `c830d8d3863ccdf537129a6b414309fed9ef4848`. Exact-head CI passed all 1,447 tests, the production and auth gates, Android build, route checks, Brand Guard and Workers build. Independent review also verified the cookie/session isolation fix. The native application source and signed AAB are unchanged by this browser-only correction.

PR #399 production workflow [39640685141](https://github.com/sautilink/sautilink/actions/runs/39640685141) succeeded at 17:07:30 UTC / 20:07:30 EAT. Its production Worker version is `8a9ed96f-7df5-4e62-9831-a1863bb28f5e`. Health, realtime status, root/app/JavaScript/login/signup/Home/menu and www routes returned HTTP 200; signed-out account access remained HTTP 401 `AUTH_REQUIRED`. Public indexing/privacy, Android App Links and PWA manifest/origin checks passed. The post-deploy Phase 33 Operations run [39641054666](https://github.com/sautilink/sautilink/actions/runs/39641054666) also passed.

**Post-deploy browser playback observation: passed within the observed scope.** The deployed app HTML was independently observed with `video=20261021-stream-session1`. The same previously failing 27-second Home video was observed from 17:08:03 through 17:15:05 UTC (20:08:03–20:15:05 EAT), spanning more than seven minutes and the five-minute media-cookie lifetime. This included an intentional pause and successful resume; it is not a claim of seven uninterrupted minutes of playback. The visible managed HLS `blob:` player advanced across repeated observations, decoded both 360p and selected 240p frames, retained `readyState=4` and had no media error at the final observation. No new HLS fatal log appeared during this observation window. The quality preference was restored to Auto, with playback still advancing. This browser check is scoped production evidence, not a new native-device or Play-installed test.

## Google Play confirmation

Authenticated Console inspection on 21 October 2026 confirmed these existing releases for `com.sautilink.app`:

| Track | Release | Observed Google Play state |
| --- | --- | --- |
| Internal testing | `1.1.5 (50) - Stream and Stories - Internal` | Available to internal testers; Full roll-out |
| Closed testing - Alpha | `1.1.5 (50) - Stream and Stories - Alpha` | Available to testers on Google Play; Full roll-out; release details show 100% |

Both release-detail pages identify app bundle **50 (1.1.5)**, Android API **26+**, target SDK **36**, four ABIs and the Stream/Stories release notes below. The bundle explorer marks version 50 **Active**, reports **Supports 16 KB**, and lists 17,963 supported Android devices. These are Console compatibility results, not a new physical-device runtime test. Version 49 is listed as deactivated by these releases. Publishing overview reports **Last published on 21 October 2026** with managed publishing off.

The existing track audiences and settings were left unchanged. No new upload, track promotion, publication, credentials, permissions or Store configuration change was needed in this follow-up. The prior lack of authenticated access did not establish that the earlier release had failed; the now-visible availability confirms it had already been published.

**Binary provenance limit:** the separately retained candidate still has the independently verified AAB SHA256 recorded above. The Console's Original file download was requested, but the resulting browser download did not synchronize into the audit workspace. Its bytes could not be hashed here, so exact byte equivalence between that Play-hosted original and the retained candidate is not newly asserted. Version/package/SDK/ABI/release metadata match; the existing Google availability state is directly verified.

Public Production remains **Inactive**. At inspection, the Console showed 12 closed-test participants opted in continuously for two days, with its 14-day criterion still pending and Apply for production disabled. This follow-up completed verification of the authorized existing testing tracks; it did not apply for public Production access. No Play-installed Samsung test or new 16 KiB device runtime test was performed, and rollout availability is not evidence that testers have already installed the update.

Published en-GB release notes (observed unchanged on both tracks):

> Smoother video playback with automatic quality, updated progress controls and looping. New 24-hour Stories with photo filters, video trimming, reactions and viewer lists. Pull to refresh your Home feed and use New Posts to catch up. A cleaner feed for followed accounts, plus reliability and privacy improvements.

Do not upload version 50 again merely to repeat the interrupted flow. If native application source changes, build and verify a new candidate rather than reusing this signed artifact as proof for changed code.

## Retained release evidence

The original signed bundle and sealed receipts are in candidate workflow [39587274909](https://github.com/sautilink/sautilink/actions/runs/39587274909), artifact `SautiLink-Play-Release50-39587274909` (ID `12340874127`). The artifact contains `sautilink-production-clean.aab`, `clean-aab.json`, `source-and-signer.json`, `native-video-transport.json`, the existing upload certificate, and the production lint report. Use the archive and AAB SHA256 values recorded above to identify the exact bytes.

The downloaded bundle and independent binary, bundletool and post-merge source-identity receipts were retained for the authorized continuation. The original GitHub artifact is scheduled to expire on 28 October 2026 at 11:05:14 UTC; the verified AAB was also preserved separately under the versioned filename `SautiLink-1.1.5-50.aab`. Its identity remains the AAB SHA256 above.

