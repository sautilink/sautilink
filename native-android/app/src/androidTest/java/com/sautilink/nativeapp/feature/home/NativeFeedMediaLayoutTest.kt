package com.sautilink.nativeapp.feature.home

import android.content.Context
import android.content.ContextWrapper
import android.content.SharedPreferences
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.auth.SautiBackend
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class NativeFeedMediaLayoutTest {
    @get:Rule val compose = createComposeRule()
    private fun auth(): StagingAuthClient {
        val context = object : ContextWrapper(InstrumentationRegistry.getInstrumentation().targetContext) {
            override fun getApplicationContext(): Context = this
            override fun getSharedPreferences(name: String, mode: Int): SharedPreferences =
                baseContext.getSharedPreferences("media_layout_fixture_$name", mode)
        }
        return StagingAuthClient("sb_publishable_offline_ui_fixture", context, SautiBackend.PRODUCTION).apply { forgetSavedSession() }
    }
    private fun image(n: Int) = FeedMedia("00000000-0000-4000-8000-${n.toString().padStart(12,'0')}", "image", n, 1000, 1000)
    private fun checkVideoFrame(width: Int, height: Int, expectedHeight: Float, home: Boolean = true) {
        val video = FeedMedia("00000000-0000-4000-8000-000000000099", "video", 0, width, height, 6000)
        val auth = auth()
        compose.setContent { MaterialTheme { Box(Modifier.width(240.dp)) {
            PostMediaGallery(auth, listOf(video), homeVideoFraming = home)
        } } }
        val rect = compose.onNodeWithTag("post-media:${video.id}").getUnclippedBoundsInRoot()
        assertEquals(240f, rect.right.value - rect.left.value, .5f)
        assertEquals(expectedHeight, rect.bottom.value - rect.top.value, .5f)
    }
    @Test fun homeTallVideoUsesFullWidthTwoByThreeFrame() = checkVideoFrame(1080, 1920, 360f)
    @Test fun homeFourByFiveVideoKeepsItsShorterFrame() = checkVideoFrame(1080, 1350, 300f)
    @Test fun homeSquareVideoStaysSquare() = checkVideoFrame(1080, 1080, 240f)
    @Test fun homeLandscapeVideoKeepsItsNaturalHeight() = checkVideoFrame(1920, 1080, 135f)
    @Test fun otherGalleriesRetainTheirExistingTallVideoFrame() = checkVideoFrame(1080, 1920, 300f, home = false)
    @Test fun oneImageHasNoNestedPager_andKeepsItsFullWidthSquareFrame() {
        val image = image(1)
        val auth = auth()
        compose.setContent { MaterialTheme { Box(Modifier.width(300.dp)) { PostMediaGallery(auth, listOf(image)) } } }
        compose.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsActions.ScrollToIndex)).assertCountEquals(0)
        val rect = compose.onNodeWithTag("post-media:${image.id}").getUnclippedBoundsInRoot()
        assertEquals(300f, rect.right.value-rect.left.value, .5f)
        assertEquals(300f, rect.bottom.value-rect.top.value, .5f)
    }
    @Test fun multipleImagesRetainTheSwipeableCarouselAndPageCount() {
        val auth = auth()
        compose.setContent { MaterialTheme { Box(Modifier.width(300.dp)) { PostMediaGallery(auth, listOf(image(1),image(2))) } } }
        compose.onNodeWithText("1/2").assertExists()
        compose.onNode(SemanticsMatcher.keyIsDefined(SemanticsActions.ScrollToIndex)).performScrollToIndex(1)
        compose.onNodeWithText("2/2").assertExists()
        compose.onNodeWithTag("post-media:${image(2).id}").assertIsDisplayed()
    }
    @Test fun tappingTheSingleImageStillOpensItsViewer() {
        val auth = auth()
        val image = image(1)
        compose.setContent { MaterialTheme { Box(Modifier.width(300.dp)) { PostMediaGallery(auth, listOf(image)) } } }
        compose.onNodeWithTag("post-media:${image.id}").performTouchInput { click() }
        compose.onNodeWithContentDescription("Close photo").assertExists()
    }
}
