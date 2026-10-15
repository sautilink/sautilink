# Rooms post approval - review patch

Status: **implemented locally; not approved, applied or deployed to a hosted backend**.
Existing Rooms default to approval OFF. No Room flags, provider configuration,
Firebase secrets or production data have been changed. PR merge/Play publication
remain unauthorized. This patch supersedes the earlier outside-repository design.

## Review scope

Migration generated with installed Supabase CLI 2.121.0:
`supabase/migrations/20261015031151_room_post_approval.sql`.

SHA256: `C77E22152EF5E6CBAC1F0AB1185E697629CFB32822CDF9368FDA0066CC0339DE`.
Review the final file/hash again if any follow-up changes are made.

- Add default-false `social_circles.post_approval_required`. Existing settings RLS
  still limits changes to owner/admin; settings changes append audit metadata.
- Pending submissions, ordered media holds and moderation audit live in private
  tables with RLS/FORCE RLS and no client table grants. No new private-schema
  privilege is added; production already grants authenticated private-schema
  USAGE for its existing moderation helper. New queue helpers remain explicitly
  ungranted to clients. Pending submissions never create a `social_posts` row
  until approval. Existing post status/SELECT policies,
  feed/search/indexing functions and published Room membership rules are unchanged.
- Ordinary members queue new top-level posts when the flag is ON. Staff-authored
  posts and existing comments retain immediate current behavior. Existing
  `staff_only` posting restrictions still apply; approval does not grant posting.
- Auth-bound RPCs implement own/staff list/detail, submit, approve/reject, withdraw,
  private media authorization and owner/admin audit. Rejection requires a reason
  of at most 500 characters. Former members can withdraw their own pending item.
- A direct `social_posts` INSERT cannot bypass approval. Approving locks the Room,
  submission, current actor/author membership and sorted media, checks original
  author permissions, then creates one normal post and attaches all media in the
  same transaction. Failure rolls back post/state/media/audit/notices together.
- The Room lock uses `FOR KEY SHARE`, which blocks deletion/key changes while
  allowing the existing membership-count trigger's non-key update. Current actor
  and author membership locks still serialize revocation. The unchanged canonical
  Room insert trigger rechecks posting permission if owner settings change while
  approval waits. No existing role/count trigger or RLS policy was changed.
- Quote eligibility is checked for the original author at submission and approval,
  preserving current phase29 public-post moderation, discoverability, audience,
  block/mute and own-post/platform-staff exceptions. The internal definer helper
  has an empty search path and no PUBLIC/anon/authenticated execute grant.
- Stable client request IDs serialize concurrent retries and compare the immutable
  full content/ordered-media snapshot. Approval/rejection decisions check version
  and decision request identity. Different competing decisions conflict.
- Held uploads cannot be altered, reused or deleted. Approval consumes holds;
  reject/withdraw releases them and renews the existing ready-upload expiry.
  Profile deletion releases its owned holds before existing media cascades.
- Generic in-app circle notices reuse existing recipient RLS and `notify_sautify`
  preference suppression. Staff pending notices are removed after decisions.
  No pending body, media URL or rejection reason enters a notification payload.
  This patch does **not** add remote FCM delivery for circle events; the current
  push enqueue already excludes circle notifications. No push/provider deployment
  is requested by this patch.

## Worker and publisher changes

- `src/room-post-approval-api.js`: real capability endpoint, queue/detail/decision/
  withdrawal/audit routes and authenticated private/no-store R2 review delivery.
  Uses caller bearer + existing public project key, never a service-role key.
  Mutations use the existing create limiter. Decision/withdrawal bodies stop at
  4096 actual bytes, including unknown-length streams; first overflow cancels
  reading before any mutation RPC. Invalid UTF8/JSON and aborted bodies fail closed.
- `src/asset-router.js`: routes the new handler in the actual Worker entry path.
- `src/sauti-posts-api.js`: Room-only review routing;202 carries
  `{ok:true,data:{submission,published:false}}`. Non-Room/policy-OFF/staff publishing
  retains 201. Missing migration RPC (PGRST202 only) preserves legacy operation;
  other backend failures fail closed. Queued polls are explicitly rejected.
- Exact lost202 retries can return the same pending submission, or confirm an
  already approved existing post. Deleted/rejected/withdrawn outcomes never claim
  publication or create another post. Approved history survives published-post
  deletion with a NULL pointer; GET remains truthful and approve ACK returns 409
  `POST_UNAVAILABLE` after deletion. No retry republishes it.
- `src/sauti-media-api.js`: R2 PUT uses atomic first-write
  `onlyIf: {etagDoesNotMatch: '*'}`; a failed precondition returns a controlled409
  without cleanup. Upload metadata PATCH/failure DELETE require still-pending,
  unattached metadata. Expiry and failure cleanup confirm actual DB deletion
  **before** removing R2 bytes; denied, zero-row and uncertain deletion preserve
  bytes. Post-attachment rollback checks current metadata/cascade absence instead
  of trusting a stale attached-media log. These shared changes close a reproduced
  stale-upload/held-media overwrite and deletion race; they expose no held content.
- **Shared upload behavior changes even when approval is OFF:** a repeat/stale
  PUT to an already-stored upload ID returns409 `UPLOAD_ALREADY_STORED` rather than
  replacing bytes. Native, web and Room upload retries begin with a fresh media
  ID by source inspection; existing uploaded/ready finalization recovery remains
  available. Real Samsung normal image/video and interruption/retry validation
  against the deployed Worker remains required before this shared change ships.
- `src/room-publish-outcome.js`, `src/app.js`, `src/room-post-images.js`: stable
  per-snapshot request IDs and confirmed Published/Pending handling. Pending clears
  local previews without deleting the now-held uploads and shows awaiting approval.
- Existing build transform continues to allow five images; the pending queue
  accepts positions0-4. If a pending submission contains a video, limit is four.
  No global/native composer media-limit expansion is part of this backend patch.

Native capability/typed outcome/queue UI is owned by the parallel native changes.
Capability is true only when the real DB RPC is present. Older/missing/error
capability preserves old column selects and hides approval controls. Review the
combined native patch and actual CI/live QA before any feature enablement.

## Actual local verification

Tests ran against isolated PostgreSQL 17.11 on 127.0.0.1:55435,
databases `sautilink_rooms_test_20261015` and disposable
`sautilink_rooms_test_review_*_20261015`; no hosted SQL probes or mutations.
The fixture refuses database names outside `sautilink_rooms_test*`.

- Migration creation/compilation and real authenticated-role SQL fixture: **PASS**.
  Covers defaultOFF, anon execute denial, private queue-table denial, member
  setting denial, direct publication denial, pending isolation, author/staff
  visibility, public-Room outsider stream denial, immutable holds/deletion denial,
  exact retry/payload conflict, approval/idempotency/conflicting decisions,
  original author/media, notices/audit, rejection, withdrawal and refreshed expiry,
  removed staff/author, former-author withdrawal, five-image final slot, bounded
  pagination, deleted approved post/history, and profile deletion cascades.
- Forced failure on the second attachment: **PASS**. Post, approval state and
  approval audit rolled back; pending item/holds remained available to withdraw.
- Two independent authenticated PostgreSQL sessions, approve versus reject:
  **PASS**. First session's held-lock/PgSleep barrier was observed; second waited,
  then failed `ALREADY_DECIDED`; exactly one post/decision audit. Fixtures cleaned.
- Production-contract extension loads verbatim current production role helpers,
  phase26 insert trigger, phase29 SELECT policy, Room posting/member-removal
  triggers, membership RLS and member-count migration into a narrow local fixture.
  Before fixes: **10/14 quote eligibility mismatches reproduced** and an actual
  author-removal/count-update/approval **40P01 deadlock reproduced**.
- Fixed quote/decision eligibility: **18/18 PASS** against actual canonical RLS,
  including original-author rechecks, hidden authors/audiences, mutes, bilateral
  blocks and existing platform-staff/own-post exceptions.
- Fixed concurrent author removal and staff removal: **PASS** independently.
  Removal commits; stale approval rejects; no post/deadlock; submission stays pending.
  Three-session owner `staff_only` change during approval: **PASS**; the unchanged
  canonical post trigger rejects the stale snapshot, retaining pending/no post.
- Existing private-schema USAGE authority check: **PASS** for all 3 FORCE-RLS queue
  tables, all 8 internal helpers and all 10 authenticated-only public RPCs, including
  actual authenticated table-read/helper-execute denial. Concurrent actual Room
  DELETE: **PASS**; it waits on KEY SHARE and rolls back at the bounded timeout.
- New Node API/publisher/upload behavior suite: **21/21 PASS**, including 5 immutable
  upload/cleanup tests and 4 streamed-body-limit tests. The pre-fix external mirror
  reproduces stale attached/held-media failures; current source passes.
- Rooms/media regression suite: **72/72 PASS** in an LF materialization matching
  Linux checkout semantics. The Windows CRLF checkout produces literal-source-
  transform anchor failures even in untouched modules; no broad line-ending edits
  were made to the repository to hide that difference.
- Local esbuild Worker/app/Room-images bundles: **PASS**. Direct executable used
  because the Node JS service's child spawn is restricted in this environment.
  This is a local bundle check, not a production build/deployment claim.

Evidence under workspace `work/outputs`:
`rooms-approval-local-sql.log`, `rooms-approval-race-{a,b,check}.log`,
`rooms-media-immutable-behavior.log`, `rooms-media-before-fix-repro.log`,
`rooms-node-regression-lf.log`, review bundle outputs.
Production-contract evidence is under `work/generatedtestscope/rooms-sql-review`:
`baseline-quote-complete.log`, `baseline-membership-race.log`, `final-quote.log`,
`final-{author,staff,policy}-race.log`, `final-authority-delete-lock.log`.
Reproduction runners and rollback-only SQL fixtures are in `supabase/tests`.

### Limits

The isolated schema models relevant existing tables/RLS/contracts and extracts the
named canonical production definitions; it is not a full production database
clone and does not replay every production migration. The original minimal
fixture's schema-USAGE denial was fixture-specific; the separate production-contract
test preserves existing private-schema USAGE and verifies queue isolation with it.
Production advisors, full hosted integration,
remote push and Samsung approval-ON QA have **not** run. Existing Room published
post RLS remains the source of truth; public Room metadata does not make its posts
public. R2 validation occurs in the Worker using the existing media trust boundary;
the database cannot independently HEAD an R2 object. Private review access checks
current Room staff despite personal blocks, which is an explicit moderation scope
requiring owner review. Generic web pending acknowledgments are supported; the
new full queue management interface is in the native patch.

Primary guidance reviewed: [Supabase functions](https://supabase.com/docs/guides/database/functions),
[Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security),
[PostgreSQL function privileges/search paths](https://www.postgresql.org/docs/current/sql-createfunction.html),
[PostgreSQL row locks](https://www.postgresql.org/docs/current/explicit-locking.html),
and [Cloudflare R2 conditional PUT/null result](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/).

## Approval, rollout and rollback

1. Review the exact migration/Worker/native patch, security boundary and final
   hashes. Obtain explicit owner authorization for hosted schema/API deployment.
   General Rooms requests do not bypass Issue353 backend/config approval gates.
2. Apply the complete migration and companion Worker only through the approved
   release procedure. Run post-deploy read-only grants/RLS/advisor checks. Keep all
   flags OFF while confirming old clients and non-Room paths still work.
3. Verify capability and controlled native/web publish/queue/media behavior on an
   owned QA Room/accounts. Owner must authorize this controlled feature enablement.
   Only then consider additional Rooms. No merge/production publication is implied.
4. Rollback begins by switching affected Room flags OFF through the authorized
   settings operation. This restores immediate **new** posts and never auto-
   publishes pending ones. Keep queue/read/decision/withdraw/media support until
   pending items are explicitly resolved. Do not drop guards, release held media
   or deploy the old bytes-first cleanup while unresolved holds exist.
5. No destructive automatic down migration is supplied: new queue/audit/history
   requires an owner-reviewed retention/export decision before eventual removal.
