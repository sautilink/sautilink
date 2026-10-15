# Rooms management - local review proposal

Status: **prepared and tested locally; no hosted schema/API deployment or feature
enablement is authorized by this document**. Moderation AI is deferred. No PR
merge, production deployment or Play publication occurred in this work.

Native checkpoint `979a26a3ce85b5b122cd3e63036e300440b54dd9` built successfully
in 9m27s. Final capability follow-up `0eab58fccb2106b5dfb87c61e549b4af25688dd1`
built with assembly and lintVital PASS in 9m37s and was installed on Samsung.
Its entire native tree is identical to reviewed PR source
`9681588868c85bccd8ff3f5f3a33b07a65633694`. That source also passed full Native
Android build/lint CI run38817218445. Earlier4fe observations remain a baseline;
new-source Samsung results and their limits are recorded below.
The three newly reproduced admission-policy/owner-block races were corrected
and the final local SQL regressions/races passed as recorded below. These local
results and bounded source reviews do not certify a hosted rollout.

## Native scope and capability behavior

| Feature | Native implementation | Backend boundary |
| --- | --- | --- |
| Rules | About panel; ordered rule editor in Community settings | New management capability |
| Membership questions | Required/optional answers for Join, Request and Accept invitation; applicant-answer review for current staff | New management capability and versioned admission RPC |
| Featured posts | At most three compact previews with actual author/excerpt/media indication; View post opens the existing canonical detail | New pin metadata plus existing caller post RLS |
| Published-post moderation | Staff pin/unpin; hierarchy-aware removal with reason and real acknowledgment | New management RPCs; no ordinary-author staff privilege |
| Outgoing invitations | Pending list and exact-row revoke | Existing invitation REST/RLS; no new capability needed |

Existing Room branding, types, routes, discovery, membership policies, cover,
role management, posts/media and approval UI remain in their existing paths.
Featured previews do not create a second Like/Save/Repost/comments state cache;
those actions remain in the normal post card and canonical detail. This change
does not implement every feature offered by Facebook Groups.

New management controls remain hidden until a real supported capability is
resolved. A known unsupported response permits the existing admission path.
Transient transport/auth failures and malformed capability responses keep
membership readiness unresolved, show Retry and do not silently use legacy
admission. When supported, all three admission actions use the versioned RPC,
including configurations with zero questions. The independent bounded
Worker/SQL/native contract review found no remaining actionable mismatch after
the admission-race and independent-capability corrections.

Reads are scoped to account, Room and request generation; stale reads cannot
overwrite a confirmed mutation. Mutations retain a request UUID for the same
immutable payload/version/action across uncertain transport retries. A changed
payload gets a new UUID. The client validates matching Room/actor/post identity,
result and receipt/version before reporting success. A later refresh failure
does not turn a confirmed mutation into a failed mutation. Late callbacks cannot
close a different sheet opened after the original editor was dismissed.

## Exact scope and migration

Installed Supabase CLI 2.121.0 generated:
`supabase/migrations/20261015214652_room_management_completion.sql`.

SHA256 of the final locally tested workspace CRLF file:
`FB8A132E9C50EEFE7528BD068EA3A999F08588304EA13CC4F622D59A171ABFB9`.
Its normalized repository LF SHA256 is
`D4F61713F474B6D609ED423CAEC85CB92EC9100078701FA6B06B40514DF57C3C`.
Recheck these hashes after any follow-up or line-ending change. The earlier
`2EEC67C8...D7105E1` result predates the reproduced admission-race correction and
is historical, not the final rollout artifact.

The previous post-approval migration was not edited. Its existing Windows CRLF
SHA256 remains `C77E22152EF5E6CBAC1F0AB1185E697629CFB32822CDF9368FDA0066CC0339DE`;
its repository LF SHA256 is
`02DA26874DC920F4662593CCBF1A4D8A3DA4F25AEDC363A4E3831BA09B42251B`.
Existing posts, authentication, APIs and RLS policies are retained. This proposal
adds separate management tables/RPCs and two narrowly demonstrated trigger fixes.

The new management SQL is logically independent of the earlier post-approval
objects. The local regression fixture loads the earlier approval migration to
check compatibility; that is not a new SQL prerequisite. Post approval remains
a separately unapproved hosted rollout described in
[rooms-post-approval-review.md](rooms-post-approval-review.md). If both proposals
ship together, review and authorize both exact migrations and the matching Worker
release; preserve each independent capability when either schema is absent.

## Data and authority

- Private configuration stores up to 10 ordered rules (title 1-120 code points,
  body up to 1000) and 3 ordered text questions (prompt 1-300, required Boolean).
  IDs are immutable UUID identities in each saved snapshot; duplicate or invalid
  IDs are rejected. Every Room starts with empty rules/questions and version 1.
  Only current owner/admin can update; each new request increments the version
  exactly once, including same-content saves. An exact retry returns its original
  immutable receipt; clients then reload current state.
- Question definitions are Room metadata available to authenticated people who
  can discover that Room. Answers and the original question/version snapshot are
  private, readable only by the applicant and current Room staff. Answers are
  bounded to 3 entries and 1000 code points each; unknown/duplicate question IDs
  and missing required answers fail closed. No contact details or post bodies
  enter the new management audit.
- A membership mutation explicitly chooses `join`, `request` or
  `accept_invitation`. The server rechecks open/approval/invitation eligibility,
  current configuration and owner blocks. It atomically saves answers with the
  existing membership/request/invitation effects. Request IDs cannot change their
  Room, operation, intent or payload. Lost acknowledgments reflect actual current
  member/pending state; a later leave/removal/cancel/decline cannot fake success.
- When questions are configured, additive INSERT guards require a server-written
  private proof for the current transaction. A user-settable custom GUC grants
  no authority. Existing pending requests are captured from server-observed rows
  when questions are first enabled and remain approvable with their original
  empty snapshot. Caller-supplied timestamps cannot create that exception.
- The new admission RPC reloads current policy/owner-block state after waiting
  for the Room advisory lock. An actual INSERT using its same-transaction private
  self-proof also rechecks mode and owner blocks. This prevents a stale earlier
  read from admitting after a committed policy/block change. Legacy direct
  empty-question RLS paths and owner bootstrap remain unchanged.
- Config updates lock the configuration row against admissions. They retain the
  existing Room/member-count lock compatibility; true concurrent boundaries were
  tested. All new private tables use FORCE RLS with no client table privileges;
  internal helper EXECUTE and audit-sequence privileges are explicitly revoked.
  Existing private-schema USAGE for older moderation helpers is not broadened.
- Answers and private receipts currently remain until profile or Room deletion,
  including after a canceled request or later departure. No new public answer
  history or automatic retention purge is supplied; review this retention before
  enabling questions on a hosted Room.

## Featured posts and published-post moderation

- Up to 3 top-level, published, nonremoved Room posts may be pinned. Current
  owner/admin/moderator can pin/unpin; a Room advisory lock serializes the cap.
  No client INSERT/UPDATE/DELETE grants are given on the pin table.
- Pin reads are a SECURITY INVOKER RPC over a new SELECT-RLS table that joins the
  actual caller's existing `social_posts` RLS. Membership, personal blocks/mutes,
  moderation and the Room-owner block boundary remain authoritative. Public Room
  metadata does not make its posts or pin IDs public. A deleted former pinner
  leaves a truthful null `pinned_by`; the Room pin itself remains.
- Published-post removal requires a nonblank reason of at most 500 code points.
  It is current Room staff-only, including for a staff member's own post.
  Owner can remove legitimate in-scope posts; admin can remove member/moderator
  or former-member posts; moderator can remove member/former-member posts.
  Other staff cannot remove the immutable owner's post, and unsupported roles
  fail closed. Ordinary authors retain their existing deletion route.
- The RPC sets the existing `deleted_at`, unpins and records a private metadata
  audit/receipt in one transaction. Original author/content remain stored; current
  post RLS hides the removed post and its thread. A narrow guard prevents undelete
  or moving removed content into a public route. Unrelated post updates remain
  supported. No global `moderation_state` permission is given to Room staff.
- Staff can remove a known in-scope post even if their own personal block/mute
  hides its body; the moderation RPC does not return that body or broaden reads.
  No restore action, AI decision, remote notice or R2 byte deletion is added.
  Media stays attached to the retained post under the existing storage boundary.

## Demonstrated existing trigger corrections

Both were reproduced using canonical existing code **before** this migration:

1. Current join-request RLS permits owner/admin/moderator review, but the latest
   phase20 approval trigger only accepted the Room owner. Real authenticated admin
   and moderator approvals raised `CIRCLE_APPROVAL_NOT_ALLOWED`; the transaction
   left pending/no member. The new migration replaces only that trigger function
   with current staff/owner-block checks and the same atomic member insertion.
   The prior owner approval path was verified before and after the change.
2. The legacy SECURITY INVOKER invitation-acceptance trigger's nested membership
   INSERT failed canonical RLS. Recipient acceptance rolled back to pending/no
   member. The new trigger-only definer repeats immutable identity and recipient
   auth checks, verifies the current Room/owner blocks, then performs the exact
   member insertion. Configured questions still require the private transaction
   proof; unrelated actors cannot accept on a recipient's behalf.

No old migration file or existing RLS policy was modified to make these pass.

### New admission race found and corrected before rollout

Root reproduced three failures in the proposed new RPC: an open join, an approval
request, and admission after an owner block each used pre-wait Room state after a
concurrent committed change. The original calls incorrectly committed a member
or request. These were actual two-session application failures, not hypothetical
source warnings (`work/outputs/rooms-management-admission-baseline.log`).

The correction is confined to this new migration: reread after the advisory wait
and revalidate current mode/blocks at the private-proof INSERT boundary. The
final three lock-wait cases all rejected with no member/request committed. This
does not add a claim that every possible concurrent database change was tested.

## HTTP/RPC contract

All new API calls retain the caller bearer and existing public project key;
there is no service-role key or caller-supplied actor/role authority. Capability
merging preserves existing `post_approval` and top-level version semantics, adding
`room_management` and `management_version: 1` only when the real new RPC exists.
The existing post-approval version semantics remain independent (including
version 0 when that component is absent). Explicitly missing/unsupported
management is false/version 0; a transient or invalid probe must return an error
so native can offer Retry without claiming legacy support. Installing this
complete migration makes management available; questions and rules remain empty.

| HTTP action | SQL RPC | Result |
| --- | --- | --- |
| GET `/api/rooms/:id/management` | `room_management_state` | Room ID, version, rules, questions, pin_limit 3 |
| PUT same path | `room_update_management` | Same normalized state; version expected + 1 |
| POST `/:id/membership-request` | `room_submit_membership_request` | Requester, actual member/pending, config_version, request_id |
| GET `/:id/membership-requests/:user/answers` | `room_membership_request_answers` | Original question/answer/version snapshot and submitted_at |
| GET `/:id/pinned-posts` | `room_pinned_posts` | Visible post IDs, pin time, nullable pinner; pin_limit 3 |
| PUT `/:id/posts/:post/pin` | `room_set_post_pin` | Exact Room/post/pinned state and nullable pin time |
| POST `/:id/posts/:post/moderation` | `room_moderate_published_post` | Confirmed remove result/time |

Membership body uses `action_kind: join|request|accept_invitation`,
`expected_version`, `request_id`, and `answers: [{question_id, answer}]`.
Config uses `expected_version`, `request_id`, `rules`, and `questions`.
Pin uses `request_id,pinned`; removal uses `request_id,action: remove,reason`.

Worker config bodies are bounded to 64 KiB and other new write bodies to 16 KiB
of actual streamed bytes; overflow is canceled before a mutation RPC. Writes use
the existing `SAUTI_CREATE_LIMITER`. Responses are no-store, and HTTP success is
returned only for a matching real SQL receipt. Missing/unknown RPCs fail closed.

Outgoing invitations reuse existing caller-RLS SELECT and DELETE contracts.
Revoke filters the exact Room, recipient, inviter, creation timestamp and pending
status, and requires that same returned tuple before reporting success.
Accepted invitations cannot be revoked
as a shortcut to removing membership. No parallel invitation storage is added.

## Actual local verification

| Check | Actual result | Evidence |
| --- | --- | --- |
| Pure native community model compiler/runtime | **88/88 PASS**, both exit 0, source `979a26a` | Workspace `outputs/Rooms-QA-16Oct-community-model-checks.json` |
| Final management SQL behavior and authority/limits | **73/73 + 30/30 PASS** | Workspace `work/outputs/rooms-management-final4.log`; earlier JSON remains historical |
| Final existing quote/decision parity | **18/18 PASS** | Same final4 log |
| Final real two-session SQL races | **7/7 PASS**: prior four rerun + three new admission denials | Workspace `work/outputs/rooms-management-concurrency-final4.log` and `rooms-management-admission-final4.log` |
| Worker focused HTTP/security tests | **35/35 PASS** (19 management + 16 existing approval) | Workspace `work/outputs/rooms-management-worker-final-20261016.log` |
| Independent cross-contract source review | No remaining actionable findings in reviewed SQL/Worker/native scope | API reviewer, final `FB8A132E...71ABFB9` SQL and capability correction |
| Android assembly/lintVital and full CI | Final `0eab58f` **PASS**, 9m37s; matching PR native tree full build/lint **PASS** | CI run38817218445; APK hash below |
| Samsung new capability-enabled management | **NOT TESTED** | No hosted management rollout |

The following final actual results apply to SQL snapshot `FB8A132E...71ABFB9`.
PostgreSQL 17.11 at loopback `127.0.0.1:55435`, fresh synthetic database
`sautilink_rooms_test_management_final4_20261016`. This fixture combines narrow
existing tables with verbatim phase26/29 post RLS/insert helpers, whole existing
Rooms/invitations migrations, current owner bootstrap, join-request triggers,
member roles/removal and member-count triggers. It is **not** a complete
production database clone or replay of every migration.

- New migration compilation: **PASS**.
- Actual management behavior assertions: **73/73 PASS**.
- Authority, count/length/Unicode and invitation/pinner lifecycle assertions:
  **30/30 PASS**.
- Existing canonical quote/decision parity during fresh setup: **18/18 PASS**.
- Four real two-session concurrency checks: **4/4 PASS**. Observed lock waits
  before releasing the first transaction: last-slot pinning stays at 3; question
  enablement preserves pre-enable open admission; pending requests are captured
  correctly; concurrent staff demotion rejects the waiting pin mutation. No
  deadlocks or unauthorized mutations occurred in these checks.
- Three additional real lock-wait admission checks: **3/3 PASS**. Open join and
  approval request reject a policy changed to private; an owner block committed
  during the wait also rejects. Each leaves zero member/request effects.
- Both baseline trigger failures reproduced and their intended paths passed after
  the targeted corrections; all synthetic transactional behavior fixtures roll back.

Final runners use PowerShell 7 and the already provisioned isolated local
PostgreSQL runtime/credentials. From the repository:

```powershell
$testDatabase = 'sautilink_rooms_test_management_final4_20261016'
pwsh -NoProfile -File supabase/tests/run-rooms-management-check.ps1 -Database $testDatabase -Prepare
pwsh -NoProfile -File supabase/tests/run-rooms-management-concurrency-check.ps1 -Database $testDatabase
pwsh -NoProfile -File supabase/tests/run-rooms-management-admission-check.ps1 -Database $testDatabase
```

They reject database names outside `sautilink_rooms_test_*` and never select a
hosted endpoint. Admission runner `-Baseline` reproduces the old behavior only;
it is not the passing final test mode. Final logs:
`work/outputs/rooms-management-{final4,concurrency-final4,admission-final4}.log`.
Earlier baseline/invitation-baseline/admission-baseline logs preserve the actual
failures; `outputs/Rooms-QA-management-sql-20261016.json` records the earlier
pre-admission-fix snapshot. Actual session logs are under
`work/generatedtestscope/rooms-management`.

Worker/Native integration and their independent test results are recorded by
their owners. This SQL result is not a claim that an APK built or a Samsung
management flow passed.

The Worker rerun includes explicit admission action kinds, nullable-but-not-
malformed pinner identity and a nine-case independent capability matrix. Missing
post approval can retain its old top-level version 0 while management is true at
version 1. Explicit missing/false is unsupported; transient/network/invalid probes
return 503, and auth errors retain 401/403. The prior 32-test run preceded those
corrections and is superseded by these 35 focused tests. The independent bounded
cross-contract source review is complete; this is not the full release suite,
hosted security certification or Samsung validation.

### Reproduce the focused native model check

The fixture and runner are intentionally outside product source. From the task
workspace, the actual command was:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File 'work/run-room-community-rules-check.ps1'
```

It invokes the established JDK at
`work/temurin21/jdk-21.0.12.1+1/bin/java.exe`, the cached Kotlin 2.2.20
`org.jetbrains.kotlin.cli.jvm.K2JVMCompiler`, `-Xmx512m`, `-no-stdlib`,
`-no-reflect` and JVM target 17. It compiles the two actual Room model files,
generated feed type signatures and `work/NativeRoomCommunityRulesCheck.kt`.
It installs no dependency and uses no Android Gradle task or daemon.

The evidence JSON records every exact compiler/runtime argument and input hash.
The recorded Java invocations can also be replayed directly from the workspace:

```powershell
$proof = Get-Content -Raw -LiteralPath 'outputs/Rooms-QA-16Oct-community-model-checks.json' | ConvertFrom-Json
$java = 'C:\Users\Dr_ Charles\Documents\Codex\2026-10-13\continue-the-existing-sautilink-native-android-2\work\temurin21\jdk-21.0.12.1+1\bin\java.exe'
$compileArgs = @($proof.compile_args)
& $java @compileArgs
if ($LASTEXITCODE -ne 0) { throw 'Kotlin compilation failed' }
$runArgs = @($proof.run_args)
& $java @runArgs
if ($LASTEXITCODE -ne 0) { throw 'Model checks failed' }
```

Verify the recorded source hashes before treating a replay as the same checkpoint.
The 88 assertions cover Unicode code-point boundaries, config/answer counts and
identity, membership action values, and staff/owner/former-member/unknown-role
hierarchy. They do not exercise Compose, HTTP, RLS or Samsung behavior.

## Actual Samsung follow-up (16 October)

Galaxy A05s SM-A057F/Android15, separate QA package `com.sautilink.preview.d2qa`.
APK SHA256 `97a5d36aa386ca87a6a9cb622675ca4c864e4dbb525167b8bbea3985d8be0b18`;
stable signer, debuggable=false, minify=false, correct existing QA Firebase client.
Original preview package version/install times were unchanged. Actual QA identity
@utaliiplus restored without a new login; no credentials were captured.

- **PASS** canonical member count: a newly created owned Room showed1 both in
  first and settled captures without manual refresh; read-only server check gave
  member_count1 and actual membership count1. This retests the earlier4fe defect.
- **PASS** visual selected chip branding: Sauti primary blue replaces default
  lavender. Existing global theme/branding files were untouched.
- **PASS** new outgoing invitation list, confirmed revoke of the exact controlled
  @drcharlestz pending invitation, empty result and read-only server absence.
- **PASS** bounded navigation through Discussion/About/People/Media, canonical
  post detail and Back, Menu profile return and Home. Owner roster and existing
  post/comment counts loaded correctly. No FATAL EXCEPTION appeared in the
  current QA process crash buffer; this is not an exhaustive stability claim.
- **PASS** native cover removal and owned-fixture deletion. Read-only server
  verification returned0 remaining test Rooms/posts/comments/invites/memberships.
  Exact agent-owned device JPEG was checked by path/name/hash, then removed;
  its media record and file were independently absent. Cover_key was null before
  Room deletion; raw R2 byte deletion was not independently inspected.

Earlier4fe live checks also confirmed cover upload/loaded image, text publishing,
post Like/Save, comment Like retained after explicit refresh and invitation send.
The final native change scope does not modify those transport implementations.
Workspace report `outputs/Rooms-QA-Samsung.md` and fixture manifest
`outputs/Rooms-QA-16Oct-fixtures.json` retain actual screenshots, source boundaries
and cleanup. Production preflight still confirms both reviewed capabilities and
schemas absent. Rules/questions/pins/published-post moderation/post approval
therefore remain **NOT TESTED live**. Full Rooms completion is not claimed.

[Native full build/lint](https://github.com/sautilink/sautilink/actions/runs/38817218445),
[Authentication](https://github.com/sautilink/sautilink/actions/runs/38817218512),
[Brand Guard](https://github.com/sautilink/sautilink/actions/runs/38817218435) and
[Android APK](https://github.com/sautilink/sautilink/actions/runs/38817218480) all
completed successfully for reviewed code9681588. No PR merge or publication.

## Required approval and remaining verification

Hosted application, advisors, full integration, native build/lint and Samsung
rules/questions/pin/removal/invitation QA remain separate gates. No new
capability-enabled live test is claimed here. Review the complete
SQL/Worker/Native diff and these compatibility
and retention details before explicit authorization to apply/deploy.

Issue #353 requires owner authorization for backend/configuration changes. This
document is the reviewable proposal for that decision, not authorization to run
it. The two trigger replacements must be included in that review because they
also correct existing empty-config admission paths.

The root-owned legacy Samsung fixture has an actual Room/post/cover and pending
cleanup, recorded in `outputs/Rooms-QA-16Oct-fixtures.json`. On installed `4fe4f21`,
create showed 0 members although the server had the owner membership/count 1,
and a selected discovery chip used lavender. Source fixes are in `979a26a`;
their live retests remain pending. No new email-only signup success is inferred
from the current account session.

**Enabled-Room backward compatibility:** empty-question Rooms preserve old
admission paths. Once a manager configures questions, older clients that directly
join/request/accept without answers receive `ROOM_QUESTIONS_REQUIRED`; they must
use a question-aware client. Existing members and captured prior pending requests
are retained. Deploy the new client path and verify it before enabling questions.

### Rollout checks requiring approval

1. Finish independent Worker/native contract review and final HTTP tests; build
   and lint the exact Android source. Recheck SQL hashes and hosted migration
   inventory; take the normal recoverable database backup. Apply/deploy only
   after the owner approves the exact proposal and target environment.
2. Verify empty-default Rooms, legacy joins/requests/invitations and existing
   post-approval capability independently. Check RLS/advisors and current staff
   role changes with caller credentials; never substitute a service-role client.
3. On Samsung with owned fixtures, verify rule settings conflicts/retry, required
   answers for all three admissions, staff-only snapshot access, captured old
   requests, hierarchy removal, pin cap/older-post hydration, nullable pinner,
   outgoing revoke/accept races and truthful errors. Exercise offline/lost ACK,
   Room/account changes and Back restoration, plus existing posts/media/actions.
4. Enable questions only after question-aware admission works. Confirm ordinary
   and older clients cannot bypass required answers. Remove owned fixtures and
   verify unchanged unrelated data before recording completion.

### Rollback constraints

Rollback must preserve answer/proof and removal guards while configured questions
or soft-removed posts exist. Do not drop the new tables to hide an integration
failure; first use an explicitly approved configuration/retention procedure.
An older Worker/native release cannot safely admit people to question-enabled
Rooms. If a rollback is needed, first agree whether to retain question-aware
admission or disable questions through an approved versioned configuration
change, preserving snapshots and receipts. Keep removed posts hidden and do not
restore broad invoker admission behavior to bypass a failed new UI. Review the
two legacy trigger corrections separately from hiding management controls.
