# SautiLink Sticker Engine: Web Integration

## Scope

First-party sticker and inline animated emoji support is added as a progressive Web enhancement to SautiLink Chats, Comments and Rooms. It does **not** replace existing Supabase messaging tables, server-side moderation, reply controls or send authorization.

## Transport

The existing text fields store stable tokens:
- Full-size sticker: `[[sl-sticker:slv-heart]]`
- Inline emoji: `:slv-heart:`

Composers use native `input` events and the existing send forms. Any client that does not support these tokens shows them as text. Incoming messages are read through the existing authenticated queries; the Web renderer resolves only approved IDs against the first-party Sticker Engine.

## Connected Web surfaces

- Direct Message composer `#message-body` and timeline `#message-thread-feed`
- Canonical comment sheet `#conversation-reply-body` and `#conversation-thread`
- Inline post comment forms with `data-comment-form`
- Room composer `#circle-sauti-body` and message timeline `#circle-stream-feed`

The renderer does not use `innerHTML` or accept arbitrary media URLs. Stickers are only loaded from `https://stickers.sautilink.com` via its read-only API. Textual fallbacks are shown when the API is unavailable. Toggling Lite Mode or reduced-motion avoids loading animations.

## CSP

Updated `app/index.html`, `_headers` and the production artifact generator allow HTTPS requests and image loads from the dedicated sticker domain only, while keeping scripts self-hosted. The Lottie MIT canvas renderer is vendored into `app/assets/vendor` and no user-supplied Javascript is executed.

## Limitations and deployment

Native Android messages are not yet upgraded. This stage is a compatibility-first text-token transport, not a binary attachment or dedicated `message_kind=sticker` DB migration. Sending and receiving actual sticker objects with sync across clients will need an authenticated app backend contract later. Do not silently convert these text tokens into user-upload URLs.

Before production rollout, verify sticker picker insertion and display on real devices (DM incoming/outgoing, comment modal, inline comment, Room posts, mobile themes, long drafts, failed sends, permissions, offline and Lite Mode). Browser visual QA and Cloudflare deployment confirmation are not replaced by CI.

## Verification

- `node --test tests/sticker-token-codec.test.mjs tests/sticker-web-integration.test.mjs`
- `npm run build:app`
- `npm run build:production && npm run verify:production-artifact`
- `npm test`
