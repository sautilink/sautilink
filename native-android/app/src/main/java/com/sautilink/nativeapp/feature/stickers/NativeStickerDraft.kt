package com.sautilink.nativeapp.feature.stickers

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp

internal val draftStickerPattern = Regex("\\[\\[sl-sticker:([a-z0-9-]{1,90})]]|:slv-([a-z0-9-]{1,86}):")
internal fun stickerSummary(text: String) = draftStickerPattern.replace(text, "Sticker")

/** Attachment tokens stay in the wire format, never in the editable caption. */
internal fun stickerCaption(value: TextFieldValue): TextFieldValue {
    val attachmentSuffix = Regex("\n(?:${draftStickerPattern.pattern})(?: (?:${draftStickerPattern.pattern}))*\\s*$").find(value.text)
    val hidden = if (attachmentSuffix != null) draftStickerPattern.findAll(value.text.substring(0, attachmentSuffix.range.first)).toList() + attachmentSuffix
        else draftStickerPattern.findAll(value.text).toList()
    fun map(offset: Int) = offset - hidden.sumOf {
        (offset - it.range.first).coerceIn(0, it.value.length)
    }
    val caption = if (attachmentSuffix != null) draftStickerPattern.replace(value.text.substring(0, attachmentSuffix.range.first), "")
        else draftStickerPattern.replace(value.text, "")
    return TextFieldValue(caption, TextRange(map(value.selection.start), map(value.selection.end)),
        value.composition?.let { TextRange(map(it.start), map(it.end)) })
}

internal fun editStickerCaption(original: String, caption: TextFieldValue, limit: Int): TextFieldValue {
    val attachments = draftStickerPattern.findAll(original).map { it.value }.toList()
    val suffix = if (attachments.isEmpty()) "" else "\n" + attachments.joinToString(" ")
    val text = caption.text.take((limit - suffix.length).coerceAtLeast(0))
        .let { if (it.lastOrNull()?.isHighSurrogate() == true) it.dropLast(1) else it }
    return TextFieldValue(text + suffix, TextRange(caption.selection.start.coerceAtMost(text.length),
        caption.selection.end.coerceAtMost(text.length)), caption.composition?.takeIf { it.end <= text.length })
}

@Composable
internal fun NativeStickerDraftPreview(value: String, enabled: Boolean = true, onChange: (String) -> Unit) {
    val matches = remember(value) { draftStickerPattern.findAll(value).toList() }
    if (matches.isEmpty()) return
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        matches.forEachIndexed { index, match ->
            Surface(shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.surfaceContainer) {
                Box(Modifier.size(104.dp).padding(6.dp)) {
                    NativeStickerText(match.value, Modifier.align(Alignment.Center).size(82.dp)) {
                        Text("Sticker", style = MaterialTheme.typography.labelSmall)
                    }
                    IconButton(onClick = { onChange(value.removeRange(match.range).trimEnd()) }, enabled = enabled,
                        modifier = Modifier.align(Alignment.TopEnd).size(28.dp)) {
                        Icon(Icons.Rounded.Close, "Remove sticker ${index + 1}", Modifier.size(17.dp))
                    }
                }
            }
        }
    }
}
