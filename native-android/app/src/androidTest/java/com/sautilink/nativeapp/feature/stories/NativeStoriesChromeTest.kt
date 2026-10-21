package com.sautilink.nativeapp.feature.stories

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.sautilink.nativeapp.feature.notifications.NativePushManager
import com.sautilink.nativeapp.ui.theme.SautiTheme
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NativeStoriesChromeTest {
    @get:Rule val compose = createComposeRule()
    @Test fun headerStoriesIconExposesUnreadCountAndSingleNavigationAction() {
        var calls = 0
        compose.setContent { SautiTheme(darkTheme = true) { StoriesButton(3) { calls++ } } }
        compose.onNodeWithText("3").assertIsDisplayed()
        compose.onNodeWithContentDescription("Stories, 3 unwatched").assertIsDisplayed().performClick()
        compose.runOnIdle { assertEquals(1, calls) }
    }
    @Test fun availableProfileStoryRingNavigatesToTheCorrectAccount() {
        var opened = ""
        compose.setContent {
            SautiTheme(darkTheme = false) {
                CompositionLocalProvider(LocalNativeStoryPresence provides NativeStoryPresence(setOf("sampleuser"), { opened = it })) {
                    StoryProfileAvatarRing("sampleuser") { Box(Modifier.size(44.dp)) { Text("SL") } }
                }
            }
        }
        compose.onNodeWithText("SL").performClick()
        compose.runOnIdle { assertEquals("sampleuser", opened) }
    }
    @Test fun storyNotificationRoutesAcceptOnlyCanonicalUuidPaths() {
        val id = "00000000-0000-4000-8000-000000000001"
        assertEquals("/stories/$id", NativePushManager.safeRoute("/stories/$id"))
        assertEquals("/stories", NativePushManager.safeRoute("/stories"))
        assertNull(NativePushManager.safeRoute("/stories/not-a-story"))
        assertNull(NativePushManager.safeRoute("/stories/$id/extra"))
        assertNull(NativePushManager.safeRoute("//evil.example/stories/$id"))
        assertNull(NativePushManager.safeRoute("/stories/$id?target=https://evil.example"))
    }
}
