# Play Integrity monitoring

This integration records a small sample of Android integrity results. It does not
authorize, reject, delay, or change login, registration, posting, messages, uploads,
or any other app action. No application RLS policy reads the monitoring tables.
The Android caller runs independently of those actions.

## Deployment status and prerequisites

The repository defaults to **monitor mode** when its required configuration is
valid. Code being present does not establish deployment status or a successful
live verdict. No enforcement mode exists.

Deployment and activation sequence:

1. Confirm the Google Play project link and the required Google terms acceptance.
2. Confirm Google Cloud project `sautilink`, project number `93555813548`, has the
   Play Integrity API available. Configure a server identity in that project;
   the first real device sample must verify its OAuth and decoding capability.
3. Configure the SHA-256 digest of the Google Play **app signing** certificate.
   The AAB upload certificate is a different identity and must not be used.
4. Apply and verify the monitoring schema and its retention job.
5. Deploy `sautilink-play-integrity` with platform `verify_jwt=true` and all four
   TypeScript files in its directory.
6. Enable monitor mode after the configuration, schema and disclosure steps.
   Publish an Android testing release containing the client integration, then
   verify a real Google Play installation. Configuration readiness alone is not
   evidence of successful Google decoding or a valid device verdict.

There are no new client secrets. `deploy-config.ts` contains only public project
and certificate information. Its default mode is monitor. Environment configuration:

| Name | Purpose |
| --- | --- |
| `PLAY_INTEGRITY_MODE` | `monitor`, absent, or blank uses monitor mode when required configuration is valid; `off` or any other nonempty value disables sampling. No enforcement mode exists. |
| `PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER` | Optional override, which must match the verified project number above. |
| `PLAY_INTEGRITY_ALLOWED_CERTIFICATE_SHA256` | Comma-separated app signing SHA-256 digests, hex/colon-hex or base64url; public defaults may also be verified in `deploy-config.ts`. |
| `PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON_BASE64` | Optional dedicated server credential, read only in the Edge Function. |
| `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64` | Existing server credential is used in place only when no dedicated credential is supplied and its project and service-account email both match `sautilink`. |

The normal Supabase server URL and server key come from the deployment environment.
Never put service-account JSON, a private key, access tokens, session JWTs, or
encrypted integrity tokens in source, a client configuration, logs, or this guide.
Do not broaden the existing Firebase identity's permissions as a routine fallback;
verify its actual ability to decode through the first real testing sample after
the project link is accepted.

## Client contract

Both calls require `Authorization: Bearer <the current user's Supabase access JWT>`
and `Content-Type: application/json`. Account identity and session identity are
derived from that token and verified with Supabase Auth; the request cannot choose
an account. Requests with extra fields are rejected.

```json
{"action":"challenge","version_code":44}
```

An enabled, eligible request returns:

```json
{
  "mode": "monitor",
  "status": "ready",
  "challenge_id": "server-generated-uuid",
  "request_hash": "opaque-43-character-base64url-digest",
  "cloud_project_number": "93555813548",
  "expires_at_ms": 1792367400000,
  "retry_after_seconds": 21600
}
```

The Android Standard Integrity request passes that `request_hash` unchanged to
Google. The encrypted token is submitted once:

```json
{"action":"observe","challenge_id":"server-generated-uuid","integrity_token":"encrypted-token"}
```

A stored observation returns `mode=monitor`, `status=recorded`, and
`retry_after_seconds=21600`. **Recorded means the monitoring result was stored**;
the result can be a normal verdict, a binding failure, a rejected token, or an
unavailable Google service. It is not a statement that the device passed.

Disabled or incomplete configuration returns `status=unavailable` with a one-hour
retry interval after authentication. Authentication, invalid inputs, expired or
consumed challenges, and rate limits use HTTP 401, 400, 409, and 429 respectively.
Every result remains irrelevant to whether the user's ordinary app action works.
The client must not sign the user out, refresh/alter sessions, show an access
warning, or gate the UI in response to this background request.

## Request verification

The database generates a unique challenge for a real, non-anonymous, non-banned
Supabase user and an owned session that still exists and is not expired. It stores
only one state row per user. The server computes SHA-256 over a fixed serialization
of a protocol label, package, user ID, session ID, challenge ID, and app version.
Only this opaque digest reaches Google; the identifiers are not sent in plaintext.

Before Google is called, the database locks and atomically consumes the matching
user/session challenge. Replays and concurrent attempts cannot decode it again.
The server requests an OAuth token using a fixed Google endpoint and only the
`playintegrity` scope, then calls the fixed `com.sautilink.app:decodeIntegrityToken`
endpoint. No client-supplied URL or credentials affect these destinations.

The decoded request must match the package and digest. Its timestamp must be
within the challenge's five-minute lifetime and cannot be more than 30 seconds
ahead of the server clock or more than 30 seconds before issuance. Late processing
has the same 30-second tolerance. Only after those checks does the server retain
allowlisted primary app, license, and device labels, plus independent certificate
and version match flags. Missing/unknown values remain `UNEVALUATED` or empty.
The latest result is not an authorization cache for future requests.

## Storage, limits, and retention

`play_integrity_private` is not added to the Data API's exposed schemas. Both
tables enable and force RLS and grant no direct access to `anon` or `authenticated`.
Public challenge/consume functions are security-invoker wrappers around narrowly
scoped private helpers that check `auth.uid()` and the current session. The result
RPC is security-invoker and executable only by `service_role`.

The server limits issues to one per ten minutes, twelve per user per UTC day, and
8,000 across the application per UTC day. The global counter is one locked row,
and each user has at most one state row. Counters reset daily. These are controls
on monitoring calls, not restrictions on use of SautiLink.

The latest summary contains only outcome, app recognition, certificate/version
match flags, app version, licensing, and allowlisted device recognition labels.
No encrypted token, full decoded response, credential, email, IP, content,
hardware identifier, app-access-risk details, or device-recall data is retained.

Latest summaries expire after 30 days. A daily cleanup clears old summaries and
deletes inactive rows, so physical removal occurs within 31 days. Deleting the
Supabase account immediately cascades to its state row. This remains
account-linked security data and must be described accurately in the product's
privacy disclosures. Monitor mode does not mean data is anonymous or ephemeral.

## Verification

Run the executable backend behavior checks with Node 22.18+ or Node 24:

```sh
node tests/play-integrity-monitor.test.mjs
```

The direct command above is also suitable for CI. When using Node 24's `--test`
runner, explicitly disable process isolation to enumerate the individual checks:

```sh
node --test --test-isolation=none --test-reporter=tap tests/play-integrity-monitor.test.mjs
```

Both commands were verified to run **23 named tests** on Node 24.19.0. Confirm
that the output reports those 23 cases. In that local environment, plain
`node --test` reported only a single file-level test, which is not evidence of
the individual case results.

The tests exercise the actual TypeScript modules, including real ephemeral RS256
signing/verification with mocked HTTP, account/session/hash binding, package and
timestamp failures, certificate/version mismatches, missing verdicts, request
limits, disabled configuration, replay handling, and removal of unknown data.
They make no real calls to Google or Supabase.

Run `supabase/tests/play_integrity_monitor.sql` in a disposable database after
applying the migration. It checks ACLs, RLS, live-session ownership, replay/expiry,
per-user and global limits, daily resets, allowed summary fields, delayed results,
retention, and account deletion using synthetic fixtures, then rolls back.
Execution of this file and a real device verdict are separate validation steps;
the JavaScript tests do not establish either result.

## Initial preparation record — 19 October 2026

The initial Android source is commit
`f82cfe1b3c5ed4e376a3ed125007fb599acaf042`, with app source tree
`8de6734a0e62879f7207749a02f396151ed16666`. The signed candidate workflow is
[run 39191409362](https://github.com/sautilink/sautilink/actions/runs/39191409362),
triggered by automation commit `e2781b43aab7806f293c8133143bda3ad3e9ef7a`.
Its backend gate passed all 23 behavior cases, Deno 2.9.6 type checking, the
complete migration on PostgreSQL 17.11 with pg_cron, role-sensitive SQL checks,
and a real two-connection consume race with observed lock contention.

The complete candidate workflow succeeded. Preview Kotlin compilation, the
signed production AAB build, all 191 caption checks, all 63 integrity/auth checks,
and production lint passed. Lint reports zero fatal/errors, 111 warnings and two
hints. The one added warning compared with release 43 suggests the optional KTX
`SharedPreferences.edit` convenience function; it is not a failed correctness
or security check.

The downloaded artifact was independently checked against GitHub's ZIP SHA-256,
its five published file checksums, its exact file allowlist, the upload signing
certificate, all 577 signed bundle payload entries, and the actual manifest
decoded with the pinned official bundletool. The verified candidate is
`SautiLink-1.0.2-44.aab`, package `com.sautilink.app`, version 44, min SDK 26,
target SDK 36, non-debuggable, 20,872,339 bytes, SHA-256
`ea395e54a68bd84b7664567ef2a8b05bd9f1d39b0dd15011a86fa2765cb95c7d`.
This exact AAB was retained and subsequently uploaded for testing as recorded
below. The machine-readable checks are in
`play-integrity-release44-verification.json` beside this document.

The production migration was applied as server-recorded version
`20261019024713_play_integrity_monitor.sql`. The local migration was originally
created by the Supabase CLI as `20261019023255_play_integrity_monitor.sql`; its
filename was aligned to the actual remote migration record after deployment.
The SQL content is identical. The original candidate source retains the original
filename so that its immutable build and CI remain reproducible.

Production Edge Function `sautilink-play-integrity` version 1 was deployed with
`verify_jwt=true` and the reviewed four files. Its public default mode is **off**;
no monitor-mode override, new credentials, or IAM permissions were configured.
Readback matched all four source files. An unauthenticated request returned HTTP
401, as did a request supplying only the public API key without a user JWT.
Production read-only checks confirmed both tables force RLS, ordinary
users cannot read either table, only the server can execute the recording RPC,
the cleanup job is active, and there are no observations or issued challenges.

Post-deployment advisors introduced no warning or error. The informational
findings are expected: the two private tables have RLS with no user policy
(access is intentionally denied), and the new cleanup index has no usage yet.
Existing project-wide warnings were not changed by this integration. See the
[RLS advisory](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
and [unused-index advisory](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index)
for their definitions.

The initial deployment remained off while the Google Cloud project link and
terms acceptance awaited the user's approval. The subsequent activation is
recorded below. A successful live Google OAuth/decode request and real-device
verdict still require the first testing sample.

### Data safety update

The existing Play Console declaration was inspected before editing. User IDs
were already collected, required, non-ephemeral, and used for fraud prevention,
security and compliance. Device or other IDs had the same collection and
retention answers but only the app-functionality purpose. A draft was saved
adding **Fraud prevention, security and compliance** to Device or other IDs.
After the approved project link, the saved questionnaire was submitted through
Publishing overview on 19 October. The Console then showed Changes in review.
Submission 3 subsequently showed **Published** at 06:28 East Africa Time on
19 October. Its details identify the sole change as the Data safety questionnaire.

No extra Diagnostics, Crash logs, Other app performance data, or Installed apps
declaration was added for this feature. This is a code-based mapping: the
integration keeps security outcomes and bounded security counters, not client
crashes, performance traces, or latency measurements. Reassess the mapping if
those practices change. Existing unrelated declarations remain subject to their
own review.

### Published privacy wording

The following addition was published through focused privacy-only
[PR 360](https://github.com/sautilink/sautilink/pull/360), based on the current
`main` policy with a minimum age of 16. Merge commit
`64c386c1bc1cda3e5de3cc754ea752dcaee2c4db` passed the brand check and the existing
Cloudflare `Workers Builds: sautilink` deployment. Worker version
`e1d3d79c-6983-4b8f-94ae-a1064aae6694` serves the updated policy, effective
19 October 2026. The live page's new text, retention wording and 16+ minimum
were verified. This development branch's older privacy page was not published.

**Android app integrity**

Our Android app uses Google Play Integrity to assess app authenticity, Google
Play licensing and device security. Google processes app metadata, licensing
and device-attestation information for these checks. We send a hashed request
reference and receive security results, which we associate with your SautiLink
account. We retain the latest result and limited security counters to monitor
abuse and improve protection. Google's handling of information for these checks
is described in its
[Play Integrity data-safety information](https://developer.android.com/google/play/integrity/terms#data-safety).

The retention section also states:

We replace the account-linked integrity result when a newer check completes.
Results expire after 30 days and are removed by daily cleanup within 31 days;
short-lived counters limit how often checks run. Account-linked integrity
records are removed when the account is deleted.

## Activation and testing release — 19 October 2026

The user approved Google Play Integrity terms acceptance at the linking step.
Play Console confirms SautiLink project `93555813548` is linked, with a displayed
daily usage limit of 10,000. App licensing, application integrity and device
integrity responses are on. Optional recent-device activity, device attributes,
Play Protect environment signals and app-access-risk responses remain off.
Linking automatically enables the API according to Google's setup guidance.

Backend activation source is commit
`daf3814552586294f6425b7b00c6b08134e37cc9`. The existing configuration test now
checks the enabled default, exact public Play signing certificate, explicit
disabling overrides and unavailable behavior for invalid or missing credentials.
All 23 backend cases and Deno type checking passed. The activation commit's
backend CI checks also succeeded.

Production Edge Function version 2 is active with `verify_jwt=true` and the
monitor default enabled. All four deployed files matched the reviewed source.
A fresh request without a user JWT returned HTTP 401. No environment override,
new credential or IAM permission was created. Existing credentials remain in
their server environment and are used only through the reviewed runtime path.

The first aggregate-only production check after activation found zero state
rows and zero retained summaries. At 03:39:27 UTC, a later aggregate found one
state row, zero retained summaries and zero observed verdicts. A state row by
itself does not establish a completed Google check. Runtime credential validity,
Google OAuth, decoding and request binding are not established by deployment
readback. A
fresh `last_summary.outcome = 'observed'` from an ordinary signed-in release 44
installation is required for that live verification. A `recorded` response
alone is insufficient because failure outcomes can also be recorded.

Play Console accepted the verified AAB as version `44 (1.0.2)`, API 26+, target
SDK 36, with no loss of supported devices. Internal release 3,
`1.0.2 (44) - Internal testing`, became **Available to internal testers** at
06:34 East Africa Time. The same uploaded bundle is used for the Closed Alpha
release; it did not require a second binary upload. Closed release 3,
`1.0.2 (44) - Closed testing`, was submitted for a full rollout to the Alpha
testing group at 06:38 East Africa Time. Submission 4 is **In review** at the
final Console inspection. This is not a production release or production access.

Console reported two non-blocking warnings for version 44: no deobfuscation
file and no native debug symbols. These limit crash/ANR diagnosis and remain
follow-up build work; the Console permitted this testing release.

### Store category investigation

The user reported seeing "Libraries & Demo" on the Play Store. A direct Console
inspection found **App**, category **Social**, and the tags Communication,
Lifestyle and Social. The default listing is live, its app name is **SautiLink**,
and its description covers posts, short videos, Rooms and direct messages.

Submission 1 explicitly records "Select app category (Social app)" and a
**Published** timestamp of 18 October 2026 at 17:32 East Africa Time. The category
is therefore already published as Social; no category mutation was made during
this investigation. Google documents that category changes can take up to
24 hours to appear on the Play Store page. Propagation or an older testing
listing is a possible explanation for the reported label, not an observed cause.
The exact Play Store screen reported by the user was not available to verify.

## Official references

- [Google: Standard requests and server-side token decoding](https://developer.android.com/google/play/integrity/standard)
- [Google: Integrity verdict fields](https://developer.android.com/google/play/integrity/verdicts)
- [Google: Choose a category and tags](https://support.google.com/googleplay/android-developer/answer/9859673?hl=en)
- [Supabase: Edge Function authorization headers](https://supabase.com/docs/guides/functions/auth-headers)
- [Supabase: Auth sessions and session revocation checks](https://supabase.com/docs/guides/auth/sessions)
- [Supabase: Row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security)
