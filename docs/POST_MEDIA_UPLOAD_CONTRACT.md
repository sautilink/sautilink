# Post media and verification contracts

Post media allows at most 10 attachments, new images up to 5 MiB each, and MP4
video up to 250 MiB / 180 seconds. These bounds apply in the Worker and database.
Story and direct-message media limits are separate and unchanged.

## Video upload

`POST /api/sauti-media/begin` retains its existing request and response fields.
For videos larger than 8 MiB, `data.chunk_upload` additionally contains:

```json
{
  "part_size_bytes": 8388608,
  "part_count": 32,
  "part_url": "/api/sauti-media/upload/<id>?part={part}",
  "complete_url": "/api/sauti-media/upload/<id>?complete=1"
}
```

The count is derived from the declared file size. Upload each 1-based part using
`PUT`, `Content-Type: video/mp4`, and the current account's bearer token. Every
part is exactly 8 MiB except the final remaining bytes. Retrying identical bytes
is safe; replacing an already stored part with different bytes returns 409.
After all parts are acknowledged, PUT an empty body to `complete_url`, then call
the existing finalize endpoint. Do not publish until finalize succeeds.

Each request authenticates and checks the owner through the ordinary RLS path.
The server selects private staging keys; clients never supply R2 keys/upload IDs.
Completion inspects MP4 atom metadata under byte/atom budgets and assembles the
parts under a private staging key. An ETag-bound read then streams the result
into a create-only canonical write, preserving a canonical object already stored
by another request. Completion records the same validated metadata as a small
upload. Video payload is never accumulated in one Worker heap buffer. A tiny
completion marker prevents a delayed request with an old pending row from
overwriting a completed/published object. Deletion/expired-upload cleanup removes
staging objects and the marker. A Worker crash during completion can require
deleting/restarting that upload; its lock is never stolen on a timeout. If the
metadata commit cannot be confirmed, canonical pending bytes remain for the
existing authorized cancellation or expiry cleanup rather than being deleted
without ownership of the database cancellation. An already executing Worker
version with unconditional writes must drain before new clients are promoted.

Older installed clients retain whole-PUT compatibility up to their former
100,000,000-byte limit. The server splits that request stream into bounded parts
internally. New uploads above that size must use the chunk contract. Images and
videos up to 8 MiB retain their existing single-PUT route.

## Shorts download

`GET` or `HEAD /api/sauti-media/<media-id>/download` requires a bearer token and
fresh RLS checks on the media and post. Only an attached video belonging to a
published, visible public root post qualifies. Followers-only posts, Room posts,
replies, Stories and direct-message media do not qualify. Ordinary RLS block,
moderation and deletion checks still apply.

The response streams the retained validated canonical MP4 with a SautiLink
attachment filename and `private, no-store`. No provider URL/token is returned.
Single `bytes=start-end` ranges and `If-Range` support resumed downloads. HEAD
and GET bind to the same validated R2 source ETag. Every resumed HTTP request
rechecks authorization. This route does not create a new Stream MP4 copy or
change Stream storage capacity.

## Verification

The public RPC remains `submit_verification_case`, with one signature. Its new
last parameter is `p_account_type text default 'individual'`, after the existing
optional `p_social_proof_confirmed` parameter. Older eight/nine-argument callers
continue to resolve through defaults.

Allowed types: `individual`, `business`, `brand`, `entity`, `organisation`.
Individuals retain the existing social-link-or-article evidence rule. Other types
must include 1–5 article URLs, with all existing URL/consent/lifecycle checks.
No ID or licence fields are requested. New/resubmitted applications persist
`account_type` and server-derived `requested_badge_type` in case metadata.

New typed individual approvals derive `standard` (blue); the other types derive
`team` (orange). Existing verified accounts and legacy applications retain their
previous review behavior. Retired applications cannot determine a new grant.
Badge classes describe verified identity, not staff privileges or authority to
broadcast Stories. Staff privileges continue to come exclusively from the
private staff-role registry.

## Default Story discovery

The server-managed `private.story_default_publishers` registry preserves the
accounts that were verified `team` publishers at the migration boundary. New
orange business/brand/entity approvals do not enter it automatically. Clients
cannot read or change this registry.

Default discovery includes the viewer's own Stories, followed accounts and
currently verified registry publishers. A colour-only badge change does not
remove an existing publisher, but removal of current verification stops its
default broadcast. Normal expiry, deletion, visibility, blocking and muting
checks remain in force. Public direct reads and profile-specific discovery do
not require registry membership.

## Deployment and verification

Apply these migrations, in order, before publishing clients that use the new
limits/type parameter:

1. `20261023043819_expand_post_media_policy.sql`
2. `20261023043820_verification_account_types.sql`
3. `20261023045902_separate_story_default_publishers.sql`
4. `20261023052959_expand_room_post_media_policy.sql`

The image storage CHECK retains the historical 8 MiB ceiling. An invoker trigger
enforces 5 MiB for every new or changed image payload; it grandfathers only the
identical existing ID, owner, object key, media kind, content type and size.
Historical images therefore remain readable, annotatable, detachable and
deletable. A `NOT VALID` CHECK would still reject ordinary updates and is not
used. The post-media and verification RLS policies/client table grants are not
broadened; the new private registry grants only the server service role the
access needed to manage publishers.

Offline regression coverage lives in `post-media-policy-postgres.test.mjs`,
`verification-account-types-postgres.test.mjs`,
`stories-default-publishers-postgres.test.mjs`, and
`post-media-chunks-download.test.mjs`, together with the existing Story,
Stream/MP4 and frontend behavior tests. Local tests do not attest to live
migration/deployment status.

## Room post approval attachments

The existing Room approval RPC and private pending-media queue accept up to ten
attachments, including mixed images and videos. Queue positions run from 0 to 9.
The same new-upload image/video size and duration limits apply. Story and message
media limits remain separate.

The Room migration gates the exact reviewed live `room_submit_post_for_review`
definition and its existing queue constraints before changing only the numeric
bounds. It preserves current membership, staff-only posting rules, blocks in both
directions, held-upload ownership/immutability, idempotent submission/decision,
atomic staff approval, member-only published visibility, function grants and
private table RLS. Unknown function or constraint drift aborts the transaction.
`room-post-media-policy-postgres.test.mjs` reproduces the old count/mixed limits
and exercises the actual RPC, approval transaction and drift rollback locally.
