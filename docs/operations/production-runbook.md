# SautiLink Production Operations Runbook

## Purpose

This runbook covers the live SautiLink social web application after the Phase 32 launch. It is intentionally narrow: restore service safely without collapsing the production/staging boundary or replacing the public account-entry root.

## Production map

- Social app: `https://sautilink.com/app/`
- Social app on www: `https://www.sautilink.com/app/`
- Production API: `https://sautilink.com/api/*`
- Production Worker: `sautilink-social-production`
- Production R2: `sautilink-media-production`
- Production Supabase ref: `rggpyiterdbbugluejcs`
- Staging Supabase ref: `bbrydwzlhweuqxpgbahu`
- Account-entry root marker: `data-sautilink-entry="login-redirect"` plus `url=/login`

Do not point production at staging, even during an incident.

## Routine health check

Run the repository probe:

```bash
node scripts/check-production-readiness.mjs
```

A healthy result ends with:

```text
PRODUCTION_READINESS_PASS
```

The permanent GitHub workflow also runs this probe every six hours and can be triggered manually.

## What the probe verifies

- `/api/health` returns HTTP 200;
- health reports `environment: production`;
- assets, media and rate-limit readiness are true;
- the request ID is echoed back;
- production does not carry staging `noindex`;
- apex and www `/app/` return HTTP 200;
- the app shell marker is present;
- the apex account-entry root remains HTTP 200 and still redirects to `/login`;
- a signed-out account-export request returns HTTP 401 with `AUTH_REQUIRED`.

## Incident triage

### 1. Health endpoint fails

Check the latest `Phase 32 Production Launch` and `Phase 33 Production Operations` workflow runs first.

Do not redeploy blindly. Determine whether the failure is:

- Worker/runtime;
- R2 binding/media;
- rate-limit binding;
- Supabase connectivity;
- Cloudflare propagation;
- a broader domain/DNS problem.

### 2. App is down but account-entry root is healthy

Treat this as a social Worker/app incident. Preserve the root website. Do not widen the Worker to `sautilink.com/*` as a workaround.

Pause new production changes, identify the first bad `main` commit, and revert that change through the normal GitHub PR path so the existing production workflow rebuilds, verifies and redeploys a known-good source state.

### 3. Account-entry root is missing or replaced

This is a route-boundary incident.

The social Worker must remain path-scoped to `/app`, `/app/*` and `/api/*` on apex and www. Restore the known-good `wrangler.production.jsonc` configuration before any feature work continues.

### 4. Health says media is unavailable

Check the production R2 binding and bucket `sautilink-media-production`. Do not substitute the staging media bucket.

### 5. Supabase connectivity or auth failure

Production must continue to target `rggpyiterdbbugluejcs`.

Do not point production at staging (`bbrydwzlhweuqxpgbahu`) to get the site online. Diagnose the production project, credentials, policy or network boundary instead.

### 6. Protected API unexpectedly returns success while signed out

Treat this as a security incident. Stop new merges that touch the affected route, reproduce against staging, review Worker auth enforcement and RLS/grants, and ship the smallest tested fix.

Do not weaken authentication or RLS to restore functionality.

## Safe rollback principle

The preferred rollback is source-controlled:

1. identify the offending merged change;
2. create a focused revert/fix branch;
3. run full repository, production artifact and Wrangler verification;
4. merge the clean fix;
5. let the existing production workflow deploy;
6. require live production readiness to pass.

Avoid manual production edits that leave GitHub `main` different from the deployed system.

## Credential incidents

Never paste Cloudflare, Supabase secret/service-role, private keys or tokens into source, PR comments, issues or logs.

If a credential is suspected to be exposed, rotate it at the provider, update the authorized GitHub environment secret, and rerun the deployment verification. The production artifact verifier must remain green.

## After an incident

Record:

- start/end time;
- affected routes/features;
- first bad commit or external cause;
- exact recovery commit;
- whether staging reproduced the fault;
- production workflow run;
- readiness result;
- any follow-up hardening task.

Then update the durable project operating checkpoint if the architecture or operating procedure changed.
