package com.sautilink.nativeapp.feature.inbox

import android.graphics.Bitmap
import android.util.Log
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.sautilink.nativeapp.ui.theme.SautiTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import kotlin.math.abs

/** Actual production bubble surfaces with local fixture content: no Auth, message API or network. */
@RunWith(AndroidJUnit4::class)
class NativeDmBubbleAppearanceTest {
    @get:Rule val compose = createComposeRule()
    private val wallpapers = listOf("system", "warm", "blue", "dark")

    private fun contrast(first: Color, second: Color): Float =
        (maxOf(first.luminance(), second.luminance()) + .05f) /
            (minOf(first.luminance(), second.luminance()) + .05f)

    private fun assertColor(expected: Color, actual: Color) {
        assertTrue("Expected $expected, rendered $actual", abs(expected.red - actual.red) <= 1f / 255 &&
            abs(expected.green - actual.green) <= 1f / 255 &&
            abs(expected.blue - actual.blue) <= 1f / 255 && actual.alpha == 1f)
    }

    private fun renderedCenter(tag: String): Color {
        val pixels = compose.onNodeWithTag(tag).captureToImage().toPixelMap()
        return pixels[pixels.width / 2, pixels.height / 2]
    }

    @Composable
    private fun Sample(tag: String, own: Boolean, wallpaper: Color, choice: String = "neutral") {
        NativeDmMessageBubbleSurface(own, choice, wallpaper, Modifier.testTag(tag)) {
            Box(Modifier.size(80.dp, 36.dp))
        }
    }

    @Test fun incomingFillIsDistinctAndReadable_onEveryExistingWallpaper_inLightAndDarkThemes() {
        val backgrounds = mutableMapOf<String, Color>()
        val foregrounds = mutableMapOf<String, Color>()
        compose.setContent {
            Column {
                listOf(false, true).forEach { dark ->
                    SautiTheme(darkTheme = dark) {
                        wallpapers.forEach { choice ->
                            val tag = "$dark-$choice"
                            val background = messageWallpaper(choice)
                            val foreground = MaterialTheme.colorScheme.onSurface
                            SideEffect { backgrounds[tag] = background; foregrounds[tag] = foreground }
                            Box(Modifier.fillMaxWidth().background(background).padding(4.dp)) {
                                Sample(tag, own = false, wallpaper = background)
                            }
                        }
                    }
                }
            }
        }
        backgrounds.forEach { (tag, wallpaper) ->
            val actual = renderedCenter(tag)
            assertTrue("The incoming bubble must visibly separate from $tag wallpaper",
                contrast(actual, wallpaper) >= 1.10f)
            assertTrue("Existing incoming message text must remain readable in $tag",
                contrast(foregrounds.getValue(tag), actual) >= 4.5f)
        }
        assertEquals(8, backgrounds.size)
        assertTrue("Auto light must not render another white-on-white bubble",
            renderedCenter("false-system") != Color.White)
    }

    @Test fun incomingFillAdaptsToExplicitWhiteWallpaper_inBothThemes() {
        val foregrounds = mutableMapOf<Boolean, Color>()
        compose.setContent {
            Column(Modifier.background(Color.White).padding(12.dp)) {
                listOf(false, true).forEach { dark ->
                    SautiTheme(darkTheme = dark) {
                        val foreground = MaterialTheme.colorScheme.onSurface
                        SideEffect { foregrounds[dark] = foreground }
                        Sample("white-$dark", own = false, wallpaper = Color.White)
                    }
                }
            }
        }
        listOf(false, true).forEach { dark ->
            val actual = renderedCenter("white-$dark")
            assertTrue(contrast(actual, Color.White) >= 1.10f)
            assertTrue(contrast(actual, foregrounds.getValue(dark)) >= 4.5f)
        }
    }

    @Test fun outgoingBlueTealNeutralKeepExactPreviousColors_acrossThemesAndWallpaperChoices() {
        val expected = mutableMapOf<String, Color>()
        compose.setContent {
            Column {
                listOf(false, true).forEach { dark ->
                    SautiTheme(darkTheme = dark) {
                        wallpapers.forEach { wallpaper ->
                            Row(Modifier.background(messageWallpaper(wallpaper)).padding(3.dp)) {
                                listOf("blue", "teal", "neutral").forEach { choice ->
                                    val tag = "$dark-$wallpaper-$choice"
                                    val original = when (choice) {
                                        "teal" -> Color(0xFF0B8676)
                                        "neutral" -> MaterialTheme.colorScheme.secondaryContainer
                                        else -> Color(0xFF0068DF)
                                    }
                                    SideEffect { expected[tag] = original }
                                    Sample(tag, own = true, wallpaper = messageWallpaper(wallpaper), choice = choice)
                                }
                            }
                        }
                    }
                }
            }
        }
        assertEquals(24, expected.size)
        expected.forEach { (tag, original) -> assertColor(original, renderedCenter(tag)) }
    }

    @OptIn(ExperimentalFoundationApi::class)
    @Test fun surfacePreservesNestedContentAndMessageGestureModifiers_withCleanLightPreview() {
        var selected = 0
        var replyOpened = 0
        compose.setContent {
            SautiTheme(darkTheme = false) {
                val wallpaper = messageWallpaper("system")
                Column(Modifier.width(320.dp).background(wallpaper).padding(16.dp)
                    .testTag("chat-bubble-preview"), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    NativeDmMessageBubbleSurface(false, "neutral", wallpaper,
                        Modifier.testTag("received-message").combinedClickable(
                            onClick = {}, onLongClick = { selected++ })) {
                        Column(Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
                            Text("Mambo", style = MaterialTheme.typography.bodyLarge)
                            Text("16:24", style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                        NativeDmMessageBubbleSurface(true, "neutral", wallpaper,
                            Modifier.testTag("sent-message")) {
                            Column(Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
                                Text("Poa", style = MaterialTheme.typography.bodyLarge)
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text("16:25", style = MaterialTheme.typography.labelSmall)
                                    NativeDmReceiptTicks("2026-10-21T13:25:00Z",
                                        NativePeerReceipts("2026-10-21T13:26:00Z", "2026-10-21T13:27:00Z"),
                                        MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                            }
                        }
                    }
                    NativeDmMessageBubbleSurface(false, "neutral", wallpaper) {
                        Column(Modifier.padding(8.dp)) {
                            TextButton(onClick = { replyOpened++ }) { Text("Quoted message") }
                            Text("Attachment caption")
                        }
                    }
                }
            }
        }
        compose.onNodeWithText("Mambo").assertIsDisplayed()
        compose.onNodeWithText("Poa").assertIsDisplayed()
        compose.onNodeWithContentDescription("Seen").assertIsDisplayed()
        compose.onNodeWithText("Attachment caption").assertIsDisplayed()
        // Capture the resting appearance before gesture tests create a pressed-state ripple.
        savePreview()
        compose.onNodeWithText("Quoted message").performClick()
        compose.onNodeWithTag("received-message").performTouchInput { longClick() }
        compose.runOnIdle { assertEquals(1, replyOpened); assertEquals(1, selected) }
    }

    private fun savePreview() {
        val context = InstrumentationRegistry.getInstrumentation().context
        val supplied = InstrumentationRegistry.getArguments().getString("additionalTestOutputDir")
        val directory = File(supplied ?: (context.externalCacheDir ?: context.cacheDir).absolutePath,
            "sautilink-chat-bubbles").apply { mkdirs() }
        val output = File(directory, "incoming-light-outgoing-unchanged.png")
        output.outputStream().use {
            assertTrue(compose.onNodeWithTag("chat-bubble-preview").captureToImage()
                .asAndroidBitmap().compress(Bitmap.CompressFormat.PNG, 100, it))
        }
        Log.i("SautiChatBubbleScreenshot", output.absolutePath)
    }
}
