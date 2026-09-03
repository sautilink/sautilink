# Phase 34 — Advanced Real-Time Messaging

## Status

Implementation branch: `phase34-advanced-realtime-messaging`.

## Goal

Upgrade the existing one-to-one Direct Messages experience from refresh-driven delivery to privacy-gated real-time behavior without replacing the Phase 23 data model or redesigning the accepted SautiLink interface.

## Scope

- real-time inbox/unread refresh after message changes;
- live thread refresh when either participant sends or deletes a message;
- live read-receipt refresh through the existing Phase 30 privacy-gated RPC;
- cross-tab conversation-state refresh;
- opt-in typing indicators;
- opt-in online presence;
- resilient reconnect behavior with database resync;
- explicit teardown on sign-out, navigation and conversation changes;
- private Supabase Realtime channels only;
- regression tests for privacy, cleanup and production/staging isolation.

## Privacy model

Persistent message bodies remain canonical in `public.dm_messages` and remain protected by the existing participant RLS.

Database-triggered Realtime broadcasts never contain a message body. They emit only bounded change signals such as conversation ID, message ID and operation. The browser then reads the canonical row through normal RLS.

Per-user database signals use a private topic:

- `dm-user:<auth.uid()>`

Conversation activity uses a private topic:

- `dm:<conversation_uuid>`

Only authenticated conversation participants can join a conversation activity channel.

Typing and presence are additionally gated by the existing Phase 30 `activity_status` preference. When activity status is disabled, the member does not publish or receive conversation presence/typing activity.

The existing `read_receipts` preference remains canonical for whether a peer can see `Seen`. Realtime only prompts the browser to re-run the existing privacy-gated read-receipt RPC.

## Supabase Realtime architecture

Supabase recommends Broadcast for scalable database-change delivery and private channels with Realtime Authorization. Phase 34 follows that model.

The migration adds two RLS policies on `realtime.messages`:

- participant/user-topic receive policy;
- participant activity-send policy.

No other object is created, altered or dropped in the locked `realtime` schema.

Two private trigger functions call `realtime.send(..., true)`:

- message INSERT/UPDATE -> bounded `message_changed` signals to both participant user topics;
- conversation-state UPDATE -> owner `conversation_state_changed`, plus peer `read_state_changed` when the read marker changes.

The trigger functions are `SECURITY DEFINER`, fixed to an empty search path, live in the non-exposed `private` schema, and have browser execute privileges revoked.

## Explicit non-goals

- no group chat;
- no media/file messages;
- no voice/video calls;
- no disappearing messages;
- no E2EE claim;
- no exact last-seen timestamp;
- no public Realtime channel;
- no service-role/secret key in browser code;
- no replacement of the Phase 23 RLS model;
- no UI redesign.

## Staging validation

Phase 34 migration was rehearsed inside a rollback transaction before apply. The rehearsal returned:

- 2 Realtime RLS policies;
- 2 DM broadcast triggers;
- 2 private trigger functions.

The migration was then applied to staging project `sautilink-test` (`bbrydwzlhweuqxpgbahu`).

A first direct synthetic insert into `realtime.messages` revealed that the sleeping staging Realtime service had not yet created its daily message partitions. No internal Realtime table or partition was modified manually. A temporary branch-only GitHub workflow connected through the supported Supabase Realtime client; Supabase then created its managed daily partitions automatically.

After service bootstrap, synthetic transaction coverage verified:

- authenticated conversation participant can use the private conversation Broadcast/Presence authorization path when Activity status is enabled;
- database message trigger emits one bounded `message_changed` signal per participant;
- two participant signals were observed for a synthetic message;
- signal payloads contained zero message-body keys and zero message-body text;
- a non-participant Realtime write to the private conversation topic was denied by RLS;
- all synthetic preference/message/signal changes were rolled back.

Temporary branch live smoke:

- workflow run: `33685271704`;
- job: `100431140589`;
- branch staging Worker version: `dd81f3e0-11f0-4bf3-a5f2-f8d44503ceba`;
- full repository verification: PASS;
- staging Wrangler validation: PASS;
- Realtime client transport: `PHASE34_REALTIME_TRANSPORT_PASS`;
- live `/app/messages` shell: HTTP 200;
- live activity/typing markers and non-E2EE safety statement: PASS.

The temporary workflow was removed before the final clean feature head.

## Production preflight

After the exact verified runtime feature head was green, the same Phase 34 migration was applied successfully to production Supabase project `sautilink` (`rggpyiterdbbugluejcs`). The Phase 34 SQL regression then passed against production.

A temporary branch-only production Realtime transport preflight used the production publishable key only and verified the supported client transport before application merge:

- workflow run: `33685657131`;
- job: `100432413969`;
- production Realtime transport: `PHASE34_PRODUCTION_REALTIME_TRANSPORT_PASS`;
- full PR app/auth verification at the preflight head: PASS;
- Brand Guard at the preflight head: PASS;
- production-release artifact verification at the preflight head: PASS.

The production preflight workflow was removed before merge and is not part of the long-lived product surface.

Supabase security advisors show no new Phase 34-specific warning. The two known pre-existing warnings remain the reviewed onboarding SECURITY DEFINER RPC and disabled leaked-password protection. Performance advisors show only existing/low-traffic `unused_index` INFO findings.

## Operational boundary

Phase 33 production readiness monitoring remains mandatory.

A Phase 34 release is complete only after:

1. migration rehearsal passes;
2. staging migration and synthetic authorization checks pass;
3. Supabase security/performance advisors show no new Phase 34 blocker;
4. full repository tests and Brand Guard pass;
5. staging live smoke passes;
6. final exact PR head is clean and mergeable;
7. production migration is applied only after the exact verified feature head is ready for release;
8. PR is merged and production Worker deployment passes;
9. permanent Phase 33 production readiness remains green;
10. durable checkpoint is updated.
