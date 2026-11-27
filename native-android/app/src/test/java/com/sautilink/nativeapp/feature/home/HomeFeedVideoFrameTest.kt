package com.sautilink.nativeapp.feature.home

import org.junit.Assert.*
import org.junit.Test

class HomeFeedVideoFrameTest {
    @Test fun tallPortraitFillsTwoByThreeWithoutStretchingItsSource() {
        val frame = homeFeedVideoFrame(1080, 1920)
        assertEquals(2f / 3f, frame.aspectRatio, .00001f)
        assertTrue(frame.crop)
        // At full width, 1620 of the original 1920 vertical pixels remain visible.
        assertEquals(.84375f, (1080f / frame.aspectRatio) / 1920f, .00001f)
        assertTrue(homeFeedVideoFrame(1080, 2400).crop)
    }

    @Test fun boundaryAndShorterVideosRetainTheirOwnAspect() {
        for ((width, height) in listOf(1080 to 1620, 1080 to 1350, 1080 to 1080,
            1920 to 1080, 4000 to 1000)) {
            val frame = homeFeedVideoFrame(width, height)
            assertEquals(width.toFloat() / height, frame.aspectRatio, .00001f)
            assertFalse(frame.crop)
        }
    }

    @Test fun missingDimensionsDoNotGuessACropOrChangeTheLegacyFallback() {
        for ((width, height) in listOf(0 to 0, 1080 to 0, 0 to 1920, -1 to 1920)) {
            val frame = homeFeedVideoFrame(width, height)
            assertEquals(.8f, frame.aspectRatio, 0f)
            assertFalse(frame.crop)
        }
    }
}
