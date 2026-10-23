package com.sautilink.nativeapp.feature.home

import com.sautilink.nativeapp.ui.components.NativePlaybackRead
import com.sautilink.nativeapp.ui.components.NativeVideoSource
import com.sautilink.nativeapp.ui.components.nativePlaybackNeedsRetry
import org.junit.Assert.*
import org.junit.Test

class FeedVideoMetadataWarmupTest {
    private val owner = "11111111-1111-4111-8111-111111111111"
    private val id = "00000000-0000-4000-8000-000000000001"
    private val other = "00000000-0000-4000-8000-000000000002"
    private val origin = "https://sautilink.com"
    private val mediaPath = "/api/sauti-media/$id"
    private val now = 1_792_540_000_000L

    private fun eligible(adaptive: Boolean = true, session: Boolean = true, foreground: Boolean = true,
        current: Boolean = true, fraction: Float = .1f, autoplay: Boolean = true,
        started: Boolean = false, manual: Boolean = false, paused: Boolean = false) =
        feedVideoMetadataEligible(adaptive, session, foreground, current, fraction, autoplay, started, manual, paused)

    private fun grant() = NativePlaybackRead().apply {
        ownerId = owner
        bearer = "existing-authenticated-credential"
        source = NativeVideoSource(id, "$origin$mediaPath/hls/m_example?c=payload.${"a".repeat(43)}",
            true, now + 300_000L)
        sourceAttempt = attempt
    }

    private fun failedWarmup() = NativePlaybackRead().apply {
        failure = true
        source = NativeVideoSource(id, "$origin$mediaPath", false)
    }

    private fun FeedVideoWarmupHandoff.intent(read: NativePlaybackRead, account: String? = owner,
        content: String = id, allowed: Boolean = true) = onAutoplayIntent(
        read, account, content, origin, "/api/sauti-media/$content/playback", now, allowed)

    @Test fun actualVisibleAutoplayPageCanReadMetadataBeforeTheExistingPlayThreshold() {
        assertTrue(eligible(fraction = .001f))
        assertTrue(eligible(fraction = .57f))
        assertTrue(eligible(fraction = .58f))
        assertFalse(eligible(fraction = 0f))
        assertFalse(eligible(fraction = -1f))
        assertFalse(eligible(fraction = Float.NaN))
        assertFalse(eligible(fraction = Float.POSITIVE_INFINITY))
        assertFalse(eligible(fraction = 1.01f))
    }

    @Test fun metadataWarmupRequiresSessionForegroundCurrentPageAndCanonicalPublishedMedia() {
        assertFalse(eligible(session = false))
        assertFalse(eligible(foreground = false))
        assertFalse(eligible(current = false))
        assertTrue(eligible(adaptive = publishedVideoAdaptivePlayback(id, mediaPath)))
        assertFalse(eligible(adaptive = publishedVideoAdaptivePlayback(id,
            "/api/rooms/$id/post-submissions/$id/media/$id")))
        assertFalse(eligible(adaptive = publishedVideoAdaptivePlayback(id, mediaPath, enabled = false)))
    }

    @Test fun autoplayOffAndExplicitPauseDoNotCreateSpeculativeReads() {
        assertFalse(eligible(autoplay = false))
        assertTrue(eligible(autoplay = false, started = true))
        assertTrue(eligible(autoplay = false, manual = true))
        assertFalse(eligible(paused = true))
        assertFalse(eligible(autoplay = false, started = true, manual = true, paused = true))
    }

    @Test fun failedPreIntentFallbackGetsOneAutoplayRecoveryWithoutPreparingThatFallback() {
        val handoff = FeedVideoWarmupHandoff()
        val read = failedWarmup()
        assertTrue(handoff.intent(read))
        assertEquals(1, read.attempt)
        assertNull("Never prepare the failed speculative MP4 while requesting HLS", read.source)
        assertFalse(handoff.intent(read))
        assertEquals("Repeated visibility/scroll return cannot replay recovery", 1, read.attempt)
    }

    @Test fun firstIntentConsumesAnInflightWarmupAndNeverRestartsItsLaterFailure() {
        val handoff = FeedVideoWarmupHandoff()
        val read = NativePlaybackRead().apply { loading = true }
        assertFalse(handoff.intent(read))
        assertEquals(0, read.attempt)
        read.loading = false
        read.failure = true
        read.source = NativeVideoSource(id, "$origin$mediaPath", false)
        val source = read.source
        assertFalse(handoff.intent(read))
        assertEquals(0, read.attempt)
        assertSame(source, read.source)
    }

    @Test fun healthyWarmGrantAndFailedRefreshOfAStillUsableGrantNeverRetryAtIntent() {
        for (refreshFailed in listOf(false, true)) {
            val read = grant().apply { failure = refreshFailed }
            val source = read.source
            assertFalse(FeedVideoWarmupHandoff().intent(read))
            assertEquals(0, read.attempt)
            assertSame(source, read.source)
            assertEquals(now + 300_000L, read.source!!.expiresAtMillis)
        }
    }

    @Test fun successfulMp4ProcessingDescriptorIsKeptWithoutAnAutomaticRetry() {
        val read = failedWarmup().apply { failure = false }
        val source = read.source
        assertFalse(FeedVideoWarmupHandoff().intent(read))
        assertEquals(0, read.attempt)
        assertSame(source, read.source)
    }

    @Test fun denialMissingSessionAndUnavailableAdaptivePathCannotBeRetriedByWarmupHandoff() {
        val denied = failedWarmup().apply { this.denied = true; source = null }
        assertFalse(FeedVideoWarmupHandoff().intent(denied))
        assertEquals(0, denied.attempt)
        val noSession = failedWarmup()
        assertFalse(FeedVideoWarmupHandoff().intent(noSession, account = null))
        assertEquals(0, noSession.attempt)
        val disabled = failedWarmup()
        assertFalse(FeedVideoWarmupHandoff().intent(disabled, allowed = false))
        assertEquals(0, disabled.attempt)
    }

    @Test fun failedAbsentOrStaleGrantCanRecoverWithoutExtendingItsAuthorization() {
        val absent = NativePlaybackRead().apply { failure = true }
        assertTrue(FeedVideoWarmupHandoff().intent(absent))
        assertEquals(1, absent.attempt)
        val stale = grant().apply { failure = true; source = source!!.copy(expiresAtMillis = now + 40_000L) }
        val source = stale.source
        assertTrue(FeedVideoWarmupHandoff().intent(stale))
        assertEquals(1, stale.attempt)
        assertSame(source, stale.source)
        assertEquals(now + 40_000L, stale.source!!.expiresAtMillis)
    }

    @Test fun foreignOwnerOrMediaStateIsNotMutatedByTheNewIntent() {
        val foreignOwner = failedWarmup().apply { ownerId = other }
        val ownerSource = foreignOwner.source
        assertFalse(FeedVideoWarmupHandoff().intent(foreignOwner))
        assertEquals(0, foreignOwner.attempt)
        assertSame(ownerSource, foreignOwner.source)
        val foreignMedia = failedWarmup()
        val mediaSource = foreignMedia.source
        assertFalse(FeedVideoWarmupHandoff().intent(foreignMedia, content = other))
        assertEquals(0, foreignMedia.attempt)
        assertSame(mediaSource, foreignMedia.source)
    }

    @Test fun aNewMountedScopeHasItsOwnOneShotButTheOldScopeCannotReplayIt() {
        val old = FeedVideoWarmupHandoff()
        val oldRead = failedWarmup()
        assertTrue(old.intent(oldRead))
        val newRead = failedWarmup()
        assertTrue(FeedVideoWarmupHandoff().intent(newRead))
        assertFalse(old.intent(oldRead))
        assertEquals(1, oldRead.attempt)
        assertEquals(1, newRead.attempt)
    }

    @Test fun manualFirstIntentLeavesExistingExplicitRetryBehaviorInCharge() {
        val handoff = FeedVideoWarmupHandoff()
        val read = failedWarmup()
        val source = read.source
        handoff.consumeManualIntent()
        if (nativePlaybackNeedsRetry(read, now, playerFailed = false)) read.retry()
        assertEquals(1, read.attempt)
        assertSame("Explicit Retry keeps its existing source policy", source, read.source)
        assertFalse(handoff.intent(read))
        assertEquals(1, read.attempt)
        read.retry()
        assertEquals("A later deliberate Retry is still allowed", 2, read.attempt)
    }
}
