package com.sautilink.nativeapp.feature.integrity

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.runBlocking
import com.sautilink.nativeapp.feature.auth.runAuthObservationTokenChecks
import java.io.IOException

/** Offline checks of the production policy and suspending observation stages, without Google or backend calls. */
fun main() = runBlocking {
    var checks = 0
    fun verify(value: Boolean, label: String) {
        check(value) { label }
        checks++
        println("PASS: $label")
    }
    val now = 1_800_000_000_000L
    val id = "11111111-2222-4333-8444-555555555555"
    val hash = "e".repeat(43)
    fun challenge(mode: String = "monitor", candidateId: String = id, candidateHash: String = hash,
        project: String = "123456789012", expiry: Long = now + 300_000L) =
        PlayIntegrityMonitorPolicy.challenge(mode, candidateId, candidateHash, project, expiry, now)
    val fresh = checkNotNull(challenge())
    verify(fresh.id == id && fresh.requestHash == hash && fresh.cloudProjectNumber == 123456789012L,
        "valid opaque server challenge preserves its exact binding")
    for (mode in listOf("", "off", "enforce", "MONITOR")) {
        verify(challenge(mode = mode) == null, "non-monitor response never starts an integrity request: $mode")
    }
    for (candidate in listOf("", "arbitrary-id", "$id\n", "mailto:user@example.com", "../$id")) {
        verify(challenge(candidateId = candidate) == null, "invalid challenge identifier is rejected")
    }
    for (candidate in listOf("", hash.dropLast(1), hash + "e", "email@example.com", "e".repeat(42) + "+",
            "e".repeat(42) + "/", "e".repeat(42) + "=", hash + "\n")) {
        verify(challenge(candidateHash = candidate) == null, "only a 43-character base64url request hash is accepted")
    }
    for (project in listOf("", "0", "-1", "+123", " 123", "0123", "1.0", "1e12", "9223372036854775808")) {
        verify(challenge(project = project) == null, "invalid or overflowing Cloud project number is rejected")
    }
    verify(challenge(expiry = now) == null && challenge(expiry = now - 1L) == null,
        "expired server challenges are rejected")
    verify(challenge(expiry = now + 300_001L) == null && challenge(expiry = Long.MAX_VALUE) == null,
        "unexpected challenge lifetime cannot cause long-lived token collection")
    verify(challenge(expiry = now + 1L) != null,
        "freshness boundary accepts a not-yet-expired challenge")
    val policy = PlayIntegrityMonitorPolicy
    verify(policy.due(now, 44, 43, now, now + 86_400_000L),
        "new app version can produce its first sample without waiting for the old version")
    verify(!policy.due(now, 44, 44, now, now + 3_600_000L),
        "rapid foreground resumes and process restarts stay within the failure cooldown")
    verify(!policy.due(now + 3_599_999L, 44, 44, now, now + 3_600_000L) &&
        policy.due(now + 3_600_000L, 44, 44, now, now + 3_600_000L),
        "retry becomes eligible exactly at its scheduled boundary")
    verify(policy.due(now - 1L, 44, 44, now, now + 3_600_000L),
        "backward clock corrections do not suppress monitoring indefinitely")
    verify(policy.due(now, 44, 44, now, now + 86_400_001L) &&
        policy.due(now, 44, 44, 0L, Long.MAX_VALUE),
        "corrupt or excessive stored cooldown is recoverable")
    verify(!policy.due(0L, 44, 0, 0L, 0L) && !policy.due(now, 0, 0, 0L, 0L),
        "invalid clock or build metadata does not start monitoring")
    verify(policy.retryDelayMillis(false, null) == 3_600_000L &&
        policy.retryDelayMillis(true, null) == 21_600_000L,
        "default failure and recorded-delivery intervals remain one and six hours")
    verify(policy.retryDelayMillis(false, -1) == 3_600_000L &&
        policy.retryDelayMillis(true, 1) == 21_600_000L,
        "server values cannot trigger a tight retry loop")
    verify(policy.retryDelayMillis(false, 43_200L) == 43_200_000L &&
        policy.retryDelayMillis(true, Long.MAX_VALUE) == 86_400_000L,
        "longer server cooldowns are honored within a bounded one-day maximum")

    var tokenRequests = 0
    var uploads = 0
    var current = true
    var clock = now
    var returnedToken = "opaque-test-token"
    var failure: Exception? = null
    var onToken: suspend () -> Unit = {}
    val receipt = PlayIntegrityObservationReceipt("monitor", "recorded", 21_600L)
    suspend fun observe(candidate: PlayIntegrityChallenge = fresh): PlayIntegrityObservationReceipt? =
        submitPlayIntegrityObservation(candidate, { current }, { clock }, {
            tokenRequests++
            onToken()
            failure?.let { throw it }
            returnedToken
        }, { actualChallenge, token ->
            check(actualChallenge === candidate && token == returnedToken)
            uploads++
            receipt
        })
    verify(observe() === receipt && tokenRequests == 1 && uploads == 1,
        "successful observation sends the exact token once with its original challenge")
    current = false
    verify(observe() == null && tokenRequests == 1 && uploads == 1,
        "signed-out or switched account starts neither Google work nor upload")
    current = true
    clock = fresh.expiresAtMillis
    verify(observe() == null && tokenRequests == 1 && uploads == 1,
        "expired challenge never starts Google work")
    clock = now
    onToken = { current = false }
    verify(observe() == null && tokenRequests == 2 && uploads == 1,
        "account switch during asynchronous token retrieval discards the old account result")
    current = true
    onToken = { clock = fresh.expiresAtMillis }
    verify(observe() == null && uploads == 1,
        "challenge that expires during token retrieval is never submitted")
    clock = now
    onToken = {}
    for (token in listOf("", "  \n ", "x".repeat(30_001))) {
        returnedToken = token
        verify(observe() == null && uploads == 1,
            "empty or excessive token is discarded before any upload")
    }
    returnedToken = "opaque-test-token"
    failure = IOException("PRIVATE_ERROR_TEXT_MUST_NOT_BE_SENT")
    verify(runCatching { observe() }.exceptionOrNull() === failure && uploads == 1,
        "SDK or connectivity failure cannot upload a fabricated verdict")
    failure = CancellationException("cancelled observation")
    verify(runCatching { observe() }.exceptionOrNull() === failure && uploads == 1,
        "coroutine cancellation is preserved rather than converted to a successful observation")
    failure = null
    val tokenStarted = CompletableDeferred<Unit>()
    val releaseToken = CompletableDeferred<Unit>()
    onToken = { tokenStarted.complete(Unit); releaseToken.await() }
    val pending = async { observe() }
    tokenStarted.await()
    pending.cancelAndJoin()
    releaseToken.complete(Unit)
    verify(pending.isCancelled && uploads == 1,
        "foreground job cancellation never sends a late token to the backend")
    onToken = {}
    val delayedAccount = CompletableDeferred<Unit>()
    val continueAccount = CompletableDeferred<Unit>()
    onToken = { delayedAccount.complete(Unit); continueAccount.await() }
    val accountPending = async { observe() }
    delayedAccount.await()
    current = false
    continueAccount.complete(Unit)
    verify(accountPending.await() == null && uploads == 1,
        "late completion from account A cannot attach an observation to account B")
    checks += runAuthObservationTokenChecks()
    println("PASS: $checks actual Play Integrity policy, asynchronous observation, and auth snapshot checks; no network calls")
}
