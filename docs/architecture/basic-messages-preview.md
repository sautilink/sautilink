# Basic Messages preview

**Status:** Phase 09 seeded web preview

This phase adds the smallest useful private messaging loop to the SautiLink web
MVP. It is intentionally separate from public replies and threads.

## Included

- One-to-one text conversations
- Conversation search and unread counts
- Message timestamps and sent/read labels
- Local send interaction
- Block, unblock, report, and delete controls
- Responsive inbox and thread layouts

## Privacy and delivery boundary

The preview uses fictional seeded conversations. Every interaction remains in
React state inside the browser. It has no Supabase client, Worker API call,
analytics request, external media, or production account identifier.

Before real delivery is enabled, the backend milestone must define authenticated
participants, row-level security, abuse rate limits, message retention, deletion
semantics, report evidence handling, and notification privacy.

## Deferred

- Group chat
- Voice or video calls
- Large attachments
- Disappearing messages
- End-to-end encryption claims
- Presence, typing indicators, and high-volume real-time delivery
