package com.sautilink.nativeapp.feature.posts

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import com.sautilink.nativeapp.ui.components.SautiIcon as Icon
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.SoftwareKeyboardController
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.ui.components.SautiPostText
import com.sautilink.nativeapp.ui.text.PostTextFormat
import com.sautilink.nativeapp.ui.text.insertPostFormatting
import com.sautilink.nativeapp.ui.theme.SautiShape
import kotlinx.coroutines.launch
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import java.io.File
import java.util.UUID

private data class ComposerMediaItem(val localId: String, val uri: Uri, val label: String,
    val status: String = "Edit", val progress: Int = 0, val ready: NativeReadyMedia? = null,
    val altText: String = "", val error: String? = null, val video: Boolean = false,
    val previewUri: Uri = uri, val localExport: File? = null)

@Composable
fun NativePostComposer(auth: StagingAuthClient, draft: String, onDraftChange: (String) -> Unit,
    onDismiss: () -> Unit, onPublished: (String) -> Unit, onSignIn: () -> Unit,
    onUploadActivity: (Boolean) -> Unit = {}) {
    val client = remember(auth) { NativePostsClient(auth) }
    val context = LocalContext.current
    val mediaClient = remember(auth, context) { NativeMediaClient(auth, context.applicationContext) }
    val scope = rememberCoroutineScope()
    var visibility by remember { mutableStateOf("public") }
    var replyAccess by remember { mutableStateOf("everyone") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var mediaItems by remember { mutableStateOf<List<ComposerMediaItem>>(emptyList()) }
    var previousUploads by remember { mutableStateOf<List<NativeReadyMedia>>(emptyList()) }
    var editingId by remember { mutableStateOf<String?>(null) }
    val uploadJobs = remember { mutableMapOf<String, Job>() }
    val localExports = remember { mutableSetOf<File>() }
    DisposableEffect(Unit) {
        onDispose {
            uploadJobs.values.toList().forEach { it.cancel() }
            localExports.forEach { it.delete() }
            // Ready remote objects remain recoverable through the existing pending-upload flow.
        }
    }
    // Keep active IME text/selection local; the parent String mirror seeds a reopened composer.
    var editor by remember { mutableStateOf(TextFieldValue(draft, TextRange(draft.length))) }
    var previewOpen by remember { mutableStateOf(false) }
    val editorFocus = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    val inFlight = busy || mediaItems.any { it.status in setOf("Preparing", "Uploading", "Exporting") }
    SideEffect { onUploadActivity(inFlight) }
    LaunchedEffect(auth.account?.id) {
        if (auth.account != null) previousUploads = runCatching { mediaClient.pendingReady() }.getOrDefault(emptyList())
    }
    fun updateItem(id: String, change: (ComposerMediaItem) -> ComposerMediaItem) {
        mediaItems = mediaItems.map { if (it.localId == id) change(it) else it }
    }
    fun removeItem(item: ComposerMediaItem) {
        uploadJobs.remove(item.localId)?.cancel()
        mediaItems = mediaItems.filterNot { it.localId == item.localId }
        item.localExport?.let { it.delete(); localExports.remove(it) }
        item.ready?.let { ready -> scope.launch { mediaClient.remove(ready.id) } }
        if (editingId == item.localId) editingId = null
    }
    fun uploadEdited(id: String, edited: NativeEditedMedia) {
        edited.ownedFile?.let(localExports::add)
        updateItem(id) { it.copy(status = "Preparing", progress = 0, error = null, previewUri = edited.uri, localExport = edited.ownedFile) }
        uploadJobs[id] = scope.launch {
            try {
                val ready = mediaClient.upload(edited.uri) { value -> updateItem(id) { it.copy(status = "Uploading", progress = value) } }
                if (mediaItems.none { it.localId == id }) mediaClient.remove(ready.id)
                else updateItem(id) { it.copy(status = "Ready", progress = 100, ready = ready) }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (error: Exception) { updateItem(id) { it.copy(status = "Failed", error = error.message ?: "Upload failed.") } }
            finally { uploadJobs.remove(id) }
        }
    }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(4)) { selected ->
        val available = (4 - mediaItems.size).coerceAtLeast(0)
        selected.take(available).forEach { uri ->
            val localId = UUID.randomUUID().toString()
            val video = context.contentResolver.getType(uri)?.startsWith("video/") == true
            val kind = if (video) "Video" else "Image"
            mediaItems = mediaItems + ComposerMediaItem(localId, uri, "$kind ${mediaItems.size + 1}", video = video)
        }
    }
    LaunchedEffect(mediaItems.map { it.localId to it.status }, editingId) {
        if (editingId == null) editingId = mediaItems.firstOrNull { it.status == "Edit" }?.localId
    }
    mediaItems.firstOrNull { it.localId == editingId }?.let { item ->
        key(item.localId) {
            NativeMediaEditor(item.uri, item.video, onCancel = { removeItem(item) },
                onExportActivity = { exporting -> updateItem(item.localId) { it.copy(status = if (exporting) "Exporting" else if (it.status == "Exporting") "Edit" else it.status) } },
                onUse = { edited -> editingId = null; uploadEdited(item.localId, edited) })
        }
    }
    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).imePadding()
        .padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Rounded.EditNote, null, tint = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.width(10.dp))
            Text("Create a post", style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
            IconButton(onClick = onDismiss, enabled = !inFlight) { Icon(Icons.Rounded.Close, "Close composer") }
        }
        if (auth.account == null) {
            Text("Sign in to publish on SautiLink.")
            Button(onClick = onSignIn) { Text("Sign in") }
        } else {
            PostComposerTextEditor(editor, draft.length, previewOpen, !busy, editorFocus,
                onValueChange = { value ->
                    editor = value.copy(text = value.text.take(2001))
                    onDraftChange(editor.text)
                }, onFormat = { format ->
                    applyComposerFormatting(format, editor, { value ->
                        editor = value
                        onDraftChange(value.text)
                        previewOpen = true
                    }, editorFocus, keyboard)
                }, onPreviewToggle = { previewOpen = !previewOpen })
            OutlinedButton(onClick = { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo)) },
                shape = SautiShape.Pill, enabled = !busy && mediaItems.size < 4) {
                Icon(Icons.Rounded.PhotoLibrary, null, Modifier.size(20.dp))
                Spacer(Modifier.width(8.dp))
                Text("Add images or video (${mediaItems.size}/4)")
            }
            if (previousUploads.isNotEmpty()) {
                Text("Unfinished uploads", style = MaterialTheme.typography.titleSmall)
                Text("Use or discard media uploaded earlier. Unattached uploads expire after one hour.",
                    style = MaterialTheme.typography.bodySmall)
                previousUploads.forEach { pending ->
                    Row(verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(pending.kind.replaceFirstChar { it.uppercase() }, modifier = Modifier.weight(1f))
                        TextButton(onClick = {
                            if (mediaItems.size < 4) {
                                mediaItems = mediaItems + ComposerMediaItem(UUID.randomUUID().toString(), Uri.EMPTY,
                                    "Recovered ${pending.kind}", status = "Ready", progress = 100, ready = pending)
                                previousUploads = previousUploads.filterNot { it.id == pending.id }
                            }
                        }, enabled = mediaItems.size < 4) { Text("Use") }
                        TextButton(onClick = {
                            previousUploads = previousUploads.filterNot { it.id == pending.id }
                            scope.launch { mediaClient.remove(pending.id) }
                        }) { Text("Discard") }
                    }
                }
            }
            mediaItems.forEach { item ->
                Surface(shape = SautiShape.Card, color = MaterialTheme.colorScheme.surfaceContainer) {
                    Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(item.label, modifier = Modifier.weight(1f), fontWeight = FontWeight.SemiBold)
                            TextButton(onClick = {
                                removeItem(item)
                            }, enabled = !busy) { Text("Remove") }
                        }
                        NativeComposerMediaPreview(item.previewUri, item.video || item.ready?.kind == "video", item.label)
                        Text("${item.status}${if (item.status == "Uploading") " ${item.progress}%" else ""}",
                            style = MaterialTheme.typography.bodySmall)
                        if (item.status == "Uploading") LinearProgressIndicator(progress = { item.progress / 100f },
                            modifier = Modifier.fillMaxWidth())
                        if (item.error != null) Text(item.error, color = MaterialTheme.colorScheme.error)
                        if (item.status == "Failed") TextButton(onClick = { uploadEdited(item.localId, NativeEditedMedia(item.previewUri, item.localExport)) }) {
                            Icon(Icons.Rounded.Refresh, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text("Retry upload")
                        }
                        if (item.ready != null) OutlinedTextField(item.altText,
                            { value -> updateItem(item.localId) { it.copy(altText = value.take(1001)) } },
                            label = { Text("Alt text (optional)") }, modifier = Modifier.fillMaxWidth(),
                            supportingText = { Text("${item.altText.length}/1000") })
                    }
                }
            }
            ComposerSectionTitle("Audience", Icons.Rounded.Public)
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(selected = visibility == "public", onClick = { visibility = "public" },
                    shape = SautiShape.Pill, label = { Text("Public") },
                    leadingIcon = { Icon(Icons.Rounded.Public, null, Modifier.size(18.dp), selected = visibility == "public") })
                FilterChip(selected = visibility == "followers", onClick = { visibility = "followers" },
                    shape = SautiShape.Pill, label = { Text("Followers") },
                    leadingIcon = { Icon(Icons.Rounded.PeopleOutline, null, Modifier.size(18.dp), selected = visibility == "followers") })
            }
            ComposerSectionTitle("Who can comment?", Icons.Rounded.ChatBubbleOutline)
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(selected = replyAccess == "everyone", onClick = { replyAccess = "everyone" },
                    shape = SautiShape.Pill, label = { Text("Everyone") },
                    leadingIcon = { Icon(Icons.Rounded.Public, null, Modifier.size(18.dp), selected = replyAccess == "everyone") })
                FilterChip(selected = replyAccess == "following", onClick = { replyAccess = "following" },
                    shape = SautiShape.Pill, label = { Text("Following") },
                    leadingIcon = { Icon(Icons.Rounded.PeopleOutline, null, Modifier.size(18.dp), selected = replyAccess == "following") })
            }
            if (error != null) Text(error.orEmpty(), color = MaterialTheme.colorScheme.error)
            Button(onClick = {
                busy = true; error = null
                scope.launch {
                    try { onPublished(client.create(draft, visibility, replyAccess,
                        mediaItems.mapNotNull { it.ready?.copy(altText = it.altText) })) }
                    catch (e: Exception) { error = e.message ?: "Could not publish post." }
                    finally { busy = false }
                }
            }, enabled = !busy && (draft.trim().isNotEmpty() || mediaItems.any { it.ready != null }) &&
                draft.trim().length <= 2000 && mediaItems.all { it.ready != null && it.altText.length <= 1000 },
                modifier = Modifier.fillMaxWidth().height(50.dp), shape = SautiShape.Pill) {
                Icon(Icons.Rounded.Send, null, Modifier.size(19.dp))
                Spacer(Modifier.width(8.dp))
                Text(if (busy) "Publishing…" else "Publish post")
            }
        }
        Spacer(Modifier.height(20.dp))
    }
}

@Composable
private fun ComposerSectionTitle(label: String, icon: androidx.compose.ui.graphics.vector.ImageVector) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Icon(icon, null, Modifier.size(19.dp), tint = MaterialTheme.colorScheme.primary)
        Text(label, style = MaterialTheme.typography.labelLarge)
    }
}

private fun applyComposerFormatting(format: PostTextFormat, editor: TextFieldValue,
    onFormatted: (TextFieldValue) -> Unit, focus: FocusRequester, keyboard: SoftwareKeyboardController?) {
    val result = insertPostFormatting(editor.text, editor.selection.start, editor.selection.end, format) ?: return
    onFormatted(TextFieldValue(result.text, TextRange(result.selectionStart, result.selectionEnd)))
    focus.requestFocus()
    keyboard?.show()
}

/** Stateless editor controls keep formatting analysis separate from the media/upload composer. */
@Composable
private fun PostComposerTextEditor(editor: TextFieldValue, draftLength: Int,
    previewOpen: Boolean, enabled: Boolean, focus: FocusRequester,
    onValueChange: (TextFieldValue) -> Unit, onFormat: (PostTextFormat) -> Unit,
    onPreviewToggle: () -> Unit) {
    OutlinedTextField(editor, onValueChange, label = { Text("What's happening?") },
        supportingText = { Text("$draftLength/2000") }, minLines = 4,
        shape = SautiShape.Card,
        textStyle = MaterialTheme.typography.bodyMedium.copy(fontSize = 16.sp, lineHeight = 22.sp),
        modifier = Modifier.fillMaxWidth().focusRequester(focus), enabled = enabled)
    ComposerSectionTitle("Text style", Icons.Rounded.TextFields)
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        PostTextFormat.entries.forEach { format ->
            val insertion = insertPostFormatting(editor.text, editor.selection.start, editor.selection.end, format)
            IconButton(onClick = { onFormat(format) }, enabled = enabled && insertion != null,
                modifier = Modifier.semantics { contentDescription = "${format.label} selected text" }) {
                Text(format.glyph, style = MaterialTheme.typography.titleMedium.copy(
                    fontWeight = if (format == PostTextFormat.BOLD) FontWeight.Bold else null,
                    fontStyle = if (format == PostTextFormat.ITALIC) FontStyle.Italic else null,
                    textDecoration = when (format) {
                        PostTextFormat.UNDERLINE -> TextDecoration.Underline
                        PostTextFormat.STRIKETHROUGH -> TextDecoration.LineThrough
                        else -> null
                    }))
            }
        }
        TextButton(onClick = onPreviewToggle, enabled = enabled,
            modifier = Modifier.weight(1f).semantics {
                stateDescription = if (previewOpen) "Expanded" else "Collapsed"
            }) { Text("Preview") }
    }
    if (previewOpen) Surface(shape = SautiShape.Card, color = MaterialTheme.colorScheme.surfaceContainer) {
        Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("Post preview", style = MaterialTheme.typography.labelSmall)
            SautiPostText(editor.text.ifBlank { "Your post will appear here." }, style = MaterialTheme.typography.bodyLarge, linkEntities = false)
        }
    }
}

@Composable
fun NativeOwnPostsScreen(auth: StagingAuthClient, refreshKey: Int, onBack: () -> Unit, onCreate: () -> Unit,
    onChanged: () -> Unit = {}) {
    val client = remember(auth) { NativePostsClient(auth) }
    val scope = rememberCoroutineScope()
    var refresh by remember { mutableIntStateOf(0) }
    var posts by remember { mutableStateOf<List<NativeOwnPost>>(emptyList()) }
    var loading by remember(auth.account?.id) { mutableStateOf(auth.account != null) }
    var error by remember { mutableStateOf<String?>(null) }
    var busyId by remember { mutableStateOf<String?>(null) }
    var editTarget by remember { mutableStateOf<NativeOwnPost?>(null) }
    var deleteTarget by remember { mutableStateOf<NativeOwnPost?>(null) }
    var editBody by remember { mutableStateOf("") }

    LaunchedEffect(client, auth.account?.id, refresh, refreshKey) {
        if (auth.account == null) return@LaunchedEffect
        loading = true; error = null
        try { posts = client.ownPosts() }
        catch (e: Exception) { error = e.message ?: "Could not load your posts." }
        finally { loading = false }
    }

    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back") }
            Text("My posts", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.weight(1f))
            IconButton(onClick = { refresh++ }, enabled = !loading) { Icon(Icons.Rounded.Refresh, "Refresh posts") }
        }
        Box(Modifier.fillMaxWidth().height(4.dp)) {
            if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
        }
        LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (error != null) item { Text(error.orEmpty(), color = MaterialTheme.colorScheme.error) }
            item { Button(onClick = onCreate, shape = SautiShape.Pill) { Text("Create a post") } }
            if (!loading && error == null && posts.isEmpty()) item { Text("You have no posts yet.") }
            items(posts, key = { it.id }) { post ->
                Surface(shape = SautiShape.Card, color = MaterialTheme.colorScheme.surfaceContainer) {
                    Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        SautiPostText(post.body.ifBlank { "Media post" }, style = MaterialTheme.typography.bodyLarge)
                        Text("${post.createdAt.take(10)} · ${post.visibility}" + if (post.editCount > 0) " · Edited" else "",
                            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            if (post.editCount == 0 && post.body.isNotBlank())
                                OutlinedButton(onClick = { editTarget = post; editBody = post.body }, enabled = busyId == null) { Text("Edit") }
                            OutlinedButton(onClick = { deleteTarget = post }, enabled = busyId == null) { Text("Delete") }
                        }
                    }
                }
            }
            if (posts.size >= 100) item { Text("Showing the latest 100 posts.") }
        }
    }

    editTarget?.let { post ->
        AlertDialog(onDismissRequest = { if (busyId == null) editTarget = null },
            title = { Text("Edit post") },
            text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Posts can be edited once. Media and audience stay the same.")
                OutlinedTextField(editBody, { editBody = it.take(2001) }, minLines = 4,
                    supportingText = { Text("${editBody.length}/2000") }, enabled = busyId == null)
            } },
            confirmButton = { TextButton(onClick = {
                busyId = post.id; error = null
                scope.launch {
                    try {
                        val updated = client.edit(post, editBody)
                        posts = posts.map { if (it.id == post.id) updated else it }
                        editTarget = null
                        onChanged()
                    } catch (e: Exception) { error = e.message ?: "Could not edit post."; editTarget = null }
                    finally { busyId = null }
                }
            }, enabled = busyId == null && editBody.trim().isNotEmpty() && editBody.trim().length <= 2000 &&
                editBody.trim() != post.body) { Text("Save changes") } },
            dismissButton = { TextButton(onClick = { editTarget = null }, enabled = busyId == null) { Text("Cancel") } })
    }

    deleteTarget?.let { post ->
        AlertDialog(onDismissRequest = { if (busyId == null) deleteTarget = null },
            title = { Text("Delete post?") },
            text = { Text("This cannot be undone.") },
            confirmButton = { TextButton(onClick = {
                busyId = post.id; error = null
                scope.launch {
                    try { client.delete(post); posts = posts.filterNot { it.id == post.id }; deleteTarget = null; onChanged() }
                    catch (e: Exception) { error = e.message ?: "Could not delete post."; deleteTarget = null }
                    finally { busyId = null }
                }
            }, enabled = busyId == null) { Text("Delete") } },
            dismissButton = { TextButton(onClick = { deleteTarget = null }, enabled = busyId == null) { Text("Cancel") } })
    }
}
