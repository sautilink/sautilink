package com.sautilink.nativeapp.feature.home

import com.sautilink.nativeapp.feature.auth.AuthRequestException
import kotlinx.coroutines.*
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import okio.Buffer
import okio.BufferedSource
import okio.ForwardingSource
import okio.Timeout
import okio.buffer
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

class FollowReadRecoveryTest {
    private val first = "00000000-0000-4000-8000-000000000001"
    private val second = "00000000-0000-4000-8000-000000000002"
    private class Body(bytes: ByteArray = "[]".toByteArray(), private val type: String = "application/json",
        private val declared: Long = bytes.size.toLong()) : ResponseBody() {
        var closed = false; var read = 0L
        private val input = object : ForwardingSource(Buffer().write(bytes)) {
            override fun read(sink: Buffer, byteCount: Long): Long = super.read(sink, byteCount).also { if (it > 0) read += it }
            override fun close() { closed = true; super.close() }
        }.buffer()
        override fun contentType() = type.toMediaType()
        override fun contentLength() = declared
        override fun source(): BufferedSource = input
    }
    private class FakeCall(private val action: ((FakeCall) -> Unit)? = null, method: String = "GET") : Call {
        private val request = Request.Builder().url("https://fixture.supabase.co/rest/v1/social_follows")
            .method(method, if (method == "POST") "{}".toRequestBody("application/json".toMediaType()) else null).build()
        lateinit var callback: Callback
        var cancelled = false; var enqueued = false
        override fun request() = request
        override fun execute(): Response = error("Asynchronous fixture only")
        override fun enqueue(responseCallback: Callback) { callback = responseCallback; enqueued = true; action?.invoke(this) }
        override fun cancel() { cancelled = true }
        override fun isExecuted() = enqueued
        override fun isCanceled() = cancelled
        override fun timeout() = Timeout.NONE
        override fun clone(): Call = FakeCall()
        fun complete(body: ResponseBody = Body(), status: Int = 200, retryAfter: String? = null) = callback.onResponse(this,
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(status).message("Fixture")
                .body(body).apply { if (retryAfter != null) header("Retry-After", retryAfter) }.build())
    }

    @Test fun oneTransientGetFailureRetriesThenReturnsOnlySuccessfulResponseBytes() = runBlocking {
        var calls = 0; val waits = mutableListOf<Long>()
        val bytes = followReadBytesWithRetry(newCall = {
            val attempt = ++calls
            FakeCall({ if (attempt == 1) it.callback.onFailure(it, IOException("Synthetic network loss")) else it.complete() })
        }, stillCurrent = { true }, pause = { waits += it })
        assertArrayEquals("[]".toByteArray(), bytes)
        assertEquals(2, calls); assertEquals(listOf(600L), waits)
    }

    @Test fun transientHttpFailuresRetryOnlyOnce_andEveryResponseCloses() = runBlocking {
        listOf(408, 429, 500, 503).forEach { status ->
            var calls = 0; val bodies = mutableListOf<Body>()
            followReadBytesWithRetry(newCall = {
                val attempt = ++calls
                FakeCall({ it.complete(Body().also(bodies::add), if (attempt == 1) status else 200) })
            }, stillCurrent = { true }, pause = {})
            assertEquals(2, calls); assertTrue(bodies.all { it.closed })
        }
    }

    @Test fun denialMissingAndRedirectStatusesNeverRetryOrInventFollowState() = runBlocking {
        listOf(401, 403, 404, 302).forEach { status ->
            var calls = 0
            val failure = runCatching { followReadBytesWithRetry(newCall = {
                calls++; FakeCall({ it.complete(status = status) })
            }, stillCurrent = { true }, pause = {}) }
            assertTrue(failure.exceptionOrNull() is FollowReadHttpFailure)
            assertEquals(1, calls)
        }
    }

    @Test fun persistentNetworkFailureStopsAfterTwoAttempts() = runBlocking {
        var calls = 0
        val failure = runCatching { followReadBytesWithRetry(newCall = {
            calls++; FakeCall({ it.callback.onFailure(it, IOException("Synthetic connection loss")) })
        }, stillCurrent = { true }, pause = {}) }
        assertTrue(failure.exceptionOrNull() is IOException); assertEquals(2, calls)
    }

    @Test fun cancellationDuringBackoffPreventsAnotherGet() = runBlocking {
        var calls = 0
        val failure = runCatching { followReadBytesWithRetry(newCall = {
            calls++; FakeCall({ it.callback.onFailure(it, IOException("Synthetic failure")) })
        }, stillCurrent = { true }, pause = { throw CancellationException("Fixture cancelled") }) }
        assertTrue(failure.exceptionOrNull() is CancellationException); assertEquals(1, calls)
    }

    @Test fun accountChangeDuringBackoffPreventsAnotherGet() = runBlocking {
        var current = true; var calls = 0
        val failure = runCatching { followReadBytesWithRetry(newCall = {
            calls++; FakeCall({ it.callback.onFailure(it, IOException("Synthetic failure")) })
        }, stillCurrent = { current }, pause = { current = false }) }
        assertTrue(failure.exceptionOrNull() is CancellationException); assertEquals(1, calls)
    }

    @Test fun lateResponseFromPreviousAccountIsDiscarded() = runBlocking {
        var current = true
        val failure = runCatching { followReadBytesWithRetry(newCall = {
            FakeCall({ current = false; it.complete() })
        }, stillCurrent = { current }, pause = {}) }
        assertTrue(failure.exceptionOrNull() is CancellationException)
    }

    @Test fun cancelledFeedCancelsSocket_andClosesUnreadLateBody() = runBlocking {
        val call = FakeCall()
        val pending = launch(start = CoroutineStart.UNDISPATCHED) { awaitFollowReadBytes(call) }
        pending.cancelAndJoin()
        val body = Body(); call.complete(body)
        assertTrue(call.cancelled); assertTrue(body.closed); assertEquals(0L, body.read)
    }

    @Test fun mutationCallsCannotEnterTheReadRetryBoundary() = runBlocking {
        listOf("POST", "DELETE").forEach { method ->
            val call = FakeCall(method = method)
            val failure = runCatching { followReadBytesWithRetry({ call }, { true }, {}) }
            assertTrue(failure.exceptionOrNull() is IllegalArgumentException)
            assertFalse(call.enqueued)
        }
    }

    @Test fun invalidOrOversizedJsonIsNotRetried_andChunkedBytesRemainBounded() = runBlocking {
        listOf(Body(type = "text/html"), Body(declared = 65_537L), Body(ByteArray(65_537), declared = -1L)).forEach { body ->
            var calls = 0
            val failure = runCatching { followReadBytesWithRetry(newCall = { calls++; FakeCall({ it.complete(body) }) },
                stillCurrent = { true }, pause = {}) }
            assertTrue(failure.exceptionOrNull() is FollowReadContentFailure)
            assertEquals(1, calls); assertTrue(body.closed)
        }
    }

    @Test fun retryAfterAndTypedCausesRespectCooldownAndAuthorization() {
        val now = 1_000_000L
        assertEquals(3_000L, followReadRetryDelay(FollowReadHttpFailure(429, "3"), now))
        assertNull(followReadRetryDelay(FollowReadHttpFailure(429, "6"), now))
        val future = DateTimeFormatter.RFC_1123_DATE_TIME.format(Instant.ofEpochMilli(now + 6_000L).atZone(ZoneOffset.UTC))
        assertNull(followReadRetryDelay(FollowReadHttpFailure(503, future), now))
        assertEquals(600L, followReadRetryDelay(AuthRequestException("Offline", cause = IOException("Synthetic")), now))
        assertNull(followReadRetryDelay(AuthRequestException("Denied", 403, IOException("Synthetic")), now))
        assertNull(followReadRetryDelay(IllegalStateException("Cancelled", CancellationException()), now))
    }

    @Test fun malformedOrCrossBatchRowsStayUnknown_insteadOfBecomingFalse() {
        assertEquals(emptySet<String>(), validatedFollowReadIds(setOf(first), emptyList()))
        assertEquals(setOf(first), validatedFollowReadIds(setOf(first, second), listOf(first, first)))
        listOf(listOf(null), listOf(42), listOf("invalid-id"), listOf(second)).forEach { rows ->
            assertThrows(FollowReadContentFailure::class.java) { validatedFollowReadIds(setOf(first), rows) }
        }
    }

    @Test fun aConfirmedFollowDuringReadRecoveryCannotBeOverwrittenByLateGet() {
        val versions = FeedActionVersions()
        val snapshot = versions.snapshot()
        versions.changed("follow:$first")
        assertEquals(mapOf(first to true), versions.reconcile("follow", mapOf(first to true), mapOf(first to false), snapshot))
    }
}
