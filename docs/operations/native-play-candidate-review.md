# Play candidate and package-review handoff

**Current status, 17 October 2026 (EAT): release 42 / version 1.0.0 signed AAB and full production lint PASS; downloaded artifact independently verified.** The latest recorded Console observation shows the package **Registered** and its existing certificate **Verified**. Play app creation, testing-track upload and public release have not been performed in this continuation.

## Release 42 — continuation after the Codex usage-limit checkpoint

This section supersedes older pending build/lint and version-41 candidate instructions below. The user asked to continue from a screenshot stating that compilation/assembly and a Store Listing draft were complete, while full production lint and downloaded-AAB verification remained pending.

| Item | Verified release 42 checkpoint |
| --- | --- |
| Native working branch | `design/native-ios-foundation-20261012`, Draft PR #352, stacked on Draft PR #351 |
| Automation commit | `66d74253bd11d396511cacab038ac7f84aae77e7` |
| Pinned build source | `43fd28fee5ecb7efd62a0f17fc5e702db2015a42` |
| App source tree | `989d2bb52155abf6dad400231f22e82805713616` |
| Successful production CI | [Run 38984055928](https://github.com/sautilink/sautilink/actions/runs/38984055928), job `117251280001` |
| CI completed | `2026-10-17T00:16:08Z` / 03:16:08 EAT |
| Downloaded artifact | `12083285602` / `SautiLink-Play-Release42-38984055928`, exactly six allowlisted files |
| Archive size / SHA256 | 20,590,818 bytes / `b25a63fb0b47d69cffb25f2c6476bf384c94f3bc3a8eeec4eebf307609c6e3b7` |
| AAB | `sautilink-production-clean.aab`, 20,831,568 bytes |
| AAB SHA256 | `e136e023421b5c36defb869b360faf40d3a50ec8ad7c48739a7e2dd20daf0e15` |
| Identity | `com.sautilink.app`, versionCode **42**, versionName **1.0.0**, minSdk **26**, targetSdk **36**, nondebuggable |
| Full production lint | **0 Error/Fatal, 109 Warnings, 2 Hints** |
| Existing upload certificate SHA256 | `31c773a7229a563d92f7047a56735ad7b02027d27a6e020d8923dd5418f4b50f` |

Independent local verification completed at `2026-10-17T00:22:14Z`: downloaded ZIP SHA256 matched GitHub's artifact digest; all five entries in `SHA256SUMS` matched; archive paths, duplicate-entry checks and CRC passed. OpenSSL verified the CMS signature, the signer matched the expected existing certificate and was valid at verification time, the signed signature-file digest covered the full JAR manifest, and all **575 payload-entry SHA256 digests** matched. This independently verifies the payload signatures without reading a private signing key.

Official Google bundletool **1.18.3**, downloaded from its upstream release and pinned to SHA256 `a099cfa1543f55593bc2ed16a70a7c67fe54b1747bb7301f37fdfd6d91028e29`, independently validated the downloaded AAB and decoded its production manifest/config successfully. This is a local rerun, not merely repetition of the CI receipt.

Static 16 KB packaging checks also passed: all eight native `.so` files across four ABIs have correctly aligned ELF LOAD segments; the manifest has `extractNativeLibs=false`; and BundleConfig enables uncompressed native libraries with `PAGE_ALIGNMENT_16K`. These static checks do **not** claim a 16 KB device/emulator runtime test or Google-generated APK validation. No registration-proof asset exists in this AAB; the exact archive contains the AAB, public certificate, two JSON receipts, full lint XML and `SHA256SUMS`.

The [comparison from Samsung-tested d7b4ef3 to pinned release source 43fd28f](https://github.com/sautilink/sautilink/compare/d7b4ef3fc64b6caa1f5407fe3d9547ffaeff3579...43fd28fee5ecb7efd62a0f17fc5e702db2015a42) changes only two review documents and the version fields in `native-android/app/build.gradle.kts`. No `app/src` changes separate that bounded Samsung QA evidence from release 42. The four other CI runs on automation commit `66d7425` (Native Android preview, Android APK, Phase 1 Authentication and Brand Guard) were successful when checked.

### Remaining release work

- Preserve/use **version 1.0.0 (42)** above. The older version-41 candidate below predates the later video fixes.
- The screenshot's previous Store Listing draft was not located in the repository or current accessible saved files. A fresh English/Kiswahili review draft was reconstructed from verified native features and provided with the release files; it is not represented as the recovered original. Actual approved store graphics/screenshots and Console declarations remain pending.
- Complete actual Play app setup, listing assets/declarations and the appropriate test-track flow. The registered package/certificate alone does not establish that an app listing or testing release exists.
- Validate Google-generated installation behavior, Play signing/API/App Links/FCM behavior, and remaining final QA including a 16 KB runtime test as applicable. The historical HTTP 500 remains unattributed; the latest bounded Samsung video results are recorded in `native-video-transport-review.md` and are not a blanket final-QA pass.
- This continuation changes the handoff record only. Both stacked PRs remain draft/unmerged; no signing key rotation, backend deployment, Play upload, public publication or new phone test was performed.

## Historical version-41 package-review receipt (superseded where noted)

**Historical status at the first 17 October checkpoint: CI/artifact gates PASS; package SUBMITTED / IN REVIEW.** The later registered/verified package result and release-42 receipt above supersede that state. This historical receipt grants no release approval.

## Exact checkpoint

| Item | Actual checkpoint |
| --- | --- |
| Native app source | `688dffe0b8da459a54a072522c833df1ff270009` |
| Pinned app/src tree | `f7de64a83b140ffec5010a8b94e8974efb56d095` |
| Original automation commit | `e150cdeecee9756a77f73494c50231a2004a29b9` |
| Corrected automation commit | `8bdc0a3ace6faee3568ec51ec60f1a164147bb7c` |
| Successful CI | Run **38948584644**, job **117133909054** |
| Google Console | **SautiLink — In review**, package `com.sautilink.app`; certificate row also **In review** |

Owner approval covered the reviewed CI patch, `ANDROID_DEVELOPER_REGISTRATION_ID`, the downloadable public proof artifact and Google package verification only. The secret's existence was confirmed; its value/standalone hash is not reproduced. Existing keys/Firebase inputs were reused. No app source, version, existing native/main-release workflow or signing key changed.

Console account: **SautiLink Corporation, Personal**. This is a package-review entry, **not a created Play app or release**. Expected existing certificate SHA256:

`31:C7:73:A7:22:9A:56:3D:92:F7:04:7A:56:73:5A:D7:B0:20:27:D2:7A:6E:02:0D:89:23:DD:54:18:F4:B5:0F`

## CI chronology

| Run/gate | Actual result |
| --- | --- |
| First run 38944810950 / job 117121137021 | **FAIL** final proof verifier, 1.29s; exact failed assertion not logged |
| First-run partial gates | AAB/full lint **PASS 18m30s**; AAB seal **PASS 4s**; proof assembly **PASS 4m31s**; transient cleanup **PASS**; **zero published artifacts** |
| Corrected run 38948584644 | **SUCCESS**; AAB/full lint **PASS 10m27s**; AAB seal **PASS**; proof assembly **PASS 2m29s**; final proof seal and cleanup **PASS** |

Actual SDK 35/36 output reproduced a verifier incompatibility: `aapt2` emits `minSdkVersion:'26'`, while the original helper expected legacy `aapt`'s `sdkVersion:'26'`. The minimal correction retained the required SDK and all artifact gates; **14 focused checks PASS**, independent review **GO**. Fingerprint CRLF handling was also corrected, but that Windows finding is not established as the Linux CI failure. The exact first failed assertion was not retrospectively recovered.

Approved original patch SHA256: `1352f587c92ddf7cad09ef077b5f28aeff9a97b1f222bdb08efefd2baa4a8d23`.
Reviewed correction SHA256: `a9400e7a220f896f1ae491900d2aa0975a3d0f3d79075d94153f31b46bf1a50e`.

## Verified artifact receipt

Artifact **12068870658**, archive **41,029,204 bytes**, expires **2026-10-23T18:49:28Z**.
Archive SHA256: `d37e9c1feefacd65a76a35e51770351d03e07821f1d6ce8073ec6f5f6225a5f4`.

Downloaded directory: `outputs/Play-candidate-688dffe-38948584644`. Exact eight-file allowlist and all seven published checksum entries matched. Independent result: **PASS_SIGNED_ARTIFACT_GATES_ONLY**.

| Artifact | Verified result |
| --- | --- |
| `sautilink-production-clean.aab` | **20,810,846 bytes**; all **575 payload entries** signed by expected certificate; registration asset absent |
| AAB SHA256 | `bd322a1f129d1e941e236d2dce6a99700c03409f9ddbb7abb45f0ed29fb2db55` |
| `sautilink-registration-proof-only.apk` | **21,710,840 bytes**; expected certificate; exact private registration input matched without value/hash disclosure |
| Proof APK SHA256 | `34ffd53482eeb6b026c65a61fbbde4730b35c4014bdcc3577bfa119e45d5cde0` |

Package/version: `com.sautilink.app`, code **41**, name `0.9.0-native-performance`, minSdk **26**, targetSdk **36**, nondebuggable. Full lint: **0 errors / 109 warnings / 2 informational**. Bundletool validation is the CI receipt, not a separate local rerun. Private-file checks cover the exact allowlist and archive basenames, not arbitrary opaque-byte analysis.

The clean AAB was sealed before adding the ephemeral registration asset. The proof APK is **challenge-only**, not for installation/distribution. Its extractable identifier and seven-day public artifact exposure were specifically approved. Both CI attempts completed transient-input cleanup.

## Google outcome and stopping point

First upload: **“Couldn’t upload” before Submit**. After refreshing the same Console, retry reached **One file uploaded**. Root selected Submit, received Google's notice that review may take **up to 48 hours** with email notification, then completed the final Submit. Latest Console heading and certificate status: **In review**.

**Submission is complete; registration/verification is not approved yet.** Google's external decision remains pending. No Play app creation, testing-track upload or public publication occurred. Stop here at CI plus package submission.

After verified downloads, this cleanup checkpoint removes **only** `.github/workflows/native-play-candidate.yml`; both `.github/scripts/play-candidate/{candidate.py,VerifyPlayBundle.java}` helpers remain. The completed one-shot workflow is retired with this review document. No secret/public-artifact retirement is claimed. Temporary local download-URL and identifier inputs were removed after verification/submission. USB unplugging was authorized; this candidate work performed no phone installation/control.

## Retained limits

- Earlier video delivery **HTTP500/timeouts remain OPEN**; no blanket Full Final QA or playback/network PASS.
- These are signed-artifact checks, not Google approval, a device 16KB runtime test, Play-installed behavior or final Play signing/API/App Links proof.
- Store listing/content/privacy/deletion declarations and applicable Personal-account release eligibility still need their own accurate completion.
- PR #352 remains unmerged. No backend deployment, Play release, key rotation or broader production rollout occurred in this block.

## Durable evidence

- CI history: `outputs/Play-candidate-e150cde-rollout.json`, `outputs/Play-candidate-8bdc0a3-rollout.json`.
- Reproduction/correction: `outputs/Play-candidate-seal-proof-local-sdk-repro-20261016.json`, `work/proposals/play-candidate-seal-proof-fix/verification.json`.
- Independent download check: `outputs/Play-candidate-688dffe-downloaded-verification-20261016T185113492092Z.json`.
- Console captures: `outputs/Play-proof-upload-failed-20261017.jpg`, `outputs/Play-proof-uploaded-before-submit-20261017.jpg`, `outputs/Play-package-in-review-20261017.jpg`.
- Existing bounded native QA: `outputs/Native-actions-688dffe-independent-gate-audit.json`, `outputs/Native-actions-Samsung-20261016.json`, `outputs/Native-entities-Samsung-20261016.json`.

**Remaining external gate:** Google's package review decision. Play app creation/testing-track upload and public release remain separate. Original proposal files keep their historical not-applied status; this receipt records the subsequent authorized actions.


## Google package verification result — 17 October

Read-only Play Console inspection now shows **SautiLink / Registered / com.sautilink.app** and the existing certificate **Verified**. This supersedes the historical In review state above. No Play app was created, and no testing-track upload or publication occurred. The previously signed 688 runtime AAB does not contain the later video fixes; a new tested release candidate is still needed. Screenshot: `outputs/Play-package-registered-verified-20261017.png`.
