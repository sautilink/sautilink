# SautiLink Media and R2 preview

**Milestone:** Preview 05 — Media & R2

**Branch:** `phase-1/r2-media-preview`

**Production impact:** None. This preview uses seeded browser state, blocks all
network connections and creates no Cloudflare R2 bucket, object or credential.

## Outcome

This milestone defines the reviewable interaction contract for:

- image and short-video attachments in the Sauti composer;
- a four-item attachment limit and visible file metadata;
- upload progress, offline queueing, validation failure, retry and removal;
- alternative-text editing before a Sauti is shared;
- media-only Sauti and media retained inside local drafts;
- one- and two-item Stream galleries with a focused media viewer; and
- responsive light/dark presentation with keyboard-close behavior.

The visual media is original CSS artwork and contains no donor assets, external
URLs or real member files.

## Production upload boundary

The browser will never receive a permanent R2 credential. The planned flow is:

1. an authenticated app asks the Worker to begin an upload;
2. the Worker validates account state, quota, declared MIME type and size;
3. the Worker creates an unpredictable user-scoped object key and returns a
   short-lived, operation-specific upload authorization;
4. the browser uploads directly to R2 and reports the resulting checksum/ETag;
5. a finalization endpoint verifies object ownership, magic bytes, actual size,
   checksum, media dimensions/duration and moderation state;
6. Postgres records only the approved object key and metadata; and
7. incomplete, rejected and detached objects are removed idempotently by a
   Queue consumer and R2 lifecycle rules.

Single-part uploads are preferred for small images. Larger videos use multipart
uploads with explicit abort/retry handling. CORS will permit only approved
SautiLink origins, methods and headers.

## Donor intake

Meadows contributes gallery/composer product research only. Bluesky contributes
media-viewer, accessibility and alt-text product-pattern research. Telegram
contributes offline/delivery-state product-pattern research. No donor storage,
authentication, SQL, upload implementation, brand assets or analytics are
accepted. The code, copy and visual system are original SautiLink work.

## Production gate

Before public media uploads are enabled:

1. Preview 05 must be approved;
2. a non-production R2 bucket and Worker binding must be created separately;
3. upload authorization/finalization endpoints need authentication, rate
   limits, idempotency, magic-byte validation and ownership tests;
4. attachment metadata requires grants, indexes, RLS and SQL policy tests;
5. CORS, lifecycle cleanup, checksum verification and orphan sweeps must pass;
6. image/video moderation and reporting hooks must be operational; and
7. browser E2E, failure injection, load tests and a production dry-run must pass.
