# SautiLink development environment

The private repository `sautilink/test` is the development and visual-review
home for SautiLink. Its `main` branch deploys to
[`https://test.sautilink.com`](https://test.sautilink.com) after verification.

## Boundaries

- This environment is staging only; it does not deploy `sautilink.com`.
- Production homepage, waitlist, Supabase project, migrations, R2 buckets and
  production Workers remain outside this repository's deployment job.
- Supabase remains the authoritative source of truth for the eventual product.
  Staging must use a separate project or demo adapters before real accounts are
  enabled.
- Every feature still uses a branch, PR, tests and visual review before merging
  to this repository's `main`.
- The MVP scope guard remains active: private DM/Messages is deferred, while
  public replies and threads remain in scope.

## Deployment contract

Pushes to `main` run `npm run check`, an audit, a fresh build, and then
deploy the isolated Worker `sautilink-test` with the custom domain
`test.sautilink.com`. Pull requests run repository checks but do not replace
the shared staging URL.

The workflow requires these GitHub Actions secrets in the `staging`
environment:

- `CLOUDFLARE_API_TOKEN`: scoped to Workers deployment for this account
- `CLOUDFLARE_ACCOUNT_ID`: the Cloudflare account that owns
  `sautilink.com`

Do not put either value in the repository, commit messages, logs, or frontend
environment variables. The custom domain is configured in Wrangler with
`custom_domain: true`; Cloudflare creates the DNS/certificate attachment when
the deployment is authorized.
