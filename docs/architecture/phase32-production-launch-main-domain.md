# Phase 32 — Production Launch / Main Domain

## Status

**Completed:** 2026-09-02

SautiLink web MVP is live on the main domain.

Production social application:

- `https://sautilink.com/app/`
- `https://www.sautilink.com/app/`
- production API boundary under `/api/*`

The existing marketing/waitlist/legal website remains outside the social Worker route and continues to serve the apex root.

## Authorization

The project owner explicitly authorized Phase 32 by replying **“Endelea”** after the production/main-domain gate was presented.

## Production architecture

Public marketing website source:

- repository: `sautilink/sautilink`
- owns `/`, `/privacy`, `/terms`, `/help`, `/contact`, waitlist and other public pages.

Social application source:

- repository: `sautilink/test`
- production Worker: `sautilink-social-production`
- path-scoped routes only:
  - `sautilink.com/app`
  - `sautilink.com/app/*`
  - `sautilink.com/api/*`
  - `www.sautilink.com/app`
  - `www.sautilink.com/app/*`
  - `www.sautilink.com/api/*`

No global `sautilink.com/*` Worker route is used, so the social deployment cannot replace the existing website root.

## Production Supabase

Production project:

- name: `sautilink`
- ref: `rggpyiterdbbugluejcs`
- region: `eu-west-1`

Staging remains isolated:

- name: `sautilink-test`
- ref: `bbrydwzlhweuqxpgbahu`

Before cutover, production and staging social schema fingerprints matched exactly:

- selected social/account columns: 217 rows — MD5 `044879f5dbde3140398405db41be0f18`
- RLS policies: 77 rows — MD5 `a50ee68288958c8609aa05f38549757c`
- social/DM/onboarding functions: 43 rows — MD5 `bc00613ce45e6dd448c1178e0bca2d8e`
- selected indexes: 94 rows — MD5 `b2d2e0e9cf4e7f1b64cbb824a6d9c249`

Production already contained the MVP migration set through Phase 30, so Phase 32 required no database migration.

## Production build isolation

Checked-in social source remains staging-safe by default.

`scripts/build-production-release.mjs` creates generated production-only copies:

- `dist-production-worker/`
- `dist-production-site/`

The generated copies use production Supabase URL/ref and production publishable key. The source tree and `test.sautilink.com` continue to target staging.

`scripts/verify-production-artifact.mjs` fails the release if it finds:

- the staging Supabase ref/key;
- source maps/source-map references;
- secret-shaped credentials/private keys;
- staging noindex metadata;
- staging-only UI copy;
- broad root Worker routing.

The first PR verification caught a staging WebSocket project ref still present in the generated CSP. The build transformer was corrected before merge and the exact final head passed.

## Production UI normalization

The generated production app:

- removes `Private preview`;
- replaces the internal Phase 31 status badge with `Live`;
- removes staging `noindex` metadata;
- uses cache marker `32-production1`;
- uses `/logo.png`, available on the main website;
- preserves current Sautify and Create Post product language;
- preserves the approved app UI rather than redesigning it.

## Production media and rate limits

Production R2 bucket:

- `sautilink-media-production`
- created during the successful production run at `2026-09-02T20:10:27Z`
- private Worker binding for both profile and post media.

Production rate-limit namespace IDs are isolated from staging in range `3201`–`3215`.

## GitHub Cloudflare credential scope

The first post-merge production deployment stopped safely before Worker cutover because a newly referenced GitHub `production` environment had no Cloudflare secrets.

Feature recovery PR #47 switched the deployment job to the existing GitHub `staging` environment **only as the Cloudflare credential storage scope**. The application targets remain production-specific:

- Supabase: `rggpyiterdbbugluejcs`
- Worker: `sautilink-social-production`
- R2: `sautilink-media-production`
- rate limits: `3201`–`3215`
- routes: main-domain `/app` + `/api` only.

A dedicated GitHub production environment can later replace this credential scope once equivalent Cloudflare secrets are configured there; no product architecture change is required.

## PR and merge evidence

Feature PR #46:

- title: `Phase 32: Production Launch / Main Domain`
- final exact feature head: `7a4a29eed31414bf236ab0cdbce685cebe9cbffa`
- squash merge: `46ca421a9b719f0cc302f7c125ef588d590ccaa5`
- production artifact verification: PASS
- production Wrangler dry-run: PASS
- staging regression/Wrangler: PASS
- Brand Guard: PASS
- Workers Build: PASS

The first post-merge run stopped at Cloudflare credential preflight before social Worker deployment because the GitHub production environment had empty Cloudflare secret values.

Recovery PR #47:

- title: `Phase 32: restore production Cloudflare credential scope`
- final exact head: `5834e1822f83d4b220c79140638e734cf82bd6f7`
- squash merge: `db25eb06ce8ea764d01c0bbbb92682f5778c2305`
- full production verification: PASS
- staging regression: PASS
- Brand Guard: PASS
- Workers Build: PASS

## Successful production deployment

Post-recovery production deployment job:

- GitHub job ID: `100406266455`
- production Worker version: `e6c3b679-bea9-4b2a-8afb-d47c3fc424fe`
- Worker startup time reported: 6 ms
- production R2 bucket preflight/create: PASS
- path-scoped Worker deploy: PASS
- live cutover smoke: PASS

Cloudflare confirmed the six intended path routes only.

Live smoke propagation:

- attempt 1: edge was still converging (`health=404`, apex app 200, www app 404, root 200)
- attempt 2: `health=200`, `app=200`, `www_app=200`, `root=200`

Successful live health payload:

```json
{"ok":true,"data":{"status":"ok","service":"sautilink-web","phase":31,"environment":"production","checks":{"assets":true,"media":true,"rate_limits":true}}}
```

`phase:31` identifies the hardening/readiness contract version inherited from Phase 31; `environment:production` is the production environment assertion for the Phase 32 release.

The live cutover also verified:

- production request-ID correlation;
- no staging `X-Robots-Tag: noindex` on production app/health;
- production app shell contains Settings and `32-production1`;
- no `Private preview` or `Phase 31` visible app status copy;
- `www` app route serves the social app;
- apex root still contains `SautiLink — Join the Waitlist`;
- signed-out production `/api/account/export` returns HTTP 401 `AUTH_REQUIRED`.

## Supabase advisor state

Production security advisors retain two known warnings:

1. `complete_social_onboarding(text,text)` is an authenticated-executable SECURITY DEFINER function. It remains an intentional reviewed per-user bootstrap exception: `auth.uid()` binding, verified-email requirement, constrained inputs, fixed empty search path, and no anon/PUBLIC EXECUTE.
2. leaked-password protection remains disabled in Supabase Auth. This is a platform setting and should remain a tracked post-launch security improvement.

Performance advisors reported only low-traffic/new-workload `unused_index` INFO entries; Phase 32 introduced no schema regression.

## Completion

Phase 32 is complete. The planned web MVP roadmap from Phase 13 through Phase 32 is now complete and the social application is live on the main SautiLink domain.

Future work is post-MVP product development/operations rather than an unfinished launch phase. Deferred examples include group chat, voice/video calls, advanced real-time messaging, recommendation ranking, live audio/video, monetization/ads, marketplace, native apps, privileged export processing, and final automated account purge.
