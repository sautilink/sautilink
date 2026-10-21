package com.sautilink.nativeapp.feature.auth

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.isActive
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException
import java.net.SocketTimeoutException

/** Real coroutine deadlines and cancellation only; no network or auth requests. */
class AuthRequestDeadlineTest {
    @Test fun successAndOrdinaryTransportFailurePassThroughWithoutRetry() = runBlocking {
        var calls = 0
        assertEquals("ready", authRequestWithinDeadline { calls++; "ready" })
        assertEquals(1, calls)
        val failure = IOException("Synthetic transport failure")
        val thrown = runCatching { authRequestWithinDeadline<Unit> { calls++; throw failure } }.exceptionOrNull()
        assertSame(failure, thrown)
        assertEquals("The deadline wrapper must never replay a request", 2, calls)
        assertTrue(currentCoroutineContext().isActive)
    }

    @Test fun ownDeadlineBecomesSocketTimeout_andLeavesCallerActive() = runBlocking {
        var calls = 0
        var cleanedUp = false
        val thrown = runCatching {
            authRequestWithinDeadline(20L) {
                calls++
                try { awaitCancellation() } finally { cleanedUp = true }
            }
        }.exceptionOrNull()
        assertTrue(thrown is SocketTimeoutException)
        assertFalse(thrown is CancellationException)
        assertNull("An internal child deadline must not masquerade as caller cancellation", thrown?.cause)
        assertEquals(1, calls)
        assertTrue(cleanedUp)
        assertTrue("A single read timeout must not cancel the image/video owner", currentCoroutineContext().isActive)
    }

    @Test fun outerDeadlineRemainsCancellation_andNeverBecomesTransportFailure() = runBlocking {
        var calls = 0
        var cleanedUp = false
        val thrown = runCatching {
            withTimeout(20L) {
                authRequestWithinDeadline(20_000L) {
                    calls++
                    try { awaitCancellation() } finally { cleanedUp = true }
                }
            }
        }.exceptionOrNull()
        assertTrue(thrown is TimeoutCancellationException)
        assertFalse(thrown is IOException)
        assertEquals(1, calls)
        assertTrue(cleanedUp)
        assertTrue(currentCoroutineContext().isActive)
    }

    @Test fun explicitJobCancellationRemainsCancellation_andCleansUp() = runBlocking {
        val entered = CompletableDeferred<Unit>()
        var calls = 0
        var cleanedUp = false
        var observed: Exception? = null
        val child = async(start = CoroutineStart.UNDISPATCHED) {
            try {
                authRequestWithinDeadline {
                    calls++
                    entered.complete(Unit)
                    try { awaitCancellation() } finally { cleanedUp = true }
                }
            } catch (error: Exception) { observed = error; throw error }
        }
        entered.await()
        child.cancelAndJoin()
        assertTrue(child.isCancelled)
        assertTrue(observed is CancellationException)
        assertFalse(observed is IOException)
        assertEquals(1, calls)
        assertTrue(cleanedUp)
        assertTrue(currentCoroutineContext().isActive)
    }
}
