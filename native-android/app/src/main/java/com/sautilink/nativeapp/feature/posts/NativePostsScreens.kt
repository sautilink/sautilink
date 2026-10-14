package com.sautilink.nativeapp.feature.posts

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.ui.theme.SautiShape
import kotlinx.coroutines.launch
import java.util.UUID

private data class ComposerMediaItem(val localId: String, val uri: Uri, val label: String,
    val status: String = "Preparing", val progress: Int = 0, val ready: NativeReadyMedia? = null,
    val altText: String = "", val error: String? = null)

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
    val inFlight = busy || mediaItems.any { it.status == "Preparing" || it.status == "Uploading" }
    SideEffect { onUploadActivity(inFlight) }
    LaunchedEffect(auth.account?.id) {
        if (auth.account != null) previousUploads = runCatching { mediaClient.pendingReady() }.getOrDefault(emptyList())
    }
    fun updateItem(id: String, change: (ComposerMediaItem) -> ComposerMediaItem) {
        mediaItems = mediaItems.map { if (it.localId == id) change(it) else it }
    }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(4)) { selected ->
        val available = (4 - mediaItems.size).coerceAtLeast(0)
        selected.take(available).forEach { uri ->
            val localId = UUID.randomUUID().toString()
            val kind = if (context.contentResolver.getType(uri)?.startsWith("video/") == true) "Video" else "Image"
            mediaItems = mediaItems + ComposerMediaItem(localId, uri, "$kind ${mediaItems.size + 1}")
            scope.launch {
                try {
                    val ready = mediaClient.upload(uri) { value -> updateItem(localId) { it.copy(status = "Uploading", progress = value) } }
                    if (mediaItems.none { it.localId == localId }) mediaClient.remove(ready.id)
                    else updateItem(localId) { it.copy(status = "Ready", progress = 100, ready = ready) }
                } catch (e: Exception) {
                    updateItem(localId) { it.copy(status = "Failed", error = e.message ?: "Upload failed.") }
                }
            }
        }
    }
    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).imePadding()
        .padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Create a post", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
            TextButton(onClick = onDismiss, enabled = !inFlight) { Text("Close") }
        }
        if (auth.account == null) {
            Text("Sign in to publish on SautiLink.")
            Button(onClick = onSignIn) { Text("Sign in") }
        } else {
            OutlinedTextField(draft, { onDraftChange(it.take(2001)) }, label = { Text("What's happening?") },
                supportingText = { Text("${draft.length}/2000") }, minLines = 4,
                modifier = Modifier.fillMaxWidth(), enabled = !busy)
            OutlinedButton(onClick = { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo)) },
                enabled = !busy && mediaItems.size < 4) { Text("Add images or video (${mediaItems.size}/4)") }
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
                                mediaItems = mediaItems.filterNot { it.localId == item.localId }
                                item.ready?.let { ready -> scope.launch { mediaClient.remove(ready.id) } }
                            }, enabled = !busy) { Text("Remove") }
                        }
                        Text("${item.status}${if (item.status == "Uploading") " ${item.progress}%" else ""}",
                            style = MaterialTheme.typography.bodySmall)
                        if (item.status == "Uploading") LinearProgressIndicator(progress = { item.progress / 100f },
                            modifier = Modifier.fillMaxWidth())
                        if (item.error != null) Text(item.error, color = MaterialTheme.colorScheme.error)
                        if (item.ready != null) OutlinedTextField(item.altText,
                            { value -> updateItem(item.localId) { it.copy(altText = value.take(1001)) } },
                            label = { Text("Alt text (optional)") }, modifier = Modifier.fillMaxWidth(),
                            supportingText = { Text("${item.altText.length}/1000") })
                    }
                }
            }
            Text("Audience", style = MaterialTheme.typography.labelLarge)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(selected = visibility == "public", onClick = { visibility = "public" }, label = { Text("Public") })
                FilterChip(selected = visibility == "followers", onClick = { visibility = "followers" }, label = { Text("Followers") })
            }
            Text("Who can comment?", style = MaterialTheme.typography.labelLarge)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(selected = replyAccess == "everyone", onClick = { replyAccess = "everyone" }, label = { Text("Everyone") })
                FilterChip(selected = replyAccess == "following", onClick = { replyAccess = "following" }, label = { Text("Following") })
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
                Text(if (busy) "Publishing…" else "Publish post")
            }
        }
        Spacer(Modifier.height(20.dp))
    }
}

@Composable
fun NativeOwnPostsScreen(auth: StagingAuthClient, refreshKey: Int, onBack: () -> Unit, onCreate: () -> Unit) {
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
        if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
        LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (error != null) item { Text(error.orEmpty(), color = MaterialTheme.colorScheme.error) }
            item { Button(onClick = onCreate, shape = SautiShape.Pill) { Text("Create a post") } }
            if (!loading && error == null && posts.isEmpty()) item { Text("You have no posts yet.") }
            items(posts, key = { it.id }) { post ->
                Surface(shape = SautiShape.Card, color = MaterialTheme.colorScheme.surfaceContainer) {
                    Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text(post.body.ifBlank { "Media post" }, style = MaterialTheme.typography.bodyLarge)
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
                    try { client.delete(post); posts = posts.filterNot { it.id == post.id }; deleteTarget = null }
                    catch (e: Exception) { error = e.message ?: "Could not delete post."; deleteTarget = null }
                    finally { busyId = null }
                }
            }, enabled = busyId == null) { Text("Delete") } },
            dismissButton = { TextButton(onClick = { deleteTarget = null }, enabled = busyId == null) { Text("Cancel") } })
    }
}
