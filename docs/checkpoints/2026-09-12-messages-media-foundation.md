# Messages media foundation — 2026-09-12

## Scope
- Keep the existing one-to-one text Messages delivery path intact.
- Add optional photo, document and voice-note attachments.
- Reuse the private `SAUTI_MEDIA` R2 bucket with conversation-scoped object keys.
- Limit all message attachments to 5 MB.
- Limit voice notes to 5 minutes.
- Allow microphone access only to the SautiLink app origin; camera stays disabled.

## Database
- `dm_messages.message_kind`: `text`, `photo`, `file`, `voice`.
- New `dm_message_attachments` metadata table with RLS.
- Pending uploads are visible only to their owner.
- Sent media is readable only by conversation participants while the linked message is not deleted.
- `send_dm_media_message_phase35` is `SECURITY INVOKER`; RLS and the existing DM insert policies remain authoritative.
- Inbox previews use `Photo`, `Voice message` or `File` when attachment-only messages have no caption.

## Worker / storage
- `/api/dm-media/upload` validates auth, conversation access, size, MIME/signatures and image dimensions before R2 storage.
- `/api/dm-media/send/:id` atomically links ready media to a DM through the database RPC.
- `/api/dm-media/messages?conversation_id=...` returns participant-authorized attachment metadata.
- `/api/dm-media/:id` serves private media only after database/RLS authorization.
- Pending uploads can be deleted and also expire after one hour.
- Dedicated `DM_MEDIA_UPLOAD_LIMITER` added for staging and production.

## Browser UI
- Attachment button supports JPEG, PNG, WebP and common document formats.
- Voice button uses `MediaRecorder` and auto-stops at five minutes.
- Plain-text submits continue through the existing `sendDirectMessage()` path.
- Media messages hydrate through authenticated blob requests; file downloads also require auth.
- Existing service-worker cache generation is unchanged; app JS remains network-first.

## Safety / rollout
- Test Supabase received the migration first.
- Security advisor caught the initial `SECURITY DEFINER` RPC and it was hardened to `SECURITY INVOKER` before production.
- Production database must not receive this migration until PR CI and artifact checks pass.
- Durable Objects and audio calls remain separate follow-up phases after media is stable.
