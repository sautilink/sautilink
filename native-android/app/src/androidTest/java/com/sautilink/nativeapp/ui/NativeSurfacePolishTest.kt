package com.sautilink.nativeapp.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Bookmark
import androidx.compose.material.icons.rounded.BookmarkBorder
import androidx.compose.material.icons.rounded.FavoriteBorder
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.feature.home.CompactPostAction
import com.sautilink.nativeapp.ui.components.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class NativeSurfacePolishTest {
    @get:Rule val compose = createComposeRule()

    @Test fun floatingNavigationIsOpaqueWhiteOrBlackOverBrightContent() {
        var dark by mutableStateOf(false)
        compose.setContent {
            MaterialTheme(colorScheme = if (dark) darkColorScheme() else lightColorScheme()) {
                Box(Modifier.fillMaxWidth().background(Color.Red)) { SautiBottomBar(0) {} }
            }
        }
        fun centerColor(): Int {
            val pixels = compose.onNodeWithTag("sauti-navigation-surface").captureToImage().toPixelMap()
            return pixels[pixels.width / 2, pixels.height / 2].toArgb()
        }
        assertEquals(Color.White.toArgb(), centerColor())
        compose.runOnIdle { dark = true }
        assertEquals(Color.Black.toArgb(), centerColor())
    }

    @Test fun postActionsHaveNoPressedBoxAndSaveFillsOnlyItsArtwork() {
        compose.mainClock.autoAdvance = false
        var liked by mutableStateOf(false)
        var saved by mutableStateOf(false)
        compose.setContent { MaterialTheme(colorScheme = lightColorScheme()) {
            Row(Modifier.background(Color.White)) {
                CompactPostAction(Icons.Rounded.FavoriteBorder, "Like", null, Modifier.testTag("like"),
                    onClick = { liked = !liked }, selected = liked)
                CompactPostAction(Icons.Rounded.BookmarkBorder, "Save", null, Modifier.testTag("save"),
                    onClick = { saved = !saved }, activeIcon = if (saved) Icons.Rounded.Bookmark else Icons.Rounded.BookmarkBorder,
                    selected = saved)
            }
        } }
        compose.mainClock.advanceTimeBy(500)
        val save = compose.onNodeWithTag("save")
        val before = save.captureToImage().toPixelMap()
        assertEquals(Color.White.toArgb(), before[before.width / 2, before.height / 2].toArgb())
        save.performTouchInput { down(center) }
        compose.mainClock.advanceTimeBy(100)
        val pressed = save.captureToImage().toPixelMap()
        assertEquals(Color.White.toArgb(), pressed[pressed.width / 2, pressed.height / 10].toArgb())
        save.performTouchInput { up() }
        compose.mainClock.advanceTimeBy(600)
        save.assertIsSelected()
        val after = save.captureToImage().toPixelMap()
        assertEquals(Color.Black.toArgb(), after[after.width / 2, after.height / 2].toArgb())
        assertEquals(Color.White.toArgb(), after[after.width / 2, after.height / 10].toArgb())
        compose.onNodeWithTag("like").performClick()
        compose.mainClock.advanceTimeBy(600)
        compose.onNodeWithTag("like").assertIsSelected()
    }

    @Test fun compactCommentEditorPreservesMentionSelectionAndGrowsForLongerText() {
        var draft by mutableStateOf(TextFieldValue("@sautilink ", TextRange(11)))
        compose.setContent { MaterialTheme {
            NativeCommentField(draft, { draft = it }, Modifier.width(260.dp))
        } }
        val field = compose.onNode(hasSetTextAction())
        val bounds = field.getUnclippedBoundsInRoot()
        assertTrue(bounds.bottom.value - bounds.top.value <= 44f)
        field.performTextInput("Hello")
        compose.runOnIdle { assertEquals("@sautilink Hello", draft.text) }
        field.performTextInput("\nSecond line")
        compose.onNodeWithText("@sautilink Hello\nSecond line").assertIsDisplayed()
    }
}
