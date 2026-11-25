package com.sautilink.nativeapp.feature.home

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sautilink.nativeapp.feature.stickers.stickerCaption
import com.sautilink.nativeapp.feature.stickers.editStickerCaption

internal fun insertCommentEmoji(value: TextFieldValue, emoji: String): TextFieldValue {
    val caption = stickerCaption(value)
    val start = caption.selection.min; val end = caption.selection.max
    if (value.text.length - (end - start) + emoji.length > 500) return value
    return editStickerCaption(value.text, TextFieldValue(caption.text.replaceRange(start, end, emoji),
        TextRange(start + emoji.length)), 500)
}

@Composable
internal fun NativeRecommendedEmojis(enabled: Boolean = true, onInsert: (String) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        listOf("❤️", "🙌", "🔥", "👏", "🥹", "😍", "😮", "😂").forEach { emoji ->
            Box(Modifier.weight(1f).height(44.dp).semantics { contentDescription = "Insert $emoji" }
                .clickable(enabled = enabled, role = Role.Button) { onInsert(emoji) }, contentAlignment = Alignment.Center) {
                Text(emoji, fontSize = 26.sp)
            }
        }
    }
}
