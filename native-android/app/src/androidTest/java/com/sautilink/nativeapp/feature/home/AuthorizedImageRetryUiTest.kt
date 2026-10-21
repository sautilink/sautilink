package com.sautilink.nativeapp.feature.home

import android.graphics.Bitmap
import android.util.Log
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.sautilink.nativeapp.ui.components.SautiPostGestureSurface
import com.sautilink.nativeapp.ui.theme.SautiTheme
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Synthetic recovery UI only. No account, token, network request or user photo. */
@RunWith(AndroidJUnit4::class)
class AuthorizedImageRetryUiTest {
    @get:Rule val compose = createComposeRule()

    private fun screenshot(name: String) {
        compose.waitForIdle()
        val context = InstrumentationRegistry.getInstrumentation().context
        val supplied = InstrumentationRegistry.getArguments().getString("additionalTestOutputDir")
        val directory = File(supplied ?: (context.externalCacheDir ?: context.cacheDir).absolutePath,
            "sautilink-image-recovery").apply { mkdirs() }
        val output = File(directory, "$name.png")
        output.outputStream().use {
            assertTrue(compose.onNodeWithTag("image-recovery-capture", useUnmergedTree = true)
                .captureToImage().asAndroidBitmap().compress(Bitmap.CompressFormat.PNG, 100, it))
        }
        Log.i("SautiImageFixture", output.absolutePath)
    }

    @Test fun explicitRetryTargetRecoversFrame_withoutOpeningPhotoOrLikingPost() {
        var retries = 0
        var opened = 0
        var liked = 0
        val pixels = Bitmap.createBitmap(320, 240, Bitmap.Config.ARGB_8888).apply {
            eraseColor(android.graphics.Color.rgb(54, 125, 180))
        }
        run {
            compose.setContent {
                var failed by remember { mutableStateOf(true) }
                SautiTheme(darkTheme = false) {
                    Surface(Modifier.width(320.dp).height(260.dp).testTag("image-recovery-capture")) {
                        SautiPostGestureSurface(Modifier.fillMaxSize(), onLike = { liked++ }, onTap = { opened++ }) {
                            if (failed) AuthorizedImageFailureContent(true, onRetry = { retries++; failed = false },
                                fallback = { Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surfaceVariant),
                                    contentAlignment = Alignment.Center) { Text("Image unavailable") } })
                            else Image(pixels.asImageBitmap(), "Recovered synthetic image", Modifier.fillMaxSize())
                        }
                    }
                }
            }
            val target = compose.onNodeWithText("Retry image", useUnmergedTree = true)
            target.assertIsDisplayed()
            val bounds = target.fetchSemanticsNode().boundsInRoot
            assertTrue(bounds.height >= with(compose.density) { 48.dp.toPx() })
            assertTrue(bounds.width >= with(compose.density) { 48.dp.toPx() })
            screenshot("failed-photo-with-explicit-retry")
            target.performTouchInput { click() }
            compose.onNodeWithContentDescription("Recovered synthetic image", useUnmergedTree = true).assertIsDisplayed()
            compose.onNodeWithText("Retry image", useUnmergedTree = true).assertDoesNotExist()
            compose.runOnIdle { assertEquals(1, retries); assertEquals(0, opened); assertEquals(0, liked) }
            screenshot("recovered-photo-after-explicit-retry")
        }
    }

    @Test fun smallAvatarFallbackKeepsItsProfileTap_withoutAnOverlayRetryTarget() {
        var profiles = 0
        var retries = 0
        compose.setContent { SautiTheme(darkTheme = false) {
            Box(Modifier.size(48.dp).testTag("profile-avatar").clickable { profiles++ }) {
                AuthorizedImageFailureContent(true, onRetry = { retries++ },
                    fallback = { Box(Modifier.fillMaxSize().background(Color(0xFFDCEAFF)),
                        contentAlignment = Alignment.Center) { Text("SL") } })
            }
        } }
        compose.onNodeWithText("Retry image", useUnmergedTree = true).assertDoesNotExist()
        compose.onNodeWithTag("profile-avatar").performTouchInput { click() }
        compose.runOnIdle { assertEquals(1, profiles); assertEquals(0, retries) }
    }
}
