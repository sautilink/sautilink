package com.sautilink.nativeapp.feature.posts

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.net.Uri
import android.util.Log
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.MotionDurationScale
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.sautilink.nativeapp.ui.theme.SautiTheme
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.runBlocking

/** Actual production editor dialog in an empty test host, using only local fixture media. */
@OptIn(ExperimentalTestApi::class)
@RunWith(AndroidJUnit4::class)
class NativeMediaEditorUiTest {
    private val noMotion = object : MotionDurationScale { override val scaleFactor = 0f }
    @get:Rule val compose = createComposeRule(effectContext = noMotion)

    private fun sourceImage(): File {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val file = File(context.cacheDir, "native-media-ui-fixture-${UUID.randomUUID()}.png")
        val bitmap = Bitmap.createBitmap(320, 160, Bitmap.Config.ARGB_8888).apply {
            setHasAlpha(false)
            for (y in 0 until height) for (x in 0 until width)
                setPixel(x, y, if (x < width / 2) Color.rgb(50, 50, 50) else Color.BLUE)
        }
        try { file.outputStream().use { assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) } }
        finally { bitmap.recycle() }
        return file
    }

    private fun digest(file: File) = MessageDigest.getInstance("SHA-256").digest(file.readBytes()).toList()

    private fun awaitImage() {
        compose.waitUntil(timeoutMillis = 10_000) {
            compose.onAllNodesWithContentDescription("Edited image preview").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithContentDescription("Edited image preview").assertIsDisplayed()
    }

    private fun screenshot(name: String) {
        compose.mainClock.advanceTimeBy(600)
        compose.waitForIdle()
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val supplied = InstrumentationRegistry.getArguments().getString("additionalTestOutputDir")
        val directory = File(supplied ?: (context.externalCacheDir ?: context.cacheDir).absolutePath,
            "sautilink-ui").apply { mkdirs() }
        val file = File(directory, "$name.png")
        file.outputStream().use {
            val screen = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
            try { assertTrue(screen.compress(Bitmap.CompressFormat.PNG, 100, it)) } finally { screen.recycle() }
        }
        Log.i("SautiUiScreenshot", file.absolutePath)
    }

    @Test fun imageDialogCropRotateAndBrightnessExportThroughTheActualUseMediaButton() {
        val original = sourceImage()
        val before = digest(original)
        val output = AtomicReference<NativeEditedMedia?>(null)
        var open by mutableStateOf(true)
        val cancelled = AtomicBoolean(false)
        try {
            compose.setContent {
                SautiTheme(darkTheme = false) {
                    if (open) NativeMediaEditor(Uri.fromFile(original), video = false,
                        onCancel = { cancelled.set(true); open = false }, onExportActivity = {},
                        onUse = { output.set(it); open = false })
                }
            }
            awaitImage()
            compose.onNodeWithText("Square").performScrollTo().assertIsDisplayed().performClick().assertIsSelected()
            compose.onNodeWithText("Rotate").performScrollTo().assertIsDisplayed().performClick()
            compose.onNodeWithText("Use media").assertIsDisplayed().assertIsEnabled()
            screenshot("media-image-editor-crop-light")
            compose.onNodeWithText("Adjust").performClick()

            // Production sliders expose their ranges through standard accessibility semantics.
            // Brightness is the only range -0.3..0.3, so no production-only test tags are needed.
            val brightness = SemanticsMatcher("Brightness slider") { node ->
                val range = if (node.config.contains(SemanticsProperties.ProgressBarRangeInfo))
                    node.config[SemanticsProperties.ProgressBarRangeInfo].range else null
                node.config.contains(SemanticsActions.SetProgress) && range != null && range.start == -0.3f && range.endInclusive == 0.3f
            }
            compose.onNode(brightness).performScrollTo().assertIsDisplayed()
                .performSemanticsAction(SemanticsActions.SetProgress) { action -> assertTrue(action(0.2f)) }
            compose.onNodeWithText("Brightness").assertIsDisplayed()
            compose.onNodeWithText("Use media").assertIsDisplayed().assertIsEnabled()
            screenshot("media-image-editor-adjust-light")
            compose.onNodeWithText("Use media").performClick()
            compose.waitUntil(timeoutMillis = 15_000) { output.get() != null }
            val result = output.get()!!
            assertNotNull(result.ownedFile)
            assertTrue(result.ownedFile!!.exists())
            val bitmap = BitmapFactory.decodeFile(result.ownedFile!!.path)
            assertNotNull(bitmap)
            try {
                assertEquals(160, bitmap.width)
                assertEquals(160, bitmap.height)
                val meanRed = (8 until bitmap.width step 16).flatMap { x ->
                    (8 until bitmap.height step 16).map { y -> Color.red(bitmap.getPixel(x, y)) }
                }.average()
                assertTrue("Brightness must affect the exported pixels, mean red=$meanRed", meanRed in 65.0..90.0)
            } finally { bitmap.recycle() }
            assertFalse(cancelled.get())
            assertEquals("Editing must not overwrite the original picker image", before, digest(original))
        } finally {
            compose.runOnIdle { open = false }
            output.get()?.ownedFile?.delete()
            original.delete()
        }
    }

    @Test fun creatorTextFontBoldCardColorAndResizeExportThroughEditor() {
        val original = sourceImage()
        val output = AtomicReference<NativeEditedMedia?>(null)
        var open by mutableStateOf(true)
        var keyboard: androidx.compose.ui.platform.SoftwareKeyboardController? = null
        try {
            compose.setContent { SautiTheme(darkTheme = false) {
                keyboard = androidx.compose.ui.platform.LocalSoftwareKeyboardController.current
                if (open) NativeMediaEditor(Uri.fromFile(original), false, onCancel = { open = false },
                    onExportActivity = {}, onUse = { output.set(it); open = false })
            } }
            awaitImage()
            compose.onNodeWithText("Filters").performClick()
            compose.onNodeWithText("Sunset").performScrollTo().performClick().assertIsSelected()
            compose.onNodeWithText("Text").performClick()
            compose.onNodeWithText("Text on media").performTextInput("Link it. Share. Connect")
            compose.runOnIdle { keyboard?.hide() }
            Thread.sleep(500)
            compose.waitForIdle()
            compose.onNodeWithText("Font · Montserrat").performScrollTo().performClick()
            compose.onNodeWithText("Caveat").performScrollTo()
            compose.waitForIdle()
            compose.onNodeWithText("Caveat").performClick()
            compose.onNodeWithText("Font · Caveat").assertIsDisplayed()
            compose.onNodeWithText("Bold").performScrollTo().performClick().assertIsOn()
            compose.onNodeWithText("Dark card").performScrollTo().performClick().assertIsSelected()
            compose.onNodeWithContentDescription("Pink text color").performScrollTo().performClick().assertIsSelected()
            compose.onNodeWithContentDescription("Text size").performScrollTo()
                .performSemanticsAction(SemanticsActions.SetProgress) { assertTrue(it(.12f)) }
            screenshot("creator-text-photo-light")
            compose.onNodeWithText("Use media").performClick()
            compose.waitUntil(20_000) { output.get() != null }
            val decoded = BitmapFactory.decodeFile(output.get()!!.ownedFile!!.path)
            try {
                var pink = 0
                for (y in 0 until decoded.height) for (x in 0 until decoded.width) {
                    val color = decoded.getPixel(x, y)
                    if (Color.red(color) > 160 && Color.blue(color) > 65 && Color.green(color) < 110) pink++
                }
                assertTrue("The UI's selected text must remain in the saved photo", pink > 20)
            } finally { decoded.recycle() }
        } finally { compose.runOnIdle { open = false }; output.get()?.ownedFile?.delete(); original.delete() }
    }

    @Test fun videoDialogShowsEffectsAndExportsTextWithItsSelectedClip() {
        val instrument = InstrumentationRegistry.getInstrumentation()
        val original = File(instrument.targetContext.cacheDir, "creator-video-ui-fixture.mp4")
        instrument.context.assets.open("media-editor-62s.mp4").use { input -> original.outputStream().use { input.copyTo(it) } }
        val output = AtomicReference<NativeEditedMedia?>(null)
        var open by mutableStateOf(true)
        var keyboard: androidx.compose.ui.platform.SoftwareKeyboardController? = null
        try {
            compose.setContent { SautiTheme(darkTheme = true) {
                keyboard = androidx.compose.ui.platform.LocalSoftwareKeyboardController.current
                if (open) NativeMediaEditor(Uri.fromFile(original), true, onCancel = { open = false },
                    onExportActivity = {}, onUse = { output.set(it); open = false })
            } }
            compose.waitUntil(30_000) { compose.onAllNodes(hasText("Use media") and isEnabled()).fetchSemanticsNodes().isNotEmpty() }
            compose.waitUntil(15_000) { compose.onAllNodesWithContentDescription("Clip start").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithContentDescription("Clip start").performSemanticsAction(SemanticsActions.SetProgress) { assertTrue(it(60200f)) }
            compose.onNodeWithContentDescription("Clip end").performSemanticsAction(SemanticsActions.SetProgress) { assertTrue(it(61700f)) }
            screenshot("video-waveform-selected-section")
            compose.onNodeWithText("Filters").performClick()
            compose.onNodeWithText("Mono").performScrollTo().performClick().assertIsSelected()
            compose.onNodeWithText("Text").performClick()
            compose.onNodeWithText("Text on media").performTextInput("SAUTI")
            compose.onNodeWithText("SAUTI").assertExists().performImeAction()
            compose.runOnIdle { keyboard?.hide() }
            Thread.sleep(500)
            compose.waitForIdle()
            compose.onNodeWithContentDescription("Pink text color").performScrollTo().performClick().assertIsSelected()
            compose.onNodeWithText("Bold").performScrollTo().performClick().assertIsOn()
            compose.onNodeWithContentDescription("Text size").performScrollTo()
                .performSemanticsAction(SemanticsActions.SetProgress) { assertTrue(it(.14f)) }
            compose.waitUntil(10_000) {
                val nodes = compose.onAllNodesWithContentDescription("Edited video preview").fetchSemanticsNodes()
                if (nodes.isEmpty()) false else {
                    val preview = compose.onNodeWithContentDescription("Edited video preview").captureToImage().asAndroidBitmap()
                    var pinkPixels = 0
                    for (y in 0 until preview.height step 3) for (x in 0 until preview.width step 3) {
                        val pixel = preview.getPixel(x, y)
                        if (Color.red(pixel) > 160 && Color.blue(pixel) > 60 && Color.green(pixel) < 110) pinkPixels++
                    }
                    pinkPixels > 10
                }
            }
            screenshot("creator-text-video-dark")
            compose.onNodeWithText("Use media").performClick()
            compose.waitUntil(90_000) { output.get() != null }
            val encodedDuration = runBlocking { localVideoDuration(instrument.targetContext, output.get()!!.uri) }
            assertTrue("The selected 60.2–61.7 second interval must survive text/filter editing: $encodedDuration", encodedDuration in 1200L..1800L)
            val frame = runBlocking { localVideoThumbnail(instrument.targetContext, output.get()!!.uri) }!!
            try {
                var pink = 0
                for (y in 0 until frame.height) for (x in 0 until frame.width) {
                    val color = frame.getPixel(x, y)
                    if (Color.red(color) > 160 && Color.blue(color) > 60 && Color.green(color) < 110) pink++
                }
                assertTrue("Text selected in the video editor must be encoded into the MP4", pink > 10)
            } finally { frame.recycle() }
        } finally { compose.runOnIdle { open = false }; output.get()?.ownedFile?.delete(); original.delete() }
    }

    @Test fun imageDialogCancelPreservesTheOriginalAndDoesNotExport() {
        val original = sourceImage()
        val before = digest(original)
        val cancelled = AtomicBoolean(false)
        val output = AtomicReference<NativeEditedMedia?>(null)
        var open by mutableStateOf(true)
        try {
            compose.setContent {
                SautiTheme(darkTheme = false) {
                    if (open) NativeMediaEditor(Uri.fromFile(original), video = false,
                        onCancel = { cancelled.set(true); open = false }, onExportActivity = {}, onUse = output::set)
                }
            }
            awaitImage()
            compose.onNodeWithContentDescription("Cancel media editing").assertIsDisplayed().performClick()
            compose.runOnIdle { assertTrue(cancelled.get()); assertNull(output.get()) }
            assertEquals(before, digest(original))
        } finally {
            compose.runOnIdle { open = false }
            output.get()?.ownedFile?.delete()
            original.delete()
        }
    }
}
