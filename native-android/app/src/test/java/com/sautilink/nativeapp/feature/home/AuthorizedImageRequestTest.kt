package com.sautilink.nativeapp.feature.home

import com.sautilink.nativeapp.feature.auth.AuthRequestException
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.CancellationException
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody
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

/** Fake HTTP calls only: privacy/cancellation boundaries exercise real request adapter. */
class AuthorizedImageRequestTest {
    private class FakeCall(private val whenEnqueued: ((FakeCall) -> Unit)? = null, method: String = "GET") : Call {
        private val fixtureRequest = Request.Builder().url("https://sautilink.com/api/fixture-photo")
            .method(method, null).build()
        lateinit var callback: Callback
        var cancelled = false
        private var enqueued = false
        override fun request() = fixtureRequest
        override fun execute(): Response = error("Fixture is asynchronous only")
        override fun enqueue(responseCallback: Callback) { callback = responseCallback; enqueued = true; whenEnqueued?.invoke(this) }
        override fun cancel() { cancelled = true }
        override fun isExecuted() = enqueued
        override fun isCanceled() = cancelled
        override fun timeout() = Timeout.NONE
        override fun clone(): Call = FakeCall()
        fun complete(body: ResponseBody, status: Int = 200, retryAfter: String? = null) = callback.onResponse(this,
            Response.Builder().request(request()).protocol(Protocol.HTTP_1_1).code(status)
                .message("Fixture").body(body).apply { if (retryAfter != null) header("Retry-After", retryAfter) }.build())
    }

    private class TrackedBody(bytes: ByteArray, private val type: String = "image/webp",
        private val declaredLength: Long = bytes.size.toLong()) : ResponseBody() {
        var closed = false
        var bytesRead = 0L
        private val input = object : ForwardingSource(Buffer().write(bytes)) {
            override fun read(sink: Buffer, byteCount: Long): Long = super.read(sink, byteCount).also {
                if (it > 0) bytesRead += it
            }
            override fun close() { closed = true; super.close() }
        }.buffer()
        override fun contentType() = type.toMediaType()
        override fun contentLength() = declaredLength
        override fun source(): BufferedSource = input
    }

    @Test fun recycledCellCancelsSocket_andDisposesAnyLateResponseWithoutReading() = runBlocking {
        val call = FakeCall()
        var delivered = false
        val loading = launch(start = CoroutineStart.UNDISPATCHED) {
            awaitAuthorizedImageBytes(call)
            delivered = true
        }
        loading.cancelAndJoin()
        assertTrue(call.cancelled)
        val body = TrackedBody(byteArrayOf(1, 2, 3))
        call.complete(body)
        assertTrue(body.closed)
        assertEquals(0L, body.bytesRead)
        assertFalse(delivered)
    }

    @Test fun validAuthenticatedImageBodyIsReturnedAndClosed() = runBlocking {
        val call = FakeCall()
        val result = async(start = CoroutineStart.UNDISPATCHED) { awaitAuthorizedImageBytes(call, 20) }
        val body = TrackedBody(byteArrayOf(1, 2, 3))
        call.complete(body)
        assertArrayEquals(byteArrayOf(1, 2, 3), result.await())
        assertTrue(body.closed)
    }

    @Test fun chunkedResponsesCannotBypassTheByteLimit() = runBlocking {
        val call = FakeCall()
        val result = async(start = CoroutineStart.UNDISPATCHED) {
            runCatching { awaitAuthorizedImageBytes(call, 20) }
        }
        val body = TrackedBody(ByteArray(21), declaredLength = -1)
        call.complete(body)
        assertTrue(result.await().exceptionOrNull() is IOException)
        assertTrue(body.closed)
    }

    @Test fun declaredOversizedNonImageAndDeniedResponsesFailBeforeDecoding() = runBlocking {
        listOf(Triple("image/jpeg", 21L, 200), Triple("text/html", 3L, 200),
            Triple("application/json", 3L, 403)).forEach { (type, length, status) ->
            val call = FakeCall()
            val result = async(start = CoroutineStart.UNDISPATCHED) {
                runCatching { awaitAuthorizedImageBytes(call, 20) }
            }
            val body = TrackedBody(byteArrayOf(1, 2, 3), type, length)
            call.complete(body, status)
            assertTrue(result.await().exceptionOrNull() is IOException)
            assertTrue(body.closed)
            assertEquals(0L, body.bytesRead)
        }
    }

    @Test fun transientNetworkFailureRetriesOnlyOnceThenReturnsImageBytes() = runBlocking {
        var calls = 0
        val pauses = mutableListOf<Long>()
        val result = authorizedImageBytesWithRetry(newCall = {
            val number = ++calls
            FakeCall({ call -> if (number == 1) call.callback.onFailure(call, IOException("Synthetic connection lost"))
                else call.complete(TrackedBody(byteArrayOf(4, 5, 6))) })
        }, stillEligible = { true }, pause = { pauses += it })
        assertArrayEquals(byteArrayOf(4, 5, 6), result)
        assertEquals(2, calls)
        assertEquals(listOf(600L), pauses)
    }

    @Test fun transientHttpStatusesRetryOnce_andCloseEveryFailedBody() = runBlocking {
        listOf(408, 429, 500, 503).forEach { status ->
            var calls = 0
            val bodies = mutableListOf<TrackedBody>()
            val result = authorizedImageBytesWithRetry(newCall = {
                val number = ++calls
                FakeCall({ call ->
                    val body = TrackedBody(byteArrayOf(7, 8)).also(bodies::add)
                    call.complete(body, if (number == 1) status else 200)
                })
            }, stillEligible = { true }, pause = { })
            assertArrayEquals(byteArrayOf(7, 8), result)
            assertEquals(2, calls)
            assertTrue(bodies.all { it.closed })
        }
    }

    @Test fun authMissingAndRedirectStatusesNeverRetry() = runBlocking {
        listOf(401, 403, 404, 302).forEach { status ->
            var calls = 0
            val failure = runCatching { authorizedImageBytesWithRetry(newCall = {
                calls++
                FakeCall({ it.complete(TrackedBody(byteArrayOf(1)), status) })
            }, stillEligible = { true }, pause = { fail("Permanent HTTP failures may not back off or retry") }) }.exceptionOrNull()
            assertTrue(failure is AuthorizedImageHttpFailure)
            assertEquals(status, (failure as AuthorizedImageHttpFailure).status)
            assertEquals(1, calls)
        }
    }

    @Test fun invalidBodyAndOversizeNeverRetry() = runBlocking {
        listOf({ TrackedBody(byteArrayOf(1), "text/html") },
            { TrackedBody(byteArrayOf(1), declaredLength = 12L * 1024 * 1024 + 1) }).forEach { body ->
            var calls = 0
            val failure = runCatching { authorizedImageBytesWithRetry(newCall = {
                calls++
                FakeCall({ it.complete(body()) })
            }, stillEligible = { true }, pause = { fail("Content/size failures may not retry") }) }.exceptionOrNull()
            assertTrue(failure is AuthorizedImageContentFailure)
            assertEquals(1, calls)
        }
    }

    @Test fun cancellingDuringBackoffNeverStartsAReplacementCall() = runBlocking {
        var calls = 0
        val enteredBackoff = CompletableDeferred<Unit>()
        val job = launch(start = CoroutineStart.UNDISPATCHED) {
            authorizedImageBytesWithRetry(newCall = {
                calls++
                FakeCall({ it.complete(TrackedBody(byteArrayOf(1)), 503) })
            }, stillEligible = { true }, pause = { enteredBackoff.complete(Unit); awaitCancellation() })
        }
        enteredBackoff.await()
        job.cancelAndJoin()
        assertEquals(1, calls)
    }

    @Test fun lostAccountEligibilityDuringBackoffStopsBeforeRetry() = runBlocking {
        var eligible = true
        var calls = 0
        val failure = runCatching { authorizedImageBytesWithRetry(newCall = {
            calls++
            FakeCall({ it.complete(TrackedBody(byteArrayOf(1)), 503) })
        }, stillEligible = { eligible }, pause = { eligible = false }) }.exceptionOrNull()
        assertTrue(failure is CancellationException)
        assertEquals(1, calls)
    }

    @Test fun retryAfterSecondsAndHttpDatesAreHonouredWithinBudget() = runBlocking {
        val now = Instant.parse("2026-10-21T00:00:00Z").toEpochMilli()
        val date = DateTimeFormatter.RFC_1123_DATE_TIME.format(Instant.ofEpochMilli(now + 3_000).atZone(ZoneOffset.UTC))
        listOf("3", date).forEach { header ->
            var calls = 0
            val pauses = mutableListOf<Long>()
            authorizedImageBytesWithRetry(newCall = {
                val number = ++calls
                FakeCall({ it.complete(TrackedBody(byteArrayOf(1)), if (number == 1) 429 else 200, header) })
            }, stillEligible = { true }, pause = { pauses += it }, nowMillis = { now })
            assertEquals(listOf(3_000L), pauses)
            assertEquals(2, calls)
        }
    }

    @Test fun longOrOverflowingRetryAfterDoesNotCreateAnEarlyRequest() = runBlocking {
        listOf("6", "3600", "999999999999999999999999999999999").forEach { header ->
            var calls = 0
            val failure = runCatching { authorizedImageBytesWithRetry(newCall = {
                calls++
                FakeCall({ it.complete(TrackedBody(byteArrayOf(1)), 429, header) })
            }, stillEligible = { true }, pause = { fail("A long server cooldown must not be shortened") }) }.exceptionOrNull()
            assertTrue(failure is AuthorizedImageHttpFailure)
            assertEquals(1, calls)
        }
    }

    @Test fun repeatedTransientFailureStopsAtTwoAttempts() = runBlocking {
        var calls = 0
        var pauses = 0
        val failure = runCatching { authorizedImageBytesWithRetry(newCall = {
            calls++
            FakeCall({ it.complete(TrackedBody(byteArrayOf(1)), 503) })
        }, stillEligible = { true }, pause = { pauses++ }) }.exceptionOrNull()
        assertTrue(failure is AuthorizedImageHttpFailure)
        assertEquals(503, (failure as AuthorizedImageHttpFailure).status)
        assertEquals(2, calls)
        assertEquals(1, pauses)
    }

    @Test fun obsoleteScopeAndNonGetRequestsNeverStartImageTransport() = runBlocking {
        var calls = 0
        assertTrue(runCatching { authorizedImageBytesWithRetry(newCall = {
            calls++; FakeCall()
        }, stillEligible = { false }) }.exceptionOrNull() is CancellationException)
        assertEquals(0, calls)
        val head = FakeCall(method = "HEAD")
        assertTrue(runCatching { authorizedImageBytesWithRetry({ head }, { true }) }.exceptionOrNull() is IllegalArgumentException)
        assertFalse(head.isExecuted())
    }

    @Test fun wrappedAuthTransportFailureAllowsEnvironmentRecovery_withoutAutomaticRequestRetry() = runBlocking {
        val failure = AuthRequestException("Synthetic token transport unavailable", cause = IOException("Offline fixture"))
        assertTrue(authorizedImageEnvironmentRecovery(failure))
        var calls = 0
        val thrown = runCatching { authorizedImageBytesWithRetry(newCall = {
            calls++
            throw failure
        }, stillEligible = { true }, pause = { fail("Auth/refresh requests must not enter the GET retry policy") }) }.exceptionOrNull()
        assertSame(failure, thrown)
        assertEquals(1, calls)
    }

    @Test fun authEnvironmentRecoveryRequiresTransientStatus_andNeverBypassesDeniedOrMissingSessions() {
        listOf(408, 429, 500, 503).forEach { status ->
            assertTrue(authorizedImageEnvironmentRecovery(AuthRequestException("Transient auth fixture", status)))
        }
        listOf(400, 401, 403, 404, 409).forEach { status ->
            assertFalse(authorizedImageEnvironmentRecovery(AuthRequestException("Denied auth fixture", status,
                IOException("A nested I/O exception must not override a denied status"))))
        }
        assertFalse(authorizedImageEnvironmentRecovery(AuthRequestException("Missing renewable session")))
        assertFalse(authorizedImageEnvironmentRecovery(AuthorizedImageContentFailure("Invalid image")))
        assertFalse(authorizedImageEnvironmentRecovery(CancellationException("Obsolete cell")))
    }
}
