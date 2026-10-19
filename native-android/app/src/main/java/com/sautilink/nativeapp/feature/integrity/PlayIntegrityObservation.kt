package com.sautilink.nativeapp.feature.integrity

import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive

/**
 * Recheck identity and expiry around the asynchronous Google operation. The result is a
 * delivery receipt for sampling only, never an app-access decision or integrity verdict.
 */
internal suspend fun submitPlayIntegrityObservation(
    challenge: PlayIntegrityChallenge,
    accountStillCurrent: () -> Boolean,
    nowMillis: () -> Long,
    requestToken: suspend (PlayIntegrityChallenge) -> String,
    submitToken: suspend (PlayIntegrityChallenge, String) -> PlayIntegrityObservationReceipt
): PlayIntegrityObservationReceipt? {
    currentCoroutineContext().ensureActive()
    if (!accountStillCurrent() || !PlayIntegrityMonitorPolicy.challengeFresh(
            challenge.expiresAtMillis, nowMillis())) return null
    val token = requestToken(challenge)
    currentCoroutineContext().ensureActive()
    if (token.isBlank() || token.length > PlayIntegrityMonitorPolicy.MAX_TOKEN_CHARACTERS || !accountStillCurrent() ||
        !PlayIntegrityMonitorPolicy.challengeFresh(challenge.expiresAtMillis, nowMillis())) return null
    return submitToken(challenge, token)
}

internal class PlayIntegrityObservationReceipt(val mode: String, val status: String, val retrySeconds: Long?)
