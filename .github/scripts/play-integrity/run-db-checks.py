#!/usr/bin/env python3
"""Execute real PostgreSQL/pg_cron tests in a fresh, labelled local container.

Uses only Python's standard library, Docker and the container's psql. Two
independent psql sessions prove the consume race with an observed SQL lock wait.
No Supabase connection, production credentials, or migration substitutions.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import subprocess
import sys
import time
import uuid

DATABASE = "sautilink_integrity_test"
PURPOSE = "play-integrity-disposable"
SCRIPT_DIRECTORY = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIRECTORY.parents[2]
DOCKER = ["docker", "--host", "unix:///var/run/docker.sock"]


class Database:
    def __init__(self, container: str) -> None:
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", container):
            raise RuntimeError("Invalid disposable container identifier")
        self.container = container
        inspected = subprocess.run(
            DOCKER + ["inspect", "--format", "{{json .Config.Labels}}", container],
            text=True, capture_output=True, check=True, timeout=10,
        )
        if json.loads(inspected.stdout or "{}").get("com.sautilink.purpose") != PURPOSE:
            raise RuntimeError("Refusing an unlabelled container; use the disposable test Dockerfile")

    def command(self, application: str = "sautilink_integrity_test_admin") -> list[str]:
        return DOCKER + [
            "exec", "-i",
            "--env", "PGHOST=/var/run/postgresql",
            "--env", "PGPORT=5432",
            "--env", "PGUSER=postgres",
            "--env", f"PGDATABASE={DATABASE}",
            "--env", "PGCONNECT_TIMEOUT=5",
            "--env", "PGSSLMODE=disable",
            "--env", f"PGAPPNAME={application}",
            "--env", "PGOPTIONS=-c client_min_messages=warning -c statement_timeout=30000 -c lock_timeout=15000",
            self.container, "psql", "--no-psqlrc", "--quiet", "--tuples-only",
            "--no-align", "--set", "ON_ERROR_STOP=1", "--dbname", DATABASE,
        ]

    def sql(self, sql: str, timeout: float = 40) -> str:
        result = subprocess.run(self.command(), input=sql, text=True, capture_output=True, timeout=timeout)
        if result.returncode:
            # The target can only be the synthetic local test database.
            raise RuntimeError(f"Disposable SQL check failed:\n{result.stderr.strip()}")
        return result.stdout.strip()

    def file(self, path: Path) -> str:
        return self.sql(path.read_text(encoding="utf-8"))

    def start(self, sql: str, application: str) -> subprocess.Popen[str]:
        process = subprocess.Popen(self.command(application), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        assert process.stdin is not None
        process.stdin.write(sql)
        process.stdin.close()
        process.stdin = None
        return process


def expect(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def user_transaction(user_id: str, session_id: str, query: str) -> str:
    claims = json.dumps({"role": "authenticated", "sub": user_id, "session_id": session_id, "is_anonymous": False})
    return f"BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims = '{claims}'; {query} COMMIT;"


def wait_for_state(database: Database, application: str, condition: str, timeout: float = 5) -> None:
    # application/condition are fixed harness constants, never external strings.
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        found = database.sql(
            f"SELECT exists(SELECT 1 FROM pg_stat_activity WHERE application_name = '{application}' AND {condition});"
        )
        if found == "t":
            return
        time.sleep(0.03)
    raise RuntimeError(f"Did not observe expected PostgreSQL state for {application}")


def race_check(database: Database) -> None:
    user_id, session_id = str(uuid.uuid4()), str(uuid.uuid4())
    first = second = None
    try:
        database.sql(f"""
          INSERT INTO auth.users (id, aud, role, email, is_anonymous)
          VALUES ('{user_id}', 'authenticated', 'authenticated', 'consume-race@example.invalid', false);
          INSERT INTO auth.sessions (id, user_id) VALUES ('{session_id}', '{user_id}');
        """)
        challenge_id = database.sql(user_transaction(
            user_id, session_id, "SELECT public.begin_play_integrity_observation_v1(44)->>'challenge_id';",
        ))
        expect(bool(re.fullmatch(r"[0-9a-f-]{36}", challenge_id)), "Race fixture challenge was not issued")
        query = f"SELECT public.consume_play_integrity_observation_v1('{challenge_id}')->>'status';"
        # First connection consumes, then holds the actual state-row lock open.
        first = database.start(user_transaction(user_id, session_id, query + " SELECT pg_sleep(5);"), "sautilink_integrity_race_first")
        wait_for_state(database, "sautilink_integrity_race_first", "wait_event = 'PgSleep'")
        # Second, independent connection must wait on that row until commit.
        second = database.start(user_transaction(user_id, session_id, query), "sautilink_integrity_race_second")
        wait_for_state(database, "sautilink_integrity_race_second", "wait_event_type = 'Lock'", timeout=3)
        outputs = []
        for process in (first, second):
            output, error = process.communicate(timeout=12)
            expect(process.returncode == 0, f"Concurrent SQL failed: {error.strip()}")
            outputs.extend(line.strip() for line in output.splitlines() if line.strip())
        expect(sorted(outputs) == ["invalid_challenge", "ready"], f"Expected one successful consume, got {outputs!r}")
        expect(database.sql(f"SELECT consumed_at IS NOT NULL AND issued_count = 1 FROM play_integrity_private.monitor_state WHERE user_id = '{user_id}';") == "t", "Race left unexpected state")
        print("PASS: real two-connection consume race; one ready, one invalid_challenge; PostgreSQL lock wait observed")
    finally:
        for process in (first, second):
            if process is not None and process.poll() is None:
                process.kill()
                process.communicate(timeout=5)
        database.sql(f"DELETE FROM auth.users WHERE id = '{user_id}';")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--container", required=True)
    parser.add_argument("--migration", required=True, type=Path)
    args = parser.parse_args()
    expect(args.migration.is_file(), "The CLI-generated migration must exist")
    database = Database(args.container)

    deadline = time.monotonic() + 45
    while True:
        try:
            version = database.sql("SELECT current_database() || '|' || current_setting('server_version_num');", timeout=8)
            break
        except (RuntimeError, subprocess.TimeoutExpired):
            if time.monotonic() >= deadline:
                raise RuntimeError("Disposable PostgreSQL container was not ready within 45 seconds")
            time.sleep(0.25)
    name, version_number = version.split("|")
    expect(name == DATABASE and 170000 <= int(version_number) < 180000, "Expected the dedicated PostgreSQL 17 test database")
    expect(database.sql("SELECT NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname IN ('auth', 'play_integrity_private'));") == "t", "Refusing a non-fresh database: auth or monitoring schema already exists")
    expect(database.sql("SELECT current_setting('cron.database_name', true);") == DATABASE, "pg_cron must point to the disposable database")
    expect(database.sql("SELECT 'pg_cron' = ANY(string_to_array(current_setting('shared_preload_libraries'), ','));") == "t", "Real pg_cron must be preloaded")

    database.file(SCRIPT_DIRECTORY / "bootstrap.sql")
    database.file(args.migration.resolve())
    print("PASS: complete migration executed on fresh PostgreSQL 17 with real pg_cron")
    expect(database.sql("SELECT count(*) = 1 FROM cron.job WHERE jobname = 'sautilink-play-integrity-expire-v1' AND command = 'select play_integrity_private.expire_observations_v1();';") == "t", "Retention job was not registered")
    test_output = database.file(REPO_ROOT / "supabase/tests/play_integrity_monitor.sql")
    expect("database checks passed" in test_output, "Role/ownership/retention checks did not complete")
    expect(database.sql("SELECT count(*) = 0 FROM auth.users;") == "t", "Rollback fixture users were retained")
    print("PASS: SQL role, ownership, replay, quota, sanitizer, expiry and cascade checks; rollback verified")
    race_check(database)
    expect(database.sql("SELECT count(*) = 0 FROM auth.users;") == "t", "Race fixture cleanup failed")
    extension_version = database.sql("SELECT extversion FROM pg_extension WHERE extname = 'pg_cron';")
    print(json.dumps({"status": "passed", "postgres_version_num": int(version_number), "pg_cron_version": extension_version,
                      "database": DATABASE, "real_parallel_consume": True, "production_connections": False}))


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, subprocess.SubprocessError, OSError, ValueError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        sys.exit(1)
