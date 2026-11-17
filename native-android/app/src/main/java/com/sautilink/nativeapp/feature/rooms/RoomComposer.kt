package com.sautilink.nativeapp.feature.rooms

import android.graphics.Bitmap
import android.os.Build
import android.util.Size
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Reply
import androidx.compose.material.icons.automirrored.rounded.Send
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.ui.components.SautiIcon as Icon
import com.sautilink.nativeapp.ui.text.PostTextFormat
import com.sautilink.nativeapp.ui.text.insertPostFormatting
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private enum class RoomComposerPanel { ATTACHMENTS, TOOLS }

@Composable
internal fun RoomInlineComposer(
    room: NativeRoom,
    state: RoomsState,
    replyTo: NativeRoomPost? = null,
    onCloseReply: () -> Unit = {},
    onSent: () -> Unit,
) {
    val draft = state.draft(room)
    val focusManager = LocalFocusManager.current
    val keyboard = LocalSoftwareKeyboardController.current
    val focusRequester = remember(room.id) { FocusRequester() }
    val colors = MaterialTheme.colorScheme
    var panel by rememberSaveable(state.accountId, room.id) { mutableStateOf<RoomComposerPanel?>(null) }
    var attachmentDetails by remember(room.id) { mutableStateOf<String?>(null) }
    val publishing = state.busy("publish")
    val text = draft.editor
    val ready = !publishing && roomDraftReady(draft)
    val limit = NativeRoomRules.MAX_MESSAGE_ATTACHMENTS
    val canAttach = !publishing && draft.media.size < limit

    val gallery = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(limit)) {
        if (it.isNotEmpty()) state.addMedia(room, it)
    }
    val files = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) {
        if (it.isNotEmpty()) state.addMedia(room, it)
    }
    fun togglePanel(target: RoomComposerPanel) {
        val next = if (panel == target) null else target
        if (next != null) {
            focusManager.clearFocus()
            keyboard?.hide()
        }
        panel = next
    }
    BackHandler(panel != null) { panel = null }
    LaunchedEffect(replyTo?.id) {
        draft.stopTyping()
        if (replyTo != null) {
            panel = null
            focusRequester.requestFocus()
            keyboard?.show()
        }
    }

    Surface(color = colors.surface, shadowElevation = 3.dp) {
        Column(Modifier.fillMaxWidth()) {
            HorizontalDivider(color = colors.outlineVariant.copy(alpha = .55f))
            if (replyTo != null) RoomReplyQuote(replyTo, !publishing, onCloseReply)
            if (draft.media.isNotEmpty()) {
                LazyRow(contentPadding = PaddingValues(horizontal = 12.dp, vertical = 7.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(draft.media, key = { it.localId }) { item ->
                        RoomAttachmentTile(item, !publishing,
                            onDetails = { attachmentDetails = item.localId },
                            onRemove = { state.removeMedia(room, item) })
                    }
                }
            }
            val error = draft.error
            if (error != null) Text(error, Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 5.dp),
                style = MaterialTheme.typography.bodySmall, color = colors.error, maxLines = 3,
                overflow = TextOverflow.Ellipsis)
            Row(Modifier.fillMaxWidth().padding(horizontal = 7.dp, vertical = 6.dp),
                verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                IconButton(onClick = { togglePanel(RoomComposerPanel.ATTACHMENTS) },
                    enabled = !publishing) {
                    Icon(if (panel == RoomComposerPanel.ATTACHMENTS) Icons.Rounded.Close else Icons.Rounded.AttachFile,
                        if (panel == RoomComposerPanel.ATTACHMENTS) "Close attachments" else "Add attachment",
                        tint = colors.primary)
                }
                Surface(Modifier.weight(1f), shape = RoundedCornerShape(24.dp),
                    color = colors.surfaceContainer, border = BorderStroke(1.dp, colors.outlineVariant.copy(alpha = .4f))) {
                    Row(verticalAlignment = Alignment.Bottom) {
                        BasicTextField(text, { input ->
                            panel = null
                            draft.edit(boundedRoomEditor(input, 2000))
                        }, enabled = !publishing,
                            modifier = Modifier.weight(1f).focusRequester(focusRequester)
                                .onFocusChanged { if (it.isFocused) panel = null },
                            maxLines = 4, textStyle = MaterialTheme.typography.bodyLarge.copy(color = colors.onSurface),
                            cursorBrush = SolidColor(colors.primary),
                            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                            decorationBox = { editor ->
                                Box(Modifier.fillMaxWidth().heightIn(min = 47.dp)
                                    .padding(start = 15.dp, end = 4.dp, top = 11.dp, bottom = 11.dp),
                                    contentAlignment = Alignment.CenterStart) {
                                    if (text.text.isEmpty()) Text(if (replyTo == null) "Message" else "Reply",
                                        color = colors.onSurfaceVariant, style = MaterialTheme.typography.bodyLarge)
                                    editor()
                                }
                            })
                        IconButton(onClick = { togglePanel(RoomComposerPanel.TOOLS) },
                            enabled = !publishing) {
                            Icon(Icons.Rounded.Tune, "Message options", Modifier.size(19.dp),
                                tint = if (panel == RoomComposerPanel.TOOLS) colors.primary
                                else colors.onSurfaceVariant)
                        }
                    }
                }
                FilledIconButton(onClick = {
                    panel = null
                    state.publish(room, replyTo?.id) {
                        if (replyTo != null) onCloseReply()
                        onSent()
                    }
                }, enabled = ready, modifier = Modifier.size(48.dp), shape = CircleShape) {
                    if (publishing) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                    else Icon(Icons.AutoMirrored.Rounded.Send,
                        if (replyTo == null) "Send message" else "Send reply", Modifier.size(22.dp))
                }
            }
            AnimatedVisibility(panel == RoomComposerPanel.ATTACHMENTS,
                enter = expandVertically(expandFrom = Alignment.Top) + fadeIn(),
                exit = shrinkVertically(shrinkTowards = Alignment.Top) + fadeOut()) {
                RoomAttachmentTray(canAttach,
                    onPhotos = { panel = null; gallery.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                    onVideos = { panel = null; gallery.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.VideoOnly)) },
                    onFiles = { panel = null; files.launch(arrayOf("image/jpeg", "image/png", "image/webp", "video/mp4")) })
            }
            AnimatedVisibility(panel == RoomComposerPanel.TOOLS,
                enter = expandVertically(expandFrom = Alignment.Top) + fadeIn(),
                exit = shrinkVertically(shrinkTowards = Alignment.Top) + fadeOut()) {
                RoomMessageTools(draft, publishing)
            }
        }
    }
    draft.media.firstOrNull { it.localId == attachmentDetails }?.let { item ->
        RoomAttachmentDetails(item, publishing, onDismiss = { attachmentDetails = null },
            onAlt = { state.mediaAlt(room, item.localId, it) },
            onRetry = item.source?.let { source ->
                {
                    state.removeMedia(room, item)
                    state.addMedia(room, listOf(source))
                    attachmentDetails = null
                }
            })
    }
}

@Composable
private fun RoomAttachmentTray(enabled: Boolean, onPhotos: () -> Unit, onVideos: () -> Unit, onFiles: () -> Unit) {
    val colors = MaterialTheme.colorScheme
    Column(Modifier.fillMaxWidth().background(colors.surfaceContainerLow).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Attach to message", style = MaterialTheme.typography.titleSmall)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            RoomAttachmentOption("Photos", Icons.Rounded.PhotoLibrary, Modifier.weight(1f), enabled, onPhotos)
            RoomAttachmentOption("Videos", Icons.Rounded.VideoLibrary, Modifier.weight(1f), enabled, onVideos)
            RoomAttachmentOption("Browse files", Icons.Rounded.FolderOpen, Modifier.weight(1f), enabled, onFiles)
        }
        Text(if (enabled) "Choose an image or video from your device." else "Remove an attachment to add another.",
            style = MaterialTheme.typography.bodySmall, color = colors.onSurfaceVariant)
    }
}

@Composable
private fun RoomAttachmentOption(label: String, icon: ImageVector, modifier: Modifier, enabled: Boolean, onClick: () -> Unit) {
    Surface(onClick = onClick, enabled = enabled, modifier = modifier, shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.secondaryContainer.copy(alpha = if (enabled) .75f else .35f)) {
        Column(Modifier.padding(horizontal = 4.dp, vertical = 10.dp),
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Icon(icon, null, Modifier.size(25.dp), tint = MaterialTheme.colorScheme.primary)
            Text(label, style = MaterialTheme.typography.labelMedium, maxLines = 2)
        }
    }
}

@Composable
private fun RoomMessageTools(draft: RoomDraft, publishing: Boolean) {
    val colors = MaterialTheme.colorScheme
    Column(Modifier.fillMaxWidth().background(colors.surfaceContainerLow).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(5.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Format text", Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
            PostTextFormat.entries.forEach { format ->
                IconButton(onClick = {
                    val value = draft.editor
                    insertPostFormatting(value.text, value.selection.start, value.selection.end, format)?.let {
                        draft.edit(boundedRoomEditor(TextFieldValue(it.text, TextRange(it.selectionStart, it.selectionEnd)), 2000))
                    }
                }, enabled = !publishing && !draft.editor.selection.collapsed) {
                    Icon(when (format) {
                        PostTextFormat.BOLD -> Icons.Rounded.FormatBold
                        PostTextFormat.ITALIC -> Icons.Rounded.FormatItalic
                        PostTextFormat.UNDERLINE -> Icons.Rounded.FormatUnderlined
                        PostTextFormat.STRIKETHROUGH -> Icons.Rounded.StrikethroughS
                    }, format.label)
                }
            }
        }
        if (draft.editor.selection.collapsed) Text("Select message text to apply formatting.",
            style = MaterialTheme.typography.bodySmall, color = colors.onSurfaceVariant)
    }
}

@Composable
private fun RoomReplyQuote(post: NativeRoomPost, closeEnabled: Boolean, onClose: () -> Unit) {
    val colors = MaterialTheme.colorScheme
    Row(Modifier.fillMaxWidth().background(colors.surfaceContainerLow).padding(start = 13.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Icon(Icons.AutoMirrored.Rounded.Reply, null, tint = colors.primary)
        Column(Modifier.weight(1f).padding(vertical = 6.dp)) {
            Text("Reply to ${post.authorName}", style = MaterialTheme.typography.labelLarge, color = colors.primary,
                maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(post.body.ifBlank { "Media attachment" }, style = MaterialTheme.typography.bodySmall,
                maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        IconButton(onClick = onClose, enabled = closeEnabled) { Icon(Icons.Rounded.Close, "Cancel reply") }
    }
}

@Composable
private fun RoomAttachmentTile(item: RoomDraftMedia, enabled: Boolean, onDetails: () -> Unit, onRemove: () -> Unit) {
    val context = LocalContext.current
    val source = item.source
    val thumbnail by produceState<Bitmap?>(null, source) {
        if (source != null && Build.VERSION.SDK_INT >= 29) {
            value = withContext(Dispatchers.IO) {
                runCatching { context.contentResolver.loadThumbnail(source, Size(160, 160), null) }.getOrNull()
            }
        }
    }
    val colors = MaterialTheme.colorScheme
    Surface(shape = RoundedCornerShape(14.dp), color = colors.surfaceContainer) {
        Row(Modifier.padding(start = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Surface(onClick = onDetails, enabled = enabled, color = colors.surfaceContainer) {
                Row(Modifier.padding(vertical = 5.dp), horizontalArrangement = Arrangement.spacedBy(7.dp),
                    verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(42.dp).clip(RoundedCornerShape(9.dp)).background(colors.secondaryContainer),
                        contentAlignment = Alignment.Center) {
                        if (thumbnail != null) Image(checkNotNull(thumbnail).asImageBitmap(), null,
                            Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
                        else Icon(if (item.kind == "video") Icons.Rounded.Videocam else Icons.Rounded.Image,
                            null, tint = colors.primary)
                    }
                    Column(Modifier.widthIn(max = 96.dp)) {
                        Text(if (item.kind == "video") "Video" else "Photo", style = MaterialTheme.typography.labelLarge)
                        Text(if (item.status == "Uploading") "${item.progress}%" else item.status,
                            style = MaterialTheme.typography.labelSmall,
                            color = if (item.error != null) colors.error else colors.onSurfaceVariant)
                    }
                }
            }
            IconButton(onClick = onRemove, enabled = enabled) {
                Icon(Icons.Rounded.Close, "Remove ${item.label}", Modifier.size(18.dp))
            }
        }
    }
}

@Composable
private fun RoomAttachmentDetails(item: RoomDraftMedia, publishing: Boolean, onDismiss: () -> Unit,
    onAlt: (String) -> Unit, onRetry: (() -> Unit)?) {
    AlertDialog(onDismissRequest = onDismiss, title = { Text(if (item.kind == "video") "Video attachment" else "Photo attachment") },
        text = {
            if (item.ready != null) OutlinedTextField(item.alt, onAlt, label = { Text("Alt text") },
                enabled = !publishing, modifier = Modifier.fillMaxWidth())
            else Text(item.error ?: item.status)
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Done") } },
        dismissButton = if (item.error != null && onRetry != null) ({
            TextButton(onClick = onRetry, enabled = !publishing) { RoomActionLabel("Retry upload", Icons.Rounded.Refresh) }
        }) else null)
}

private fun roomDraftReady(draft: RoomDraft): Boolean =
    (draft.editor.text.isNotBlank() || draft.media.isNotEmpty()) &&
        draft.editor.text.length <= 2000 && !draft.uploading &&
        draft.media.all { it.ready != null && it.alt.length <= 1000 }

private fun boundedRoomEditor(value: TextFieldValue, maxLength: Int): TextFieldValue {
    if (value.text.length <= maxLength) return value
    val text = value.text.take(maxLength)
    return TextFieldValue(text, TextRange(value.selection.start.coerceAtMost(text.length),
        value.selection.end.coerceAtMost(text.length)))
}
