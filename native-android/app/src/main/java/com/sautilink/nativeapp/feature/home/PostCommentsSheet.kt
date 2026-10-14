package com.sautilink.nativeapp.feature.home

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.automirrored.rounded.Send
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.ui.components.SautiExploreSkeleton
import com.sautilink.nativeapp.ui.components.SautiCommentActions
import com.sautilink.nativeapp.ui.components.SautiVerificationBadge
import com.sautilink.nativeapp.ui.theme.SautiShape
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import org.json.JSONObject
import java.util.UUID

private val commentTrailSaver = listSaver<List<NativePostComment>, String>(
    save = { trail -> trail.map { comment -> JSONObject().apply {
        put("id", comment.id); put("author", comment.author); put("handle", comment.handle)
        put("body", comment.body); put("createdAt", comment.createdAt); put("authorId", comment.authorId)
        put("replyCount", comment.replyCount); put("verified", comment.verified); put("badgeType", comment.badgeType)
    }.toString() } },
    restore = { saved -> saved.map { text -> val item = JSONObject(text)
        NativePostComment(item.getString("id"), item.getString("author"), item.getString("handle"),
            item.getString("body"), item.getString("createdAt"), item.getString("authorId"),
            item.getInt("replyCount"), item.getBoolean("verified"), item.getString("badgeType"))
    } }
)

/** Production comments and nested replies share SautiLink's existing guarded APIs.
 * Staging can browse, but may never send or delete content.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun PostCommentsSheet(
    post: StagingFeedPost,
    actions: PostInteractionsClient,
    allowWrite: Boolean,
    signedInUserId: String?,
    onDismiss: () -> Unit,
    onRootPosted: () -> Unit,
    onRootDeleted: () -> Unit,
    onCommentChanged: () -> Unit
) {
    val scope = rememberCoroutineScope()
    // Each breadcrumb is a real social_posts UUID; navigating up stays inside this sheet.
    var trail by rememberSaveable(post.id, stateSaver = commentTrailSaver) { mutableStateOf<List<NativePostComment>>(emptyList()) }
    val parent = trail.lastOrNull()
    val targetId = parent?.id ?: post.id
    var comments by remember(post.id, targetId) { mutableStateOf<List<NativePostComment>>(emptyList()) }
    var loading by remember(post.id, targetId) { mutableStateOf(true) }
    var loadError by remember(post.id, targetId) { mutableStateOf<String?>(null) }
    var writeError by remember(post.id) { mutableStateOf<String?>(null) }
    var busySend by remember(post.id) { mutableStateOf(false) }
    var deletingId by remember(post.id) { mutableStateOf<String?>(null) }
    var confirmDelete by remember(post.id) { mutableStateOf<NativePostComment?>(null) }
    var refresh by remember(post.id) { mutableIntStateOf(0) }
    var selectedReactions by rememberSaveable(post.id) { mutableStateOf<Map<String, String>>(emptyMap()) }
    var busyReactionId by remember(post.id) { mutableStateOf<String?>(null) }
    var busyReactionKind by remember(post.id) { mutableStateOf<String?>(null) }
    var reactionError by remember(post.id, targetId) { mutableStateOf<String?>(null) }
    var reactionRetry by remember(post.id) { mutableIntStateOf(0) }
    var reactionRevision by remember(post.id) { mutableIntStateOf(0) }
    val mutating = busySend || deletingId != null || busyReactionId != null

    LaunchedEffect(post.id, targetId, refresh) {
        loading = true
        comments = emptyList() // Never show another thread's comments while loading.
        loadError = null
        try {
            comments = withTimeout(18_000L) { actions.loadComments(targetId) }
        } catch (_: TimeoutCancellationException) {
            loadError = "Comments took too long to load. Try again."
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (e: Exception) {
            loadError = e.message ?: "Could not load comments."
        } finally {
            loading = false
        }
    }

    LaunchedEffect(post.id, targetId, comments.map { it.id }, allowWrite, reactionRetry) {
        if (!allowWrite || comments.isEmpty()) return@LaunchedEffect
        val revision = reactionRevision
        reactionError = null
        try {
            val states = withTimeout(18_000L) { actions.getCommentReactionStates(comments.map { it.id }) }
            if (revision == reactionRevision) selectedReactions = selectedReactions + states.mapValues { it.value.orEmpty() }
        } catch (_: TimeoutCancellationException) { reactionError = "Comment reaction status took too long. Try again." }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (e: Exception) { reactionError = e.message ?: "Comment reaction status is unavailable." }
    }

    fun react(comment: NativePostComment, kind: String) {
        if (!allowWrite || mutating) return
        val next = if (selectedReactions[comment.id] == kind) null else kind
        busyReactionId = comment.id; busyReactionKind = kind; reactionRevision++
        writeError = null
        scope.launch {
            try {
                val counts = withTimeout(20_000L) { actions.setCommentReaction(comment.id, next) }
                selectedReactions = selectedReactions + (comment.id to next.orEmpty())
                comments = comments.map { item ->
                    if (item.id == comment.id) item.copy(likes = counts.first, dislikes = counts.second) else item
                }
            } catch (_: TimeoutCancellationException) {
                selectedReactions = selectedReactions - comment.id
                writeError = "Reaction timed out. Refresh comments to check its status."
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (e: Exception) { writeError = e.message ?: "Your comment reaction could not be saved." }
            finally { busyReactionId = null; busyReactionKind = null }
        }
    }

    val threadStateHolder = rememberSaveableStateHolder()
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true,
        confirmValueChange = { !mutating || it != SheetValue.Hidden })
    ModalBottomSheet(onDismissRequest = { if (!mutating) onDismiss() },
        sheetState = sheetState, shape = SautiShape.Sheet) {
        threadStateHolder.SaveableStateProvider(targetId) {
            // Retain each thread's draft, retry key and scroll position when navigating or reopening.
            var draft by rememberSaveable { mutableStateOf("") }
            var requestId by rememberSaveable { mutableStateOf(UUID.randomUUID().toString()) }
            val listState = rememberLazyListState()
            var scrollIndex by rememberSaveable { mutableIntStateOf(0) }
            var scrollOffset by rememberSaveable { mutableIntStateOf(0) }
            LaunchedEffect(listState, loading, targetId) {
                if (!loading && loadError == null && comments.isNotEmpty()) {
                    // Loading skeletons must not clamp away the remembered thread position.
                    listState.scrollToItem(scrollIndex.coerceAtMost(comments.lastIndex), scrollOffset)
                    snapshotFlow { listState.firstVisibleItemIndex to listState.firstVisibleItemScrollOffset }
                        .collect { (index, offset) -> scrollIndex = index; scrollOffset = offset }
                }
            }
            Column(
                Modifier.fillMaxWidth().fillMaxHeight(.9f).padding(horizontal = 18.dp).padding(bottom = 12.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    if (parent != null) {
                        IconButton(onClick = { trail = trail.dropLast(1); writeError = null }, enabled = !mutating) {
                            Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back to previous comments")
                        }
                    }
                    Column(Modifier.weight(1f)) {
                        Text(if (parent == null) "Comments" else "Replies", style = MaterialTheme.typography.titleLarge)
                        Text(
                            if (parent == null) "${post.authorName}'s post" else "Replying to ${parent.author}",
                            style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    IconButton(onClick = { refresh++ }, enabled = !mutating && !loading) {
                        Icon(Icons.Rounded.Refresh, "Refresh comments")
                    }
                    IconButton(onClick = {
                        scope.launch { sheetState.hide(); if (!sheetState.isVisible) onDismiss() }
                    }, enabled = !mutating) {
                        Icon(Icons.Rounded.Close, "Close comments")
                    }
                }
                if (parent != null) {
                    Surface(shape = SautiShape.Card, color = MaterialTheme.colorScheme.primaryContainer) {
                        Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                            Text(parent.author + if (parent.handle.isNotBlank()) " · @${parent.handle}" else "",
                                style = MaterialTheme.typography.labelMedium)
                            Text(parent.body, style = MaterialTheme.typography.bodyMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
                LazyColumn(Modifier.fillMaxWidth().weight(1f), state = listState,
                    verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    if (loading) items(3) { SautiExploreSkeleton() }
                    if (loadError != null) item {
                        Column {
                            Text(loadError.orEmpty(), color = MaterialTheme.colorScheme.error,
                                style = MaterialTheme.typography.bodySmall)
                            TextButton(onClick = { refresh++ }, enabled = !loading) { Text("Retry comments") }
                        }
                    }
                    if (!loading && loadError == null && comments.isEmpty()) item {
                        Text(if (parent == null) "No comments yet. Start the conversation." else "No replies yet.",
                            style = MaterialTheme.typography.bodyMedium)
                    }
                    items(comments, key = { it.id }) { comment ->
                        Surface(shape = SautiShape.Card, color = MaterialTheme.colorScheme.surfaceContainer) {
                            Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                                Row(verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                                    Text(comment.author + if (comment.handle.isNotBlank()) " · @${comment.handle}" else "",
                                        style = MaterialTheme.typography.labelMedium)
                                    SautiVerificationBadge(comment.verified, comment.badgeType,
                                        comment.author, size = 13.dp)
                                }
                                Text(comment.body, style = MaterialTheme.typography.bodyMedium)
                                Text(relativePostTime(comment.createdAt), style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                                SautiCommentActions(likes = comment.likes, dislikes = comment.dislikes,
                                    replyCount = comment.replyCount,
                                    liked = selectedReactions[comment.id] == "like",
                                    disliked = selectedReactions[comment.id] == "dislike",
                                    reactionEnabled = allowWrite && !mutating, replyEnabled = !mutating,
                                    onLike = { react(comment, "like") }, onDislike = { react(comment, "dislike") },
                                    onReply = { trail = trail + comment; writeError = null },
                                    onDelete = if (allowWrite && comment.authorId == signedInUserId)
                                        ({ confirmDelete = comment }) else null,
                                    busyReaction = if (busyReactionId == comment.id) busyReactionKind else null)
                            }
                        }
                    }
                }
                if (comments.size == 40) {
                    Text("Showing the latest 40 in this thread.", style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (reactionError != null) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text(reactionError.orEmpty(), Modifier.weight(1f), color = MaterialTheme.colorScheme.error,
                            style = MaterialTheme.typography.bodySmall)
                        TextButton(onClick = { reactionRetry++ }, enabled = !mutating) { Text("Retry reactions") }
                    }
                }
                if (writeError != null) {
                    Text(writeError.orEmpty(), color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodySmall)
                }
                if (allowWrite) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(
                            value = draft,
                            onValueChange = { newValue ->
                                if (newValue.length <= 500 && newValue != draft) {
                                    draft = newValue
                                    requestId = UUID.randomUUID().toString()
                                    writeError = null
                                }
                            },
                            modifier = Modifier.weight(1f), shape = SautiShape.Card,
                            placeholder = { Text(if (parent == null) "Write a comment..." else "Write a reply...") },
                            maxLines = 4,
                            supportingText = { Text("${draft.length}/500") },
                            enabled = !mutating
                        )
                        IconButton(onClick = {
                            if (mutating || draft.isBlank()) return@IconButton
                            val destination = targetId
                            val rootWrite = parent == null
                            val body = draft
                            val key = requestId
                            busySend = true
                            writeError = null
                            scope.launch {
                                try {
                                    withTimeout(20_000L) { actions.sendComment(destination, body, key) }
                                    draft = ""
                                    requestId = UUID.randomUUID().toString()
                                    if (rootWrite) onRootPosted()
                                    else {
                                        trail = trail.mapIndexed { index, ancestor ->
                                            if (index == trail.lastIndex) ancestor.copy(replyCount = ancestor.replyCount + 1) else ancestor
                                        }
                                    }
                                    refresh++
                                    onCommentChanged()
                                } catch (_: TimeoutCancellationException) {
                                    writeError = "Comment request timed out. Retry with the same text; duplicates are protected."
                                } catch (cancelled: CancellationException) {
                                    throw cancelled
                                } catch (e: Exception) {
                                    writeError = e.message ?: "Comment could not be posted."
                                } finally {
                                    busySend = false
                                }
                            }
                        }, enabled = draft.isNotBlank() && !mutating) {
                            if (busySend) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                            else Icon(Icons.AutoMirrored.Rounded.Send, if (parent == null) "Post comment" else "Post reply")
                        }
                    }
                } else {
                    Text("Read-only test environment", style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
    val toDelete = confirmDelete
    if (toDelete != null) {
        AlertDialog(
            onDismissRequest = { if (!mutating) confirmDelete = null },
            title = { Text("Delete your comment?") },
            text = { Text("This comment and any replies beneath it may be removed from SautiLink. This cannot be undone.") },
            confirmButton = {
                TextButton(onClick = {
                    if (mutating || toDelete.authorId != signedInUserId || !allowWrite) return@TextButton
                    confirmDelete = null
                    val deletedFromRoot = parent == null
                    deletingId = toDelete.id
                    writeError = null
                    scope.launch {
                        try {
                            withTimeout(20_000L) { actions.deleteOwnComment(toDelete.id) }
                            if (deletedFromRoot) onRootDeleted()
                            else {
                                trail = trail.mapIndexed { index, ancestor ->
                                    if (index == trail.lastIndex) ancestor.copy(replyCount = (ancestor.replyCount - 1).coerceAtLeast(0)) else ancestor
                                }
                            }
                            refresh++
                            onCommentChanged()
                        } catch (_: TimeoutCancellationException) {
                            writeError = "Delete timed out. Refresh to check whether it was removed."
                        } catch (cancelled: CancellationException) {
                            throw cancelled
                        } catch (e: Exception) {
                            writeError = e.message ?: "Could not delete comment. Refresh and try again."
                        } finally {
                            deletingId = null
                        }
                    }
                }, enabled = !mutating) { Text("Delete", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { confirmDelete = null }, enabled = !mutating) { Text("Cancel") } }
        )
    }
}
