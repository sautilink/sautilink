package com.sautilink.nativeapp.feature.home

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import com.sautilink.nativeapp.ui.components.SautiIcon as Icon
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.safety.NativeReportDialog
import com.sautilink.nativeapp.feature.safety.NativeSafetyClient
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/** Keep the feed and its decoder mounted while opening post controls. */
@Composable
internal fun FeedPostOptions(
    post: StagingFeedPost, auth: StagingAuthClient, online: Boolean,
    onOpenProfile: () -> Unit, onOpenPost: () -> Unit, onShare: () -> Unit,
    onUpdated: (String) -> Unit = {}, onDeleted: () -> Unit = {}
) {
    val accountId = auth.account?.id
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val safety = remember(auth) { NativeSafetyClient(auth) }
    var expanded by remember(post.id, accountId) { mutableStateOf(false) }
    var reportOpen by remember(post.id, accountId) { mutableStateOf(false) }
    var busy by remember(post.id, accountId) { mutableStateOf(false) }
    var error by remember(post.id, accountId) { mutableStateOf<String?>(null) }
    var submitted by remember(post.id, accountId) { mutableStateOf(false) }
    val ownsPost = accountId != null && post.authorId == accountId
    val postClient = remember(auth) { lazy { com.sautilink.nativeapp.feature.posts.NativePostsClient(auth) } }
    var editOpen by remember(post.id, accountId) { mutableStateOf(false) }
    var deleteOpen by remember(post.id, accountId) { mutableStateOf(false) }
    var editLoading by remember(post.id, accountId) { mutableStateOf(false) }
    var ownPost by remember(post.id, accountId) { mutableStateOf<com.sautilink.nativeapp.feature.posts.NativeOwnPost?>(null) }
    var editBody by remember(post.id, accountId) { mutableStateOf("") }
    LaunchedEffect(editOpen, post.id, accountId) {
        if (!editOpen || !ownsPost) return@LaunchedEffect
        editLoading = true; error = null; ownPost = null
        try {
            val loaded = postClient.value.ownPost(post.id)
            if (auth.account?.id == accountId) { ownPost = loaded; editBody = loaded.body }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) { error = failure.message ?: "Could not load this post." }
        finally { editLoading = false }
    }
    Box {
        IconButton(onClick = { expanded = true }, modifier = Modifier.size(48.dp)) {
            Icon(Icons.Rounded.MoreHoriz, contentDescription = "Post options", modifier = Modifier.size(23.dp))
        }
        DropdownMenu(expanded, onDismissRequest = { expanded = false }) {
            FeedOwnerPostMenuItems(ownsPost, online && !busy,
                onEdit = { expanded = false; error = null; editOpen = true },
                onDelete = { expanded = false; error = null; deleteOpen = true })
            DropdownMenuItem(text = { Text("View profile") }, enabled = post.authorHandle.isNotBlank(),
                leadingIcon = { Icon(Icons.Rounded.PersonOutline, null) },
                onClick = { expanded = false; onOpenProfile() })
            DropdownMenuItem(text = { Text("Copy link") }, leadingIcon = { Icon(Icons.Rounded.Link, null) }, onClick = {
                expanded = false
                val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                clipboard.setPrimaryClip(ClipData.newPlainText("SautiLink post", "https://sautilink.com/post/${post.id}"))
            })
            DropdownMenuItem(text = { Text("Share") }, leadingIcon = { Icon(Icons.Rounded.Share, null) },
                onClick = { expanded = false; onShare() })
            DropdownMenuItem(text = { Text("View post") }, leadingIcon = { Icon(Icons.Rounded.Article, null) },
                onClick = { expanded = false; onOpenPost() })
            if (accountId != null && post.authorId != accountId) {
                HorizontalDivider()
                DropdownMenuItem(text = { Text("Report", color = MaterialTheme.colorScheme.error) },
                    leadingIcon = { Icon(Icons.Rounded.Flag, null, tint = MaterialTheme.colorScheme.error) },
                    enabled = online && !busy, onClick = { expanded = false; error = null; reportOpen = true })
            }
        }
    }
    if (editOpen && ownsPost) FeedEditPostDialog(ownPost, editBody, editLoading, busy, online, error,
        onBodyChange = { editBody = it; error = null }, onCancel = { editOpen = false }) {
        val target = ownPost ?: return@FeedEditPostDialog
        if (busy || !online || auth.account?.id != accountId) return@FeedEditPostDialog
        busy = true; error = null
        scope.launch {
            try {
                val updated = postClient.value.edit(target, editBody)
                if (auth.account?.id == accountId) { editOpen = false; onUpdated(updated.body) }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { error = failure.message ?: "Could not edit post. Try again." }
            finally { busy = false }
        }
    }
    if (deleteOpen && ownsPost) FeedDeletePostDialog(busy, online, error, onCancel = { deleteOpen = false }) {
        if (busy || !online || auth.account?.id != accountId) return@FeedDeletePostDialog
        busy = true; error = null
        scope.launch {
            try {
                postClient.value.delete(com.sautilink.nativeapp.feature.posts.NativeOwnPost(post.id, post.body,
                    post.createdAt, 0, post.mediaCount, "public"))
                if (auth.account?.id == accountId) { deleteOpen = false; onDeleted() }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { error = failure.message ?: "Could not delete post. Try again." }
            finally { busy = false }
        }
    }
    if (reportOpen) NativeReportDialog("post", busy, error,
        onDismiss = { if (!busy) reportOpen = false }) { reason, details ->
        if (busy || !online || auth.account?.id != accountId) return@NativeReportDialog
        busy = true
        error = null
        scope.launch {
            try {
                safety.report("post", post.id, reason, details)
                if (auth.account?.id == accountId) { reportOpen = false; submitted = true }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) {
                if (auth.account?.id == accountId) error = failure.message ?: "Could not report post."
            } finally { busy = false }
        }
    }
    if (submitted) AlertDialog(onDismissRequest = { submitted = false },
        title = { Text("Report submitted") }, text = { Text("A safety reviewer will assess your report.") },
        confirmButton = { TextButton(onClick = { submitted = false }) { Text("Done") } })
}
