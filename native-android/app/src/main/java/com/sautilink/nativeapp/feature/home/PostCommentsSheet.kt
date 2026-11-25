package com.sautilink.nativeapp.feature.home

import com.sautilink.nativeapp.feature.stickers.*
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
import com.sautilink.nativeapp.ui.components.SautiIcon as Icon
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import com.sautilink.nativeapp.ui.components.SautiExploreSkeleton
import com.sautilink.nativeapp.ui.components.SautiCommentActions
import com.sautilink.nativeapp.ui.theme.SautiShape
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.auth.normalizeLoginUsername
import com.sautilink.nativeapp.feature.auth.validLoginUsername
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
        put("likes", comment.likes); put("dislikes", comment.dislikes); put("hasAvatar", comment.hasAvatar)
    }.toString() } },
    restore = { saved -> saved.map { text -> val item = JSONObject(text)
        NativePostComment(item.getString("id"), item.getString("author"), item.getString("handle"),
            item.getString("body"), item.getString("createdAt"), item.getString("authorId"),
            item.getInt("replyCount"), item.getBoolean("verified"), item.getString("badgeType"),
            item.optInt("likes"), item.optInt("dislikes"), item.optBoolean("hasAvatar"))
    } }
)

/** Keep a useful thread above the composer when the keyboard or a short window reduces space. */
@Composable
internal fun commentSheetHeightFraction(): Float {
    val configuration = LocalConfiguration.current
    val keyboardVisible = WindowInsets.ime.getBottom(LocalDensity.current) > 0
    val compactWindow = configuration.screenHeightDp < 480 ||
        configuration.screenWidthDp > configuration.screenHeightDp
    return if (keyboardVisible || compactWindow) 1f else .56f
}

/** Production comments and nested replies share SautiLink's existing guarded APIs.
 * Staging can browse, but may never send or delete content.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun PostCommentsSheet(
    post: StagingFeedPost,
    actions: PostInteractionsClient,
    auth: StagingAuthClient,
    allowWrite: Boolean,
    signedInUserId: String?,
    onDismiss: () -> Unit,
    onRootPosted: () -> Unit,
    onRootDeleted: () -> Unit,
    onCommentChanged: () -> Unit,
    focusedCommentId: String? = null,
    onOpenProfile: ((String) -> Unit)? = null,
) {
    val scope = rememberCoroutineScope()
    // Each breadcrumb is a real social_posts UUID; navigating up stays inside this sheet.
    var trail by rememberSaveable(post.id, stateSaver = commentTrailSaver) { mutableStateOf<List<NativePostComment>>(emptyList()) }
    val parent = trail.lastOrNull()
    val targetId = parent?.id ?: post.id
    val mention = parent?.handle?.takeIf(::validLoginUsername)
        ?.let { "@${normalizeLoginUsername(it)} " }.orEmpty()
    var replyFocusId by remember(post.id) { mutableStateOf<String?>(null) }
    var comments by remember(post.id, targetId) { mutableStateOf<List<NativePostComment>>(emptyList()) }
    var focusPath by remember(post.id, focusedCommentId) { mutableStateOf<List<NativePostComment>>(emptyList()) }
    var focusResolved by remember(post.id, focusedCommentId) { mutableStateOf(focusedCommentId == null) }
    LaunchedEffect(post.id, focusedCommentId) {
        if (focusedCommentId == null) return@LaunchedEffect
        try { focusPath = withTimeout(18_000L) { actions.loadCommentPath(post.id, focusedCommentId) } }
        catch (_: TimeoutCancellationException) { }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { }
        finally { focusResolved = true }
    }
    val visibleComments = remember(comments, focusPath, targetId, post.id) {
        val immediate = if (targetId == post.id) focusPath.firstOrNull()
            else focusPath.getOrNull(focusPath.indexOfFirst { it.id == targetId }.takeIf { it >= 0 }?.plus(1) ?: focusPath.size)
        val roots = if (immediate != null && comments.none { it.id == immediate.id }) comments + immediate else comments
        if (immediate == null) roots else roots.flatMap { comment ->
            if (comment.id == immediate.id) listOf(comment) + focusPath.dropWhile { it.id != immediate.id }.drop(1)
            else listOf(comment)
        }
    }
    var loading by remember(post.id, targetId) { mutableStateOf(true) }
    var loadError by remember(post.id, targetId) { mutableStateOf<String?>(null) }
    var writeError by remember(post.id) { mutableStateOf<String?>(null) }
    var busySend by remember(post.id) { mutableStateOf(false) }
    var deletingId by remember(post.id) { mutableStateOf<String?>(null) }
    var confirmDelete by remember(post.id) { mutableStateOf<NativePostComment?>(null) }
    var refresh by remember(post.id) { mutableIntStateOf(0) }
    var selectedReactions by rememberSaveable(post.id) { mutableStateOf<Map<String, String>>(emptyMap()) }
    var busyReactionId by remember(post.id) { mutableStateOf<String?>(null) }
    var reactionError by remember(post.id, targetId) { mutableStateOf<String?>(null) }
    var reactionRetry by remember(post.id) { mutableIntStateOf(0) }
    var reactionRevision by remember(post.id) { mutableIntStateOf(0) }
    var reactionStatusLoading by remember(post.id, targetId) { mutableStateOf(allowWrite) }
    val mutating = busySend || deletingId != null || busyReactionId != null

    LaunchedEffect(post.id, targetId, refresh) {
        loading = true
        // targetId owns a separate remembered list; refresh keeps this thread visible.
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

    LaunchedEffect(post.id, targetId, visibleComments.map { it.id }, allowWrite, reactionRetry, loading, refresh) {
        if (loading) return@LaunchedEffect
        if (!allowWrite || visibleComments.isEmpty()) { reactionStatusLoading = false; return@LaunchedEffect }
        reactionStatusLoading = true
        val revision = reactionRevision
        reactionError = null
        try {
            val states = withTimeout(18_000L) { actions.getCommentReactionStates(visibleComments.map { it.id }) }
            if (revision == reactionRevision) selectedReactions = selectedReactions + states.mapValues { it.value.orEmpty() }
        } catch (_: TimeoutCancellationException) { reactionError = "Comment reaction status took too long. Try again." }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (e: Exception) { reactionError = e.message ?: "Comment reaction status is unavailable." }
        finally { reactionStatusLoading = false }
    }

    fun react(comment: NativePostComment, kind: String) {
        if (!allowWrite || mutating || loading || reactionStatusLoading || !selectedReactions.containsKey(comment.id)) return
        val next = if (selectedReactions[comment.id] == kind) null else kind
        busyReactionId = comment.id; reactionRevision++
        writeError = null
        scope.launch {
            try {
                val counts = withTimeout(20_000L) { actions.setCommentReaction(comment.id, next) }
                selectedReactions = selectedReactions + (comment.id to next.orEmpty())
                val update: (NativePostComment) -> NativePostComment = { item ->
                    if (item.id == comment.id) item.copy(likes = counts.first, dislikes = counts.second) else item
                }
                comments = comments.map(update)
                focusPath = focusPath.map(update)
            } catch (_: TimeoutCancellationException) {
                refresh++
                writeError = "Reaction timed out. Checking its saved status."
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (e: Exception) { writeError = e.message ?: "Your comment reaction could not be saved." }
            finally { busyReactionId = null }
        }
    }

    val threadStateHolder = rememberSaveableStateHolder()
    val currentMutation = rememberUpdatedState(mutating)
    // SheetState remembers this callback as an input. A new callback for each busy-state
    // change recreates it and replays the opening animation twice for a single reaction.
    val confirmSheetChange = remember {
        { value: SheetValue -> !currentMutation.value || value != SheetValue.Hidden }
    }
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true,
        confirmValueChange = confirmSheetChange)
    ModalBottomSheet(onDismissRequest = { if (!mutating) onDismiss() },
        sheetState = sheetState, shape = SautiShape.Sheet,
        containerColor = MaterialTheme.colorScheme.surface,
        tonalElevation = 0.dp) {
        val heightFraction = commentSheetHeightFraction()
        threadStateHolder.SaveableStateProvider(targetId) {
            // Retain each thread's draft, retry key and scroll position when navigating or reopening.
            val initialDraft = TextFieldValue(mention, selection = TextRange(mention.length))
            var draft by rememberSaveable(stateSaver = TextFieldValue.Saver) { mutableStateOf(initialDraft) }
            var requestId by rememberSaveable { mutableStateOf(UUID.randomUUID().toString()) }
            val focus = remember { FocusRequester() }
            val keyboard = LocalSoftwareKeyboardController.current
            val hasMessage = draft.text.isNotBlank() && draft.text.trim() != mention.trim()
            LaunchedEffect(replyFocusId, targetId) {
                if (allowWrite && replyFocusId == targetId) {
                    if (draft.text.isEmpty()) draft = initialDraft
                    focus.requestFocus()
                    keyboard?.show()
                    replyFocusId = null
                }
            }
            val listState = rememberLazyListState()
            var scrollIndex by rememberSaveable { mutableIntStateOf(0) }
            var scrollOffset by rememberSaveable { mutableIntStateOf(0) }
            var focusApplied by rememberSaveable(focusedCommentId) { mutableStateOf(false) }
            LaunchedEffect(listState, loading, targetId, focusResolved) {
                if (!loading && focusResolved && loadError == null && visibleComments.isNotEmpty()) {
                    // Loading skeletons must not clamp away the remembered thread position.
                    val focusIndex = visibleComments.indexOfFirst { it.id == focusedCommentId }
                    if (!focusApplied && focusIndex >= 0) {
                        listState.scrollToItem(focusIndex)
                        focusApplied = true
                    } else listState.scrollToItem(scrollIndex.coerceAtMost(visibleComments.lastIndex), scrollOffset)
                    snapshotFlow { listState.firstVisibleItemIndex to listState.firstVisibleItemScrollOffset }
                        .collect { (index, offset) -> scrollIndex = index; scrollOffset = offset }
                }
            }
            Column(
                Modifier.fillMaxWidth().imePadding().heightIn(min = 280.dp).fillMaxHeight(heightFraction)
                    .padding(horizontal = 16.dp).padding(bottom = 8.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                Box(Modifier.fillMaxWidth().heightIn(min = 40.dp), contentAlignment = Alignment.Center) {
                    if (parent != null) IconButton(
                        onClick = { trail = trail.dropLast(1); writeError = null }, enabled = !mutating,
                        modifier = Modifier.align(Alignment.CenterStart)
                    ) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back to previous comments", Modifier.size(20.dp)) }
                    Text(if (parent == null) "Comments" else "Replies",
                        style = MaterialTheme.typography.titleMedium.copy(fontSize = 15.sp),
                        fontWeight = FontWeight.Medium, modifier = Modifier.align(Alignment.Center))
                    IconButton(onClick = {
                        scope.launch { sheetState.hide(); if (!sheetState.isVisible) onDismiss() }
                    }, enabled = !mutating, modifier = Modifier.align(Alignment.CenterEnd)) {
                        Icon(Icons.Rounded.Close, "Close comments", Modifier.size(18.dp))
                    }
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = .45f))
                if (parent != null) {
                    Surface(shape = SautiShape.Card, color = MaterialTheme.colorScheme.primaryContainer) {
                        PostCommentContent(auth, parent, Modifier.padding(12.dp),
                            enabled = !mutating, maxBodyLines = 2)
                    }
                }
                LazyColumn(Modifier.fillMaxWidth().weight(1f), state = listState,
                    contentPadding = PaddingValues(bottom = 4.dp),
                    verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    if (loading && comments.isEmpty()) items(3) { SautiExploreSkeleton() }
                    if (loadError != null) item {
                        Column {
                            Text(loadError.orEmpty(), color = MaterialTheme.colorScheme.error,
                                style = MaterialTheme.typography.bodySmall)
                            TextButton(onClick = { refresh++ }, enabled = !loading) { Text("Retry comments") }
                        }
                    }
                    if (!loading && loadError == null && visibleComments.isEmpty()) item {
                        Text(if (parent == null) "No comments yet. Start the conversation." else "No replies yet.",
                            style = MaterialTheme.typography.bodyMedium)
                    }
                    items(visibleComments, key = { it.id }) { comment ->
                        val indent = focusPath.indexOfFirst { it.id == comment.id }.coerceIn(0, 3)
                        Surface(color = if (comment.id == focusedCommentId) MaterialTheme.colorScheme.primaryContainer
                            else MaterialTheme.colorScheme.surface, shape = SautiShape.Card,
                            modifier = Modifier.fillMaxWidth().padding(start = (indent * 10).dp)
                                .testTag(if (comment.id == focusedCommentId) "highlighted-comment" else "comment")) {
                            PostCommentContent(auth, comment, Modifier.padding(horizontal = 4.dp, vertical = 5.dp),
                                enabled = !mutating, onOpenProfile = onOpenProfile,
                                onDelete = if (allowWrite && comment.authorId == signedInUserId)
                                    ({ confirmDelete = comment }) else null) {
                                SautiCommentActions(likes = comment.likes, dislikes = comment.dislikes,
                                    replyCount = comment.replyCount,
                                    liked = selectedReactions[comment.id] == "like",
                                    disliked = selectedReactions[comment.id] == "dislike",
                                    reactionEnabled = allowWrite && !mutating && !loading && !reactionStatusLoading &&
                                        selectedReactions.containsKey(comment.id), replyEnabled = !mutating,
                                    onLike = { react(comment, "like") }, onDislike = { react(comment, "dislike") },
                                    onReply = {
                                        replyFocusId = if (allowWrite) comment.id else null
                                        trail = trail + comment
                                        writeError = null
                                    },
                                    onViewReplies = { trail = trail + comment; writeError = null })
                            }
                        }
                    }
                }
                if (comments.size == 80) {
                    Text("Showing the first 80 in this thread.", style = MaterialTheme.typography.labelSmall,
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
                    NativeStickerDraftPreview(draft.text, !busySend && deletingId == null) { draft = TextFieldValue(it, TextRange(stickerCaption(draft).selection.end.coerceAtMost(it.length))); requestId = UUID.randomUUID().toString() }
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = .6f))
                    NativeRecommendedEmojis(!busySend && deletingId == null) { emoji ->
                        val next = insertCommentEmoji(draft, emoji)
                        if (next != draft) { draft = next; requestId = UUID.randomUUID().toString(); writeError = null; focus.requestFocus() }
                    }
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        com.sautilink.nativeapp.feature.stickers.NativeStickerButton(!busySend && deletingId == null) { token ->
                            val next = com.sautilink.nativeapp.feature.stickers.insertNativeSticker(draft, token, 500)
                            if (next != draft) { draft = next; requestId = UUID.randomUUID().toString(); writeError = null }
                        }
                        OutlinedTextField(
                            value = stickerCaption(draft),
                            onValueChange = { newValue ->
                                val next = editStickerCaption(draft.text, newValue, 500)
                                if (next.text != draft.text) { requestId = UUID.randomUUID().toString(); writeError = null }
                                draft = next
                            },
                            modifier = Modifier.weight(1f).focusRequester(focus), shape = SautiShape.Pill,
                            textStyle = MaterialTheme.typography.bodyMedium.copy(fontSize = 14.sp, lineHeight = 20.sp),
                            placeholder = { Text(if (parent == null) "Write a comment..." else "Write a reply...") },
                            maxLines = 3,
                            supportingText = if (draft.text.length >= 400) ({ Text("${draft.text.length}/500") }) else null,
                            enabled = !busySend && deletingId == null
                        )
                        IconButton(onClick = {
                            if (mutating || !hasMessage) return@IconButton
                            val destination = targetId
                            val rootWrite = parent == null
                            val body = draft.text
                            val key = requestId
                            busySend = true
                            writeError = null
                            scope.launch {
                                try {
                                    withTimeout(20_000L) { actions.sendComment(destination, body, key) }
                                    draft = initialDraft
                                    requestId = UUID.randomUUID().toString()
                                    onRootPosted()
                                    if (!rootWrite) {
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
                        }, enabled = hasMessage && !mutating) {
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
                    val focusIndex = focusPath.indexOfFirst { it.id == toDelete.id }
                    val deletedFromRoot = parent == null && focusIndex <= 0
                    deletingId = toDelete.id
                    writeError = null
                    scope.launch {
                        try {
                            withTimeout(20_000L) { actions.deleteOwnComment(toDelete.id) }
                            onRootDeleted()
                            if (!deletedFromRoot && parent != null && comments.any { it.id == toDelete.id }) {
                                trail = trail.mapIndexed { index, ancestor ->
                                    if (index == trail.lastIndex) ancestor.copy(replyCount = (ancestor.replyCount - 1).coerceAtLeast(0)) else ancestor
                                }
                            }
                            comments = comments.filterNot { it.id == toDelete.id }
                            if (focusIndex >= 0) focusPath = focusPath.take(focusIndex)
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
