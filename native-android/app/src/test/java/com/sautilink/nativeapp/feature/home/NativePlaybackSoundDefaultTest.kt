package com.sautilink.nativeapp.feature.home

import org.junit.Assert.*
import org.junit.Test

class NativePlaybackSoundDefaultTest {
    @Test fun aNewSessionStartsWithSoundAndTheViewerCanMuteAndUnmute() {
        NativePlaybackPreferences.resetSessionSound()
        assertFalse(NativePlaybackPreferences.sessionMuted)
        NativePlaybackPreferences.toggleSessionSound()
        assertTrue(NativePlaybackPreferences.sessionMuted)
        NativePlaybackPreferences.toggleSessionSound()
        assertFalse(NativePlaybackPreferences.sessionMuted)
        NativePlaybackPreferences.toggleSessionSound()
        NativePlaybackPreferences.resetSessionSound()
        assertFalse(NativePlaybackPreferences.sessionMuted)
    }
}
