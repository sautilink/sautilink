package com.sautilink.nativeapp.ui.components

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.Base64

class NativePlaybackResumeReuseTest {
    private val owner = "11111111-1111-4111-8111-111111111111"
    private val id = "00000000-0000-4000-8000-000000000001"
    private val other = "00000000-0000-4000-8000-000000000002"
    private val origin = "https://sautilink.com"
    private val path = "/api/sauti-media/$id/playback"
    private val now = 1_792_540_000_000L
    private fun token(expires: Long = now + 3_600_000L) = "header." +
        Base64.getUrlEncoder().withoutPadding().encodeToString(
            JSONObject().put("exp", expires / 1000L).toString().toByteArray()) + ".signature"

    private fun read() = NativePlaybackRead().apply {
        ownerId = owner
        bearer = token()
        source = NativeVideoSource(id,
            "$origin/api/sauti-media/$id/hls/m_example?c=payload.${"a".repeat(43)}",
            true, now + 300_000L, cacheKey = owner)
        sourceAttempt = attempt
    }

    private suspend fun resume(value: NativePlaybackRead, account: String = owner,
        content: String = id, site: String = origin, endpoint: String = path,
        credential: String = token(), time: Long = now, current: () -> Boolean = { true },
        wait: suspend (Long) -> Unit = {}) = waitForNativePlaybackResume(
        value, account, content, site, endpoint, credential, time, current, wait)

    @Test fun mountedReturnKeepsTheSameSourceUntilItsOriginalRefreshDeadline() = runBlocking {
        val value = read().apply { loading = true }
        val originalSource = value.source
        val entered = CompletableDeferred<Long>()
        val deadline = CompletableDeferred<Unit>()
        var descriptorRequests = 0
        val returnToVideo = launch(start = CoroutineStart.UNDISPATCHED) {
            resume(value, wait = { remaining -> entered.complete(remaining); deadline.await() })
            // This is the descriptor branch after the production resolver's
            // reuse suspension; reaching it early would replace the playing URI.
            descriptorRequests++
        }
        assertEquals(255_000L, entered.await())
        assertEquals(0, descriptorRequests)
        assertFalse(value.loading)
        assertSame(originalSource, value.source)
        assertEquals(now + 300_000L, value.source!!.expiresAtMillis)
        assertEquals(owner, value.source!!.cacheKey)
        deadline.complete(Unit)
        returnToVideo.join()
        assertEquals(1, descriptorRequests)
    }

    @Test fun repeatedViewportReturnsNeverExtendTheOriginalAuthorization() = runBlocking {
        val value = read()
        val waits = mutableListOf<Long>()
        assertTrue(resume(value, time = now + 30_000L, wait = { waits += it }))
        assertTrue(resume(value, time = now + 245_000L, wait = { waits += it }))
        assertEquals(listOf(225_000L, 10_000L), waits)
        assertFalse(resume(value, time = now + 255_000L, wait = { fail("Expired warm-up must fetch now") }))
        assertEquals(now + 300_000L, value.source!!.expiresAtMillis)
    }

    @Test fun authRenewalDeadlineCanRequireAnEarlierDescriptorThanCapabilityExpiry() = runBlocking {
        val credential = token(now + 60_000L)
        val value = read().apply { bearer = credential }
        var wait = 0L
        assertTrue(resume(value, credential = credential, wait = { wait = it }))
        assertEquals(10_000L, wait)
        assertFalse(resume(value, credential = credential, time = now + 6_000L,
            wait = { fail("Credentials inside the refresh window require Auth now") }))
    }

    @Test fun newMountedReadCannotReuseAnotherPlayersGrant() = runBlocking {
        assertFalse(resume(NativePlaybackRead(), wait = { fail("A new mount must obtain its own descriptor") }))
        assertFalse(resume(read().apply { ownerId = null }, wait = { fail("Missing owner cannot reuse") }))
    }

    @Test fun wrongAccountContentOriginAndEndpointCannotReuseAnExistingSource() = runBlocking {
        val value = read()
        val noWait: suspend (Long) -> Unit = { fail("Foreign scope must request an authorized descriptor") }
        assertFalse(resume(value, account = "another-account", wait = noWait))
        assertFalse(resume(value, content = other, wait = noWait))
        assertFalse(resume(value, site = "https://test.sautilink.com", wait = noWait))
        assertFalse(resume(value, endpoint = "/api/stories/$id/playback", wait = noWait))
        assertFalse(resume(value, endpoint = "$path?redirect=foreign", wait = noWait))
        assertFalse(resume(value, current = { false }, wait = noWait))
    }

    @Test fun missingChangedOrBlankCurrentCredentialCannotReuseEvenWithTheSameOwner() = runBlocking {
        val noWait: suspend (Long) -> Unit = { fail("Credential changes require a new descriptor") }
        assertFalse(resume(read().apply { bearer = null }, wait = noWait))
        assertFalse(resume(read(), credential = "", wait = noWait))
        assertFalse(resume(read(), credential = token(now + 7_200_000L), wait = noWait))
    }

    @Test fun deniedFailedMp4AndNearExpirySourcesNeverDelayARecoveryRequest() = runBlocking {
        val noWait: suspend (Long) -> Unit = { fail("Recovery must not wait for the previous grant") }
        assertFalse(resume(read().apply { denied = true }, wait = noWait))
        assertFalse(resume(read().apply { failure = true }, wait = noWait))
        assertFalse(resume(read().apply { source = source!!.copy(hls = false) }, wait = noWait))
        assertFalse(resume(read().apply { source = source!!.copy(expiresAtMillis = null) }, wait = noWait))
        assertFalse(resume(read(), time = now + 255_000L, wait = noWait))
        assertFalse(resume(read(), time = now + 301_000L, wait = noWait))
    }

    @Test fun explicitRetryBypassesReuseEvenThoughTheOldSourceIsStillUsable() = runBlocking {
        val value = read()
        val original = value.source
        value.retry()
        assertFalse(resume(value, wait = { fail("Explicit Retry must fetch immediately") }))
        assertSame(original, value.source)
    }

    @Test fun disablingTheMountedPlayerCancelsItsScheduledDescriptorRequest() = runBlocking {
        val value = read()
        val entered = CompletableDeferred<Unit>()
        var descriptorRequests = 0
        val job = launch(start = CoroutineStart.UNDISPATCHED) {
            resume(value, wait = { entered.complete(Unit); awaitCancellation() })
            descriptorRequests++
        }
        entered.await()
        job.cancelAndJoin()
        assertEquals(0, descriptorRequests)
        assertEquals(now + 300_000L, value.source!!.expiresAtMillis)
    }

    @Test fun changedAccountRetryOrSourceDuringTheWaitCannotLaunchAStaleRefresh() = runBlocking {
        suspend fun assertObsolete(change: (NativePlaybackRead) -> Unit, eligibility: () -> Boolean = { true }) {
            val value = read()
            var descriptorRequests = 0
            val error = runCatching {
                resume(value, current = eligibility, wait = { change(value) })
                descriptorRequests++
            }.exceptionOrNull()
            assertTrue(error is CancellationException)
            assertEquals(0, descriptorRequests)
        }
        var eligible = true
        assertObsolete({ eligible = false }, { eligible })
        assertObsolete({ it.retry() })
        assertObsolete({ it.source = it.source!!.copy(cacheKey = other) })
    }

    @Test fun healthyHlsAndMp4ManualResumeDoNotRetryOrChangeTheSource() {
        val hls = read()
        val original = hls.source
        assertFalse(nativePlaybackNeedsRetry(hls, now, playerFailed = false))
        assertEquals(0, hls.attempt)
        assertSame(original, hls.source)
        val mp4 = read().apply {
            source = NativeVideoSource(id, "$origin/api/sauti-media/$id", false)
            bearer = null
        }
        assertFalse(nativePlaybackNeedsRetry(mp4, now, playerFailed = false))
    }

    @Test fun actualManualRecoveryRetainsItsRetryTriggers() {
        assertTrue(nativePlaybackNeedsRetry(NativePlaybackRead(), now, playerFailed = false))
        assertTrue(nativePlaybackNeedsRetry(read(), now, playerFailed = true))
        assertTrue(nativePlaybackNeedsRetry(read().apply { denied = true }, now, playerFailed = false))
        assertTrue(nativePlaybackNeedsRetry(read().apply { failure = true }, now, playerFailed = false))
        assertTrue(nativePlaybackNeedsRetry(read().apply { bearer = null }, now, playerFailed = false))
        assertTrue(nativePlaybackNeedsRetry(read(), now + 300_000L, playerFailed = false))
        assertTrue(nativePlaybackNeedsRetry(read().apply { source = source!!.copy(expiresAtMillis = null) },
            now, playerFailed = false))
        assertTrue(nativePlaybackNeedsRetry(read().apply { source = source!!.copy(hls = false) },
            now, playerFailed = true))
    }
}
