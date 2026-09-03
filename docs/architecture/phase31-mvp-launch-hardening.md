# Phase 31 — MVP Launch Hardening

## Status

Completed on 2026-09-02.

- Feature PR: #43
- Final clean feature head: `e0bd65ade740c582354cad96a6fe32168ab7c0b8`
- Squash merge SHA: `d557f4c173ef32c12c81cc631fb1c910832b9d55`
- Branch live-smoke Worker: `28d8285a-2bc7-41cc-8815-d3398dfd48fd`
- Post-merge main Worker: `5bc725e4-e327-4760-8681-e119173f82a9`

Production and the main domain remained unchanged. Phase 32 requires explicit production authorization.

## Goal

Harden the existing web MVP for launch without adding a new social feature.

The phase focuses on release safety, staging isolation, deploy verification, runtime failure boundaries, accessibility preferences, and artifact hygiene.

## Scope

### 1. Staging isolation

`test.sautilink.com` must not become search-indexable by accident.

The Worker adds:

- `X-Robots-Tag: noindex, nofollow, noarchive` to every staging response;
- a staging-only `/robots.txt` response with `Disallow: /`.

The staged static artifact also carries the noindex header in `_headers` as defense in depth.

Production-like hostnames do not receive the staging noindex header from the Worker. Production crawler policy remains a Phase 32 decision.

### 2. Health and release readiness

A public, non-secret `GET /api/health` endpoint reports only coarse deployment readiness:

- static asset binding available;
- R2 media bindings available;
- required Cloudflare rate-limit bindings available.

It returns HTTP 200 when required bindings exist and HTTP 503 when the deployment is degraded.

No credentials, account information, database contents, bucket names, or secret values are returned.

### 3. Request correlation and global error boundary

The Worker assigns a bounded request ID:

- a valid caller-supplied `X-Request-ID` may be preserved;
- otherwise a new UUID is generated.

Every response receives `X-Request-ID`.

Unexpected Worker exceptions are caught at the top-level router:

- API requests receive a generic structured `INTERNAL_ERROR` plus request ID;
- web requests receive a generic temporary-unavailable response;
- internal exception text is not sent to the browser.

### 4. Deployment race prevention and permanent live smoke

The existing `main` staging deploy job is serialized using a dedicated GitHub Actions concurrency group.

After every successful `main` staging deploy, the workflow permanently verifies:

- `/api/health` is HTTP 200 and Phase 31 ready;
- staging `X-Robots-Tag` is present;
- request-ID correlation is preserved;
- `/app/settings` serves the current app shell;
- `/robots.txt` blocks indexing;
- a representative signed-out protected API still returns HTTP 401 `AUTH_REQUIRED`.

The readiness probe retries briefly for Cloudflare propagation instead of treating immediate edge convergence as an application failure.

### 5. Staged artifact hygiene

`npm run check` now builds the staged site and runs `scripts/verify-staging-artifact.mjs` before the test suite.

The verifier fails if the staged artifact contains:

- source/repository directories such as `src`, `supabase`, `docs`, `tests`, `.git`, or `.github`;
- package/config/development secret files;
- source maps or source-map references;
- secret-key markers such as `sb_secret_`, service-role key environment names, Cloudflare API-token names, or private-key PEM markers.

It also verifies required staged assets and the staging noindex rule.

### 6. CSP and staging-preview consistency

Generated staging development/MVP pages no longer use inline `<style>` blocks under a `style-src 'self'` CSP.

Their CSS is written as separate staged files:

- `/assets/development.css`;
- `/preview/mvp/mvp.css`.

Stale pre-Sautify staging labels are corrected to the current product language:

- Sautify;
- Create Post.

Stable internal database/API identifiers remain unchanged.

### 7. Reduced-motion support

The live app respects `prefers-reduced-motion: reduce`:

- JavaScript smooth scrolling switches to automatic scrolling;
- CSS animation/transition duration is minimized.

No visual redesign is introduced.

## Supabase launch-security review

Phase 31 does not change the Supabase schema unless a verified launch blocker requires it.

The existing advisor warning on `public.complete_social_onboarding(text,text)` was inspected against the current function definition.

This is an intentional authenticated per-user onboarding RPC:

- binds identity to `auth.uid()`;
- requires a confirmed email;
- validates and reserves username format;
- validates display-name length;
- prevents account username mismatch;
- uses a fixed empty search path;
- grants EXECUTE to authenticated/service-role only, not anon/PUBLIC.

Because the function atomically creates the caller's account/social profile rows that authenticated users cannot insert directly, Phase 31 treats the SECURITY DEFINER finding as an intentional reviewed exception rather than rewriting onboarding into a riskier multi-step client flow.

Leaked-password protection remains a Supabase platform-setting warning and is not silently changed by repository code.

## Non-goals

Phase 31 does not add:

- new social features;
- personalized ranking;
- group chat or calls;
- monetization;
- production search indexing;
- production domain routing;
- automated final account deletion;
- export archive processing;
- native apps.

## Completion gates

Before Phase 31 can close:

1. full build/tests and staged-artifact verifier pass;
2. Brand Guard passes;
3. Wrangler deployment validation passes;
4. Workers Build passes;
5. Supabase security/performance advisors are reviewed for launch regressions;
6. branch deployment to `test.sautilink.com` passes Phase 31 live readiness smoke;
7. temporary branch-only smoke workflow, if needed, is removed before merge;
8. final exact PR head is non-draft, mergeable and clean;
9. exact-head merge completes without bypassing gates;
10. post-merge `main` CI passes;
11. permanent post-deploy live smoke passes on the `main` deployment;
12. durable checkpoint advances to Phase 32 — Production Launch / Main Domain.

Production remains untouched until Phase 32 receives explicit authorization.


## Completion evidence

- Full application build/tests passed with the Phase 31 staged-artifact verifier enabled inside `npm run check`.
- The artifact verifier confirmed the staged allowlist, required public assets, no source maps/source-map references, and no actual secret-key patterns in the 65-file staging artifact.
- The first verifier implementation intentionally failed CI on a generic `sb_secret_` literal present in the bundled Supabase client library. The scanner was corrected to detect actual credential-shaped values rather than library safety-code prefixes; the corrected verifier passed without weakening secret-file/path/source-map guards.
- Existing historical tests were kept strict but made forward-compatible where Phase 31 legitimately added CSP-safe staged CSS and reformatted the Worker route expression.
- Staging generated development/MVP pages now use external self-hosted CSS under the existing strict `style-src 'self'` CSP rather than inline style blocks.
- Staging is protected from accidental indexing by both Worker `X-Robots-Tag: noindex, nofollow, noarchive` and a staging-only `robots.txt` with `Disallow: /`.
- `GET /api/health` returns only coarse readiness for assets, media bindings and rate-limit bindings, and fails closed with HTTP 503 when a required binding is absent.
- Every Worker response receives a bounded `X-Request-ID`; unexpected exceptions are converted to generic responses without leaking internal exception details.
- Reduced-motion preferences are respected by both JavaScript scroll behavior and CSS animation/transition guards.
- Staging copy was synchronized to current product language: Sautify and Create Post.
- Supabase security advisors showed no new Phase 31-specific finding. The existing `complete_social_onboarding` SECURITY DEFINER warning was inspected against its live definition and accepted as an intentional, tightly validated authenticated per-user bootstrap RPC. Leaked-password protection remains a separate Supabase Auth platform-setting warning.
- Supabase performance advisors showed only existing/low-traffic `unused_index` INFO entries; Phase 31 introduced no schema change or new unindexed-foreign-key debt.
- Branch live staging smoke passed on Worker `28d8285a-2bc7-41cc-8815-d3398dfd48fd`. It verified health HTTP 200 with Phase 31 readiness, staging noindex/robots, request-ID correlation, the current Settings shell, and signed-out account/moderation API boundaries returning HTTP 401 `AUTH_REQUIRED`.
- Temporary `.github/workflows/phase31-staging.yml` was removed before final clean-head CI and was not merged to `main`.
- Final clean feature head `e0bd65ade740c582354cad96a6fe32168ab7c0b8` was non-draft, mergeable `true`, `mergeable_state=clean`, and passed Brand Guard, full build/tests + artifact verification, Wrangler validation and Workers Build.
- PR #43 squash-merged to `main` as `d557f4c173ef32c12c81cc631fb1c910832b9d55`.
- Post-merge `main` passed Brand Guard, full build/tests + artifact verification, Wrangler validation and Workers Build.
- The permanent serialized main-deployment workflow then deployed `test.sautilink.com` as Worker `5bc725e4-e327-4760-8681-e119173f82a9` and passed its new live readiness gate on the first convergence attempt: health/settings/robots HTTP 200 plus signed-out account API HTTP 401 `AUTH_REQUIRED`.
- The next roadmap milestone is **Phase 32 — Production Launch / Main Domain**, but it must not begin until the project owner explicitly authorizes production launch.
