package com.sautilink.nativeapp.feature.posts

import org.junit.Assert.*
import org.junit.Test

class NativePostMediaBoundariesTest {
    @Test fun threeMinutePostAllowsLongerClipsButKeepsStoryOverrideStrict() {
        assertTrue(NativeMediaEditPolicy.validTrim(240_000, 20_000, 200_000))
        assertFalse(NativeMediaEditPolicy.validTrim(240_000, 20_000, 200_001))
        assertEquals(NativeMediaEditPolicy.Trim(0, 180_000), NativeMediaEditPolicy.trim(240_000))
        assertTrue(NativeMediaEditPolicy.validTrim(240_000, 60_000, 90_000, maximumMs = 30_000))
        assertFalse(NativeMediaEditPolicy.validTrim(240_000, 60_000, 90_001, maximumMs = 30_000))
    }
    @Test fun laterTrimUsesUnchangedOriginalTimeline() {
        val trim = NativeMediaEditPolicy.trim(300_000, 200_000)
        assertEquals(NativeMediaEditPolicy.Trim(200_000, 300_000), trim)
        assertTrue(NativeMediaEditPolicy.validTrim(300_000, trim.startMs, trim.endMs))
    }
}
