# SautiLink opt-in TOTP MFA — database enforcement review

**Status: proposed SQL only, NOT applied to production.** This document deliberately lives outside `supabase/migrations` so that no release runner can automatically apply it. Before any migration, test on an active isolated Supabase project. Production currently has zero verified MFA factors; the existing Play Store Android app is not confirmed to handle a fresh MFA challenge.

## Evidence and scope (2026-11-15)
- Inspected production `pg_policies`: 129 RLS policies on public tables; none reference `aal`.
- `auth.mfa_factors` has columns `user_id`, `status` and `factor_type`.
- Existing permissive owner/participant policies protect `public.account_profiles`, `public.dm_messages`, `public.dm_conversations`, and `public.social_notifications`.
- These policies are **additional restrictive policies**, never a replacement for owner/participant predicates.
- Only sessions for users with a **verified** MFA factor must carry `aal2`. Users with no verified factors remain allowed with `aal1` or `aal2`.
- Public/discoverable posts and profiles must remain visible; do not gate their public reads.

## DRAFT enforcement SQL (do not run on production)

This uses the **opt-in MFA pattern published by Supabase**. First confirm that the effective authenticated role can execute the factor lookup in the policy on a disposable test project. A common failure mode is `permission denied for schema auth`; never grant unauthenticated users access to `auth.mfa_factors` or its secret column just to make these policies work. If permissions block the lookup, redesign it with an audited private SECURITY DEFINER helper, explicit `auth.uid()` binding, pinned search path and minimal EXECUTE grants. Do not push an unreviewed helper into the exposed API.

```sql
-- SautiLink MFA policy proposal. NOT A MIGRATION.
-- Do not run before Android MFA compatibility and account recovery E2E pass.
-- Run first on a throwaway Supabase project using representative test identities.
BEGIN;

-- Protected self-only account profile (private personal details).
CREATE POLICY account_profiles_mfa_select_opt_in
  ON public.account_profiles AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    ARRAY[(SELECT auth.jwt()->>'aal')] <@ (
      SELECT CASE WHEN count(id)>0 THEN ARRAY['aal2'] ELSE ARRAY['aal1','aal2'] END
      FROM auth.mfa_factors
      WHERE (SELECT auth.uid()) = user_id AND status = 'verified'
    )
  );
CREATE POLICY account_profiles_mfa_update_opt_in
  ON public.account_profiles AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (
    ARRAY[(SELECT auth.jwt()->>'aal')] <@ (
      SELECT CASE WHEN count(id)>0 THEN ARRAY['aal2'] ELSE ARRAY['aal1','aal2'] END
      FROM auth.mfa_factors
      WHERE (SELECT auth.uid()) = user_id AND status = 'verified'
    )
  )
  WITH CHECK (
    ARRAY[(SELECT auth.jwt()->>'aal')] <@ (
      SELECT CASE WHEN count(id)>0 THEN ARRAY['aal2'] ELSE ARRAY['aal1','aal2'] END
      FROM auth.mfa_factors
      WHERE (SELECT auth.uid()) = user_id AND status = 'verified'
    )
  );

-- Private direct messages (sender and participant policies already exist).
CREATE POLICY dm_messages_mfa_select_opt_in
  ON public.dm_messages AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    ARRAY[(SELECT auth.jwt()->>'aal')] <@ (
      SELECT CASE WHEN count(id)>0 THEN ARRAY['aal2'] ELSE ARRAY['aal1','aal2'] END
      FROM auth.mfa_factors
      WHERE (SELECT auth.uid()) = user_id AND status = 'verified'
    )
  );
CREATE POLICY dm_messages_mfa_insert_opt_in
  ON public.dm_messages AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    ARRAY[(SELECT auth.jwt()->>'aal')] <@ (
      SELECT CASE WHEN count(id)>0 THEN ARRAY['aal2'] ELSE ARRAY['aal1','aal2'] END
      FROM auth.mfa_factors
      WHERE (SELECT auth.uid()) = user_id AND status = 'verified'
    )
  );
CREATE POLICY dm_messages_mfa_update_opt_in
  ON public.dm_messages AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (
    ARRAY[(SELECT auth.jwt()->>'aal')] <@ (
      SELECT CASE WHEN count(id)>0 THEN ARRAY['aal2'] ELSE ARRAY['aal1','aal2'] END
      FROM auth.mfa_factors
      WHERE (SELECT auth.uid()) = user_id AND status = 'verified'
    )
  )
  WITH CHECK (
    ARRAY[(SELECT auth.jwt()->>'aal')] <@ (
      SELECT CASE WHEN count(id)>0 THEN ARRAY['aal2'] ELSE ARRAY['aal1','aal2'] END
      FROM auth.mfa_factors
      WHERE (SELECT auth.uid()) = user_id AND status = 'verified'
    )
  );

CREATE POLICY dm_conversations_mfa_select_opt_in
  ON public.dm_conversations AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    ARRAY[(SELECT auth.jwt()->>'aal')] <@ (
      SELECT CASE WHEN count(id)>0 THEN ARRAY['aal2'] ELSE ARRAY['aal1','aal2'] END
      FROM auth.mfa_factors
      WHERE (SELECT auth.uid()) = user_id AND status = 'verified'
    )
  );
CREATE POLICY dm_conversations_mfa_insert_opt_in
  ON public.dm_conversations AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    ARRAY[(SELECT auth.jwt()->>'aal')] <@ (
      SELECT CASE WHEN count(id)>0 THEN ARRAY['aal2'] ELSE ARRAY['aal1','aal2'] END
      FROM auth.mfa_factors
      WHERE (SELECT auth.uid()) = user_id AND status = 'verified'
    )
  );

-- Private notifications.
CREATE POLICY social_notifications_mfa_select_opt_in
  ON public.social_notifications AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    ARRAY[(SELECT auth.jwt()->>'aal')] <@ (
      SELECT CASE WHEN count(id)>0 THEN ARRAY['aal2'] ELSE ARRAY['aal1','aal2'] END
      FROM auth.mfa_factors
      WHERE (SELECT auth.uid()) = user_id AND status = 'verified'
    )
  );
CREATE POLICY social_notifications_mfa_update_opt_in
  ON public.social_notifications AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (
    ARRAY[(SELECT auth.jwt()->>'aal')] <@ (
      SELECT CASE WHEN count(id)>0 THEN ARRAY['aal2'] ELSE ARRAY['aal1','aal2'] END
      FROM auth.mfa_factors
      WHERE (SELECT auth.uid()) = user_id AND status = 'verified'
    )
  )
  WITH CHECK (
    ARRAY[(SELECT auth.jwt()->>'aal')] <@ (
      SELECT CASE WHEN count(id)>0 THEN ARRAY['aal2'] ELSE ARRAY['aal1','aal2'] END
      FROM auth.mfa_factors
      WHERE (SELECT auth.uid()) = user_id AND status = 'verified'
    )
  );

-- NOTE: Evaluate remaining private rows and server APIs before release.
COMMIT;
```

## Staging acceptance checks

1. **No MFA registered:** a fresh `aal1` token retains the preexisting self/participant access, and cannot access another user's records.
2. **Verified factor, unverified new session:** `aal1` sees no private account data or DMs and cannot mutate them. Auth login and factor verification remain usable.
3. **Factor verified during the same session:** `aal2` restores that user's private reads and writes but not another user's records.
4. **Factor unenrolled:** test fresh token update, old JWT lifetime, and revocation of old `aal2` sessions. Do not claim instant revocation until verified.
5. **Web + Android:** demonstrate 2FA challenge and recovery on both clients. The GitHub Android workflow currently packages the production web artifact through Capacitor; that does **not** substitute for a real Play Store install and login test.
6. **RLS failure simulation:** ensure permission denied, timeout or missing factor lookup does not accidentally allow an enrolled user.
7. **Cloudflare Workers/Edge Functions/R2:** inventory endpoints using privileged service keys; RLS does not protect service_role bypass traffic, and every sensitive endpoint needs independently verified JWT + opt-in MFA checks.
8. **Audit existing policy names, grants and current production schema** again immediately before any migration; fail if they changed.

## Rollback plan (test project first)

```sql
BEGIN;
DROP POLICY IF EXISTS account_profiles_mfa_select_opt_in ON public.account_profiles;
DROP POLICY IF EXISTS account_profiles_mfa_update_opt_in ON public.account_profiles;
DROP POLICY IF EXISTS dm_messages_mfa_select_opt_in ON public.dm_messages;
DROP POLICY IF EXISTS dm_messages_mfa_insert_opt_in ON public.dm_messages;
DROP POLICY IF EXISTS dm_messages_mfa_update_opt_in ON public.dm_messages;
DROP POLICY IF EXISTS dm_conversations_mfa_select_opt_in ON public.dm_conversations;
DROP POLICY IF EXISTS dm_conversations_mfa_insert_opt_in ON public.dm_conversations;
DROP POLICY IF EXISTS social_notifications_mfa_select_opt_in ON public.social_notifications;
DROP POLICY IF EXISTS social_notifications_mfa_update_opt_in ON public.social_notifications;
COMMIT;
```

Rollback removes ONLY the new restrictive policies; it does not touch existing permissive owner/participant policies.

**Supabase reference:** https://supabase.com/docs/guides/auth/auth-mfa#enforce-rules-for-mfa-logins
