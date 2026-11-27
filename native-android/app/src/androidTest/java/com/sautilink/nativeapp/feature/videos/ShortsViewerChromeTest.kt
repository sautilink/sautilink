package com.sautilink.nativeapp.feature.videos

import androidx.compose.foundation.layout.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.ui.theme.SautiTheme
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class ShortsViewerChromeTest {
    @get:Rule val compose=createComposeRule()
    @Test fun reactionsKeepRequestedOrderAndShareOneRowOnSmallPhones() {
        val taps=mutableListOf<String>()
        compose.setContent { SautiTheme(darkTheme=false) {
            ShortsActionBar(1200,11,38,false,false,false,onLike={taps+="like"},onComments={taps+="comment"},
                onRepost={taps+="repost"},onShare={taps+="share"},onSave={taps+="save"},modifier=Modifier.width(330.dp))
        } }
        val labels=listOf("Like","Comments","Repost","Share","Save")
        val bounds=labels.map { compose.onNodeWithContentDescription(it).fetchSemanticsNode().boundsInRoot }
        bounds.zipWithNext().forEach { (a,b) -> assertTrue(a.right<=b.left); assertEquals(a.center.y,b.center.y,.5f) }
        labels.forEach { compose.onNodeWithContentDescription(it).performClick() }
        assertEquals(listOf("like","comment","repost","share","save"),taps)
        compose.onNodeWithText("1.2k").assertExists()
        compose.onNodeWithText("0").assertDoesNotExist()
    }
    @Test fun optionsExposeTheActualPlayerAndPostActionsInDarkMode() {
        var chosen=0f;var auto=true
        compose.setContent { SautiTheme(darkTheme=true) {
            ShortsOptionsSheet(1f,"auto","480",listOf(360,480,720),false,false,true,false,
                onSpeed={chosen=it},onQuality={},onCaptions={},onAutoAdvance={auto=it},
                onPost={},onDownload={},onOffline={},onNotInterested={},onReport={},onDismiss={})
        } }
        listOf("Quality","Captions","Auto-advance","Go to Post","Download video","Add to Offline",
            "Not interested in this","Report post").forEach { compose.onNodeWithText(it).assertExists() }
        compose.onNodeWithText("1.5x").performClick()
        assertEquals(1.5f,chosen,0f)
        compose.onNodeWithText("Not available for this video").assertExists()
    }
}
