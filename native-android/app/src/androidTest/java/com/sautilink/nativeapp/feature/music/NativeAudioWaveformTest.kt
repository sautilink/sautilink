package com.sautilink.nativeapp.feature.music

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class NativeAudioWaveformTest {
    @get:Rule val compose = createComposeRule()
    @Test fun fullEditorShowsTheSelectedPhotoAndConfirmationRetainsTheClipAndMix() {
        val context = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().targetContext
        val file = java.io.File(context.cacheDir,"waveform-photo-test.png")
        val bitmap = android.graphics.Bitmap.createBitmap(400,600,android.graphics.Bitmap.Config.ARGB_8888)
        bitmap.eraseColor(android.graphics.Color.rgb(84,102,92))
        file.outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it) }
        bitmap.recycle()
        val track=NativeMusicTrack("waveform-test", "Test audio", "Artist", 200000,5000,185000,60000,null,false)
        val initial=track.selection(12345,58000).copy(musicVolume=.4f,originalVolume=0f)
        var confirmed:NativeAudioSelection?=null
        try {
            compose.setContent { MaterialTheme {
                NativeMusicTrimEditor(track,initial,android.net.Uri.fromFile(file),false,{List(512){.5f}},
                    musicVolume=initial.musicVolume,originalVolume=initial.originalVolume,
                    onBack={},onUse={confirmed=it})
            } }
            compose.waitUntil(5000) { compose.onAllNodesWithContentDescription("Selected photo preview").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithContentDescription("Selected photo preview").assertIsDisplayed()
            compose.onNodeWithContentDescription("Clip duration").assertTextEquals("0:58")
            compose.onNodeWithText("Use audio").performClick()
            compose.runOnIdle { assertEquals(initial,confirmed) }
        } finally { file.delete() }
    }
    @Test fun waveformDragAndRangeHandlesUseTheSameSelectionAndTheFrameStaysWhite() {
        val bounds = NativeAudioTrimBounds(5000,185000,60000)
        var clip by mutableStateOf(bounds.clip(20000,30000))
        var started=0;var ended=0
        compose.setContent { MaterialTheme {
            Column(Modifier.fillMaxWidth().background(Color.Black)) {
                NativeAudioWaveform(bounds,clip,List(512){.5f},200000,0,
                    onChange={clip=it},onScrub={started++},onScrubEnd={ended++})
                NativeAudioTrimOverview(bounds,clip,0,onChange={clip=it},onScrub={started++},onScrubEnd={ended++})
            }
        } }
        val wave=compose.onNodeWithTag("audio-waveform")
        val before=wave.getUnclippedBoundsInRoot()
        wave.performTouchInput { swipe(Offset(width*.65f,height/2f),Offset(width*.35f,height/2f),350) }
        compose.runOnIdle { assertTrue(clip.startMs>20000);assertEquals(30000L,clip.durationMs) }
        compose.onNodeWithContentDescription("Clip end").performSemanticsAction(SemanticsActions.SetProgress){it(95000f)}
        compose.runOnIdle { assertEquals(95000L,clip.endMs);assertTrue(clip.durationMs<=60000);assertTrue(started>=2);assertEquals(started,ended) }
        assertEquals(before.left,wave.getUnclippedBoundsInRoot().left)
        val pixels=wave.captureToImage().toPixelMap()
        // Upper interior of the fixed selection is opaque white, independent of waveform movement.
        assertEquals(Color.White.toArgb(),pixels[pixels.width/2,pixels.height/4].toArgb())
    }
}
