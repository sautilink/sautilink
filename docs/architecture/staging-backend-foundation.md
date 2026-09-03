# Phase 11: staging backend foundation

## Status

This phase defines and tests the versioned database contract. The migration is **not applied** to production or to any shared Supabase project. It must be validated on an isolated staging project first.

The live page at `/preview/backend-foundation/` is a no-network architecture preview. It contains no Supabase URL, publishable key, service-role credential, production account or real message.

## Authority boundaries

- Supabase Auth is authoritative for identity and verified sessions.
- Supabase Postgres is authoritative for profiles, settings, Sauti, replies, follows, blocks, Circles, notifications, one-to-one messages and moderation reports.
- Cloudflare Workers enforce edge rate limits, abuse controls and privileged lifecycle transitions.
- Cloudflare R2 stores media objects. Postgres stores only relational records and, in the later media slice, object keys.
- D1 may eventually support a derived read model, but it cannot become a second source of truth.

The browser may receive a project URL and a modern Supabase publishable key. It must never receive a secret or service-role credential.

## Versioned schema

`20260826142952_create_social_mvp_foundation.sql` extends the existing split between private `account_profiles` and deliberately public `social_profiles`.

The phase adds:

- `social_blocks` and `social_follows`
- `social_circles` and `social_circle_members`
- `social_posts` for Sauti and public replies
- `user_social_settings`
- `social_notifications`
- `dm_conversations`, `dm_conversation_states` and `dm_messages`
- `social_reports`

Basic Messages uses one canonical two-member conversation row. Group chat remains outside the web MVP. Per-member state stores read and hidden timestamps without deleting the other participant's history.

## Security contract

- Every new `public` table enables and forces row-level security.
- Grants are explicit and minimal; automatic default privileges are not trusted.
- Ownership policies use `(select auth.uid())` and update policies include both `using` and `with check`.
- Foreign-key and policy lookup columns are indexed.
- Notification creation and moderation lifecycle changes are server-owned.
- Reports can be inserted by their authenticated reporter but cannot be read back through the public Data API.
- Conversation and message inserts reject blocked member pairs at the database boundary.
- Message bodies are limited to 4,000 characters; group chat, calls, file transfer and disappearing messages remain deferred.

No policy uses `user_metadata` as authorization input. No new `security definer` function is introduced. Realtime remains a delivery mechanism rather than the authoritative message store, and this phase does not modify the locked-down `realtime` schema.

## Staging activation gate

Before this migration can power the web preview:

1. Create or select an isolated Supabase staging project or paid development branch.
2. Confirm its project reference is not the production reference.
3. Apply all migrations in order and run the SQL contract tests.
4. Run Supabase security and performance advisors.
5. Configure only the staging project URL and publishable key for `test.sautilink.com`.
6. Keep secret/service-role credentials in server-only secret storage.
7. Exercise RLS with two ordinary test users, including block and DM isolation cases.

Only after those checks pass should seeded UI actions be replaced with real staging data.
