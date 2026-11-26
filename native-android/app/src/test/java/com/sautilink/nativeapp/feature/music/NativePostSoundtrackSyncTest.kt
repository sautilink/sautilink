package com.sautilink.nativeapp.feature.music

import org.junit.Assert.*
import org.junit.Test

class NativePostSoundtrackSyncTest {
    @Test fun photosAndTextNeedNoVideoFrame_butAVideoPlaceholderMustWait() {
        assertTrue(videoSoundtrackReady(null))
        assertFalse(videoSoundtrackReady(NativePostVideoClock("post", "video", null, true, false, false)))
    }
    @Test fun trimmedAudioUsesVideoTimeWithinTheSelectedClip_notTheSongsOriginalOffset() {
        assertEquals(0L, soundtrackVideoPosition(0, 30000))
        assertEquals(12000L, soundtrackVideoPosition(42000, 30000))
        assertEquals(0L, soundtrackVideoPosition(60000, 30000))
        assertEquals(0L, soundtrackVideoPosition(-100, 30000))
        assertEquals(0L, soundtrackVideoPosition(1000, 0))
    }
    @Test fun driftTreatsTheLoopBoundaryAsAdjacent_andStillDetectsASeek() {
        assertEquals(40L, soundtrackCircularDrift(29980, 20, 30000))
        assertEquals(8000L, soundtrackCircularDrift(1000, 9000, 30000))
        assertEquals(0L, soundtrackCircularDrift(30000, 0, 30000))
    }
}
