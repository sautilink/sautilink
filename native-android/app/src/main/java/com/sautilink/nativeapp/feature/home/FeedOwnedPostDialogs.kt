package com.sautilink.nativeapp.feature.home

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.DeleteOutline
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.feature.posts.NativeOwnPost
import com.sautilink.nativeapp.feature.stickers.NativeStickerDraftPreview
import com.sautilink.nativeapp.feature.stickers.editStickerCaption
import com.sautilink.nativeapp.feature.stickers.stickerCaption
import com.sautilink.nativeapp.ui.components.SautiIcon as Icon

@Composable
internal fun FeedOwnerPostMenuItems(ownsPost: Boolean, enabled: Boolean, onEdit: () -> Unit, onDelete: () -> Unit) {
    if (!ownsPost) return
    DropdownMenuItem(text = { Text("Edit post") }, enabled = enabled,
        leadingIcon = { Icon(Icons.Rounded.Edit, null) }, onClick = onEdit)
    DropdownMenuItem(text = { Text("Delete post", color = MaterialTheme.colorScheme.error) }, enabled = enabled,
        leadingIcon = { Icon(Icons.Rounded.DeleteOutline, null, tint = MaterialTheme.colorScheme.error) }, onClick = onDelete)
    HorizontalDivider()
}

@Composable
internal fun FeedEditPostDialog(post: NativeOwnPost?, body: String, loading: Boolean, busy: Boolean,
    online: Boolean, error: String?, onBodyChange: (String) -> Unit, onCancel: () -> Unit, onSave: () -> Unit) {
    val editable = post != null && post.editCount == 0 && post.body.isNotBlank()
    AlertDialog(onDismissRequest = { if (!busy) onCancel() }, title = { Text("Edit post") },
        text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
            else if (editable) {
                Text("Posts can be edited once. Media and audience stay the same.")
                OutlinedTextField(stickerCaption(TextFieldValue(body)).text,
                    { onBodyChange(editStickerCaption(body, TextFieldValue(it), 2000).text) },
                    label = { Text("Caption") }, minLines = 3, maxLines = 8, enabled = !busy,
                    supportingText = { Text("${body.length}/2000") })
                NativeStickerDraftPreview(body, !busy, onBodyChange)
            } else if (post != null) Text(if (post.editCount > 0) "This post has already used its edit."
                else "Only posts with an existing caption can be edited.")
            if (error != null) Text(error, color = MaterialTheme.colorScheme.error)
        } },
        confirmButton = { TextButton(onClick = onSave, enabled = editable && !loading && !busy && online &&
            body.trim().isNotEmpty() && body.trim().length <= 2000 && body.trim() != post?.body) { Text(if (busy) "Saving…" else "Save changes") } },
        dismissButton = { TextButton(onClick = onCancel, enabled = !busy) { Text("Cancel") } })
}

@Composable
internal fun FeedDeletePostDialog(busy: Boolean, online: Boolean, error: String?, onCancel: () -> Unit, onDelete: () -> Unit) {
    AlertDialog(onDismissRequest = { if (!busy) onCancel() }, title = { Text("Delete post?") },
        text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("This cannot be undone.")
            if (error != null) Text(error, color = MaterialTheme.colorScheme.error)
        } },
        confirmButton = { TextButton(onClick = onDelete, enabled = !busy && online) { Text(if (busy) "Deleting…" else "Delete") } },
        dismissButton = { TextButton(onClick = onCancel, enabled = !busy) { Text("Cancel") } })
}
