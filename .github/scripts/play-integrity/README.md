# Disposable SQL verification

Requirements: a Linux Docker daemon on `/var/run/docker.sock`, Python 3.10+, and
the checked-out repository. No host PostgreSQL client, Supabase credentials, or
Google credentials are needed. The workflow is intentionally owned separately.

The image is based on official `postgres:17.11-bookworm`, with the real
`postgresql-17-cron` package from its PostgreSQL Debian repository. The runner
prints the actual PostgreSQL and pg_cron versions in its result. PostgreSQL 17.11
and Bookworm were verified in the [official image source](https://github.com/docker-library/postgres/blob/master/versions.json).
The preload/database settings follow [pg_cron's upstream instructions](https://github.com/citusdata/pg_cron#setting-up-pg_cron).

Build and start a new temporary container:

```sh
docker build --tag sautilink-integrity-postgres-test .github/scripts/play-integrity
docker run --detach --rm --name sautilink-integrity-sql-test \
  --env POSTGRES_DB=sautilink_integrity_test \
  --env POSTGRES_USER=postgres \
  --env POSTGRES_PASSWORD=disposable-local-test-only \
  sautilink-integrity-postgres-test
```

No port is published. The runner executes `psql` over a Unix socket inside the
container, requires the test image's purpose label and fixed database name, and
refuses an existing auth or monitoring schema. It applies the original migration
without stripping or replacing any SQL, including the actual pg_cron extension
and job registration. Only a minimal auth schema and synthetic users are added.

Run the checks, supplying the **actual CLI-generated migration path**:

```sh
python3 .github/scripts/play-integrity/run-db-checks.py \
  --container sautilink-integrity-sql-test \
  --migration supabase/migrations/ACTUAL_GENERATED_MIGRATION.sql
```

The existing SQL suite executes positive operations as `authenticated` and
`service_role`, validates private grants/RLS, binding/session ownership, replay,
limits, daily resets, summaries, retention and deletion, then rolls back. The
runner verifies that its fixtures were rolled back.

For the real race check, one independent `psql` connection consumes a challenge
and holds the state-row lock for five seconds. A second connection submits the
same consume; the runner verifies its actual PostgreSQL lock wait. Exactly one
connection must receive `ready`; the other must receive `invalid_challenge`.
Its separate synthetic fixture is deleted after the race.

The container's cron launcher is disabled to avoid a wall-clock scheduled job
interfering with fixture timing. The real extension, cron job metadata, and
cleanup function are still executed and verified. The suite does not claim a
test of Supabase Auth's JWT signature server, production triggers, or a Google
Play device verdict.

Always remove the disposable container in the workflow's `always()` cleanup:

```sh
docker rm --force sautilink-integrity-sql-test
```

The container has no mounted data volume or production connection. Do not pass
production credentials, a production Docker context, or a Supabase database URL.
