# Play Integrity monitoring

This integration records a small sample of Android integrity results. It does not
authorize, reject, delay, or change login, registration, posting, messages, uploads,
or any other app action. No application RLS policy reads the monitoring tables.
The Android caller runs independently of those actions.

## Deployment status and prerequisites

The repository defaults to **off**. Code being present is not evidence that Play
Integrity is linked, enabled, receiving verdicts, or enforcing a policy.

Before enabling the function:

1. Confirm the Google Play project link and the required Google terms acceptance.
2. Confirm Google Cloud project `sautilink`, project number `93555813548`, has the
   Play Integrity API available and the server identity can decode its tokens.
3. Configure the SHA-256 digest of the Google Play **app signing** certificate.
   The AAB upload certificate is a different identity and must not be used.
4. Apply and verify the monitoring schema and its retention job.
5. Deploy `sautilink-play-integrity` with platform `verify_jwt=true` and all four
   TypeScript files in its directory.
6. Enable monitor mode only after the above checks and review of the privacy and
   Play Data safety disclosures. Publish an Android release containing the client
   integration, then verify a real Google Play installation during testing.

There are no new client secrets. `deploy-config.ts` contains only public project
and certificate information. Its default mode is off. Environment configuration:

| Name | Purpose |
| --- | --- |
| `PLAY_INTEGRITY_MODE` | `monitor` enables sampling; absent, `off`, or any other value disables it. No enforcement mode exists. |
| `PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER` | Optional override, which must match the verified project number above. |
| `PLAY_INTEGRITY_ALLOWED_CERTIFICATE_SHA256` | Comma-separated app signing SHA-256 digests, hex/colon-hex or base64url; public defaults may also be verified in `deploy-config.ts`. |
| `PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON_BASE64` | Optional dedicated server credential, read only in the Edge Function. |
| `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64` | Existing server credential is used in place only when no dedicated credential is supplied and its project and service-account email both match `sautilink`. |

The normal Supabase server URL and server key come from the deployment environment.
Never put service-account JSON, a private key, access tokens, session JWTs, or
encrypted integrity tokens in source, a client configuration, logs, or this guide.
Do not broaden the existing Firebase identity's permissions as a routine fallback;
verify its actual ability to decode after the project link is accepted.

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

## Official references

- [Google: Standard requests and server-side token decoding](https://developer.android.com/google/play/integrity/standard)
- [Google: Integrity verdict fields](https://developer.android.com/google/play/integrity/verdicts)
- [Supabase: Edge Function authorization headers](https://supabase.com/docs/guides/functions/auth-headers)
- [Supabase: Auth sessions and session revocation checks](https://supabase.com/docs/guides/auth/sessions)
- [Supabase: Row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security)
