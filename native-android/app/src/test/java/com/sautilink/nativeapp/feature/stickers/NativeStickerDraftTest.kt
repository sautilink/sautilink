package com.sautilink.nativeapp.feature.stickers

import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import org.junit.Assert.*
import org.junit.Test

class NativeStickerDraftTest {
    @Test fun addingAndEditingAttachmentsNeverExposesCodesInCaption() {
        val first = insertNativeSticker(TextFieldValue("Hello ", TextRange(6)), "[[sl-sticker:sl-happy]]", 500)
        assertEquals("Hello ", stickerCaption(first).text)
        assertEquals(6, stickerCaption(first).selection.start)
        val next = editStickerCaption(first.text, TextFieldValue("Hello world", TextRange(11)), 500)
        assertEquals("Hello world", stickerCaption(next).text)
        assertTrue(next.text.contains("[[sl-sticker:sl-happy]]"))
        val two = insertNativeSticker(next, ":slv-heart:", 500)
        assertEquals("Hello world", stickerCaption(two).text)
        assertEquals(2, draftStickerPattern.findAll(two.text).count())
    }

    @Test fun captionBudgetKeepsCompleteAttachmentsAndValidCursor() {
        val original = insertNativeSticker(TextFieldValue(""), "[[sl-sticker:sl-happy]]", 500)
        val updated = editStickerCaption(original.text, TextFieldValue("x".repeat(600), TextRange(600)), 500)
        assertTrue(updated.text.length <= 500)
        assertEquals(1, draftStickerPattern.findAll(updated.text).count())
        assertTrue(stickerCaption(updated).selection.end <= stickerCaption(updated).text.length)
    }
}
