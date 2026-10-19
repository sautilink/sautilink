# Unavailable Room cache regression

This focused JVM fixture compiles the actual production `RoomsState.kt` and `NativeRoomModels.kt` against cached Compose runtime 1.10 and coroutines. Only Android/UI/service boundaries are replaced; there are no HTTP requests, credentials, device actions, or backend writes.

Run `validation/run-room-cache-check.ps1` with `-JavaPath` pointing to the cached JDK 21 executable and `-OutputDirectory` pointing below the workspace's `work/generatedtestscope`. The runner requires the exact existing `50100dfeef0e28d236ba1a3f035a748a653b3139` Git baseline. It expects that baseline to fail before checking the current source.

The test drives a canonical null lookup with three already-started landing reads, resumes deliberately non-cancellable stale responses, and checks exact-UUID eviction while preserving another Room and the draft. It separately checks transport-error retention, account/navigation/metadata guards, and that a later explicit fresh landing read can return an available Room. JVM results do not replace Android build or live Samsung verification.
