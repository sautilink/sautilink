# Play candidate and package-review handoff

**Final status, 17 October 2026 (EAT): CI/artifact gates PASS; package SUBMITTED / IN REVIEW. Google approval remains pending.** CI completed 16 October (UTC). This receipt grants no release approval.

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
