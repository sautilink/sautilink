# Phase 23 — Real Direct Messages MVP

Status: **staging acceptance gate**

Phase 23 activates the one-to-one Direct Messages foundation that previously existed only as seeded preview data and dormant Supabase tables. It keeps the accepted SautiLink app shell intact and does not introduce group chat, attachments, calls, presence, typing indicators, disappearing messages, or end-to-end-encryption claims.

## Live scope

- Messages navigation on desktop and mobile.
- Unread badge for direct messages.
- Inbox sorted by latest activity.
- Client-side inbox search by display name or username.
- Open a conversation from a discoverable profile.
- Start a conversation by exact username.
- Direct route: `/app/messages`.
- Thread route: `/app/messages/:conversationId`.
- One-to-one text messages up to 4,000 characters.
- Mark conversation read when opened.
- Hide/delete a conversation from your own inbox only.
- A new message restores a locally hidden conversation.
- Sender can delete their own message for both participants.
- Report an incoming DM through the existing Trust & Safety report flow.
- Block/unblock from the thread.
- Blocking stops new delivery while retaining existing message history.

## Explicit privacy statement

Phase 23 does **not** claim end-to-end encryption.

The live thread UI explicitly tells members that private messages are not end-to-end encrypted and should not be used for passwords or sensitive account credentials.

## Existing database foundation reused

Phase 23 reuses:

- `public.dm_conversations`
- `public.dm_messages`
- `public.dm_conversation_states`

The foundation already had a canonical two-member conversation key. Phase 23 hardens and activates it instead of creating a parallel chat schema.

## Conversation creation

`public.open_dm_conversation_phase23(peer_id)` is a SECURITY INVOKER RPC.

It:

- requires an authenticated user
- rejects self-conversations
- canonicalizes the two profile IDs
- reuses an existing conversation where one exists
- only creates a new conversation when the peer is discoverable
- remains subject to normal conversation INSERT RLS
- cannot create a conversation across a block relationship

The RPC is not SECURITY DEFINER.

New conversations automatically receive one private state row per participant through an internal trigger.

Empty conversations are visible to their creator but do not appear in the recipient's inbox until a first message exists.

## Message delivery boundary

Authenticated browser INSERT access is column-scoped to:

- `conversation_id`
- `sender_id`
- `body`

The browser cannot supply message IDs, server timestamps, edited timestamps, or deletion timestamps during INSERT.

A private BEFORE INSERT trigger:

- confirms `auth.uid()` matches the sender
- confirms the sender is a conversation participant
- rechecks the block boundary
- trims the body
- assigns the server timestamp with `clock_timestamp()`
- normalizes edit/delete fields
- enforces a maximum of 30 messages per sender per minute

An internal AFTER INSERT trigger updates conversation activity and restores hidden inbox state for both participants.

## Read and inbox state

Conversation state rows are server-created. Browser INSERT on `dm_conversation_states` is revoked.

The authenticated member can only read their own state and update:

- `last_read_at`
- `hidden_at`

`public.dm_inbox_phase23()` is a SECURITY INVOKER read model. It returns only participant conversations permitted by RLS, latest-message preview, and per-user unread count.

## Message deletion

Browser UPDATE access on `dm_messages` is column-scoped to `deleted_at` only.

Only the original sender may use the Phase 23 soft-delete policy.

An internal trigger normalizes the operation by:

- setting the server deletion timestamp
- replacing the stored live body with `Message deleted.`
- preventing edit metadata from being injected through the deletion path

The UI does not present message editing in this MVP.

## Conversation deletion semantics

“Delete conversation” means **remove from your inbox**.

It updates only the signed-in member's `hidden_at` state.

It does not delete the other participant's history. If a new message arrives, the internal message trigger clears the hidden state and the conversation returns to the inbox.

## Blocking

Existing DM history remains visible after a block so the member retains context and can report abusive content.

New DM INSERTs are blocked if either participant has blocked the other.

The thread also exposes the existing SautiLink block/unblock control for discoverable peers.

## Message reports

Phase 23 activates the already-allowed `message` target type in the Trust & Safety system.

The report target is the numeric `dm_messages.id`.

The report validation trigger confirms:

- the message exists
- the reporter is a participant in that conversation
- the reported message was not sent by the reporter

Reports continue through the existing rate-limited Trust & Safety Worker; direct browser report-table writes are not introduced.

## Synthetic verification — 2026-09-01

All behavior tests ran in transactions and were rolled back.

- creator sees own conversation state: **1**
- total state rows created per conversation: **2**
- message body trimmed server-side: **PASS**
- recipient inbox contains delivered conversation: **PASS**
- unread before opening thread: **1**
- unread after read marker: **0**
- hidden conversation removed from recipient inbox: **0 rows**
- new message restores hidden conversation: **PASS**
- unread after restored new message: **1**
- incoming DM report validation: **PASS**
- sender soft-delete replaces live body: **PASS**
- existing history remains visible after block: **PASS**
- blocked send rejected: **PASS**

## Privilege audit

- anonymous DM table privileges: **0**
- conversation INSERT columns:
  - `created_by`
  - `member_one_id`
  - `member_two_id`
- message INSERT columns:
  - `body`
  - `conversation_id`
  - `sender_id`
- message UPDATE columns:
  - `deleted_at`
- browser state INSERT: **denied**
- authenticated execute on `open_dm_conversation_phase23`: **allowed**
- authenticated execute on `dm_inbox_phase23`: **allowed**
- authenticated execute on private send trigger: **denied**

## Supabase advisors

No new Phase 23 security warning was reported.

Existing unrelated warnings remain:

- intentional authenticated `public.complete_social_onboarding(...)` SECURITY DEFINER onboarding boundary
- leaked-password protection disabled on the current project plan/settings

Performance advisor output contains staging unused-index notices only. No new missing-index blocker was reported for Phase 23.

## Deferred

- group chat
- voice/video calls
- attachments
- media messages
- end-to-end encryption
- disappearing messages
- typing indicators
- presence/online status
- realtime high-volume delivery
- push/email DM notifications
- message editing
- advanced conversation requests/spam folders

## Build and staging

Phase 23 branch validation completed before the temporary staging workflow was removed:

- application build: **PASS**
- full test suite: **PASS**
- Phase 23 focused tests: **PASS**
- SautiLink Brand Guard: **PASS**
- Cloudflare deployment validation: **PASS**
- generated browser bundle synchronized: **PASS**
- deploy to `test.sautilink.com`: **PASS**
- production: **unchanged**

Successful staging workflow run: `33539749777`.

The temporary branch-only staging workflow was removed after successful deployment.

## Staging acceptance gate

Before Phase 23 can merge, verify on `test.sautilink.com`:

1. Messages appears in desktop and mobile navigation.
2. Start a conversation from another member's discoverable profile.
3. Start a conversation by entering an exact username.
4. Send text from Account A and confirm Account B receives it after refresh/open.
5. Confirm Account B sees an unread Messages badge before opening the thread.
6. Open the thread and confirm unread clears.
7. Send replies in both directions.
8. Search the inbox by username/name.
9. Delete one of your own messages and confirm both participants see `Message deleted.`.
10. Report an incoming message and confirm the Trust & Safety submission succeeds.
11. Delete/hide a conversation from one account and confirm it remains on the other account.
12. Send a new message and confirm the hidden conversation returns.
13. Block the peer and confirm old history remains visible but new sends fail.
14. Unblock and confirm sending works again.
15. Confirm a non-participant cannot open a copied `/app/messages/:conversationId` route.
16. Confirm mobile inbox/thread/composer layout remains usable.
