package com.sautilink.nativeapp.feature.rooms

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AddPhotoAlternate
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.ui.components.SautiPostText
import com.sautilink.nativeapp.ui.text.PostTextFormat
import com.sautilink.nativeapp.ui.text.insertPostFormatting

@Composable
internal fun RoomComposerSheet(room: NativeRoom, state: RoomsState, onDismiss: () -> Unit) {
    val draft = state.draft(room)
    val publishing = state.busy("publish")
    var preview by remember(state.accountId, room.id) { mutableStateOf(false) }
    val keyboard = LocalSoftwareKeyboardController.current
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(5)) { uris ->
        if (state.auth.account?.id == state.accountId && state.selected?.id == room.id) state.addMedia(room, uris)
    }
    RoomSheet("Post in ${room.name}", onDismiss) {
        OutlinedTextField(draft.editor, { value -> draft.editor = boundedRoomEditor(value) },
            enabled = !publishing, label = { Text("Share with this Room") }, minLines = 4,
            modifier = Modifier.fillMaxWidth(), supportingText = { Text("${draft.editor.text.length}/2000") })
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            PostTextFormat.entries.forEach { format ->
                TextButton(onClick = {
                    val value = draft.editor
                    insertPostFormatting(value.text, value.selection.start, value.selection.end, format)?.let { inserted ->
                        keyboard?.hide()
                        draft.editor = TextFieldValue(inserted.text, TextRange(inserted.selectionStart, inserted.selectionEnd))
                        preview = true
                    }
                }, enabled = !publishing, modifier = Modifier.weight(1f).semantics {
                    contentDescription = "${format.label} selected text"
                }) {
                    Text(format.glyph, fontWeight = if (format == PostTextFormat.BOLD) FontWeight.Bold else FontWeight.Normal,
                        fontStyle = if (format == PostTextFormat.ITALIC) FontStyle.Italic else FontStyle.Normal,
                        textDecoration = when (format) { PostTextFormat.UNDERLINE -> TextDecoration.Underline
                            PostTextFormat.STRIKETHROUGH -> TextDecoration.LineThrough; else -> TextDecoration.None })
                }
            }
            TextButton(onClick = { preview = !preview }) { Text("Preview") }
        }
        if (preview) Surface(color = MaterialTheme.colorScheme.surfaceContainer, shape = MaterialTheme.shapes.medium) {
            Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                Text("Post preview", style = MaterialTheme.typography.labelLarge)
                SautiPostText(draft.editor.text, style = MaterialTheme.typography.bodyLarge)
            }
        }
        val limit = NativeRoomRules.mediaLimit(draft.media.map { it.kind })
        OutlinedButton(onClick = { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo)) },
            enabled = !publishing && draft.media.size < limit, modifier = Modifier.fillMaxWidth()) {
            Icon(Icons.Rounded.AddPhotoAlternate, null); Spacer(Modifier.width(8.dp))
            Text("Add media (${draft.media.size}/$limit)")
        }
        Text("Up to five photos, or four attachments when including video.", style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        draft.media.forEach { item ->
            RoomDraftMediaRow(room, state, item, publishing)
        }
        RoomSelectField("Who can comment?", draft.replyAccess,
            listOf("everyone" to "Everyone", "following" to "People you follow", "mentioned" to "People mentioned"),
            !publishing) { draft.replyAccess = it }
        if (draft.replyAccess == "mentioned") Text("Mention each person using @username in your post.",
            style = MaterialTheme.typography.bodySmall)
        val queued = room.supportsPostApproval && room.postApprovalRequired && !room.isStaff
        if (queued) RoomNotice("Your post will appear after Room staff approve it.")
        if (draft.error != null) RoomNotice(draft.error.orEmpty(), true)
        val valid = (draft.editor.text.trim().isNotBlank() || draft.media.isNotEmpty()) &&
            draft.editor.text.trim().length <= 2000 && draft.media.all { it.ready != null && it.alt.length <= 1000 }
        Button(onClick = { keyboard?.hide(); state.publish(room, onDismiss) },
            enabled = valid && !publishing && !draft.uploading,
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
            Text(if (publishing) "Sending…" else if (queued) "Submit for review" else "Publish in Room")
        }
        Text("Drafts stay separate for each Room and account. Unattached uploads expire after one hour.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

private fun boundedRoomEditor(value: TextFieldValue): TextFieldValue {
    if (value.text.length <= 2001) return value
    val text = value.text.take(2001)
    return TextFieldValue(text, TextRange(value.selection.start.coerceAtMost(text.length), value.selection.end.coerceAtMost(text.length)))
}

@Composable
private fun RoomDraftMediaRow(room: NativeRoom, state: RoomsState, item: RoomDraftMedia, publishing: Boolean) {
    Surface(color = MaterialTheme.colorScheme.surfaceContainer, shape = MaterialTheme.shapes.medium) {
        Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("${item.kind.replaceFirstChar { it.uppercase() }} · ${item.status}", modifier = Modifier.weight(1f),
                    style = MaterialTheme.typography.titleSmall)
                TextButton(onClick = { state.removeMedia(room, item) }, enabled = !publishing) { Text("Remove") }
            }
            if (item.status == "Uploading") LinearProgressIndicator(progress = { item.progress / 100f }, modifier = Modifier.fillMaxWidth())
            if (item.error != null) Text(item.error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            if (item.ready != null) OutlinedTextField(item.alt, { state.mediaAlt(room, item.localId, it) },
                label = { Text("Alt text (optional)") }, enabled = !publishing,
                modifier = Modifier.fillMaxWidth(), supportingText = { Text("${item.alt.length}/1000") })
        }
    }
}
