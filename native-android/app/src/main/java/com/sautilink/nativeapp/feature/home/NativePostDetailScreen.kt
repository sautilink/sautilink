package com.sautilink.nativeapp.feature.home

import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
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
import com.sautilink.nativeapp.ui.theme.SautiHeaderFont
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
import com.sautilink.nativeapp.ui.components.SautiPostActionRow
import com.sautilink.nativeapp.ui.components.SautiPostIcons
import com.sautilink.nativeapp.ui.components.SautiPostSkeleton
import com.sautilink.nativeapp.ui.components.SautiVerificationBadge
import com.sautilink.nativeapp.ui.theme.SautiColors
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/** Canonical Post Detail: same media, reactions and nested comments as the Home feed.
 * Avoid the historical bare media preview when opening a post via profile/notification.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NativePostDetailScreen(
    auth: StagingAuthClient, requestedPostId: String, onBack: () -> Unit,
    onSignIn: () -> Unit, onOpenProfile: (String) -> Unit,
    initialComments: Boolean = false
) {
    val client = remember(auth) { StagingFeedClient(auth) }
    val actions = remember(auth) { PostInteractionsClient(auth) }
    val safety = remember(auth) { NativeSafetyClient(auth) }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var postId by remember(requestedPostId) { mutableStateOf(requestedPostId) }
    var highlightedComment by remember(requestedPostId) { mutableStateOf<String?>(null) }
    var post by remember(requestedPostId) { mutableStateOf<StagingFeedPost?>(null) }
    var commentsMode by remember(requestedPostId, initialComments) { mutableStateOf(initialComments) }
    var loading by remember(requestedPostId) { mutableStateOf(true) }
    var busy by remember(requestedPostId) { mutableStateOf(false) }
    var error by remember(requestedPostId) { mutableStateOf<String?>(null) }
    var refresh by remember(requestedPostId) { mutableIntStateOf(0) }
    var liked by remember(requestedPostId) { mutableStateOf(false) }
    var saved by remember(requestedPostId) { mutableStateOf(false) }
    var reposted by remember(requestedPostId) { mutableStateOf(false) }
    var reportOpen by remember(requestedPostId) { mutableStateOf(false) }
    var reportNote by remember(requestedPostId) { mutableStateOf<String?>(null) }

    LaunchedEffect(requestedPostId, auth.account?.id, refresh) {
        if (auth.account == null) { loading = false; post = null; return@LaunchedEffect }
        loading = true
        error = null
        try {
            val root = actions.resolvePostRoot(requestedPostId)
            if (root == null) { post = null; return@LaunchedEffect }
            postId = root
            if (root != requestedPostId && refresh == 0) {
                highlightedComment = requestedPostId
                commentsMode = true
            }
            post = client.loadOne(root)
            liked = actions.getLikeStates(listOf(root))[root] == true
            saved = actions.getSavedStates(listOf(root))[root] == true
            reposted = actions.getRepostStates(listOf(root))[root] == true
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) {
            if (post == null) error = failure.message ?: "Could not open post."
        } finally { loading = false }
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

    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surface)) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 7.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconButton(onClick = {
                if (commentsMode) { commentsMode = false; highlightedComment = null }
                else onBack()
            }, modifier = Modifier.size(48.dp)) {
                Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back", tint = SautiColors.Red)
            }
            Text("Post", fontFamily = SautiHeaderFont,
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            if (commentsMode) {
                TextButton(onClick = { commentsMode = false; highlightedComment = null }) { Text("View post") }
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
                    if (item.media.isNotEmpty()) item {
                        val playbackBlocked = com.sautilink.nativeapp.ui.components.LocalNativePlaybackBlocked
                        CompositionLocalProvider(playbackBlocked provides (playbackBlocked.current || commentsMode)) {
                            PostMediaGallery(auth, item.media,
                                onDoubleTapLike = if (!busy && auth.account != null) ({ changeLike(likeOnly = true) }) else null)
                        }
                    }
                    item {
                        HorizontalDivider()
                        SautiPostActionRow(modifier = Modifier.heightIn(min = 56.dp), actions = {
                            CompactPostAction(icon = Icons.Rounded.FavoriteBorder,
                                label = if (liked) "Unlike post" else "Like post", count = feedCount(item.likes), modifier = Modifier,
                                selected = liked,
                                enabled = !busy, onClick = { changeLike() })
                            CompactPostAction(Icons.Rounded.ChatBubbleOutline, "Comments", feedCount(item.comments), Modifier,
                                onClick = { commentsMode = true })
                            CompactPostAction(Icons.Rounded.Repeat, "Repost", feedCount(item.reposts), Modifier,
                                selected = reposted,
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
                                onClick = {
                                val send = Intent(Intent.ACTION_SEND).apply {
                                    type = "text/plain"
                                    putExtra(Intent.EXTRA_TEXT, actions.postShareUrl(postId))
                                }
                                runCatching { context.startActivity(Intent.createChooser(send, "Share post")) }
                            })
                        }, trailing = {
                            CompactPostAction(Icons.Rounded.BookmarkBorder,
                                if (saved) "Remove from saved" else "Save post",
                                count = null, modifier = Modifier,
                                selected = saved,
                                activeIcon = if (saved) Icons.Rounded.Bookmark else Icons.Rounded.BookmarkBorder,
                                enabled = !busy, onClick = {
                                if (busy) return@CompactPostAction
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
    val currentPost = post
    if (commentsMode && currentPost != null && auth.account != null) {
        PostCommentsSheet(currentPost, actions, auth, allowWrite = true, signedInUserId = auth.account?.id,
            onDismiss = { commentsMode = false; highlightedComment = null },
            onRootPosted = { post = post?.let { it.copy(comments = it.comments + 1) } },
            onRootDeleted = { post = post?.let { it.copy(comments = (it.comments - 1).coerceAtLeast(0)) } },
            onCommentChanged = {}, focusedCommentId = highlightedComment, onOpenProfile = onOpenProfile)
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
