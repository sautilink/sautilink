#!/usr/bin/env python3
"""Run actual Kotlin Play Integrity policy/async-stage checks without Android or network.

Uses the same pinned, already cached Kotlin runtime as run-text-entity-check.py.
It never downloads dependencies, contacts Google, or creates integrity tokens.
"""

from __future__ import annotations

import argparse
import importlib.util
import os
from pathlib import Path
import shutil
import sys
import tempfile


AUTH_FIXTURE = """package com.sautilink.nativeapp.feature.auth
enum class StagingSessionState { CHECKING, SIGNED_OUT, SIGNED_IN, RETRYABLE_ERROR }
data class StagingAccount(val id: String)
class AuthObservationSnapshotFixture {
    var sessionState = StagingSessionState.SIGNED_OUT
    var currentUser: StagingAccount? = null
    var accessToken: String? = null
    var tokenExpiresAtMillis = 0L
    var forbiddenAuthCalls = 0
    fun activeAccessToken(): String { forbiddenAuthCalls++; error("Monitoring must not refresh auth") }
    fun restoreSession() { forbiddenAuthCalls++; error("Monitoring must not restore auth") }
    fun clearLocalSession() { forbiddenAuthCalls++; error("Monitoring must not change auth") }
    fun snapshot() = listOf(sessionState, currentUser, accessToken, tokenExpiresAtMillis, forbiddenAuthCalls)
"""


def main() -> int:
    sys.dont_write_bytecode = True
    runner_path = Path(__file__).with_name("run-text-entity-check.py")
    spec = importlib.util.spec_from_file_location("sauti_kotlin_validation", runner_path)
    if spec is None or spec.loader is None:
        print("ERROR: shared Kotlin validation runner was not found", file=sys.stderr)
        return 1
    shared = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(shared)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--java-path", default="java")
    parser.add_argument("--output-directory", type=Path, required=True)
    parser.add_argument("--gradle-module-cache", "--module-cache", type=Path,
        default=Path.home() / ".gradle/caches/modules-2/files-2.1")
    parser.add_argument("--native-root", type=Path, default=Path(__file__).resolve().parent.parent)
    args = parser.parse_args()
    try:
        java = shutil.which(args.java_path)
        if not java:
            raise shared.ValidationError("Java 17 or newer is required.")
        runtime = [shared.cached_jar(args.gradle_module_cache.expanduser().resolve(), *item)
            for item in shared.DEPENDENCIES]
        native = args.native_root.expanduser().resolve()
        integrity = native / "app/src/main/java/com/sautilink/nativeapp/feature/integrity"
        sources = [integrity / "PlayIntegrityMonitorPolicy.kt", integrity / "PlayIntegrityObservation.kt",
            native / "validation/PlayIntegrityMonitorCheck.kt", native / "validation/AuthObservationTokenCheck.kt"]
        for source in sources:
            if not source.is_file():
                raise shared.ValidationError(f"Required source is missing: {source}")
        output = args.output_directory.expanduser().resolve()
        output.mkdir(parents=True, exist_ok=True)
        auth_source = (native / "app/src/main/java/com/sautilink/nativeapp/feature/auth/StagingAuthClient.kt").read_text(encoding="utf-8")
        method, _ = shared.actual_block(auth_source, "    fun cachedAccessTokenForObservation(")
        fixture = output / "AuthObservationSnapshotFixture.kt"
        fixture.write_text(AUTH_FIXTURE + method + "\n}\n", encoding="utf-8")
        sources.append(fixture)
        classes = Path(tempfile.mkdtemp(prefix="classes-", dir=output))
        classpath = os.pathsep.join(str(runtime[index]) for index in (1, 5, 6))
        shared.checked_run([java, "-cp", os.pathsep.join(map(str, runtime)),
            "org.jetbrains.kotlin.cli.jvm.K2JVMCompiler", "-no-stdlib", "-no-reflect", "-jvm-target", "17",
            "-classpath", classpath, "-d", str(classes), *map(str, sources)],
            "Play Integrity validation compilation failed")
        shared.checked_run([java, "-cp", os.pathsep.join((str(classes), classpath)),
            "com.sautilink.nativeapp.feature.integrity.PlayIntegrityMonitorCheckKt"],
            "Play Integrity behavior checks failed")
        return 0
    except (shared.ValidationError, OSError, UnicodeError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
