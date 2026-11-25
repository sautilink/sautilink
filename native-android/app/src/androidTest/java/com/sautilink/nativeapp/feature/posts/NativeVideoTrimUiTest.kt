package com.sautilink.nativeapp.feature.posts

import android.net.Uri
import androidx.compose.runtime.*
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import com.sautilink.nativeapp.ui.theme.SautiTheme
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.io.File
import java.util.concurrent.atomic.AtomicReference

class NativeVideoTrimUiTest {
    @get:Rule val compose = createComposeRule()
    @Test fun storyTimelineExportsTheSameToneAndSilenceChosenWithItsHandles() {
        val instrument = InstrumentationRegistry.getInstrumentation()
        val context = instrument.targetContext
        val original = File(context.cacheDir, "waveform-ui-tone.mp4")
        instrument.context.assets.open("waveform-tone-silence.mp4").use { input -> original.outputStream().use { input.copyTo(it) } }
        val output = AtomicReference<NativeEditedMedia?>(null)
        var open by mutableStateOf(true)
        try {
            compose.setContent { SautiTheme(darkTheme = true) {
                if (open) NativeMediaEditor(Uri.fromFile(original), true, onCancel = { open = false },
                    onExportActivity = {}, onUse = { output.set(it); open = false }, maximumVideoMs = 30000)
            } }
            compose.waitUntil(15000) { compose.onAllNodesWithContentDescription("Clip end").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithContentDescription("Clip end").performSemanticsAction(SemanticsActions.SetProgress) { assertTrue(it(3000f)) }
            compose.onNodeWithContentDescription("Clip start").performSemanticsAction(SemanticsActions.SetProgress) { assertTrue(it(1000f)) }
            compose.onNodeWithContentDescription("Clip duration").assertTextEquals("0:02")
            compose.waitUntil(15000) { compose.onAllNodesWithContentDescription("Pause edited video").fetchSemanticsNodes().isNotEmpty() }
            // Real time lets the decoder render the selected section, independently of the Compose clock.
            Thread.sleep(1200)
            val screenshot = instrument.uiAutomation.takeScreenshot()
            try { File(context.externalCacheDir, "video-waveform-real-preview.png").outputStream().use { screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it) } }
            finally { screenshot.recycle() }
            compose.onNodeWithText("Use media").performClick()
            compose.waitUntil(30000) { output.get() != null }
            runBlocking {
                val result = requireNotNull(output.get())
                val duration = localVideoDuration(context,result.uri)
                assertTrue("Selected interval must remain two seconds", duration in 1700..2100)
                val peaks = localVideoWaveform(context,result.uri,duration)
                assertTrue("1–2 seconds of the source must retain its tone", peaks.take(190).count { it > .05f } > 175)
                assertTrue("2–3 seconds of the source must retain its silence", peaks.takeLast(160).all { it < .005f })
            }
        } finally { compose.runOnIdle { open = false }; output.get()?.ownedFile?.delete(); original.delete() }
    }
}
