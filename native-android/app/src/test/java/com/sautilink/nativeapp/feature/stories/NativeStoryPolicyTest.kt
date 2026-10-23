package com.sautilink.nativeapp.feature.stories

import com.sautilink.nativeapp.feature.posts.NativeImageEdits
import com.sautilink.nativeapp.feature.posts.NativeMediaEditPolicy
import com.sautilink.nativeapp.feature.posts.NativePhotoFilter
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class NativeStoryPolicyTest {
    @Test fun expiryIsExclusiveAndMalformedExpiryFailsClosed() {
        val expiry = "2026-10-21T12:00:00Z"
        val time = Instant.parse(expiry).toEpochMilli()
        assertTrue(NativeStoryPolicy.active(expiry, time - 1))
        assertFalse(NativeStoryPolicy.active(expiry, time))
        assertFalse(NativeStoryPolicy.active("not-a-date", time))
    }
    @Test fun dailyQuotaBoundariesAndUnknownKindAreRejected() {
        assertTrue(NativeStoryPolicy.canCreate("image", 3, 2))
        assertFalse(NativeStoryPolicy.canCreate("image", 4, 0))
        assertTrue(NativeStoryPolicy.canCreate("video", 4, 1))
        assertFalse(NativeStoryPolicy.canCreate("video", 0, 2))
        assertFalse(NativeStoryPolicy.canCreate("image", -1, 0))
        assertFalse(NativeStoryPolicy.canCreate("audio", 0, 0))
    }
    @Test fun navigationStopsAtLastStoryAndPreviousNeverUnderflows() {
        assertEquals(1, NativeStoryPolicy.next(0, 2))
        assertNull(NativeStoryPolicy.next(1, 2))
        assertNull(NativeStoryPolicy.next(0, 0))
        assertEquals(0, NativeStoryPolicy.previous(0, 2))
        assertEquals(1, NativeStoryPolicy.previous(2, 3))
    }
    @Test fun reactionsToggleOrReplaceWithoutImpossibleCombination() {
        assertEquals("love", NativeStoryPolicy.reaction(null, "love"))
        assertNull(NativeStoryPolicy.reaction("love", "love"))
        assertEquals("dislike", NativeStoryPolicy.reaction("love", "dislike"))
    }
    @Test fun progressNeverExceedsSegmentAndUnknownDurationStaysAtZero() {
        assertEquals(0f, NativeStoryPolicy.progress(10, 0))
        assertEquals(.5f, NativeStoryPolicy.progress(15_000, 30_000))
        assertEquals(1f, NativeStoryPolicy.progress(40_000, 30_000))
        assertEquals(0f, NativeStoryPolicy.progress(-10, 30_000))
    }
    @Test fun storyTrimCapsActualExportSelectionAtThirtySeconds() {
        val initial = NativeMediaEditPolicy.trim(120_000, lengthMs = NativeStoryPolicy.MAX_VIDEO_MS, maximumMs = NativeStoryPolicy.MAX_VIDEO_MS)
        assertEquals(30_000L, initial.durationMs)
        val moved = NativeMediaEditPolicy.trim(120_000, 80_000, 60_000, NativeStoryPolicy.MAX_VIDEO_MS)
        assertEquals(80_000L, moved.startMs)
        assertEquals(110_000L, moved.endMs)
        assertTrue(NativeMediaEditPolicy.validTrim(120_000, moved.startMs, moved.endMs, NativeStoryPolicy.MAX_VIDEO_MS))
        assertFalse(NativeMediaEditPolicy.validTrim(120_000, 0, 30_001, NativeStoryPolicy.MAX_VIDEO_MS))
        // Post editing now allows up to three minutes; Story remains capped at thirty seconds.
        assertEquals(120_000L, NativeMediaEditPolicy.trim(120_000).durationMs)
    }
    @Test fun applyingPhotoFilterPreservesFramingAndResetReturnsOriginalColors() {
        val crop = NativeImageEdits(rotation = 90, aspect = 9f / 16f, zoom = 1.8f, panX = .4f, panY = -.3f)
        val golden = NativePhotoFilter.Golden.applyTo(crop)
        assertEquals(crop.rotation, golden.rotation)
        assertEquals(crop.aspect, golden.aspect)
        assertEquals(crop.zoom, golden.zoom)
        assertEquals(crop.panX, golden.panX)
        assertTrue(golden.warmth > 0)
        assertEquals(0f, NativePhotoFilter.Mono.applyTo(crop).saturation)
        assertEquals(crop, NativePhotoFilter.Original.applyTo(golden))
    }
    @Test fun expiredStoriesAndOwnStoriesNeverInflateUnreadBadge() {
        val now = Instant.parse("2026-10-21T12:00:00Z").toEpochMilli()
        fun story(id: String, expires: String, seen: Boolean = false) = NativeStory(id, id, "image", "", "", expires, 0, "", "", "", seen, 0, null)
        fun author(id: String) = NativeStoryAuthor(id, "user$id", "User", false, "standard", false)
        val feed = NativeStoriesFeed(listOf(
            NativeStoryGroup(author("own"), listOf(story("own", "2026-10-22T12:00:00Z"))),
            NativeStoryGroup(author("other"), listOf(story("a", "2026-10-22T12:00:00Z"), story("b", "2026-10-21T11:00:00Z"), story("c", "2026-10-22T12:00:00Z", true)))
        ))
        assertEquals(1, feed.unreadCount("own", now))
        assertEquals(0, feed.copy(serverOffsetMs = 24 * 60 * 60 * 1_000L).unreadCount("own", now))
    }
}
