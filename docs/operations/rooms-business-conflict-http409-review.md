# Rooms business conflict SQLSTATE correction

Status: **owner-approved exact migration APPLIED at 05:21 UTC on 16 October; six-function readback and bounded known-process drain verified.** Actual Samsung 501 stale-save returned HTTP409 with retained edits. The separately approved conditional recovery was **not executed**: all five known backends were absent at the drain check. Root performed the hosted application and device testing; this patch author performed neither. General Auth/network stability remains OPEN.

## Reason and exact scope

Controlled Samsung stale-settings requests timed out after about ten seconds. Read-only production diagnostics observed repeated active `room_update_management` transactions. [Supabase's troubleshooting article](https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b) documents that custom SQLSTATE `40001` exceptions cause transaction retries in PostgREST14; it recommends a normal exception or a `PT` HTTP code. The article says the retry bug is fixed in PostgREST16. A bounded strict-format application-name projection at `02:39:51 UTC` confirmed `PostgREST 14.5` on all five observed backends; evidence is workspace `outputs/Rooms-business-conflict-known-process-guard-baseline-20261016.json`.

[Migration](../../supabase/migrations/20261016022505_rooms_business_conflicts_http409.sql) changes **eleven explicit business exception codes from `40001` to `PT409` in six existing functions**:

| Function | Changed raises |
| --- | ---: |
| `public.room_decide_post_submission(uuid,uuid,uuid,integer,text,text)` | 2 |
| `public.room_withdraw_post_submission(uuid,uuid,uuid,integer)` | 2 |
| `public.room_update_management(uuid,integer,uuid,jsonb,jsonb)` | 1 |
| `private.enforce_room_membership_questions()` | 1 |
| `public.room_submit_membership_request(uuid,integer,uuid,jsonb,text)` | 4 |
| `public.room_set_post_pin(uuid,uuid,boolean,uuid)` | 1 |

The private trigger is included because both membership inserts and join-request inserts can reach its business conflict. Exception messages, arguments, return types, authorization checks, locking, idempotency and all other logic are preserved. Existing Worker code maps the preserved business messages to HTTP409. Native conflict handling already expects that HTTP response.

All six baseline bodies are guarded by normalized body MD5 before any replacement. The migration uses `CREATE OR REPLACE`, preserving function identities, owners, ACLs, security mode and empty `search_path`. It changes no rows, settings, tables, policies, triggers, backend routes or client code. Earlier deployed migrations remain unchanged. LF normalization accounts for the cached Windows fixture's line endings.

## Exact review artifacts

- Migration SHA256: `07AD281FD659721091758CA879FAE2F6B11460B38F756581527305E734926C31`.
- [Guarded rollback draft](sql-drafts/rooms-business-conflicts-http409-rollback.sql) SHA256: `D10663C1E9C017E8D682968EDDF3C38B2E192F5AD73933B087EC6E83C611788A`.
- Local pre-patch `pg_get_functiondef` backup SHA256: `B46351D164E0C857CF82406DC76C74D5139FBE7E644180B3EB19C5E273CB45A8`.
- Independent production read-only baseline review: workspace evidence `outputs/Rooms-business-conflict-production-baseline-review-20261016.json`; all six normalized production bodies matched this draft's preflight guards. This is not a claim that the author captured a new production backup.
- Actual production catalog backup: workspace `outputs/Rooms-business-conflict-functions-backup-before-20261016.json`, captured at `2026-10-16T02:32:13.844898Z`, SHA256 `C64CF2C2BC3D8377AD5996676292B807243580D797D231A6A81F28C6493E2CBE`. It contains exactly six definitions plus owner/ACL/config/security/signature metadata.
- Bounded production logs for `02:20–02:24 UTC`: 19,805 exact `ROOM_MANAGEMENT_VERSION_CONFLICT` / `40001` errors across five PIDs, each referencing `room_update_management`. Evidence: workspace `outputs/Rooms-config-postgres-retry-counts-20261016.json`. This proves the retry pathology; parameterized statements do not expose an individual Room or actor, so they are not claimed as separately attributed QA sessions.

The operator retained the actual definitions/authority backup and reconfirmed the six baseline guards before the approved application recorded below. Any later application or recovery requires its own current checks. Function replacement alone is not proof that existing requests drained; those processes were observed separately.

Rollback is separately guarded against the expected patched bodies and was tested locally. It restores the former definitions and **reintroduces the custom40001 retry risk**; it is a review artifact, not an instruction to apply automatically.

### Separate conditional recovery draft

[Known-loop recovery SQL](sql-drafts/rooms-business-conflict-stop-known-loops.sql), SHA256 `55FD4EE9628D94E438072BCF6C34A4EC62156687EF4B44E637FF2D34AEDBB0C3`, was separately and conditionally approved by the owner at `05:20:01 UTC`. It could be considered only after the exact migration/readback and a bounded drain observation, with fresh evidence that the same known processes still loop. It first checks all six patched function/authority fingerprints. Only the five recorded PID plus backend-start tuples may match, and only with the current database, authenticator role, exact observed PostgREST14.5 application, active transaction, exact invocation and statement hash. Mismatches, idle sessions and new PIDs are skipped. This interrupts a matching request and is not undone by transaction rollback. The execution condition was not met after application, so root did not run it.

At `02:39:51 UTC`, one listed PID was already idle with a different statement; four matched the active statement. This is a conditional allowlist, not a claim that all five still need termination. Room/actor parameters remain hidden in prepared SQL, so these are identified failed database processes rather than proven per-actor QA sessions. No project restart or general session termination is proposed.

## Actual approved production application and drain

The owner approved the exact migration hash above and conditional recovery at `2026-10-16T05:20:01Z`, for project `rggpyiterdbbugluejcs`. Root applied the migration with `success:true`; hosted history records **`20261016052113` / `rooms_business_conflicts_http409`**. At `05:21:29.939749 UTC`, all six predicted body hashes and owner/ACL/security/search-path metadata matched: **zero explicit 40001 and eleven PT409 literals**. No Worker redeployment was needed for the preserved message mapping.

At `05:21:53.318703 UTC`, all five recorded backend processes were absent. The bounded `05:21:15–05:21:43 UTC` log window contained zero matching old-process errors. Log ingestion can lag; direct PID absence was independently observed. **No conditional recovery, process termination or restart was performed.** This does not establish the state of unseen processes or global database health.

Workspace evidence: `outputs/Rooms-business-conflict-owner-approval-20261016.json`, `outputs/Rooms-business-conflict-apply-20261016T0521Z.json` and `outputs/Rooms-business-conflict-postapply-summary-20261016T0521Z.json`, with the adjacent function/history/drain source readbacks.

## Actual Samsung 501 conflict and recovery

Both exact 501 QA packages were installed and the expected Dr/Utalii identities restored. Dr admin retained configuration v5 while the owner saved v6. At `05:28:43 UTC`, the stale native Save returned **HTTP409 in 616ms** with “The Room changed. Refresh before trying again.” The exact unsaved `OwnedStaleAfterFix16` draft remained visible. Authoritative readback retained v6/`OwnedFinalRule16` and showed no new Dr configuration receipt. The bounded server log check found one PT409 conflict on one process and no 40001; it is not a global health check.

The first explicit Reload then failed with `SocketTimeoutException`, last milestone `REQUEST_HEADERS_END`, `10015ms`, statusNONE. One explicit Retry Reload subsequently displayed the current v6 rule. Record **PASS for bounded conflict/no-overwrite/draft retention and later Reload recovery**, while retaining the first Reload failure. Earlier cold-start Auth DNS/timeout failures also remain open evidence; no vault reset or new login was required for the recorded restoration.

Evidence: `outputs/Rooms-network-501-stale-v5-conflict-20261016.json`, `outputs/Rooms-enabled-boundary-stale-v5-conflict-no-overwrite-20261016.json`, `outputs/Rooms-enabled-stale-v5-conflict-log-counts-20261016.json`, `outputs/Rooms-network-501-reload-failure-20261016.json` and `work/rooms-501-dr-reloaded-v6-after-retry.{png,xml}`. The earlier d1 stale-v4 timeouts remain historical failures; they are not relabeled as409 responses.

## Actual local verification

Existing isolated PostgreSQL17.11 on `127.0.0.1:55435`; new synthetic clone `sautilink_rooms_test_conflicts_20261016_r4` from the cached canonical Rooms/cascade fixture. No production fixture writes were used.

- Unchanged baseline: **EXPECTED RED** — stale settings raised `40001` instead of the required `PT409`.
- Patched business behavior: **20/20 PASS**, covering actual SQLSTATE/message pairs across all six functions, stale settings/membership/pin/decisions/withdrawals, canceled-request preservation, private admission-trigger recheck, exact retry ACKs and authority.
- Catalog checks: **PASS** — six function identities, owners, ACLs, security/search-path metadata and all unrelated functions/relation/policy/trigger catalogs unchanged; exactly eleven normalized body substitutions.
- Existing management behavior **73/73**, authority/limits **30/30**, quote/decision visibility **18/18 PASS**.
- Guarded rollback, reapply, catalog checks and the20 business checks: **PASS**.
- Owned local cluster stopped successfully; zero remaining Postgres or psql processes.

Canonical evidence: workspace `work/generatedtestscope/rooms-business-conflicts/sautilink_rooms_test_conflicts_20261016_r4/result.json` and adjacent logs/backup. Earlier harness failures were retained separately: server-address text formatting, LF comparison and a missing existing quote-test variable; none required migration changes.

Replay with the existing local runtime and cached synthetic template:

```powershell
./supabase/tests/run-rooms-business-conflict-check.ps1 -Database sautilink_rooms_test_conflicts_<fresh_suffix>
```

The runner refuses an existing database and checks the loopback server identity. It references the versioned rollback draft; the runtime/password remain local and no password is printed.

## Remaining gates and limits

No local PostgREST14 HTTP service was run. Local results prove PostgreSQL behavior and preserved contracts; the separate production readbacks and Samsung 501 observations above establish only their stated scopes. General Auth/network failures remain OPEN. The later native deleted-Room cache correction at `ddd36b7` passed both QA assembly/full lint and actual Samsung cache retest. Both APKs are installed with expected identities; owner cold restoration failed before one explicit Retry recovered Home/Menu and Rooms smoke. Matched edge/Auth-origin200 plus unusually large provider timing on the QA `/user` request narrow the observation but do not prove timely client delivery or the exact transport cause. These failure/recovery boundaries are recorded in the management review. No timeout, retry or authentication behavior change is included; no merge or Play publication is authorized by these results.

Separate owned A/B QA storage cleanup completed at `05:55:46 UTC`: **PASS for exactly 21 allowlisted keys**, with six found objects deleted and verified by subsequent GET404, and 15 already absent at their initial GET. The bucket catalog was read as disabled before deletion; there was no listing, wildcard or broader key operation. Native Room DELETE itself does **not** delete object bytes: this was separately scoped operator QA cleanup. The withdrawn `597444d9` video original/variants and native-discarded `00999466` image were already absent; all six found objects belonged to the Room-cascaded attached-media group. Evidence: `outputs/Rooms-R2-exact-cleanup-20261016T055423Z/results.json` and `outputs/Rooms-R2-exact-cleanup-review-20261016.json`. This establishes neither global edge-cache erasure nor cleanup of later/unrelated fixtures.
