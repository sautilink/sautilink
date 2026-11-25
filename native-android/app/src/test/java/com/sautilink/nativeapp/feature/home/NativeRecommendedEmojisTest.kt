package com.sautilink.nativeapp.feature.home

import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import org.junit.Assert.*
import org.junit.Test

class NativeRecommendedEmojisTest {
    @Test fun insertsAtCursorAndPreservesReplyMentionAndSticker() {
        val original = TextFieldValue("@sautilink hello\n[[sl-sticker:sl-happy]]", TextRange(11))
        val next = insertCommentEmoji(original, "🔥")
        assertEquals("@sautilink 🔥hello\n[[sl-sticker:sl-happy]]", next.text)
        assertEquals(13, next.selection.start)
    }

    @Test fun doesNotTruncateExistingTextAtTheCommentLimit() {
        val full = TextFieldValue("x".repeat(500), TextRange(250))
        assertEquals(full, insertCommentEmoji(full, "❤️"))
        val selected = full.copy(selection = TextRange(248, 252))
        val replacement = insertCommentEmoji(selected, "🔥")
        assertEquals(498, replacement.text.length)
        assertTrue(replacement.text.contains("🔥"))
    }
}
