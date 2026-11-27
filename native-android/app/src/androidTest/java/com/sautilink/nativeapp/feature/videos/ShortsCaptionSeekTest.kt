package com.sautilink.nativeapp.feature.videos

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.ui.components.SautiPostText
import com.sautilink.nativeapp.ui.components.ThinVideoSeekBar
import com.sautilink.nativeapp.ui.theme.SautiTheme
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class ShortsCaptionSeekTest {
    @get:Rule val compose=createComposeRule()
    @Test fun longCaptionTogglesByTappingWithoutMoreOrLessLabels() {
        val caption="This is a long caption that keeps its full text available when a viewer taps it. ".repeat(9)
        var expanded=false
        compose.setContent {SautiTheme(darkTheme=true) {
            SautiPostText(caption,Modifier.width(280.dp),maxLines=2,expandedMaxHeight=160.dp,
                tapToExpand=true,onExpandedChange={expanded=it})
        }}
        val compact=compose.onNodeWithText(caption).fetchSemanticsNode().boundsInRoot.height
        compose.onNodeWithText("See more").assertDoesNotExist()
        compose.onNodeWithText(caption).performClick()
        compose.waitForIdle()
        assertTrue(expanded)
        assertTrue(compose.onNodeWithText(caption).fetchSemanticsNode().boundsInRoot.height>compact)
        compose.onNodeWithText("See less").assertDoesNotExist()
        compose.onNodeWithText(caption).performClick()
        compose.waitForIdle()
        assertFalse(expanded)
        assertEquals(compact,compose.onNodeWithText(caption).fetchSemanticsNode().boundsInRoot.height,1f)
    }
    @Test fun timelineThickensDuringPressAndReturnsToThinOnRelease() {
        compose.mainClock.autoAdvance=false
        var selected:Long?=null
        compose.setContent {SautiTheme(darkTheme=true) {
            ThinVideoSeekBar(3000,10000,true,Modifier.width(300.dp),thickness=2.dp,
                pressedThickness=6.dp,showThumb=false,onSeek={selected=it})
        }}
        compose.mainClock.advanceTimeBy(16)
        val thin=compose.onNodeWithTag("video-seek-track").fetchSemanticsNode().boundsInRoot.height
        compose.onNodeWithContentDescription("Video progress").performTouchInput {down(center)}
        compose.mainClock.advanceTimeBy(180)
        val thick=compose.onNodeWithTag("video-seek-track").fetchSemanticsNode().boundsInRoot.height
        assertTrue("Pressed timeline should visibly thicken",thick>=thin*2)
        compose.onNodeWithContentDescription("Video progress").performTouchInput {up()}
        compose.mainClock.advanceTimeBy(200)
        assertEquals(thin,compose.onNodeWithTag("video-seek-track").fetchSemanticsNode().boundsInRoot.height,1f)
        compose.runOnIdle {assertNotNull(selected)}
    }
}
