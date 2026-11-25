package com.sautilink.nativeapp.feature.music

import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class NativeMusicReleaseTest {
    @Test fun newLabelUsesReleaseDateAndExpiresAfterSevenDays() {
        val now = Instant.parse("2026-11-25T12:00:00Z")
        assertTrue(isNewMusicRelease("2026-11-25", now))
        assertTrue(isNewMusicRelease("2026-11-19", now))
        assertFalse(isNewMusicRelease("2026-11-18", now))
        assertFalse(isNewMusicRelease("2026-11-26", now))
        assertFalse(isNewMusicRelease(null, now))
        assertFalse(isNewMusicRelease("not-a-date", now))
        assertFalse(isNewMusicRelease("2026-11-18", Instant.parse("2026-11-25T00:00:00Z")))
    }
}
