package com.sautilink.nativeapp.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.sautilink.nativeapp.feature.home.FeedRefreshContainer
import com.sautilink.nativeapp.feature.home.HomeFeedTabs
import com.sautilink.nativeapp.feature.home.FeedFollowButton
import com.sautilink.nativeapp.feature.home.feedFollowButtonVisible
import com.sautilink.nativeapp.ui.theme.SautiTheme
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Real app-owned controls with synthetic text rows; no auth or network access. */
@RunWith(AndroidJUnit4::class)
class NativeFeedRefreshControlsTest {
    @get:Rule val compose = createComposeRule()

    @Test fun pullRefreshOnlyTriggersAtTop_andTabsRemainOutsideScrollingContent() {
        var refreshes = 0
        var refreshing by mutableStateOf(false)
        compose.setContent { SautiTheme(darkTheme = false) {
            Column(Modifier.fillMaxSize()) {
                HomeFeedTabs("for_you", {})
                FeedRefreshContainer(refreshing, !refreshing, false, onRefresh = { refreshes++; refreshing = true },
                    onNewPosts = {}, modifier = Modifier.weight(1f)) {
                    LazyColumn(Modifier.fillMaxSize().testTag("feed-list")) {
                        items(100) { Text("Post $it", Modifier.fillMaxWidth().height(120.dp)) }
                    }
                }
            }
        } }
        val top = compose.onNodeWithText("For You").fetchSemanticsNode().boundsInRoot.top
        compose.onNodeWithTag("feed-list").performTouchInput { swipeDown() }
        compose.waitUntil(5_000L) { refreshes == 1 }
        compose.runOnIdle { refreshing = false }
        compose.onNodeWithTag("feed-list").performScrollToIndex(20)
        compose.onNodeWithTag("feed-list").performTouchInput { swipeDown() }
        compose.runOnIdle { assertEquals("A pull within the list must scroll, without refreshing", 1, refreshes) }
        compose.onNodeWithText("For You").assertIsDisplayed()
        assertEquals(top, compose.onNodeWithText("For You").fetchSemanticsNode().boundsInRoot.top, 1f)
    }

    @Test fun newPostsNoticeDoesNotMoveOrReplaceTheReadingPosition_andRequiresATap() {
        var show by mutableStateOf(false)
        var requests = 0
        var visibleIndex = -1
        compose.setContent { SautiTheme(darkTheme = true) {
            val list = rememberLazyListState()
            SideEffect { visibleIndex = list.firstVisibleItemIndex }
            FeedRefreshContainer(false, true, show, onRefresh = {}, onNewPosts = { requests++ }, modifier = Modifier.fillMaxSize()) {
                LazyColumn(Modifier.fillMaxSize().testTag("feed-list"), state = list) {
                    items(100) { Text("Post $it", Modifier.fillMaxWidth().height(120.dp)) }
                }
            }
        } }
        compose.onNodeWithTag("feed-list").performScrollToIndex(20)
        compose.runOnIdle { show = true }
        compose.onNodeWithText("New Posts").assertIsDisplayed()
        compose.runOnIdle { assertEquals(20, visibleIndex); assertEquals(0, requests) }
        compose.onNodeWithText("New Posts").performClick()
        compose.runOnIdle { assertEquals(20, visibleIndex); assertEquals(1, requests) }
        compose.onNodeWithText("Post 20").assertIsDisplayed()
    }

    @Test fun confirmedFollowShowsFeedback_thenRefreshHidesIt_withoutAnUnfollowTap() {
        var following by mutableStateOf<Boolean?>(false)
        var feedback by mutableStateOf(false)
        var writes = 0
        compose.setContent { SautiTheme(darkTheme = false) {
            if (feedFollowButtonVisible(following, feedback, null)) {
                FeedFollowButton(following, null, true) { writes++; following = true; feedback = true }
            }
        } }
        compose.onNodeWithText("Follow").performClick()
        compose.onNodeWithText("Following").assertIsDisplayed().assertIsNotEnabled()
        compose.onNodeWithText("Following").performTouchInput { click() }
        compose.runOnIdle { assertEquals(1, writes); feedback = false }
        compose.onNodeWithText("Following").assertDoesNotExist()
        compose.onNodeWithText("Follow").assertDoesNotExist()
    }
}
