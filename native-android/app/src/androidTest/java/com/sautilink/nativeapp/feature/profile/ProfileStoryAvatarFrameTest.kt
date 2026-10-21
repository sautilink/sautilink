package com.sautilink.nativeapp.feature.profile

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.sautilink.nativeapp.ui.theme.SautiTheme
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Render the real production frame, including its white Surface border. This
 * catches the previous gradient-under-Surface drawing bug using actual pixels.
 */
@RunWith(AndroidJUnit4::class)
class ProfileStoryAvatarFrameTest {
    @get:Rule val compose = createComposeRule()
    private fun gradientPixels(): Int {
        val bitmap = compose.onNodeWithTag("profile-story-avatar").captureToImage().asAndroidBitmap()
        var count = 0
        for (y in 0 until bitmap.height) for (x in 0 until bitmap.width) {
            val pixel = bitmap.getPixel(x, y)
            if (android.graphics.Color.alpha(pixel) > 100 && android.graphics.Color.red(pixel) > 180 &&
                android.graphics.Color.green(pixel) < 160 && android.graphics.Color.blue(pixel) < 160) count++
        }
        return count
    }
    @Test fun activeStoryGradientRemainsVisibleOutsideWhiteAvatarBorderAndOpensCurrentProfileStories() {
        var opened = ""
        var currentHandle by mutableStateOf("sampleuser")
        compose.setContent { SautiTheme(darkTheme = false) {
            ProfileStoryAvatarFrame(true, { opened = currentHandle }, Modifier.testTag("profile-story-avatar")) {
                Box(Modifier.size(86.dp).clip(CircleShape).background(Color.Blue))
            }
        } }
        assertTrue("The pink/orange ring must survive the surrounding white border", gradientPixels() > 50)
        compose.onNodeWithTag("profile-story-avatar").performClick()
        compose.runOnIdle { assertEquals("sampleuser", opened); currentHandle = "anotheruser" }
        compose.onNodeWithTag("profile-story-avatar").performClick()
        compose.runOnIdle { assertEquals("anotheruser", opened) }
    }
    @Test fun absentStoryDoesNotDrawARingOrExposeAStoryNavigationAction() {
        compose.setContent { SautiTheme(darkTheme = false) {
            ProfileStoryAvatarFrame(false, { error("Inactive avatar must not open Stories") }, Modifier.testTag("profile-story-avatar")) {
                Box(Modifier.size(86.dp).clip(CircleShape).background(Color.Blue))
            }
        } }
        assertEquals(0, gradientPixels())
        compose.onNodeWithTag("profile-story-avatar").assertHasNoClickAction()
    }
}
