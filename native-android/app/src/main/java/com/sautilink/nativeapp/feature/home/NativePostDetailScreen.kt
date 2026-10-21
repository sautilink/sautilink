package com.sautilink.nativeapp.feature.home

import com.sautilink.nativeapp.ui.components.SautiEntityText
import android.content.Intent
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import com.sautilink.nativeapp.ui.components.SautiIcon as Icon
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.safety.NativeReportDialog
import com.sautilink.nativeapp.feature.safety.NativeSafetyClient
import com.sautilink.nativeapp.ui.components.SautiAvatar
import com.sautilink.nativeapp.ui.components.SautiActionIconButton
import com.sautilink.nativeapp.ui.components.SautiPostActionRow
import com.sautilink.nativeapp.ui.components.SautiPostIcons
import com.sautilink.nativeapp.ui.components.SautiCommentActions
import com.sautilink.nativeapp.ui.components.SautiPostSkeleton
import com.sautilink.nativeapp.ui.components.SautiVerificationBadge
import com.sautilink.nativeapp.ui.theme.SautiColors
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import java.util.UUID

/** Canonical Post Detail: same media, reactions and nested comments as the Home feed.
 * Avoid the historical bare media preview when opening a post via profile/notification.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NativePostDetailScreen(
    auth: StagingAuthClient, postId: String, onBack: () -> Unit,
    onSignIn: () -> Unit, onOpenProfile: (String) -> Unit,
    initialComments: Boolean = false
) {
    val client = remember(auth) { StagingFeedClient(auth) }
    val actions = remember(auth) { PostInteractionsClient(auth) }
    val safety = remember(auth) { NativeSafetyClient(auth) }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var post by remember(postId) { mutableStateOf<StagingFeedPost?>(null) }
    var comments by remember(postId) { mutableStateOf<List<NativePostComment>>(emptyList()) }
    var replies by remember(postId) { mutableStateOf<Map<String, List<NativePostComment>>>(emptyMap()) }
    var expanded by remember(postId) { mutableStateOf<Set<String>>(emptySet()) }
    var commentsMode by remember(postId, initialComments) { mutableStateOf(initialComments) }
    var replyTarget by remember(postId) { mutableStateOf<NativePostComment?>(null) }
    var draft by remember(postId) { mutableStateOf("") }
    var loading by remember(postId) { mutableStateOf(true) }
    var commentsLoading by remember(postId) { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember(postId) { mutableStateOf<String?>(null) }
    var refresh by remember { mutableIntStateOf(0) }
    var commentRevision by remember { mutableIntStateOf(0) }
    var liked by remember(postId) { mutableStateOf(false) }
    var saved by remember(postId) { mutableStateOf(false) }
    var reposted by remember(postId) { mutableStateOf(false) }
    var reportOpen by remember { mutableStateOf(false) }
    var reportNote by remember { mutableStateOf<String?>(null) }
    val reactionCounts = remember(postId) {
        mutableStateMapOf<String, Pair<Int, Int>>()
    }
    var commentReactionRevision by remember(postId) { mutableIntStateOf(0) }
    val selectedReactions = remember(postId) { mutableStateMapOf<String, String?>() }

    BackHandler(commentsMode) {
        if (replyTarget != null) { replyTarget = null; draft = "" }
        else commentsMode = false
    }
    LaunchedEffect(postId, auth.account?.id, refresh) {
        if (auth.account == null) { loading = false; post = null; return@LaunchedEffect }
        loading = true; error = null
        try {
            post = client.loadOne(postId)
            val state = actions.getLikeStates(listOf(postId))
            liked = state[postId] == true
            saved = actions.getSavedStates(listOf(postId))[postId] == true
            reposted = actions.getRepostStates(listOf(postId))[postId] == true
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (e: Exception) {
            // Render successfully loaded post even if independent action-state fetch failed.
            if (post == null) error = e.message ?: "Could not open post."
        } finally { loading = false }
    }
    LaunchedEffect(postId, commentsMode, commentRevision) {
        if (!commentsMode || auth.account == null) return@LaunchedEffect
        commentsLoading = true
        try {
            comments = actions.loadComments(postId)
            if (expanded.isNotEmpty()) {
                replies = expanded.associateWith { id -> actions.loadComments(id) }
            }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (e: Exception) { error = e.message ?: "Comments unavailable." }
        finally { commentsLoading = false }
    }

    val shownCommentIds = (comments + replies.values.flatten()).map { it.id }.distinct()
    LaunchedEffect(postId, commentsMode, shownCommentIds, auth.account?.id) {
        if (!commentsMode || auth.account == null || shownCommentIds.isEmpty()) return@LaunchedEffect
        val revision = commentReactionRevision
        try {
            val states = actions.getCommentReactionStates(shownCommentIds)
            if (revision == commentReactionRevision) selectedReactions.putAll(states)
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (e: Exception) { error = e.message ?: "Comment reaction status is unavailable." }
    }

    fun changeLike(likeOnly: Boolean = false) {
        if (busy || (likeOnly && liked)) return
        val desired = if (likeOnly) true else !liked
        busy = true
        scope.launch {
            try {
                actions.setLike(postId, desired); liked = desired
                val latest = client.loadOne(postId)
                if (latest != null) post = post?.copy(likes = latest.likes)
            } catch (e: Exception) { error = e.message }
            finally { busy = false }
        }
    }

    fun toggleExpanded(id: String) {
        if (id in expanded) { expanded = expanded - id; return }
        expanded = expanded + id
        scope.launch {
            try { replies = replies + (id to actions.loadComments(id)) }
            catch (e: Exception) { error = e.message ?: "Could not open replies." }
        }
    }

    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surface)) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 7.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconButton(onClick = {
                if (commentsMode) { commentsMode = false; replyTarget = null }
                else onBack()
            }, modifier = Modifier.size(48.dp)) {
                Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back", tint = SautiColors.Red)
            }
            Text("Post",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            if (commentsMode) {
                TextButton(onClick = { commentsMode = false }) { Text("View post") }
            } else {
                IconButton(onClick = { refresh++ }, enabled = !loading) {
                    Icon(Icons.Rounded.Refresh, "Refresh post")
                }
            }
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = .65f))
        when {
            auth.account == null -> {
                Column(Modifier.fillMaxWidth().padding(24.dp)) {
                    Text("Sign in to see this post.")
                    Button(onClick = onSignIn) { Text("Sign in") }
                }
            }
            error != null && post == null -> {
                Text(error.orEmpty(), Modifier.padding(20.dp), color = MaterialTheme.colorScheme.error)
                TextButton(onClick = { refresh++ }) { Text("Try again") }
            }
            loading && post == null -> repeat(2) { SautiPostSkeleton() }
            post == null -> Text("This post is unavailable or you do not have access.",
                Modifier.padding(20.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
            else -> {
                val item = post!!
                LazyColumn(
                    Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    item {
                        Row(Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            val initials = item.authorName.split(" ").filter { it.isNotBlank() }
                                .take(2).joinToString("") { it.take(1).uppercase() }.ifBlank { "SL" }
                            if (item.hasAvatar && item.authorHandle.isNotBlank()) {
                                AuthorizedImage(auth, "/api/profile-media/${item.authorHandle}/avatar",
                                    "Avatar", Modifier.size(46.dp).clip(CircleShape),
                                    fallback = { SautiAvatar(initials, Modifier.size(46.dp), SautiColors.Blue) })
                            } else SautiAvatar(initials, Modifier.size(46.dp), SautiColors.Blue)
                            Column(Modifier.weight(1f).clickable(enabled = item.authorHandle.isNotBlank()) {
                                onOpenProfile(item.authorHandle)
                            }) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(item.authorName, fontWeight = FontWeight.SemiBold,
                                        style = MaterialTheme.typography.titleMedium,
                                        modifier = Modifier.weight(1f, fill = false),
                                        maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    Spacer(Modifier.width(5.dp))
                                    SautiVerificationBadge(item.verified, item.badgeType,
                                        item.authorName, size = 16.dp)
                                }
                                Text("@${item.authorHandle} · ${relativePostTime(item.createdAt)}",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            if (item.authorId != auth.account?.id) {
                                IconButton(onClick = { reportOpen = true }) {
                                    Icon(Icons.Rounded.MoreHoriz, "Post options")
                                }
                            }
                        }
                    }
                    if (item.body.isNotBlank()) item {
                        com.sautilink.nativeapp.ui.components.SautiPostGestureSurface(Modifier.fillMaxWidth(),
                            onLike = if (!busy && auth.account != null) ({ changeLike(likeOnly = true) }) else null) {
                            com.sautilink.nativeapp.ui.components.SautiPostText(item.body,
                                style = MaterialTheme.typography.bodyMedium.copy(fontSize = 15.sp, lineHeight = 21.sp))
                        }
                    }
                    // Comments previously replaced the post: retain that decoder lifecycle.
                    // The identity and caption remain behind the sheet without active media.
                    if (item.media.isNotEmpty() && !commentsMode) item {
                        PostMediaGallery(auth, item.media,
                            bufferingOverlayEnabled = true, adaptivePlaybackEnabled = true,
                            onDoubleTapLike = if (!busy && auth.account != null) ({ changeLike(likeOnly = true) }) else null)
                    }
                    item {
                        HorizontalDivider()
                        SautiPostActionRow(modifier = Modifier.heightIn(min = 56.dp), actions = {
                            CompactPostAction(icon = if (liked) Icons.Rounded.ThumbUp else Icons.Rounded.ThumbUpOffAlt,
                                label = "Like", count = feedCount(item.likes), modifier = Modifier,
                                tint = if (liked) SautiColors.Red else MaterialTheme.colorScheme.onSurface,
                                enabled = !busy, onClick = { changeLike() })
                            CompactPostAction(Icons.Rounded.ChatBubbleOutline, "Comments", feedCount(item.comments), Modifier,
                                tint = MaterialTheme.colorScheme.onSurface, onClick = { commentsMode = true })
                            CompactPostAction(Icons.Rounded.Repeat, "Repost", feedCount(item.reposts), Modifier,
                                tint = if (reposted) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
                                enabled = !busy, onClick = {
                                if (busy) return@CompactPostAction
                                busy = true
                                scope.launch {
                                    try {
                                        actions.setRepost(postId, !reposted); reposted = !reposted
                                        val latest = client.loadOne(postId)
                                        if (latest != null) post = post?.copy(reposts = latest.reposts)
                                    }
                                    catch (e: Exception) { error = e.message }
                                    finally { busy = false }
                                }
                            })
                            CompactPostAction(SautiPostIcons.Share, "Share post", null, Modifier,
                                tint = MaterialTheme.colorScheme.onSurface, onClick = {
                                val send = Intent(Intent.ACTION_SEND).apply {
                                    type = "text/plain"
                                    putExtra(Intent.EXTRA_TEXT, actions.postShareUrl(postId))
                                }
                                runCatching { context.startActivity(Intent.createChooser(send, "Share post")) }
                            })
                        }, trailing = {
                            SautiActionIconButton(if (saved) Icons.Rounded.Bookmark else Icons.Rounded.BookmarkBorder,
                                "Save post", if (saved) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
                                enabled = !busy, onClick = {
                                if (busy) return@SautiActionIconButton
                                busy = true
                                scope.launch {
                                    try { actions.setSaved(postId, !saved); saved = !saved }
                                    catch (e: Exception) { error = e.message }
                                    finally { busy = false }
                                }
                            })
                        })
                        OutlinedButton(onClick = { commentsMode = true },
                            shape = RoundedCornerShape(20.dp), modifier = Modifier.fillMaxWidth()) {
                            Icon(Icons.Rounded.ChatBubbleOutline, null)
                            Spacer(Modifier.width(8.dp))
                            Text("View comments and replies")
                        }
                        if (error != null) Text(error.orEmpty(),
                            color = MaterialTheme.colorScheme.error)
                    }
                }
            }
        }
    }
    if (commentsMode && post != null && auth.account != null) {
        val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
        ModalBottomSheet(onDismissRequest = { commentsMode = false }, sheetState = sheetState,
            shape = com.sautilink.nativeapp.ui.theme.SautiShape.Sheet,
            containerColor = MaterialTheme.colorScheme.surface, tonalElevation = 0.dp) {
            val heightFraction = commentSheetHeightFraction()
            Column(Modifier.fillMaxWidth().imePadding().heightIn(min = 280.dp).fillMaxHeight(heightFraction)) {
                Row(Modifier.fillMaxWidth().padding(start = 18.dp, end = 6.dp),
                    verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Rounded.ChatBubbleOutline, null, Modifier.size(21.dp),
                        tint = MaterialTheme.colorScheme.primary)
                    Spacer(Modifier.width(9.dp))
                    Text("Comments", style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                    IconButton(onClick = { commentsMode = false }) { Icon(Icons.Rounded.Close, "Close comments") }
                }
                LazyColumn(
                    Modifier.weight(1f),
                    contentPadding = PaddingValues(bottom = 16.dp)
                ) {
                    if (commentsLoading && comments.isEmpty()) items(3) { SautiPostSkeleton() }
                    if (error != null) item {
                        Text(error.orEmpty(), Modifier.padding(14.dp),
                            color = MaterialTheme.colorScheme.error)
                    }
                    if (!commentsLoading && comments.isEmpty() && error == null) item {
                        Text("Be the first to comment.", Modifier.padding(22.dp))
                    }
                    items(comments, key = { it.id }) { comment ->
                        CommentThreadRow(auth, comment, replies, expanded,
                            counts = reactionCounts, selected = selectedReactions, reactionsEnabled = !busy,
                            onOpenProfile = onOpenProfile,
                            onReply = { target ->
                                replyTarget = target
                                draft = if (target.handle.isNotBlank()) "@${target.handle} " else ""
                            },
                            onExpand = ::toggleExpanded,
                            onReaction = { target, reaction ->
                                if (!busy) {
                                    busy = true; error = null; commentReactionRevision++
                                    scope.launch {
                                        try {
                                            val next = if (selectedReactions[target.id] == reaction) null else reaction
                                            reactionCounts[target.id] = actions.setCommentReaction(target.id, next)
                                            selectedReactions[target.id] = next
                                        } catch (e: Exception) { error = e.message ?: "Could not react." }
                                        finally { busy = false }
                                    }
                                }
                            }
                        )
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = .5f))
                    }
                }
                if (replyTarget != null) {
                    Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 5.dp),
                        verticalAlignment = Alignment.CenterVertically) {
                        Text("Replying to ${replyTarget?.author.orEmpty()}",
                            modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
                        IconButton(onClick = { replyTarget = null; draft = "" }) {
                            Icon(Icons.Rounded.Close, "Cancel reply")
                        }
                    }
                }
                Row(Modifier.fillMaxWidth().padding(10.dp),
                    verticalAlignment = Alignment.Bottom,
                    horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                    OutlinedTextField(
                        value = draft, onValueChange = { draft = it.take(500) },
                        placeholder = { Text("Write a comment…") },
                        shape = RoundedCornerShape(23.dp),
                        modifier = Modifier.weight(1f),
                        textStyle = MaterialTheme.typography.bodyMedium.copy(fontSize = 16.sp, lineHeight = 22.sp),
                        minLines = 1, maxLines = 3
                    )
                    IconButton(
                        onClick = {
                            val targetId = replyTarget?.id ?: postId
                            val message = draft.trim()
                            if (message.isBlank() || busy) return@IconButton
                            busy = true; error = null
                            scope.launch {
                                try {
                                    actions.sendComment(targetId, message, UUID.randomUUID().toString())
                                    draft = ""; replyTarget = null
                                    commentRevision++
                                } catch (e: Exception) { error = e.message ?: "Could not send comment." }
                                finally { busy = false }
                            }
                        },
                        enabled = draft.trim().isNotEmpty() && !busy,
                        modifier = Modifier.size(48.dp)
                    ) { Icon(Icons.Rounded.Send, "Send comment") }
                }
            }
        }
    }
    if (reportOpen) NativeReportDialog("post", busy, error = reportNote,
        onDismiss = { reportOpen = false }) { reason, details ->
        busy = true; reportNote = null
        scope.launch {
            try {
                safety.report("post", postId, reason, details)
                reportOpen = false; reportNote = "Report submitted."
            } catch (e: Exception) { reportNote = e.message ?: "Could not report post." }
            finally { busy = false }
        }
    }
}

@Composable
private fun CommentThreadRow(
    auth: StagingAuthClient, item: NativePostComment,
    replies: Map<String, List<NativePostComment>>, expanded: Set<String>,
    counts: Map<String, Pair<Int, Int>>, selected: Map<String, String?>, reactionsEnabled: Boolean,
    onOpenProfile: (String) -> Unit,
    onReply: (NativePostComment) -> Unit,
    onExpand: (String) -> Unit,
    onReaction: (NativePostComment, String) -> Unit,
    depth: Int = 0
) {
    Column(Modifier.fillMaxWidth().padding(start = if (depth > 0) 12.dp else 0.dp),
        verticalArrangement = Arrangement.spacedBy(7.dp)) {
        PostCommentContent(auth, item,
            Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, top = 12.dp),
            enabled = reactionsEnabled, onOpenProfile = onOpenProfile
        ) {
            val totals = counts[item.id] ?: (item.likes to item.dislikes)
            SautiCommentActions(likes = totals.first, dislikes = totals.second,
                replyCount = item.replyCount, liked = selected[item.id] == "like",
                disliked = selected[item.id] == "dislike",
                reactionEnabled = reactionsEnabled, replyEnabled = reactionsEnabled,
                onLike = { onReaction(item, "like") }, onDislike = { onReaction(item, "dislike") },
                onReply = { onReply(item) })
            if (item.replyCount > 0) {
                TextButton(onClick = { onExpand(item.id) }) {
                    Text(if (item.id in expanded) "Hide ${item.replyCount} replies"
                        else "View ${item.replyCount} replies")
                }
            }
        }
        // Bound nesting visually; server independently enforces maximum allowed depth.
        if (item.id in expanded && depth < 5) {
            replies[item.id].orEmpty().forEach { child ->
                CommentThreadRow(auth, child, replies, expanded, counts, selected, reactionsEnabled,
                    onOpenProfile, onReply, onExpand, onReaction, depth + 1)
            }
        }
    }
}
