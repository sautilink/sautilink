package com.sautilink.nativeapp.feature.auth

/** Exercises the exact read-only method extracted from StagingAuthClient by the runner. */
fun runAuthObservationTokenChecks(): Int {
    var checks = 0
    fun verify(value: Boolean, label: String) {
        check(value) { label }
        checks++
        println("PASS: $label")
    }
    val source = AuthObservationSnapshotFixture()
    source.sessionState = StagingSessionState.SIGNED_IN
    source.currentUser = StagingAccount("account-a")
    source.accessToken = "PRIVATE_CACHED_TEST_JWT"
    source.tokenExpiresAtMillis = System.currentTimeMillis() + 600_000L
    val initial = source.snapshot()
    verify(source.cachedAccessTokenForObservation("account-a") == source.accessToken &&
        source.snapshot() == initial,
        "monitoring reads the current cached JWT without mutating authentication")
    verify(source.cachedAccessTokenForObservation("account-b") == null && source.snapshot() == initial,
        "another account cannot use an earlier account's cached monitoring JWT")
    source.tokenExpiresAtMillis = System.currentTimeMillis() + 60_000L
    val expiring = source.snapshot()
    verify(source.cachedAccessTokenForObservation("account-a") == null && source.snapshot() == expiring,
        "near-expiry token skips monitoring without refresh, vault read, or sign-out")
    source.tokenExpiresAtMillis = System.currentTimeMillis() - 60_000L
    val expired = source.snapshot()
    verify(source.cachedAccessTokenForObservation("account-a") == null && source.snapshot() == expired,
        "expired token never starts auth rotation from the monitoring path")
    source.tokenExpiresAtMillis = System.currentTimeMillis() + 600_000L
    for (state in listOf(StagingSessionState.CHECKING, StagingSessionState.SIGNED_OUT,
        StagingSessionState.RETRYABLE_ERROR)) {
        source.sessionState = state
        val before = source.snapshot()
        verify(source.cachedAccessTokenForObservation("account-a") == null && source.snapshot() == before,
            "monitoring preserves $state and does not attempt session restoration")
    }
    source.sessionState = StagingSessionState.SIGNED_IN
    for (token in listOf(null, "", "  ")) {
        source.accessToken = token
        val before = source.snapshot()
        verify(source.cachedAccessTokenForObservation("account-a") == null && source.snapshot() == before,
            "missing cached token does not cause fallback authentication work")
    }
    source.currentUser = null
    source.accessToken = "PRIVATE_OLD_CACHED_JWT"
    val signedOut = source.snapshot()
    verify(source.cachedAccessTokenForObservation("account-a") == null && source.snapshot() == signedOut,
        "sign-out cannot leak a stale token even if an old cache entry remains")
    verify(source.forbiddenAuthCalls == 0,
        "actual monitoring snapshot method never invokes auth refresh or session mutation")
    return checks
}
