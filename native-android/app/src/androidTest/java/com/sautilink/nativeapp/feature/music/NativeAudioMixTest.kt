package com.sautilink.nativeapp.feature.music

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class NativeAudioMixTest {
    @get:Rule val compose = createComposeRule()

    @Test fun independentVolumeControlsMuteAndRestoreOriginalWithoutChangingTheTrim() {
        var selected by mutableStateOf(NativeAudioSelection("test-audio", "Track", "Artist", 12345, 5000,
            musicVolume = .7f, originalVolume = .4f))
        compose.setContent { MaterialTheme { NativeAudioMixControls(selected, true, true) { selected = it } } }
        compose.onNodeWithContentDescription("Music volume").performSemanticsAction(
            androidx.compose.ui.semantics.SemanticsActions.SetProgress) { it(.25f) }
        compose.runOnIdle { assertEquals(.25f, selected.musicVolume); assertEquals(.4f, selected.originalVolume) }
        compose.onNodeWithContentDescription("Original video sound").performClick()
        compose.runOnIdle { assertEquals(0f, selected.originalVolume) }
        compose.onNodeWithContentDescription("Original video sound").performClick()
        compose.runOnIdle { assertEquals(.4f, selected.originalVolume); assertEquals(12345L, selected.startMs); assertEquals(5000L, selected.durationMs) }
    }

    @Test fun selectedClipUrlAndPersistedMixUseTheExactTimelineAndLegacyDefaultsRemainCompatible() {
        val track = NativeMusicTrack("test-audio", "Track", "Artist", 120000, 5000, 90000, 30000, null, false)
        val clip = track.selection(42567, 12345).copy(musicVolume = .3f, originalVolume = 0f)
        assertTrue(clip.previewUrl().endsWith("startMs=42567&durationMs=12345"))
        assertEquals(clip, NativeAudioSelection.from(clip.json()))
        assertEquals(60000L, track.selection(89999, 30000).startMs)
        assertEquals(5000L, track.selection(-100, 40000).startMs)
        val legacy = JSONObject(clip.json().toString()).apply { remove("musicVolume"); remove("originalVolume") }
        assertEquals(1f, NativeAudioSelection.from(legacy)!!.musicVolume)
        assertEquals(0f, NativeAudioSelection.from(legacy)!!.originalVolume)
    }
}
