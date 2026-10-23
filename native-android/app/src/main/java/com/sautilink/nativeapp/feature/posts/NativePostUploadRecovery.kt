package com.sautilink.nativeapp.feature.posts

import com.sautilink.nativeapp.feature.auth.AuthRequestException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import org.json.JSONObject
import java.io.IOException
import javax.net.ssl.SSLException

internal fun retryablePostUploadFailure(error: Exception): Boolean {
    val causes = generateSequence<Throwable>(error) { it.cause }.take(8).toList()
    if (causes.any { it is CancellationException || it is SSLException }) return false
    // Request-body owner/cancellation checks must never be interpreted as a
    // transport outage merely because OkHttp requires an IOException wrapper.
    if (causes.drop(1).any { it is AuthRequestException }) return false
    if (error is AuthRequestException && error.httpStatus != null) {
        return error.httpStatus in setOf(408, 425, 500, 502, 503, 504)
    }
    return causes.any { it is IOException }
}

/** Reuses the same server-issued upload ID. Never repeats the creating POST.
 * After an uncertain single PUT, finalization confirms a committed transfer
 * before any bytes are sent again. Finalize and chunk completion are idempotent.
 */
internal suspend fun finishNativePostUpload(
    plan: NativePostUploadPlan,
    checkActiveOwner: () -> Unit,
    transfer: suspend (Int) -> Unit,
    complete: suspend () -> Unit,
    finalize: suspend () -> JSONObject,
    waitBeforeRetry: suspend (Long) -> Unit = { delay(it) }
): JSONObject {
    suspend fun <T> retry(operation: suspend () -> T): T {
        var attempt = 0
        while (true) {
            checkActiveOwner()
            try {
                val result = operation()
                checkActiveOwner()
                return result
            } catch (error: Exception) {
                checkActiveOwner()
                if (!retryablePostUploadFailure(error) || ++attempt >= 3) throw error
                waitBeforeRetry(500L * attempt)
            }
        }
    }
    if (!plan.chunked) {
        var attempt = 0
        while (true) {
            checkActiveOwner()
            try {
                transfer(1)
                break
            } catch (error: Exception) {
                checkActiveOwner()
                if (!retryablePostUploadFailure(error)) throw error
                try {
                    val confirmed = finalize()
                    checkActiveOwner()
                    return confirmed
                } catch (confirmation: Exception) {
                    checkActiveOwner()
                    if (!retryablePostUploadFailure(confirmation)
                        && (confirmation !is AuthRequestException || confirmation.httpStatus != 404)) throw confirmation
                }
                if (++attempt >= 3) throw error
                waitBeforeRetry(500L * attempt)
            }
        }
    } else {
        for (part in 1..plan.partCount) retry { transfer(part) }
        retry { complete() }
    }
    return retry { finalize() }
}
