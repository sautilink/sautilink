package com.sautilink.nativeapp.feature.home

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.feature.music.NativeAudioSelection
import com.sautilink.nativeapp.feature.music.NativeMusicIdentity
import com.sautilink.nativeapp.ui.components.NativeSearchField
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class NativeCompactFeedChromeTest {
    @get:Rule val compose = createComposeRule()

    @Test fun usernameAndMusicSharePositionAndTypeSize() {
        compose.mainClock.autoAdvance = false
        compose.setContent { MaterialTheme {
            NativeMusicIdentity("sautilink", "1h", NativeAudioSelection("preview-test", "Test sound", "SautiLink", 0, 30000),
                showTimestamp = true)
        } }
        compose.mainClock.advanceTimeBy(100)
        val first = compose.onNodeWithText("@sautilink • 1h")
        val bounds = first.getUnclippedBoundsInRoot()
        val nameLayout = mutableListOf<TextLayoutResult>()
        first.performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(nameLayout) }
        compose.mainClock.advanceTimeBy(3000)
        val song = compose.onNodeWithText("♫ Test sound · SautiLink")
        val second = song.getUnclippedBoundsInRoot()
        val songLayout = mutableListOf<TextLayoutResult>()
        song.performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(songLayout) }
        assertEquals(bounds.left.value, second.left.value, .5f)
        assertEquals(bounds.top.value, second.top.value, .5f)
        assertEquals(nameLayout.single().layoutInput.style.fontSize, songLayout.single().layoutInput.style.fontSize)
        assertEquals(nameLayout.single().layoutInput.style.lineHeight, songLayout.single().layoutInput.style.lineHeight)
    }

    @Test fun emojiTapInsertsIntoTheCommentAndSearchStaysCompact() {
        compose.setContent { MaterialTheme {
            var draft by remember { mutableStateOf(TextFieldValue("@sautilink ", androidx.compose.ui.text.TextRange(11))) }
            var search by remember { mutableStateOf("") }
            Column(Modifier.fillMaxWidth()) {
                NativeSearchField(search, { search = it }, placeholder = "Search people")
                NativeRecommendedEmojis { draft = insertCommentEmoji(draft, it) }
                OutlinedTextField(draft, { draft = it })
            }
        } }
        compose.onNodeWithContentDescription("Insert 🔥").performClick()
        compose.onNodeWithText("@sautilink 🔥").assertIsDisplayed()
        val search = compose.onAllNodes(hasSetTextAction())[0]
        val fieldBounds = search.getUnclippedBoundsInRoot()
        assertTrue(fieldBounds.bottom.value - fieldBounds.top.value <= 48f)
        search.performTextInput("Dr charles")
        compose.onNodeWithContentDescription("Clear search").performClick()
        compose.onNodeWithText("Search people").assertIsDisplayed()
    }
}
