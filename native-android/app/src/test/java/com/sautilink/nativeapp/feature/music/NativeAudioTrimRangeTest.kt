package com.sautilink.nativeapp.feature.music

import org.junit.Assert.*
import org.junit.Test

class NativeAudioTrimRangeTest {
    private val bounds = NativeAudioTrimBounds(5000, 185000, 60000)
    @Test fun videoAndStoryCapsAndSubsecondSourcesRemainValid() {
        val story = NativeAudioTrimBounds(0, 62000, 30000)
        val moved = story.move(story.clip(0, 30000), 60200)
        assertEquals(NativeAudioTrimRange(32000, 30000), moved)
        assertEquals(30000L, story.resizeEnd(story.clip(1000,15000), 62000).durationMs)
        val short = NativeAudioTrimBounds(0, 420, 180000)
        assertEquals(NativeAudioTrimRange(0,420), short.clip(9999,30000))
        assertEquals(NativeAudioTrimRange(0,420), short.resizeEnd(short.clip(0,420), 1))
    }
    @Test fun movingTheWaveformPreservesDurationAndStopsAtBothLicensedEdges() {
        val clip = bounds.clip(25000, 30000)
        assertEquals(NativeAudioTrimRange(5000, 30000), bounds.move(clip, -900000))
        assertEquals(NativeAudioTrimRange(155000, 30000), bounds.move(clip, 900000))
        assertEquals(NativeAudioTrimRange(37345, 30000), bounds.move(clip, 12345))
    }
    @Test fun resizingKeepsTheOtherEndpointAndEnforcesOneSecondAndMaximumLength() {
        val clip = bounds.clip(50000, 30000)
        assertEquals(NativeAudioTrimRange(20000, 60000), bounds.resizeStart(clip, 0))
        assertEquals(NativeAudioTrimRange(79000, 1000), bounds.resizeStart(clip, 999999))
        assertEquals(NativeAudioTrimRange(50000, 60000), bounds.resizeEnd(clip, 999999))
        assertEquals(NativeAudioTrimRange(50000, 1000), bounds.resizeEnd(clip, 0))
    }
    @Test fun everyConfirmedSelectionMatchesExactlyWhatThePreviewRequests() {
        val track = NativeMusicTrack("test-track", "Track", "Artist", 200000, 5000, 185000, 60000, null, false)
        val chosen = bounds.resizeEnd(bounds.move(bounds.clip(5000,30000),45321),74321)
        val audio = track.selection(chosen.startMs, chosen.durationMs)
        assertEquals(chosen.startMs,audio.startMs); assertEquals(chosen.durationMs,audio.durationMs)
        assertTrue(audio.previewUrl().endsWith("startMs=${chosen.startMs}&durationMs=${chosen.durationMs}"))
    }
}
