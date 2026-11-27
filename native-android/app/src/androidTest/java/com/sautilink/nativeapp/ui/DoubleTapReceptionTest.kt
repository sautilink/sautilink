package com.sautilink.nativeapp.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import com.sautilink.nativeapp.feature.posts.PostComposerTextEditor
import com.sautilink.nativeapp.ui.components.*
import com.sautilink.nativeapp.ui.theme.*
import java.io.File
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class DoubleTapReceptionTest {
    @get:Rule val compose=createComposeRule()
    @Test fun repeatDoubleTapsAnimateAgainWithoutOpeningOrSeeking() {
        var likes=0;var seeks=0;var opens=0
        compose.mainClock.autoAdvance=false
        compose.setContent { SautiTheme(darkTheme=true) {
            SautiVideoGestureSurface(Modifier.width(320.dp).height(480.dp).background(Color(0xFF314C58)).testTag("media"),
                playbackLabel="Play",onPlayback={},onTap={_,_->opens++},onSeek={seeks++;true},onLike={likes++})
        }}
        compose.mainClock.advanceTimeBy(16)
        compose.onNodeWithTag("media").performTouchInput {doubleClick(center)}
        compose.mainClock.advanceTimeBy(180)
        compose.onNodeWithTag("double-tap-heart",useUnmergedTree=true).assertExists()
        val directory=File(InstrumentationRegistry.getInstrumentation().targetContext.cacheDir,"reaction-review").apply {mkdirs()}
        File(directory,"heart-pop.png").outputStream().use { output ->
            compose.onNodeWithTag("media").captureToImage().asAndroidBitmap().compress(android.graphics.Bitmap.CompressFormat.PNG,100,output)
        }
        compose.onNodeWithTag("media").performTouchInput {doubleClick(center+Offset(8f,10f))}
        compose.mainClock.advanceTimeBy(180)
        compose.onAllNodesWithTag("double-tap-heart",useUnmergedTree=true).assertCountEquals(2)
        assertEquals(2,likes);assertEquals(0,seeks);assertEquals(0,opens)
        compose.mainClock.advanceTimeBy(1400)
        compose.onAllNodesWithTag("double-tap-heart",useUnmergedTree=true).assertCountEquals(0)
        compose.onNodeWithTag("media").performTouchInput {doubleClick(Offset(width*.1f,height*.5f))}
        compose.mainClock.advanceTimeBy(100)
        assertEquals(1,seeks);assertEquals(2,likes)
    }
    @Test fun photoDoubleTapUsesTheSameTransientHeart() {
        var likes=0
        compose.setContent {SautiTheme { SautiPostGestureSurface(Modifier.size(280.dp).testTag("photo"),onLike={likes++}) {} }}
        compose.onNodeWithTag("photo").performTouchInput {doubleClick(center)}
        compose.runOnIdle {assertEquals(1,likes)}
    }
    @Test fun composeIsPlainWhileOldPostFormattingIsPreserved() {
        compose.setContent {SautiTheme {Column {
            PostComposerTextEditor(TextFieldValue("Draft"),5,true,remember {FocusRequester()},{})
            SautiPostText("**Historical bold**")
        }}}
        compose.onNodeWithText("Text style").assertDoesNotExist()
        compose.onNodeWithText("Preview").assertDoesNotExist()
        val text=compose.onNodeWithText("Historical bold").fetchSemanticsNode().config[SemanticsProperties.Text].single()
        assertTrue(text.spanStyles.any {it.item.fontWeight==FontWeight.Bold})
    }
    @Test fun emailUsesBrandInkInBothThemesWithoutSocialNavigation() {
        var dark by mutableStateOf(false)
        compose.setContent {SautiTheme(darkTheme=dark) {SautiEntityText("team@sautilink.com",linkSocialEntities=false)}}
        fun ink():Color {
            val text=compose.onNodeWithText("team@sautilink.com").fetchSemanticsNode().config[SemanticsProperties.Text].single()
            return requireNotNull(text.getLinkAnnotations(0,text.length).single().item.styles?.style?.color)
        }
        assertEquals(SautiColors.EntityOrangeLight,ink())
        compose.runOnIdle {dark=true}
        assertEquals(SautiColors.EntityOrangeDark,ink())
    }
}
