# Room membership readiness regression

Run from the repository with PowerShell 7 and the cached JDK/Gradle dependencies:

```powershell
./native-android/validation/run-room-readiness-check.ps1 `
  -JavaPath /path/to/jdk/bin/java.exe `
  -OutputDirectory ../generatedtestscope/room-readiness-check
```

The runner compiles the actual `RoomManagementState`, Room models and cached Compose 1.10.0 snapshot runtime. It observes the real `membershipReady` expression before `open`, with deferred capability/configuration responses. The exact tracked pre-fix Git source blob must fail to invalidate the initial observation; current source must pass eleven checks. Logs and generated classes remain outside product source.

Fixtures replace network/auth boundaries without credentials or HTTP. Android parcel interfaces permit class loading; the test Looper throws to select Compose's documented host-test fallback. Snapshot storage, observation, readiness and Room lifecycle logic are real. These checks do not replace APK build/lint or Samsung QA.
