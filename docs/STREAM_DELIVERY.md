# Cloudflare Stream delivery

The Stream binding performs imports, direct uploads, status reads, token creation
and deletion without an API token in a client or a Worker environment variable.
The canonical R2 source and the existing Supabase post/Room ACL remain authoritative.

## Configuration

Production Worker configuration needs `stream: { binding: "STREAM" }` and:

- `SAUTI_STREAM_ENABLED=true`
- `SAUTI_STREAM_ORIGIN=https://customer-<account-code>.cloudflarestream.com`
- `SAUTI_STREAM_STORAGE_SECONDS=60000` for the purchased 1,000-minute capacity
- `SAUTI_STREAM_INITIAL_SECONDS=0` **only after verifying that the Stream account
  is empty**; otherwise initialize this with the independently inventoried
  storage already consumed outside these managed jobs.
- Secret `SAUTI_STREAM_SOURCE_KEY`: 32 random bytes, base64url encoded without
  padding. Never commit or return it. It signs both origin-import capabilities
  and short-lived playback capabilities, with separate payload formats.

Nothing in this implementation buys or increases a plan. Storage reservations
include processing and uncertain imports, plus Story direct-upload allocations.
Delivery remains metered by Cloudflare separately from this storage guard.

## Playback and authorization

`GET /api/sauti-media/:id/playback` accepts the existing Bearer authorization or
the existing secure media-session cookie and performs a fresh, uncached RLS
lookup. Its response is `{ ok: true, data: { type, url, expires_in, expires_at,
qualities } }`. `expires_at` is an ISO timestamp; `expires_in` is at most 300.

- `mp4`: the existing canonical first-party URL while processing/unavailable.
- `hls`: `/api/sauti-media/:id/hls/:opaquePathIdentity?c=:capability`.

Every manifest and media request rechecks the current database ACL before
calling `serveSautiStreamHls`. The encrypted and HMAC-authenticated capability binds the asset
generation, path, authenticated session and expiry. Provider paths and signatures
stay inside AES-GCM ciphertext; the harmless `m_`/`s_` route hint allows clients
to cache segments while always fetching expiring manifests. An authenticated token
refresh in the same Supabase session retains that binding; parsing the claims
does not authenticate a request or grant access.

The gateway generates a provider token internally. The browser/app never sees
that token or sends its SautiLink credential to Cloudflare. The manifest parser
rewrites variant, audio, subtitle, iframe, MAP and key URI attributes and media
lines to first-party capabilities. Other origins, path escapes, unsupported
external-resource tags and malformed URI attributes fail closed. Authorized
responses use `no-store` and disclose no signed provider URL.

The web player lazily loads the exact lockfile-pinned HLS.js 1.7.3 asset, served
from SautiLink. It uses actual manifest levels for quality choices and HLS
bandwidth adaptation. A healthy HLS source is excluded from the older MP4
rendition switching and blob-recovery paths. Failed processing/provider playback
retains MP4 fallback. Pause, speed, position and current-player checks are
preserved on attach/renewal. No third-party script origin or relaxed CSP is needed.

## Existing and new post videos

`prepareSautiStreamVideo(env, row)` accepts only an attached canonical video row
with a current post ID. It verifies the R2 object's exact path, owner/media
metadata, validated marker, size, and generation ETag. It first creates a durable
job and reserves capacity using R2 conditional writes. Only the winning claimant
can start the provider operation. New post creation queues this work with
`ctx.waitUntil` after all media attachments succeed.

The provider fetches a 15-minute opaque HMAC source capability at
`/api/sauti-media/:id/stream-source`; this route supports HEAD and exact byte
ranges and carries no user Bearer token. Source replacement or job cancellation
invalidates it. Unknown upload outcomes are reconciled by unique job metadata,
never by replaying a potentially successful provider POST.

The scheduled inventory caller must obtain **all** attached video rows using a
scoped server-only inventory capability, including followers-only and Room
posts. Anonymous/public RLS results are insufficient for a complete migration.
It must exclude unattached/pending/deleted rows and batch a small number of
`inspectSautiStreamImportCandidate` / `prepareSautiStreamVideo` calls per run.
Inventory authorization does not grant viewers any new read access.

`sweepSautiStreamJobs(env, { validate, limit: 25 })` polls a bounded durable
cursor. `validate(job)` has three outcomes:

- `true`: the current database source/Story still exists and is eligible; poll.
- `false`: source is explicitly deleted/expired; tombstone and delete the copy.
- `null`/`undefined`: an uncertain read or unavailable database; skip safely.

Post deletion tombstones the job and performs idempotent Stream deletion before
R2 cleanup. If a concurrent/unknown import has not returned its ID, the tombstone
is retained for later discovery and cleanup. Capacity is released only after
provider deletion, and a failed release is retried on later sweeps.

## Stories helpers

The Story API owns authentication, quota, expiry and current row authorization:

- `createSautiStoryStreamUpload(env, { id, owner_id })`: reserve 30 seconds,
  create a signed-only, owner-bound one-time direct upload. Returns a durable job
  including `stream_uid`, `upload_url`, `upload_expires_at` (Unix seconds) and
  `generation`. The upload URL is for multipart upload without a SautiLink JWT.
- `readySautiStoryStreamAsset(env, { id, owner_id })`: poll and return the ready
  job only after Cloudflare confirms signed-only access, matching ownership and
  metadata, and a server-measured duration of at most 30 seconds. Polling is
  throttled to 15 seconds. The publish API must represent processing as retryable.
- Use `{ kind: 'story', id, stream_uid, generation }` with
  `sautiStreamPlaybackDescriptor` / `serveSautiStreamHls`,
  `basePath: /api/stories/:id/hls/`, and `expiresAt: story.expires_at`.
- `serveSautiStreamThumbnail(request, env, asset, { expiresAt })` returns a
  bounded, validated JPEG from the private provider thumbnail, after the caller's
  current Story authorization. It never returns a provider token.
- `deleteSautiStreamVideo(env, { id, owner_id }, 'story')` is the durable cleanup
  hook for owner deletion, abandoned uploads and 24-hour expiry.

Story expiry must be enforced on every public response before calling a helper;
the scheduled cleanup also removes the actual provider video. Do not use
Cloudflare's scheduled deletion for a 24-hour promise, since that API's minimum
retention is 30 days.

## Verification

`node --test tests/sauti-stream-delivery.test.mjs` covers import concurrency,
capacity, uncertain provider outcomes, source Range/HMAC/ETag, cancellation races,
direct-upload ownership/duration, manifest rewriting/SSRF, first-party capability
scope/expiry, session refresh, thumbnails, and preservation of the existing RLS
denial. Before rollout, inspect an actual account-specific private Stream master
and child manifest through the gateway and test real playback/quality switching.
