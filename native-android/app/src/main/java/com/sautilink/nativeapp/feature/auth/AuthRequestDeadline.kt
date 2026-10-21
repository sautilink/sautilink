package com.sautilink.nativeapp.feature.auth

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withTimeout
import java.net.SocketTimeoutException

/** A request's own deadline is a transport failure, while caller cancellation
 * stays cancellation. This helper never repeats authentication or refresh calls.
 */
internal suspend fun <T> authRequestWithinDeadline(
    timeoutMillis: Long = 20_000L,
    block: suspend CoroutineScope.() -> T,
): T = try {
    withTimeout(timeoutMillis, block)
} catch (timeout: TimeoutCancellationException) {
    currentCoroutineContext().ensureActive()
    // The timed-out child is already finished; attaching its cancellation would
    // incorrectly classify this active caller's transport failure as disposal.
    throw SocketTimeoutException("Authentication request timed out")
}
