package com.sautilink.nativeapp.feature.home

import androidx.compose.foundation.layout.Row
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import org.junit.Rule
import org.junit.Test

class NativeReactionCountsUiTest {
    @get:Rule val compose = createComposeRule()
    @Test fun emptyPostShowsOnlyIconsAndTheFirstLikeAddsOne() {
        var likes by mutableIntStateOf(0)
        compose.setContent { MaterialTheme { Row {
            CompactPostAction(Icons.Rounded.FavoriteBorder,"Like post",feedCount(likes),Modifier,onClick={likes++})
            CompactPostAction(Icons.Rounded.ChatBubbleOutline,"Comments",feedCount(0),Modifier,onClick={})
            CompactPostAction(Icons.Rounded.Repeat,"Repost",feedCount(0),Modifier,onClick={})
        } } }
        compose.onAllNodesWithText("0").assertCountEquals(0)
        compose.onNodeWithContentDescription("Comments").assertIsDisplayed()
        compose.onNodeWithContentDescription("Repost").assertIsDisplayed()
        compose.onNodeWithContentDescription("Like post").performClick()
        compose.onNodeWithText("1").assertIsDisplayed()
        compose.runOnIdle { likes=0 }
        compose.onAllNodesWithText("1").assertCountEquals(0)
        compose.onAllNodesWithText("0").assertCountEquals(0)
    }
    @Test fun allThreePostActionsUseTheSameCompactCount() {
        var total by mutableIntStateOf(1000)
        compose.setContent { MaterialTheme { Row {
            CompactPostAction(Icons.Rounded.FavoriteBorder,"Like post",feedCount(total),Modifier,onClick={})
            CompactPostAction(Icons.Rounded.ChatBubbleOutline,"Comments",feedCount(total),Modifier,onClick={})
            CompactPostAction(Icons.Rounded.Repeat,"Repost",feedCount(total),Modifier,onClick={})
        } } }
        compose.onAllNodesWithText("1k").assertCountEquals(3)
        compose.runOnIdle { total=1100 }
        compose.onAllNodesWithText("1.1k").assertCountEquals(3)
        compose.runOnIdle { total=10000 }
        compose.onAllNodesWithText("10k").assertCountEquals(3)
    }
}
