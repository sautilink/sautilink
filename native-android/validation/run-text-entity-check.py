#!/usr/bin/env python3
"""Run the native text checks with cached Kotlin jars, without Gradle or Android.

Portable counterpart of run-text-entity-check.ps1. Requires Python 3 and Java 17
or newer. It reads the real Kotlin sources and extracts the three MainActivity
route closures plus the detail-context LaunchedEffect into the same JVM fixture.
No dependency downloads, credentials, or Android/backend access are performed.

Example:
  python3 native-android/validation/run-text-entity-check.py \
      --output-directory /tmp/sautilink-text-check \
      --gradle-module-cache ~/.gradle/caches/modules-2/files-2.1
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


DEPENDENCIES = (
    ("org.jetbrains.kotlin", "kotlin-compiler-embeddable", "2.2.20"),
    ("org.jetbrains.kotlin", "kotlin-stdlib", "2.2.20"),
    ("org.jetbrains.kotlin", "kotlin-script-runtime", "2.2.20"),
    ("org.jetbrains.kotlin", "kotlin-reflect", "1.6.10"),
    ("org.jetbrains.kotlin", "kotlin-daemon-embeddable", "2.2.20"),
    ("org.jetbrains.kotlinx", "kotlinx-coroutines-core-jvm", "1.8.0"),
    ("org.jetbrains", "annotations", "23.0.0"),
)

FIXTURE_HEADER = """package com.sautilink.nativeapp.ui.text
class EntityRoutesFixture {
 var detail: String? = null
 var memberProfileReturn: String? = null
 var viewedProfileHandle = ""
 var notificationPostId = ""
 var postReturn: String? = null
 var entityExploreActive = false
 var entityExploreQuery = ""
 var entityExploreReturn: String? = null
 var entityExploreProfile = ""
 var entityExploreMemberReturn: String? = null
 var entityExplorePostId = ""
 var entityExplorePostReturn: String? = null
 var entityExploreAccount: String? = null
 val activeAccountId: String? = "public-qa-fixture"
"""


class ValidationError(Exception):
    """An actionable runner setup or validation failure."""


def cached_jar(cache: Path, group: str, artifact: str, version: str) -> Path:
    directory = cache / group / artifact / version
    matches = sorted(
        path for path in directory.rglob(f"{artifact}-{version}.jar") if path.is_file()
    )
    if len(matches) != 1:
        raise ValidationError(
            f"Expected one cached {artifact}-{version}.jar under {directory}; "
            f"found {len(matches)}. Supply --gradle-module-cache for an existing "
            "Gradle modules-2/files-2.1 directory. This runner does not download jars."
        )
    return matches[0]


def actual_block(source: str, marker: str) -> tuple[str, str]:
    """Extract a real brace-balanced block, matching the PowerShell runner."""
    start = source.find(marker)
    if start < 0:
        raise ValidationError(f"Missing actual MainActivity block: {marker.strip()}")
    if source.find(marker, start + len(marker)) >= 0:
        raise ValidationError(f"Ambiguous actual MainActivity block: {marker.strip()}")
    body = source.find("{", start)
    if body < 0:
        raise ValidationError(f"Missing block body: {marker.strip()}")
    depth, end = 1, body + 1
    while end < len(source) and depth:
        if source[end] == "{":
            depth += 1
        elif source[end] == "}":
            depth -= 1
        end += 1
    if depth:
        raise ValidationError(f"Unbalanced actual MainActivity block: {marker.strip()}")
    return source[start:end], source[body + 1 : end - 1]


def actual_fixture(main_activity: str) -> str:
    routes = [
        actual_block(main_activity, f"    fun {name}(")[0]
        for name in ("openEntityProfile", "openEntityHashtag", "closeEntityExplore")
    ]
    effect = actual_block(main_activity, "    LaunchedEffect(detail) {")[1]
    return (
        FIXTURE_HEADER
        + "\n".join(routes)
        + "\nfun synchronizeDetail() {\n"
        + effect
        + "\n}\n}\n"
    )


def checked_run(command: list[str], failure: str) -> None:
    try:
        result = subprocess.run(command, check=False)
    except OSError as error:
        raise ValidationError(f"Could not execute Java: {error}") from error
    if result.returncode:
        raise ValidationError(f"{failure} (exit {result.returncode}).")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--java-path", default="java", help="Java executable (default: java on PATH).")
    parser.add_argument("--output-directory", type=Path, required=True, help="Directory for the extracted fixture and compiled classes.")
    parser.add_argument(
        "--gradle-module-cache", "--module-cache", type=Path,
        default=Path.home() / ".gradle/caches/modules-2/files-2.1",
        help="Gradle modules-2/files-2.1 cache containing the pinned Kotlin jars.",
    )
    parser.add_argument(
        "--native-root", type=Path, default=Path(__file__).resolve().parent.parent,
        help="Native Android source directory (default: the runner's native-android directory).",
    )
    args = parser.parse_args()

    try:
        java = shutil.which(args.java_path)
        if not java:
            raise ValidationError("Java was not found. Supply --java-path to Java 17 or newer.")
        cache = args.gradle_module_cache.expanduser().resolve()
        runtime = [cached_jar(cache, *dependency) for dependency in DEPENDENCIES]
        stdlib = runtime[1]
        native_root = args.native_root.expanduser().resolve()
        app = native_root / "app/src/main/java/com/sautilink/nativeapp"
        sources = [
            app / "ui/text/TextEntities.kt",
            app / "ui/text/PostTextFormatting.kt",
            native_root / "validation/TextEntitiesCheck.kt",
        ]
        main_path = app / "MainActivity.kt"
        for path in [main_path, *sources]:
            if not path.is_file():
                raise ValidationError(f"Required Kotlin source is missing: {path}")
        fixture = actual_fixture(main_path.read_text(encoding="utf-8"))
        output = args.output_directory.expanduser().resolve()
        output.mkdir(parents=True, exist_ok=True)
        fixture_path = output / "EntityRoutesFixture.kt"
        fixture_path.write_text(fixture, encoding="utf-8")
        # Every invocation gets fresh classes, so stale output cannot mask a failure.
        classes = Path(tempfile.mkdtemp(prefix="classes-", dir=output))
        print(f"Compiling actual text sources and MainActivity routes from {native_root}", flush=True)
        checked_run(
            [java, "-cp", os.pathsep.join(map(str, runtime)),
             "org.jetbrains.kotlin.cli.jvm.K2JVMCompiler",
             "-no-stdlib", "-no-reflect", "-jvm-target", "17",
             "-classpath", str(stdlib), "-d", str(classes),
             str(sources[0]), str(sources[1]), str(fixture_path), str(sources[2])],
            "Text entity validation compilation failed",
        )
        checked_run(
            [java, "-cp", os.pathsep.join((str(classes), str(stdlib))),
             "com.sautilink.nativeapp.ui.text.TextEntitiesCheckKt"],
            "Text entity behavior checks failed",
        )
        print(f"Validation output: {output}")
        return 0
    except (ValidationError, OSError, UnicodeError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
