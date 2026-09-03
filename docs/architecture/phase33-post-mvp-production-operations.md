# Phase 33 — Post-MVP Production Operations & Reliability

> Historical release record. The root marker was later changed from the waitlist copy to the canonical `/login` account-entry redirect; see the current project operating checkpoint.

## Status

**Completed:** 2026-09-02

Feature branch: `phase33-post-mvp-production-operations`.

Feature PR #49 was squash-merged to `main` after the exact final head passed the repository, staging, production-artifact, production-Wrangler, brand and live-readiness gates.

## Goal

Add a small, durable production-operations layer that continuously checks the live SautiLink social application without redesigning the product, changing its database schema, or widening the production Worker route boundary.

## Delivered scope

- reusable Node.js production readiness probe: `scripts/check-production-readiness.mjs`;
- permanent GitHub Actions workflow: `.github/workflows/phase33-production-operations.yml`;
- automatic production probe every six hours;
- manual `workflow_dispatch` support;
- live production health verification for assets, media and rate-limit bindings;
- apex and `www` app-route checks;
- production request-ID correlation check;
- production/staging `noindex` isolation check;
- signed-out protected API fail-closed check for HTTP 401 `AUTH_REQUIRED`;
- root marketing-site ownership check using the `Join the Waitlist` marker;
- production incident and rollback runbook: `docs/operations/production-runbook.md`;
- regression coverage that keeps the monitor read-only and the Phase 32 production boundaries intact.

## Explicit non-goals preserved

- No Supabase schema migration.
- No production data mutation.
- No product UI redesign.
- No change to Sautify or Create Post terminology.
- No expansion of the path-scoped production Worker to the marketing root.
- No new Cloudflare or Supabase secret.
- No paid monitoring dependency.
- No native-app, recommendation, group-chat, voice/video, monetization or marketplace work in this phase.

## Reliability design

The monitor is public-endpoint-only and requires no deployment credentials. It runs with `contents: read` permission and no write permission.

The schedule is every six hours rather than every few minutes to stay compatible with the project's zero-budget operating principle while still detecting persistent production outages between deployments.

Each run retries transient failures a small bounded number of times, then fails visibly through GitHub Actions. The workflow does not create issues, mutate production or expose credentials.

## Production boundaries preserved

Production social Worker:

- `sautilink-social-production`

Production media bucket:

- `sautilink-media-production`

Production Supabase ref:

- `rggpyiterdbbugluejcs`

Staging Supabase ref remains isolated:

- `bbrydwzlhweuqxpgbahu`

The monitor never rewrites these targets and never points production at staging.

## Feature PR evidence

Feature PR #49:

- title: `Phase 33: Post-MVP Production Operations & Reliability`
- final exact head: `eb142330299f39c9335308b706dacbbead9f8762`
- squash merge: `71bb9a851241cd028b1ebc0e6b591e09637c803d`
- PR state before merge: non-draft and mergeable
- Phase 33 live monitor: PASS
- Brand Guard: PASS
- full repository build/tests: PASS
- staging Wrangler validation: PASS
- Phase 32 production artifact verification: PASS
- production Wrangler validation: PASS

Two CI-only regressions were found and fixed before merge:

1. the first Phase 33 schedule assertion used an invalid JavaScript regular expression; the assertion was changed to an exact string check without changing the monitor;
2. a Phase 24 regression test still required pre-Phase-32 checkpoint wording; it was made semantic/forward-compatible while retaining the original durable-handoff and automatic-merge requirements.

No failed gate was bypassed.

## Post-merge main evidence

Main merge SHA:

- `71bb9a851241cd028b1ebc0e6b591e09637c803d`

All four push-triggered workflows completed successfully:

- SautiLink Brand Guard run #400 — run ID `33680333713`;
- Phase 33 Production Operations run #4 — run ID `33680333635`;
- Phase 32 Production Launch run #10 — run ID `33680333566`;
- Phase 1 Authentication run #364 — run ID `33680333659`.

Permanent Phase 33 monitor result:

- `PRODUCTION_READINESS_PASS`;
- request ID `phase33-33680333635-1`;
- health HTTP 200;
- apex app HTTP 200;
- `www` app HTTP 200;
- marketing root HTTP 200;
- signed-out protected API HTTP 401;
- Worker environment `production`.

Production deployment result:

- deploy job ID `100415249949`;
- production Worker `sautilink-social-production`;
- Worker startup time: 6 ms;
- current production Worker version: `12eba3cb-8dc2-4429-b663-a19edda63e12`;
- first convergence attempt: `health=200 app=200 www_app=200 root=200`;
- signed-out production account API: HTTP 401;
- production cutover/preserve-root smoke: PASS.

Staging deployment result:

- deploy job ID `100415232032`;
- staging Worker version: `be8145ea-5951-4031-a476-38767626b0c1`;
- first readiness attempt: `health=200 app=200 robots=200`;
- signed-out account API: HTTP 401;
- staging live readiness: PASS.

## Completion

Every Phase 33 completion gate passed. Phase 33 is complete and the first post-MVP operating baseline is now durable on `main`.

Future post-MVP product phases must preserve this monitor, the production/staging separation, the path-scoped main-domain Worker boundary, and the source-controlled rollback discipline unless a deliberate architecture change is approved.
