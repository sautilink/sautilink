package com.sautilink.nativeapp.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.background
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.ProvideTextStyle
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.feature.home.HomeFeedTabs
import com.sautilink.nativeapp.ui.components.*
import com.sautilink.nativeapp.ui.theme.SautiTheme
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class HomeChromeBehaviorTest {
    @get:Rule val compose = createComposeRule()

    @Test fun glassGradientStaysContinuousBehindTheLabels() {
        compose.setContent { SautiTheme(darkTheme = false) {
            Box(Modifier.width(340.dp).background(Color.White).testTag("glass-fixture")) {
                ProvideTextStyle(TextStyle(background = Color.White)) {
                    HomeFeedTabs("for_you", {})
                }
            }
        } }
        val capture = compose.onNodeWithTag("glass-fixture").captureToImage()
        val context = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().targetContext
        java.io.File(context.filesDir, "home-tabs-glass.png").outputStream().use {
            capture.asAndroidBitmap().compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
        }
        val pixels = capture.toPixelMap()
        // Unselected segment, before the first glyph: the glass gradient must
        // remain continuous through the text line rather than acquire a stripe.
        val x = (pixels.width * .05f).toInt()
        val middle = pixels[x, pixels.height / 2]
        val above = pixels[x, pixels.height / 4]
        val below = pixels[x, pixels.height * 3 / 4]
        for ((center, expected) in listOf(middle.red to (above.red + below.red) / 2f,
            middle.green to (above.green + below.green) / 2f,
            middle.blue to (above.blue + below.blue) / 2f)) assertEquals(expected, center, .015f)
    }

    @Test fun scrollingHidesAndRestoresNavigationWithoutResizingFeedOrBarSlot() {
        val state = HomeNavigationScrollState()
        compose.setContent { MaterialTheme {
            val scroll = rememberHomeNavigationScrollConnection(state)
            Box(Modifier.width(340.dp).height(500.dp)) {
                LazyColumn(Modifier.fillMaxSize().nestedScroll(scroll).testTag("fixture-feed")) {
                    items(40) { Text("Post $it", Modifier.fillMaxWidth().height(100.dp)) }
                }
                Box(Modifier.align(Alignment.BottomCenter)) {
                    HomeScrollNavigation(state.hidden, enabled = true) { SautiBottomBar(0) {} }
                }
            }
        } }
        val beforeFeed = compose.onNodeWithTag("fixture-feed").getUnclippedBoundsInRoot()
        val beforeSlot = compose.onNodeWithTag("home-navigation-slot").getUnclippedBoundsInRoot()
        compose.onNodeWithContentDescription("Home").assertIsDisplayed()
        compose.onNodeWithTag("fixture-feed").performTouchInput {
            swipeUp(startY = height * .72f, endY = height * .36f, durationMillis = 450)
        }
        compose.runOnIdle { assertTrue(state.hidden) }
        compose.onNodeWithContentDescription("Home").assertDoesNotExist()
        assertEquals(beforeFeed, compose.onNodeWithTag("fixture-feed").getUnclippedBoundsInRoot())
        assertEquals(beforeSlot, compose.onNodeWithTag("home-navigation-slot").getUnclippedBoundsInRoot())
        compose.onNodeWithTag("fixture-feed").performTouchInput {
            swipeDown(startY = height * .3f, endY = height * .65f, durationMillis = 450)
        }
        compose.runOnIdle { assertFalse(state.hidden) }
        compose.onNodeWithContentDescription("Home").assertIsDisplayed()
    }

    @Test fun nonHomeNavigationStaysVisibleEvenIfHomeWasHidden() {
        compose.setContent { MaterialTheme {
            HomeScrollNavigation(hidden = true, enabled = false) { SautiBottomBar(4) {} }
        } }
        compose.onNodeWithContentDescription("Home").assertIsDisplayed()
        compose.onNodeWithContentDescription("Short Videos").assertIsDisplayed()
    }

    @Test fun compactGlassTabsRetainTouchTargetsSelectionAndLargeText() {
        var selected by mutableStateOf("for_you")
        var changes = 0
        var fontScale by mutableFloatStateOf(1f)
        compose.setContent { SautiTheme(darkTheme = false) {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, fontScale)) {
                HomeFeedTabs(selected, { selected = it; changes++ }, Modifier.width(340.dp))
            }
        } }
        compose.onNodeWithTag("home-feed-glass").assertHeightIsEqualTo(44.dp)
        compose.onNodeWithTag("home-feed-tabs").assertHeightIsEqualTo(48.dp)
        compose.onNodeWithText("For You").assertIsSelected()
        compose.onNodeWithText("Trending").performClick()
        compose.onNodeWithText("Trending").assertIsSelected()
        compose.runOnIdle { assertEquals(1, changes); fontScale = 1.8f }
        compose.onNodeWithText("Following").assertIsDisplayed().performClick()
        compose.onNodeWithText("Following").assertIsSelected()
        compose.runOnIdle { assertEquals(2, changes) }
        val track = compose.onNodeWithTag("home-feed-tabs").getUnclippedBoundsInRoot()
        val label = compose.onNodeWithText("Following").getUnclippedBoundsInRoot()
        assertTrue("Large text must stay inside its touch target", label.top >= track.top && label.bottom <= track.bottom)
    }
}
