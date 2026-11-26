package com.sautilink.nativeapp.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Repeat
import androidx.compose.material.icons.rounded.FavoriteBorder
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.feature.home.CompactPostAction
import com.sautilink.nativeapp.feature.music.*
import com.sautilink.nativeapp.ui.components.SautiGlyph
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class NativeIconPerformanceTest {
    @get:Rule val compose = createComposeRule()

    @Test fun iconIsStillOnEntry_andHeartSelectionKeepsItsBounds() {
        compose.mainClock.autoAdvance = false
        var filled by mutableStateOf(false)
        compose.setContent { MaterialTheme {
            SautiGlyph(if (filled) "heart-filled" else "heart", "Heart",
                Modifier.size(96.dp).background(Color.White).testTag("heart"), tint = Color.Black)
        } }
        compose.mainClock.advanceTimeBy(16)
        val first = compose.onNodeWithTag("heart").captureToImage()
        compose.mainClock.advanceTimeBy(180)
        assertEquals(first.toPixelMap().buffer.toList(), compose.onNodeWithTag("heart").captureToImage().toPixelMap().buffer.toList())
        fun bounds(): List<Int> {
            val pixels = compose.onNodeWithTag("heart").captureToImage().toPixelMap()
            val points = buildList { for (y in 0 until pixels.height) for (x in 0 until pixels.width)
                if (pixels[x,y].red < .5f) add(x to y) }
            return listOf(points.minOf { it.first }, points.minOf { it.second }, points.maxOf { it.first }, points.maxOf { it.second })
        }
        val outline = bounds()
        compose.runOnIdle { filled = true }
        compose.mainClock.advanceTimeBy(600)
        assertEquals(outline, bounds())
    }

    @Test fun repostTurnsBrandOrangeAndUndoRestoresThemeInk() {
        var selected by mutableStateOf(false)
        compose.setContent { MaterialTheme(colorScheme = lightColorScheme()) {
            CompactPostAction(Icons.Rounded.Repeat, "Repost", null, Modifier.background(Color.White).testTag("repost"),
                onClick = { selected = !selected }, selected = selected)
        } }
        fun orangePixels(): Int {
            val p = compose.onNodeWithTag("repost").captureToImage().toPixelMap()
            return (0 until p.height).sumOf { y -> (0 until p.width).count { x ->
                p[x,y].let { it.red > .75f && it.green < .6f && it.blue < .4f } } }
        }
        assertEquals(0, orangePixels())
        compose.onNodeWithTag("repost").performClick()
        compose.waitForIdle()
        assertTrue(orangePixels() > 0)
        compose.onNodeWithTag("repost").performClick()
        compose.waitForIdle()
        assertEquals(0, orangePixels())
    }

    @Test fun scrollingGeometryDoesNotRecomposeAudioSession_butSoundtrackChangesDo() {
        val registry = VisiblePostAudioRegistry()
        val first = NativeAudioSelection("first", "First", "SautiLink", 0, 30000)
        val second = first.copy(trackId = "second")
        registry["post"] = VisiblePostAudio("post", first, 100, 0)
        var commits = 0
        compose.setContent {
            val selected = registry.values.maxByOrNull { it.visiblePercent }?.audio
            SideEffect { commits++ }
            Text(selected?.trackId.orEmpty())
        }
        val before = commits
        compose.runOnIdle { repeat(100) { registry["post"] = VisiblePostAudio("post", first, 100-it, it) } }
        compose.waitForIdle()
        assertEquals(before, commits)
        compose.runOnIdle { registry["post"] = VisiblePostAudio("post", second, 95, 0) }
        compose.onNodeWithText("second").assertExists()
        assertTrue(commits > before)
        compose.runOnIdle { registry.remove("post") }
        compose.onNodeWithText("second").assertDoesNotExist()
    }
    @Test fun unknownShortsActionsCanRetryWithoutShowingFalseUnlikedArtwork() {
        var pending by mutableStateOf(true)
        var reads = 0
        compose.setContent { MaterialTheme {
            com.sautilink.nativeapp.feature.videos.VideoRailAction(
                androidx.compose.material.icons.Icons.Rounded.FavoriteBorder, "Like", statusKnown = false,
                statusPending = pending, onClick = { reads++ })
        } }
        compose.onNodeWithContentDescription("Like").assertDoesNotExist()
        compose.onNode(SemanticsMatcher.keyIsDefined(androidx.compose.ui.semantics.SemanticsProperties.ProgressBarRangeInfo)).assertExists()
        compose.runOnIdle { pending = false }
        compose.onNodeWithContentDescription("Retry Like status").performClick()
        compose.runOnIdle { assertEquals(1, reads) }
        compose.onNodeWithContentDescription("Like").assertDoesNotExist()
    }

    @Test fun followNeverAppearsWhileUnknown_andExistingFollowsStayHidden() {
        val storage = object : android.content.ContextWrapper(
            androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().targetContext) {
            override fun getApplicationContext(): android.content.Context = this
            override fun getSharedPreferences(name: String, mode: Int): android.content.SharedPreferences =
                baseContext.getSharedPreferences("icon_performance_fixture_$name", mode)
        }
        val auth = com.sautilink.nativeapp.feature.auth.StagingAuthClient("sb_publishable_offline_ui_fixture", storage,
            com.sautilink.nativeapp.feature.auth.SautiBackend.PRODUCTION).apply { forgetSavedSession() }
        val post = com.sautilink.nativeapp.feature.home.StagingFeedPost("fixture-post", "fixture-author", "Test Author",
            "testauthor", false, "", "Test", "2026-11-26T00:00:00Z", 0, 0, 0, 0, emptyList(), false)
        var follow by mutableStateOf(com.sautilink.nativeapp.feature.videos.ShortsFollowUiState())
        compose.setContent { MaterialTheme {
            com.sautilink.nativeapp.feature.videos.ShortsAuthorIdentityRow(auth, post, null, follow, true, {}, {}, {})
        } }
        compose.onNodeWithText("Follow").assertDoesNotExist()
        compose.runOnIdle { follow = follow.receiveRead(0, false) }
        compose.onNodeWithText("Follow").assertExists()
        compose.runOnIdle { follow = follow.receiveRead(0, true) }
        compose.onNodeWithText("Follow").assertDoesNotExist()
    }

    @Test fun newAndExistingIconsUseMatchingVisualSize() {
        val names = listOf("home-0-1", "search", "heart", "heart-filled", "chat-circle", "repeat",
            "send", "bookmark", "bookmark-filled", "notification", "user", "nav-messages", "nav-shorts")
        compose.setContent { MaterialTheme { Column {
            names.chunked(3).forEach { row -> Row { row.forEach { name ->
                val artwork = Modifier.size(72.dp).background(Color.White).testTag(name)
                if (name.startsWith("nav-")) com.sautilink.nativeapp.ui.components.SautiNavigationIcon(
                    if (name == "nav-messages") 2 else 4, name, false, Color.Black, artwork)
                else SautiGlyph(name, name, artwork, tint = Color.Black)
            } } }
        } } }
        val visualSizes = names.associateWith { name ->
            val p = compose.onNodeWithTag(name).captureToImage().toPixelMap()
            val points = buildList { for (y in 0 until p.height) for (x in 0 until p.width)
                if (p[x,y].red < .5f) add(x to y) }
            val width = points.maxOf { it.first } - points.minOf { it.first } + 1
            val height = points.maxOf { it.second } - points.minOf { it.second } + 1
            maxOf(width, height).toFloat() / p.width * 24f
        }
        assertTrue("Common 24dp slots should have consistent optical size: $visualSizes",
            visualSizes.values.max() - visualSizes.values.min() <= .6f)
        assertEquals(visualSizes.getValue("heart"), visualSizes.getValue("heart-filled"), .1f)
    }

    @Test fun restoredRoomsMatchesItsStoriesNeighbour() {
        compose.setContent { MaterialTheme { Row {
            com.sautilink.nativeapp.feature.stories.StoriesButton(0) {}
            com.sautilink.nativeapp.feature.home.RoomsHomeShortcut {}
        } } }
        fun extent(label: String): Float {
            val node = compose.onNodeWithContentDescription(label, useUnmergedTree = true)
            val pixels = node.captureToImage().toPixelMap()
            val points = buildList { for (y in 0 until pixels.height) for (x in 0 until pixels.width)
                if (pixels[x,y].alpha > .5f && pixels[x,y].red < .5f) add(x to y) }
            val size = kotlin.math.sqrt(((points.maxOf { it.first }-points.minOf { it.first }+1) *
                (points.maxOf { it.second }-points.minOf { it.second }+1)).toFloat())
            val bounds = node.getUnclippedBoundsInRoot()
            return size/pixels.width*(bounds.right.value-bounds.left.value)
        }
        assertTrue("Rooms should match the Stories artwork size", kotlin.math.abs(extent("Rooms")-extent("Stories")) < 1f)
    }

    @Test fun videoScrollGeometryDoesNotRecomposePlaybackUntilAVisibilityThresholdChanges() {
        val viewport = com.sautilink.nativeapp.feature.home.NativeFeedVideoViewport().apply { update(.8f, 0f) }
        var commits = 0
        compose.setContent {
            val band = viewport.visibility
            SideEffect { commits++ }
            Text(band.name)
        }
        val before = commits
        compose.runOnIdle { repeat(100) { viewport.update(.6f + it*.004f, it.toFloat()) } }
        compose.waitForIdle()
        assertEquals("Scroll pixels must not recreate playback effects", before, commits)
        compose.runOnIdle { viewport.update(.3f, 500f) }
        compose.onNodeWithText("PARTIAL").assertExists()
        assertTrue(commits > before)
    }

    @Test fun videoPreparationHealthUpdatesDoNotRecomposeTheCallingFeedScreen() {
        val storage = object : android.content.ContextWrapper(
            androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().targetContext) {
            override fun getApplicationContext(): android.content.Context = this
            override fun getSharedPreferences(name: String, mode: Int): android.content.SharedPreferences =
                baseContext.getSharedPreferences("lookahead_scope_fixture_$name", mode)
        }
        val auth = com.sautilink.nativeapp.feature.auth.StagingAuthClient("sb_publishable_offline_ui_fixture", storage,
            com.sautilink.nativeapp.feature.auth.SautiBackend.PRODUCTION).apply { forgetSavedSession() }
        var commits = 0
        lateinit var health: com.sautilink.nativeapp.feature.home.FeedVideoLookaheadState
        compose.setContent {
            val state = com.sautilink.nativeapp.feature.home.rememberFeedVideoLookahead(auth, emptyList(),
                androidx.compose.foundation.lazy.rememberLazyListState(), "fixture", false, false)
            SideEffect { health = state; commits++ }
            Text("Feed screen")
        }
        val before = commits
        repeat(5) { index ->
            compose.runOnIdle { health.report(com.sautilink.nativeapp.feature.home.FeedVideoHealth(
                "fixture-video", true, 3000L+index, true, index.toLong())) }
            compose.waitForIdle()
        }
        assertEquals("Video health must invalidate only the preparation worker", before, commits)
    }

}
