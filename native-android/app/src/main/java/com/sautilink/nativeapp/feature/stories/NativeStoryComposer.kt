package com.sautilink.nativeapp.feature.stories

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.posts.NativeComposerMediaPreview
import com.sautilink.nativeapp.feature.posts.NativeEditedMedia
import com.sautilink.nativeapp.feature.posts.NativeMediaEditor
import com.sautilink.nativeapp.ui.components.SautiIcon as Icon
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import java.io.File

@Composable
internal fun NativeStoryComposer(auth: StagingAuthClient, quota: NativeStoryQuota,
    onClose: () -> Unit, onPublished: () -> Unit) {
    val accountId = auth.account?.id
    val context = LocalContext.current
    val client = remember(auth) { NativeStoriesClient(auth) }
    val scope = rememberCoroutineScope()
    var source by remember(accountId) { mutableStateOf<Uri?>(null) }
    var video by remember(accountId) { mutableStateOf(false) }
    var edited by remember(accountId) { mutableStateOf<NativeEditedMedia?>(null) }
    var uploadKey by remember(accountId) { mutableStateOf(java.util.UUID.randomUUID().toString()) }
    var editor by remember(accountId) { mutableStateOf(false) }
    var exporting by remember(accountId) { mutableStateOf(false) }
    var publishing by remember(accountId) { mutableStateOf(false) }
    var progress by remember(accountId) { mutableIntStateOf(0) }
    var caption by remember(accountId) { mutableStateOf("") }
    var error by remember(accountId) { mutableStateOf<String?>(null) }
    var dismissConfirm by remember { mutableStateOf(false) }
    val ownedFiles = remember(accountId) { mutableSetOf<File>() }
    DisposableEffect(accountId) { onDispose { ownedFiles.forEach { it.delete() } } }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) {
            val isVideo = context.contentResolver.getType(uri)?.startsWith("video/") == true
            if (!NativeStoryPolicy.canCreate(if (isVideo) "video" else "image", quota.imagesUsed, quota.videosUsed)) {
                error = if (isVideo) "You've used today's two video stories. Try again after the daily reset."
                    else "You've used today's four photo stories. Try again after the daily reset."
            } else {
                source = uri; video = isVideo; editor = true; error = null
            }
        }
    }
    fun requestClose() {
        if (publishing || exporting) return
        if (edited != null || caption.isNotBlank()) dismissConfirm = true else onClose()
    }
    Dialog(onDismissRequest = ::requestClose, properties = DialogProperties(usePlatformDefaultWidth = false, dismissOnClickOutside = false)) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            Column(Modifier.fillMaxSize().safeDrawingPadding().imePadding()) {
                Row(Modifier.padding(horizontal = 8.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = ::requestClose, enabled = !publishing && !exporting) { Icon(Icons.Rounded.Close, "Close story composer") }
                    Text("Create story", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                    TextButton(onClick = {
                        val media = edited ?: return@TextButton
                        publishing = true; error = null; progress = 0
                        scope.launch {
                            try {
                                client.publish(context, media.uri, if (video) "video" else "image", caption, uploadKey) { progress = it }
                                if (auth.account?.id == accountId) onPublished()
                            } catch (cancelled: CancellationException) { throw cancelled }
                            catch (failure: Exception) { error = failure.message ?: "Your story could not be published. Try again." }
                            finally { publishing = false }
                        }
                    }, enabled = edited != null && !publishing && !exporting && accountId != null) {
                        Icon(Icons.Rounded.Send, null, Modifier.size(19.dp)); Spacer(Modifier.width(6.dp)); Text("Share")
                    }
                }
                Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                        Icon(Icons.Rounded.Public, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(18.dp))
                        Text("Public · Expires after 24 hours", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    edited?.let { media -> NativeComposerMediaPreview(media.uri, video, "Story") }
                    if (edited == null) Surface(shape = androidx.compose.foundation.shape.RoundedCornerShape(24.dp), color = MaterialTheme.colorScheme.surfaceContainer) {
                        Column(Modifier.fillMaxWidth().padding(vertical = 42.dp, horizontal = 20.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            Icon(Icons.Rounded.AddPhotoAlternate, null, Modifier.size(44.dp), tint = MaterialTheme.colorScheme.primary)
                            Text("Share a little moment", style = MaterialTheme.typography.titleMedium)
                            Text("Crop and filter a photo, or trim a video to 30 seconds.", style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        OutlinedButton(onClick = { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo)) }, enabled = !publishing && !exporting) {
                            Icon(Icons.Rounded.PhotoLibrary, null, Modifier.size(19.dp)); Spacer(Modifier.width(7.dp)); Text(if (edited == null) "Choose media" else "Replace media")
                        }
                        if (source != null && edited != null) TextButton(onClick = { editor = true }, enabled = !publishing) {
                            Icon(Icons.Rounded.Edit, null, Modifier.size(19.dp)); Spacer(Modifier.width(6.dp)); Text(if (video) "Trim" else "Edit photo")
                        }
                    }
                    OutlinedTextField(value = caption, onValueChange = { caption = it.take(NativeStoryPolicy.MAX_CAPTION) },
                        modifier = Modifier.fillMaxWidth(), label = { Text("Caption (optional)") }, minLines = 2, maxLines = 5,
                        enabled = !publishing, supportingText = { Text("${caption.length}/${NativeStoryPolicy.MAX_CAPTION}") },
                        shape = androidx.compose.foundation.shape.RoundedCornerShape(18.dp))
                    Text("Daily limit: 4 photos and 2 videos. Deleting a story does not reset this limit.",
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (publishing) {
                        LinearProgressIndicator(progress = { progress / 100f }, modifier = Modifier.fillMaxWidth())
                        Text(if (progress < 100) "Uploading your story… $progress%" else "Preparing your story…", style = MaterialTheme.typography.bodySmall)
                    }
                    if (error != null) Text(error.orEmpty(), color = MaterialTheme.colorScheme.error)
                    Spacer(Modifier.height(16.dp))
                }
            }
        }
    }
    if (editor && source != null) NativeMediaEditor(source!!, video, onCancel = { editor = false },
        onExportActivity = { exporting = it }, onUse = { result ->
            edited?.ownedFile?.takeUnless { it == result.ownedFile }?.let { it.delete(); ownedFiles.remove(it) }
            result.ownedFile?.let(ownedFiles::add); edited = result; uploadKey = java.util.UUID.randomUUID().toString(); editor = false
        }, maximumVideoMs = NativeStoryPolicy.MAX_VIDEO_MS, storyPhoto = !video)
    if (dismissConfirm) AlertDialog(onDismissRequest = { dismissConfirm = false }, title = { Text("Discard this story?") },
        text = { Text("Your photo and video originals will stay on your device.") },
        confirmButton = { TextButton(onClick = { dismissConfirm = false; onClose() }) { Text("Discard", color = MaterialTheme.colorScheme.error) } },
        dismissButton = { TextButton(onClick = { dismissConfirm = false }) { Text("Keep editing") } })
}
