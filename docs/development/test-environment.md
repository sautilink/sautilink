# SautiLink development and staging environment

The canonical development, production-release and visual-review source is the
public repository `sautilink/sautilink`. The former private repository
`sautilink/test` is retained only as migration history and must not own future
production deployments.

Staging remains available at
[`https://test.sautilink.com`](https://test.sautilink.com), but it is deployed
from the canonical repository through `wrangler.social-staging.jsonc`.

## Boundaries

- The staging workflow is staging only and never deploys `sautilink.com`.
- Production uses the isolated `wrangler.production.jsonc` configuration,
  generated production artifacts and its dedicated production workflow.
- Supabase remains the authoritative source of truth for the eventual product.
  Staging must use a separate project or demo adapters before real accounts are
  enabled.
- Every feature still uses a branch, PR, tests and visual review before merging
  to `sautilink/sautilink` `main`.
- The MVP scope guard remains active: private DM/Messages is deferred, while
  public replies and threads remain in scope.

## Deployment contract

Eligible pushes to `main` run `npm run check`, an audit, a fresh build, and then
deploy the isolated Worker `sautilink-test` with the custom domain
`test.sautilink.com`. Pull requests run repository checks but do not replace
the shared staging URL. All staging Wrangler commands must explicitly use
`--config wrangler.social-staging.jsonc`; `wrangler.jsonc` belongs to the
root-site deployment and must not be repurposed.

The workflow requires these GitHub Actions secrets in the `staging`
environment:

- `CLOUDFLARE_API_TOKEN`: scoped to Workers deployment for this account
- `CLOUDFLARE_ACCOUNT_ID`: the Cloudflare account that owns
  `sautilink.com`

Do not put either value in the repository, commit messages, logs, or frontend
environment variables. The custom domain is configured in Wrangler with
`custom_domain: true`; Cloudflare creates the DNS/certificate attachment when
the deployment is authorized.
