# Legacy Stream duration repair, 21 October 2026

This is a bounded data correction for seven attached, published, visible legacy videos. The existing MP4 parser recorded only 111–241 ms for them. `ffprobe` of the exact private R2 sources measured 21.757–30.348 seconds. The Stream importer correctly deleted these seven provider copies because the original duration metadata permitted only two seconds; 43 other eligible library videos are ready. Five moderated videos remain excluded.

The reviewed manifest is `scripts/repair-data/legacy-stream-duration-20261021.json`. Corrected durations round the maximum measured format/stream duration **up** to milliseconds. Every record pins its owner, attached post, source ETag, size, dimensions, original finalization timestamp and deleted import generation. The source files and diagnostic downloads stay outside Git.

## Database step

1. Read fresh R2 source heads for all seven. `assertLegacyRepairSource` requires the exact manifest ETag/byte size and validated owner/media custom metadata. Stop on any mismatch.
2. Print the reviewable SQL with `node scripts/repair-legacy-stream-duration.mjs --sql`. Apply it once through the privileged operator database channel. This is a data-only repair, not a new schema migration or callable function.
3. The atomic `DO` block locks each target media/post/profile row, verifies the exact identity and old metadata plus current published/visible/discoverable/account eligibility, and changes **only** `duration_ms`. A mismatch on any row aborts all seven. Repeating it after success is harmless because the exact corrected duration is also accepted.
4. Print `--verification-sql` and read back the seven rows. No policy, grant, moderation, owner, source key or original publication field changes.

## R2 recovery step

Import `resetLegacyStreamJob` from the operator module. Supply a real R2 binding or authenticated binding proxy, a privileged **read-only** database callback returning the fresh verification projection, and a provider callback that returns `true` only after a fresh, unambiguous provider not-found result for the deleted UID. Authentication failures, timeouts and provider 5xx must return false or throw.

For each allowlisted ID, the executor reads the live job, provider state, corrected database row, source head and capacity ledger. It refuses to proceed unless the original pinned generation is terminal `deleted`, `provider_deleted=true`, the source still matches, the original faulty metadata/2-second limit remains on that terminal job, and **all** capacity reservations for that media ID have been released. It then conditionally replaces that exact job ETag using R2 `put(..., {onlyIf:{etagMatches}})` with a fresh generation in `reserved` state and the corrected duration. The new record carries the repair ID and prior generation for audit. It retains no provider UID, old upload URL or deletion flag.

The normal private backfill/importer creates and reserves the new provider object; the repair does not upload, delete, purchase capacity or modify the storage ledger. It adds no Worker route and does not weaken terminal-state behavior for other jobs. A second reset of the new generation is rejected.

Do not use unconditional `wrangler r2 object put/delete` as a substitute for the ETag comparison. If a write times out or reports a conflict, inspect the current record before any further action. Never replay an uncertain provider import. After normal cron reconciliation, confirm all 50 eligible published videos are ready and the five moderated IDs still have no import job. Confirm the new generation's reservation and source identity, then test representative old-video HLS playback through the existing authenticated app/web routes.

## Local verification

`node --test tests/legacy-stream-duration-repair.test.mjs`

Tests execute the SQL on actual PostgreSQL via PGlite, cover all-seven rollback and idempotent rerun, changed identities/metadata/eligibility, moderated/missing rows, source replacement, provider uncertainty, capacity reservations, stale generations and conditional-write conflict. No live writes occur in these tests.
