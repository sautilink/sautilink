package com.sautilink.nativeapp.feature.videos

import android.content.Context
import android.content.ContextWrapper
import android.content.SharedPreferences
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material3.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.auth.SautiBackend
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** Missing-poster pixel regression on both themes. Isolated signed-out fixture;
 * no real account, token, HTTP, uploads or actual viewer events. */
class ShortVideoCoverTest {
    @get:Rule val compose = createComposeRule()
    private fun auth(): StagingAuthClient {
        val context = object : ContextWrapper(InstrumentationRegistry.getInstrumentation().targetContext) {
            override fun getApplicationContext(): Context = this
            override fun getSharedPreferences(name: String, mode: Int): SharedPreferences =
                baseContext.getSharedPreferences("short_cover_fixture_$name", mode)
        }
        return StagingAuthClient("sb_publishable_offline_ui_fixture", context, SautiBackend.PRODUCTION).apply { forgetSavedSession() }
    }
    private fun missingPosterRemainsBlack(dark: Boolean) {
        val auth = auth()
        compose.setContent {
            val scheme = if (dark) darkColorScheme() else lightColorScheme(surfaceVariant = Color.White)
            MaterialTheme(colorScheme = scheme) {
                Box(Modifier.size(240.dp).background(Color.White)) {
                    ShortVideoCover(auth, "00000000-0000-4000-8000-000000000001", Modifier.size(240.dp).testTag("cover"))
                }
            }
        }
        val pixels = compose.onNodeWithTag("cover").captureToImage().toPixelMap()
        for (fraction in listOf(.05f, .25f, .5f, .75f, .95f)) {
            val pixel = pixels[(pixels.width*fraction).toInt(), (pixels.height*fraction).toInt()]
            assertEquals(0f, pixel.red, .01f)
            assertEquals(0f, pixel.green, .01f)
            assertEquals(0f, pixel.blue, .01f)
            assertEquals(1f, pixel.alpha, .01f)
        }
        compose.onNodeWithText("Retry image").assertDoesNotExist()
    }
    @Test fun lightThemeDoesNotFlashAWhitePhotoPlaceholder() = missingPosterRemainsBlack(false)
    @Test fun darkThemeKeepsTheSameBlackMissingPosterStage() = missingPosterRemainsBlack(true)
}
