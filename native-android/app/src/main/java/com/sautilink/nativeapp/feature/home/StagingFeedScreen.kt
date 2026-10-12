package com.sautilink.nativeapp.feature.home

import android.content.Intent
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ArrowBack
import androidx.compose.material.icons.rounded.MoreHoriz
import androidx.compose.material.icons.rounded.NotificationsNone
import androidx.compose.material.icons.rounded.ChatBubbleOutline
import androidx.compose.material.icons.rounded.Favorite
import androidx.compose.material.icons.rounded.FavoriteBorder
import androidx.compose.material.icons.rounded.Bookmark
import androidx.compose.material.icons.rounded.BookmarkBorder
import androidx.compose.material.icons.rounded.Send
import androidx.compose.material.icons.rounded.DeleteOutline
import androidx.compose.material.icons.rounded.PhotoLibrary
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Repeat
import androidx.compose.material.icons.rounded.Share
import androidx.compose.material.icons.rounded.PersonAdd
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.auth.SautiBackend
import com.sautilink.nativeapp.feature.auth.StagingSessionState
import com.sautilink.nativeapp.ui.components.SautiAvatar
import com.sautilink.nativeapp.ui.components.SautiVerificationBadge
import com.sautilink.nativeapp.ui.theme.SautiColors
import com.sautilink.nativeapp.ui.theme.SautiShape
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.TimeoutCancellationException
import java.util.UUID
import java.time.Duration
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.util.Locale

/** Explicit environment-isolated read-only feed; production and staging use different auth sessions. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StagingFeedScreen(
    auth: StagingAuthClient,
    onBack: () -> Unit,
    onSignIn: () -> Unit,
    asHome: Boolean = false,
    onOpenNotifications: () -> Unit = {},
    onOpenSettings: () -> Unit = {},
    onOpenVideos: () -> Unit = {},
    onOpenRooms: () -> Unit = {},
    onOpenProfile: (String) -> Unit = {},
    onOpenPost: (String) -> Unit = {}
) {
    val account = auth.account
    val sessionState = auth.sessionState
    var menuOpen by remember { mutableStateOf(false) }
    var mode by rememberSaveable(auth.backend.id) { mutableStateOf("for_you") }
    var refreshVersion by remember { mutableIntStateOf(0) }
    var loading by remember { mutableStateOf(false) }
    var loadingMore by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var posts by remember { mutableStateOf<List<StagingFeedPost>>(emptyList()) }
    var offset by remember { mutableIntStateOf(0) }
    var hasMore by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val online = rememberNetworkAvailable()
    val client = remember(auth) { StagingFeedClient(auth) }
    val actions = remember(auth) { PostInteractionsClient(auth) }
    val canInteract = auth.backend == SautiBackend.PRODUCTION && account != null && online
    // Separate Like and Save state: one slow lookup never disables the other.
    var likeStates by remember(auth, account?.id) { mutableStateOf<Map<String, Boolean>>(emptyMap()) }
    var savedStates by remember(auth, account?.id) { mutableStateOf<Map<String, Boolean>>(emptyMap()) }
    var repostStates by remember(auth, account?.id) { mutableStateOf<Map<String, Boolean>>(emptyMap()) }
    var followingStates by remember(auth, account?.id) { mutableStateOf<Map<String, Boolean>>(emptyMap()) }
    var followReadError by remember(auth, account?.id) { mutableStateOf<String?>(null) }
    var followRetryVersion by remember(auth, account?.id) { mutableIntStateOf(0) }
    var likeReadError by remember(auth, account?.id) { mutableStateOf<String?>(null) }
    var savedReadError by remember(auth, account?.id) { mutableStateOf<String?>(null) }
    var repostReadError by remember(auth, account?.id) { mutableStateOf<String?>(null) }
    var repostCountSyncVersion by remember(auth, account?.id) { mutableIntStateOf(0) }
    var actionError by remember(auth, account?.id) { mutableStateOf<String?>(null) }
    var actionErrorPostId by remember(auth, account?.id) { mutableStateOf<String?>(null) }
    var actionRetryVersion by remember(auth, account?.id) { mutableIntStateOf(0) }
    var busyKeys by remember(auth, account?.id) { mutableStateOf<Set<String>>(emptySet()) }
    var commentsFor by remember(auth, account?.id) { mutableStateOf<StagingFeedPost?>(null) }
    var commentCountSyncVersion by remember(auth, account?.id) { mutableIntStateOf(0) }

    val shownPostIds = remember(posts) { posts.map { it.id } }
    // Each request has a deadline and its own result/error. No mutation happens here.
    LaunchedEffect(auth, account?.id, shownPostIds, actionRetryVersion) {
        if (!canInteract || shownPostIds.isEmpty()) return@LaunchedEffect
        val expectedId = account?.id
        val missingLikes = shownPostIds.filterNot { it in likeStates }
        val missingSaved = shownPostIds.filterNot { it in savedStates }
        val missingReposts = shownPostIds.filterNot { it in repostStates }
        if (missingLikes.isNotEmpty()) {
            launch {
                try {
                    val loaded = withTimeout(18_000L) { actions.getLikeStates(missingLikes) }
                    if (auth.account?.id == expectedId) {
                        likeStates = loaded + likeStates
                        likeReadError = null
                    }
                } catch (_: TimeoutCancellationException) {
                    likeReadError = "Like status timed out after 18 seconds. Tap Retry."
                } catch (cancelled: CancellationException) { throw cancelled }
                catch (e: Exception) {
                    likeReadError = e.message ?: "Like status unavailable. Tap Retry."
                }
            }
        }
        if (missingSaved.isNotEmpty()) {
            launch {
                try {
                    val loaded = withTimeout(18_000L) { actions.getSavedStates(missingSaved) }
                    if (auth.account?.id == expectedId) {
                        savedStates = loaded + savedStates
                        savedReadError = null
                    }
                } catch (_: TimeoutCancellationException) {
                    savedReadError = "Saved status timed out after 18 seconds. Tap Retry."
                } catch (cancelled: CancellationException) { throw cancelled }
                catch (e: Exception) {
                    savedReadError = e.message ?: "Saved status unavailable. Tap Retry."
                }
            }
        }
        if (missingReposts.isNotEmpty()) {
            launch {
                try {
                    val loaded = withTimeout(18_000L) { actions.getRepostStates(missingReposts) }
                    if (auth.account?.id == expectedId) {
                        repostStates = loaded + repostStates
                        repostReadError = null
                    }
                } catch (_: TimeoutCancellationException) {
                    repostReadError = "Repost status timed out after 18 seconds. Tap Retry."
                } catch (cancelled: CancellationException) { throw cancelled }
                catch (e: Exception) {
                    repostReadError = e.message ?: "Repost status unavailable. Tap Retry."
                }
            }
        }
    }

    val shownAuthorIds = remember(posts, account?.id) {
        posts.map { it.authorId }.filter { it.isNotBlank() && it != account?.id }.distinct()
    }
    // Independent from Like/Save/Repost: a slow Follow lookup never stalls a post action.
    LaunchedEffect(auth, account?.id, shownAuthorIds, followRetryVersion) {
        if (!canInteract || shownAuthorIds.isEmpty()) return@LaunchedEffect
        val expectedAccountId = account?.id
        val missing = shownAuthorIds.filterNot { it in followingStates }
        if (missing.isEmpty()) return@LaunchedEffect
        try {
            val loaded = withTimeout(18_000L) { actions.getFollowingStates(missing) }
            if (auth.account?.id == expectedAccountId) {
                // A confirmed tap made while loading takes precedence over a late GET.
                followingStates = loaded + followingStates
                followReadError = null
            }
        } catch (_: TimeoutCancellationException) {
            followReadError = "Follow status timed out. Tap Retry."
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (e: Exception) {
            followReadError = e.message ?: "Follow status unavailable. Tap Retry."
        }
    }

    // UI watchdog independent from the network calls: never leave a spinner forever.
    LaunchedEffect(auth, account?.id, shownPostIds, actionRetryVersion) {
        if (canInteract && shownPostIds.isNotEmpty()) {
            delay(25_000L)
            if (shownPostIds.any { it !in likeStates } && likeReadError == null) {
                likeReadError = "Like check is taking too long. Tap Retry."
            }
            if (shownPostIds.any { it !in savedStates } && savedReadError == null) {
                savedReadError = "Saved check is taking too long. Tap Retry."
            }
            if (shownPostIds.any { it !in repostStates } && repostReadError == null) {
                repostReadError = "Repost check is taking too long. Tap Retry."
            }
        }
    }

    fun changeAction(post: StagingFeedPost, kind: String) {
        if (!canInteract) return
        val key = "$kind:${post.id}"
        if (key in busyKeys) return
        val expectedUser = auth.account?.id
        val previous = if (kind == "like") likeStates[post.id] else savedStates[post.id]
        // When state is unknown, a user tap means explicit Like/Save (idempotent POST),
        // NEVER Unlike/Unsave. This avoids a stuck status lookup disabling both buttons.
        val desired = previous != true
        busyKeys = busyKeys + key
        actionError = null
        actionErrorPostId = null
        scope.launch {
            try {
                if (kind == "like") actions.setLike(post.id, desired)
                else actions.setSaved(post.id, desired)
                if (auth.account?.id != expectedUser) return@launch
                if (kind == "like") {
                    likeStates = likeStates + (post.id to desired)
                    // An unknown prior state may already be liked: do not invent a count.
                    if (previous != null) posts = posts.map { item -> if (item.id == post.id) item.copy(likes =
                        (item.likes + if (previous) -1 else 1).coerceAtLeast(0)) else item }
                } else {
                    savedStates = savedStates + (post.id to desired)
                    if (mode == "saved" && !desired) {
                        // The server confirmed deletion. Remove only that item; no feed write is involved.
                        posts = posts.filterNot { it.id == post.id }
                    }
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (e: Exception) {
                if (auth.account?.id == expectedUser) {
                    actionError = "${if (kind == "like") "Like" else "Save"} failed: ${e.message ?: "Request failed"}"
                    actionErrorPostId = post.id
                }
            } finally {
                busyKeys = busyKeys - key
            }
        }
    }

    fun changeRepost(post: StagingFeedPost) {
        if (!canInteract) return
        val key = "repost:${post.id}"
        if (key in busyKeys) return
        val previous = repostStates[post.id]
        // Unknown status means a safe, idempotent Repost request, never an unrequested Undo.
        val desired = previous != true
        val expectedUser = auth.account?.id
        busyKeys = busyKeys + key
        actionError = null
        actionErrorPostId = null
        scope.launch {
            try {
                withTimeout(20_000L) { actions.setRepost(post.id, desired) }
                if (auth.account?.id != expectedUser) return@launch
                repostStates = repostStates + (post.id to desired)
                if (previous != null) {
                    posts = posts.map { p -> if (p.id == post.id)
                        p.copy(reposts = (p.reposts + if (previous) -1 else 1).coerceAtLeast(0)) else p }
                }
                val sequence = ++repostCountSyncVersion
                launch {
                    try {
                        val total = withTimeout(12_000L) { actions.loadRepostCount(post.id) }
                        if (auth.account?.id == expectedUser && sequence == repostCountSyncVersion) {
                            posts = posts.map { p -> if (p.id == post.id) p.copy(reposts = total) else p }
                        }
                    } catch (cancelled: CancellationException) { throw cancelled }
                    catch (_: Exception) { /* Normal feed refresh reconciles uncertain counts. */ }
                }
            } catch (_: TimeoutCancellationException) {
                if (auth.account?.id == expectedUser) {
                    actionError = "Repost took too long. Refresh to check its status before trying again."
                    actionErrorPostId = post.id
                    repostStates = repostStates - post.id
                    repostReadError = "Repost status is uncertain. Tap Retry."
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (e: Exception) {
                if (auth.account?.id == expectedUser) {
                    actionError = "Repost failed: ${e.message ?: "Request failed"}"
                    actionErrorPostId = post.id
                }
            } finally {
                busyKeys = busyKeys - key
            }
        }
    }

    fun changeFollow(post: StagingFeedPost) {
        if (!canInteract || post.authorId == auth.account?.id ||
            !Regex("^[a-z0-9][a-z0-9._]{2,29}$").matches(post.authorHandle)) return
        val key = "follow:${post.authorId}"
        if (key in busyKeys) return
        val previous = followingStates[post.authorId]
        // Unknown status is always interpreted as an explicit Follow, never Unfollow.
        val desired = previous != true
        val expectedUserId = auth.account?.id
        busyKeys = busyKeys + key
        actionError = null
        actionErrorPostId = null
        scope.launch {
            try {
                withTimeout(20_000L) { actions.setFollow(post.authorHandle, desired) }
                if (auth.account?.id != expectedUserId) return@launch
                followingStates = followingStates + (post.authorId to desired)
                followReadError = null
                // Following must not continue showing an author the user has just unfollowed.
                if (mode == "following" && !desired) refreshVersion++
            } catch (_: TimeoutCancellationException) {
                if (auth.account?.id == expectedUserId) {
                    followingStates = followingStates - post.authorId
                    actionError = "Follow request timed out. Check current status before trying again."
                    actionErrorPostId = post.id
                    followReadError = "Follow state uncertain. Tap Retry."
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (e: Exception) {
                if (auth.account?.id == expectedUserId) {
                    actionError = "Follow failed: ${e.message ?: "Request failed"}"
                    actionErrorPostId = post.id
                }
            } finally {
                busyKeys = busyKeys - key
            }
        }
    }

    fun sharePost(post: StagingFeedPost) {
        try {
            val link = actions.postShareUrl(post.id)
            val intent = Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_TEXT, link)
            }
            context.startActivity(Intent.createChooser(intent, "Share SautiLink post"))
            // Opening the Android chooser is NOT proof the post was actually shared.
        } catch (e: Exception) {
            actionError = "Couldn't open Android sharing. Try again."
            actionErrorPostId = post.id
        }
    }

    LaunchedEffect(client, account?.id, mode, refreshVersion, online) {
        val cachedPage = if (account == null) null else client.cached(mode)
        posts = cachedPage?.posts.orEmpty()
        likeStates = emptyMap()
        savedStates = emptyMap()
        repostStates = emptyMap()
        followingStates = emptyMap()
        followReadError = null
        likeReadError = null
        savedReadError = null
        repostReadError = null
        actionError = null
        actionErrorPostId = null
        offset = cachedPage?.nextOffset ?: 0
        error = null
        hasMore = cachedPage?.hasMore ?: false
        if (account == null) { client.clearCache(); loading = false; return@LaunchedEffect }
        if (!online) {
            loading = false
            error = if (cachedPage == null) "Offline. Reconnect to load posts."
                else "Offline. Showing recent posts saved in this session. Reconnect to refresh."
            return@LaunchedEffect
        }
        if (cachedPage != null && refreshVersion == 0 && (client.cacheAgeMs(mode) ?: Long.MAX_VALUE) < 45_000L) {
            loading = false
            return@LaunchedEffect
        }
        loading = true
        try {
            val page = client.load(mode, 0)
            posts = page.posts
            if (mode == "saved") {
                // The private saved relationship query itself confirms this state.
                savedStates = savedStates + page.posts.associate { it.id to true }
            }
            offset = page.nextOffset
            hasMore = page.hasMore
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (exception: Exception) {
            error = if (cachedPage != null) "Could not refresh. Showing recent posts. ${exception.message.orEmpty()}"
                else exception.message ?: "Unable to load feed."
        } finally {
            loading = false
        }
    }

    // The activity owns system-bar insets. Avoid doubling the status-bar spacer.
    Scaffold(
        containerColor = MaterialTheme.colorScheme.surfaceContainer,
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        topBar = {
            TopAppBar(
                title = {
                    if (asHome) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("Sauti", style = MaterialTheme.typography.headlineSmall,
                                fontWeight = FontWeight.Bold)
                            Text("Link", style = MaterialTheme.typography.headlineSmall,
                                fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
                        }
                    } else {
                        Column {
                            Text("SautiLink Feed", style = MaterialTheme.typography.titleLarge)
                            if (auth.backend != SautiBackend.PRODUCTION) {
                                Text("STAGING · READ ONLY", color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    style = MaterialTheme.typography.labelSmall)
                            }
                        }
                    }
                },
                navigationIcon = {
                    if (!asHome) IconButton(onClick = onBack) { Icon(Icons.Rounded.ArrowBack, "Back") }
                },
                actions = {
                    if (!asHome) {
                        IconButton(onClick = { refreshVersion++ }, enabled = account != null && !loading && !loadingMore) {
                            Icon(Icons.Rounded.Refresh, "Refresh posts")
                        }
                    } else {
                        IconButton(onClick = onOpenNotifications) {
                            Icon(Icons.Rounded.NotificationsNone, "Notifications")
                        }
                        Box {
                            IconButton(onClick = { menuOpen = true }) {
                                Icon(Icons.Rounded.MoreHoriz, "Home options")
                            }
                            DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                                DropdownMenuItem(
                                    text = { Text("Refresh feed") },
                                    enabled = account != null && !loading && !loadingMore,
                                    onClick = { menuOpen = false; refreshVersion++ }
                                )
                                if (auth.backend == SautiBackend.PRODUCTION) DropdownMenuItem(
                                    text = { Text("Rooms") }, onClick = { menuOpen = false; onOpenRooms() })
                                DropdownMenuItem(text = { Text("Settings") }, onClick = { menuOpen = false; onOpenSettings() })
                            }
                        }
                    }
                },
                windowInsets = WindowInsets(0, 0, 0, 0)
            )
        }
    ) { insets ->
        LazyColumn(
            Modifier.fillMaxSize().padding(insets),
            contentPadding = PaddingValues(start = 10.dp, end = 10.dp, top = 6.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            item {
                Row(modifier = Modifier.horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FeedModePill("For You", mode == "for_you") { mode = "for_you" }
                    FeedModePill("Following", mode == "following") { mode = "following" }
                    FeedModePill("Short Videos", mode == "short_videos") {
                        if (auth.backend == SautiBackend.PRODUCTION && asHome) onOpenVideos()
                        else mode = "short_videos"
                    }
                    if (auth.backend == SautiBackend.PRODUCTION) {
                        FeedModePill("Saved", mode == "saved") { mode = "saved" }
                    }
                }
            }
            if (auth.backend != SautiBackend.PRODUCTION) item {
                Text("Staging test feed · Read only",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (actionError != null && account != null) item {
                FeedMessageCard(actionError.orEmpty()) {
                    TextButton(onClick = { actionError = null; actionErrorPostId = null; refreshVersion++ }) {
                        Text("Refresh posts")
                    }
                }
            }
            if (account == null) {
                when (sessionState) {
                    StagingSessionState.CHECKING -> item {
                        Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator()
                        }
                    }
                    StagingSessionState.RETRYABLE_ERROR -> item {
                        FeedMessageCard("Could not restore your session. Check your connection and try again; your sign-in is still saved on this device.") {
                            Button(onClick = { scope.launch { auth.restoreSession() } }, shape = SautiShape.Pill) { Text("Retry session") }
                            TextButton(onClick = onSignIn) { Text("Account options") }
                        }
                    }
                    else -> item {
                        FeedMessageCard("Sign in to SautiLink to see posts from your community.") {
                            Button(onClick = onSignIn, shape = SautiShape.Pill) { Text("Sign in to SautiLink") }
                        }
                    }
                }
            } else {
                if (loading) item {
                    Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator()
                    }
                }
                if (error != null) item { FeedMessageCard(error.orEmpty()) {
                    OutlinedButton(onClick = { refreshVersion++ }, shape = SautiShape.Pill) { Text("Try again") }
                } }
                if (!loading && error == null && posts.isEmpty()) item {
                    FeedMessageCard(when (mode) {
                        "following" -> "No posts from followed accounts yet."
                        "short_videos" -> "No accessible short videos available yet."
                        "saved" -> "No saved posts yet. Save a post from For You or Following to find it here."
                        else -> "No accessible posts available for this account."
                    })
                }
                items(posts, key = { it.id }) { post ->
                    RealPostCard(
                        post, auth,
                        online = online,
                        following = followingStates[post.authorId],
                        busyFollow = "follow:${post.authorId}" in busyKeys,
                        followReadError = if (followingStates[post.authorId] == null) followReadError else null,
                        liked = likeStates[post.id],
                        saved = savedStates[post.id],
                        reposted = repostStates[post.id],
                        busyLike = "like:${post.id}" in busyKeys,
                        busySave = "save:${post.id}" in busyKeys,
                        busyRepost = "repost:${post.id}" in busyKeys,
                        likeReadError = if (likeStates[post.id] == null) likeReadError else null,
                        savedReadError = if (savedStates[post.id] == null) savedReadError else null,
                        repostReadError = if (repostStates[post.id] == null) repostReadError else null,
                        mutationError = if (actionErrorPostId == post.id) actionError else null,
                        onRetryLike = {
                            likeReadError = null
                            likeStates = likeStates - post.id
                            actionRetryVersion++
                        },
                        onRetrySaved = {
                            savedReadError = null
                            savedStates = savedStates - post.id
                            actionRetryVersion++
                        },
                        onRetryRepost = {
                            repostReadError = null
                            repostStates = repostStates - post.id
                            actionRetryVersion++
                        },
                        onLike = { changeAction(post, "like") },
                        onSave = { changeAction(post, "save") },
                        onComments = { commentsFor = post },
                        onRepost = { changeRepost(post) },
                        onShare = { sharePost(post) },
                        onOpenProfile = { if (post.authorHandle.isNotBlank()) onOpenProfile(post.authorHandle) },
                        onOpenPost = { onOpenPost(post.id) },
                        onFollow = { changeFollow(post) },
                        onRetryFollow = {
                            followReadError = null
                            followingStates = followingStates - post.authorId
                            followRetryVersion++
                        }
                    )
                }
                if (hasMore && error == null && !loading) item {
                    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                        if (loadingMore) CircularProgressIndicator(Modifier.padding(15.dp))
                        else OutlinedButton(onClick = {
                            val requestedUserId = auth.account?.id
                            val requestedMode = mode
                            val requestedRefresh = refreshVersion
                            val requestedOffset = offset
                            loadingMore = true
                            scope.launch {
                                try {
                                    val page = client.load(requestedMode, requestedOffset)
                                    // Ignore late results after changing accounts, feed tabs, or refreshing.
                                    if (auth.account?.id != requestedUserId || mode != requestedMode || refreshVersion != requestedRefresh) return@launch
                                    val known = posts.map { it.id }.toSet()
                                    posts = posts + page.posts.filterNot { it.id in known }
                                    if (requestedMode == "saved") {
                                        savedStates = savedStates + page.posts.associate { it.id to true }
                                    }
                                    offset = page.nextOffset
                                    hasMore = page.hasMore
                                } catch (cancelled: CancellationException) {
                                    throw cancelled
                                } catch (exception: Exception) {
                                    if (auth.account?.id == requestedUserId && mode == requestedMode && refreshVersion == requestedRefresh)
                                        error = exception.message ?: "Unable to load more posts."
                                } finally {
                                    loadingMore = false
                                }
                            }
                        }, shape = SautiShape.Pill) { Text("Load more posts") }
                    }
                }
            }
        }
    }
    val selectedPost = commentsFor
    if (selectedPost != null) {
        PostCommentsSheet(
            post = selectedPost, actions = actions,
            allowWrite = canInteract,
            signedInUserId = account?.id,
            onDismiss = { commentsFor = null },
            onRootPosted = {
                posts = posts.map { p -> if (p.id == selectedPost.id) p.copy(comments = p.comments + 1) else p }
            },
            onRootDeleted = {
                posts = posts.map { p -> if (p.id == selectedPost.id) p.copy(comments = (p.comments - 1).coerceAtLeast(0)) else p }
            },
            onCommentChanged = {
                val expectedAccountId = auth.account?.id
                val sequence = ++commentCountSyncVersion
                scope.launch {
                    try {
                        val total = withTimeout(12_000L) { actions.loadCommentCount(selectedPost.id) }
                        if (auth.account?.id == expectedAccountId && sequence == commentCountSyncVersion) {
                            posts = posts.map { p -> if (p.id == selectedPost.id) p.copy(comments = total) else p }
                        }
                    } catch (cancelled: CancellationException) { throw cancelled }
                    catch (_: Exception) { /* Optimistic count remains until the next feed refresh. */ }
                }
            }
        )
    }
}

private fun feedCount(count: Int): String = when {
    count >= 1_000_000 -> String.format(Locale.US, "%.1fM", count / 1_000_000.0)
    count >= 1_000 -> String.format(Locale.US, "%.1fK", count / 1_000.0)
    else -> count.toString()
}

/** Compact elapsed time for native social posts and comments, matching familiar social UI.
 * Supabase uses ISO-8601 timestamps, usually with a Z or +00:00 offset.
 * Timezones are honored and future/server-skew timestamps are clamped to 'now'.
 */
internal fun relativePostTime(isoDate: String, now: Instant = Instant.now()): String {
    val timestamp = isoDate.trim().replace(' ', 'T')
    val postedAt = runCatching { OffsetDateTime.parse(timestamp).toInstant() }.getOrNull()
        ?: runCatching { Instant.parse(timestamp) }.getOrNull()
        ?: runCatching { LocalDateTime.parse(timestamp).toInstant(ZoneOffset.UTC) }.getOrNull()
        ?: return isoDate.take(10)
    val seconds = Duration.between(postedAt, now).seconds.coerceAtLeast(0L)
    val minutes = seconds / 60
    val hours = seconds / 3_600
    val days = seconds / 86_400
    return when {
        seconds < 60 -> "now"
        minutes < 60 -> "${minutes}m"
        hours < 24 -> "${hours}h"
        days < 7 -> "${days}d"
        days < 30 -> "${days / 7}w"
        days < 365 -> "${days / 30}mo"
        else -> "${days / 365}y"
    }
}

/** Compact selection chips with quiet grouped-surface styling and 44dp hit targets. */
@Composable
private fun FeedModePill(label: String, selected: Boolean, onClick: () -> Unit) {
    Surface(onClick = onClick, shape = SautiShape.Pill,
        color = if (selected) MaterialTheme.colorScheme.primary.copy(alpha = .12f)
                else MaterialTheme.colorScheme.surfaceContainer,
        modifier = Modifier.heightIn(min = 44.dp)) {
        Box(Modifier.padding(horizontal = 17.dp, vertical = 11.dp),
            contentAlignment = Alignment.Center) {
            Text(label, style = MaterialTheme.typography.labelLarge,
                fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
                color = if (selected) MaterialTheme.colorScheme.primary
                    else MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun FeedMessageCard(message: String, footer: @Composable () -> Unit = {}) {
    Surface(shape = SautiShape.Card, color = MaterialTheme.colorScheme.surfaceContainer, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(22.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text(message, style = MaterialTheme.typography.bodyMedium)
            footer()
        }
    }
}

@Composable
private fun RealPostCard(
    post: StagingFeedPost,
    auth: StagingAuthClient,
    online: Boolean,
    following: Boolean?,
    busyFollow: Boolean,
    followReadError: String?,
    liked: Boolean?,
    saved: Boolean?,
    reposted: Boolean?,
    busyLike: Boolean,
    busySave: Boolean,
    busyRepost: Boolean,
    likeReadError: String?,
    savedReadError: String?,
    repostReadError: String?,
    mutationError: String?,
    onRetryLike: () -> Unit,
    onRetrySaved: () -> Unit,
    onRetryRepost: () -> Unit,
    onLike: () -> Unit,
    onSave: () -> Unit,
    onComments: () -> Unit,
    onRepost: () -> Unit,
    onShare: () -> Unit,
    onOpenProfile: () -> Unit,
    onOpenPost: () -> Unit,
    onFollow: () -> Unit,
    onRetryFollow: () -> Unit
) {
    val initials = post.authorName.split(" ").filter { it.isNotBlank() }.take(2)
        .map { it.first().uppercaseChar() }.joinToString("").ifBlank { "SL" }
    Surface(
        shape = RoundedCornerShape(14.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = .18f)),
        shadowElevation = 0.dp,
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(0.dp)) {
            // Author identity and actions match the established SautiLink web order.
            Row(
                modifier = Modifier.fillMaxWidth()
                    .padding(start = 12.dp, end = 4.dp, top = 10.dp, bottom = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(9.dp)
            ) {
                if (post.hasAvatar && Regex("^[a-z0-9][a-z0-9._]{2,29}$").matches(post.authorHandle)) {
                    AuthorizedImage(
                        auth = auth,
                        route = "/api/profile-media/${post.authorHandle}/avatar",
                        description = "${post.authorName}'s avatar",
                        modifier = Modifier.size(44.dp).clip(CircleShape),
                        fallback = { SautiAvatar(initials, Modifier.size(44.dp), SautiColors.Blue) }
                    )
                } else SautiAvatar(initials, Modifier.size(44.dp), SautiColors.Blue)
                Column(
                    modifier = Modifier.weight(1f).clickable(onClick = onOpenProfile),
                    verticalArrangement = Arrangement.spacedBy(2.dp)
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(post.authorName, style = MaterialTheme.typography.titleMedium,
                            modifier = Modifier.weight(1f, fill = false),
                            maxLines = 1, overflow = TextOverflow.Ellipsis)
                        SautiVerificationBadge(post.verified, post.badgeType,
                            post.authorName, size = 16.dp)
                    }
                    Text(
                        "${if (post.authorHandle.isNotBlank()) "@${post.authorHandle} · " else ""}${relativePostTime(post.createdAt)}",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodySmall,
                        maxLines = 1, overflow = TextOverflow.Ellipsis
                    )
                }
                if (auth.backend == SautiBackend.PRODUCTION && auth.account != null &&
                    post.authorId != auth.account?.id &&
                    Regex("^[a-z0-9][a-z0-9._]{2,29}$").matches(post.authorHandle)) {
                    OutlinedButton(
                        onClick = onFollow, enabled = online && !busyFollow,
                        modifier = Modifier.heightIn(min = 40.dp),
                        shape = RoundedCornerShape(13.dp),
                        contentPadding = PaddingValues(horizontal = 9.dp, vertical = 0.dp)
                    ) {
                        if (busyFollow) {
                            CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                        } else {
                            Text(if (following == true) "Following" else "Follow",
                                style = MaterialTheme.typography.labelMedium,
                                maxLines = 1)
                        }
                    }
                }
                if (auth.backend == SautiBackend.PRODUCTION) {
                    IconButton(onClick = onOpenPost, enabled = online, modifier = Modifier.size(48.dp)) {
                        Icon(Icons.Rounded.MoreHoriz, contentDescription = "Post options",
                            modifier = Modifier.size(23.dp))
                    }
                }
            }
            if (auth.backend == SautiBackend.PRODUCTION && auth.account != null &&
                post.authorId != auth.account?.id &&
                Regex("^[a-z0-9][a-z0-9._]{2,29}$").matches(post.authorHandle) && followReadError != null) {
                Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp),
                    verticalAlignment = Alignment.CenterVertically) {
                    Text("Follow status unavailable", style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error, modifier = Modifier.weight(1f))
                    TextButton(onClick = onRetryFollow) { Text("Retry Follow") }
                }
            }
            if (post.body.isNotBlank()) {
                Text(post.body, style = MaterialTheme.typography.bodyLarge,
                    modifier = Modifier.fillMaxWidth().padding(start = 14.dp, end = 14.dp, bottom = 10.dp))
            }
            // Gallery is flush with card edges; caption is never overlaid onto the media.
            if (post.media.isNotEmpty()) {
                PostMediaGallery(auth, post.media)
            } else if (post.mediaCount > 0) {
                Surface(color = MaterialTheme.colorScheme.surfaceVariant) {
                    Row(Modifier.fillMaxWidth().padding(14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Icon(Icons.Rounded.PhotoLibrary, null, modifier = Modifier.size(19.dp))
                        Text("Media unavailable for this session", style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
            HorizontalDivider(
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp),
                color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = .55f)
            )
            if (auth.backend == SautiBackend.PRODUCTION) {
                Column(Modifier.fillMaxWidth().padding(horizontal = 10.dp)) {
                    // Only failures interrupt the feed, not routine relationship queries.
                    if (liked == null && likeReadError != null) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(likeReadError, style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.error, modifier = Modifier.weight(1f))
                            TextButton(onClick = onRetryLike) { Text("Retry Like") }
                        }
                    }
                    if (saved == null && savedReadError != null) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(savedReadError, style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.error, modifier = Modifier.weight(1f))
                            TextButton(onClick = onRetrySaved) { Text("Retry Save") }
                        }
                    }
                    if (reposted == null && repostReadError != null) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(repostReadError, style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.error, modifier = Modifier.weight(1f))
                            TextButton(onClick = onRetryRepost) { Text("Retry Repost") }
                        }
                    }
                    if (mutationError != null) {
                        Text(mutationError, color = MaterialTheme.colorScheme.error,
                            style = MaterialTheme.typography.bodySmall)
                    }
                    // Four compact web-like actions group on the left; Save stays at the far right.
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        CompactPostAction(Icons.Rounded.FavoriteBorder,
                            if (liked == true) "Unlike post" else "Like post", feedCount(post.likes),
                            Modifier.weight(1f), onLike, online && !busyLike,
                            if (liked == true) SautiColors.Red else MaterialTheme.colorScheme.onSurfaceVariant,
                            if (liked == true) Icons.Rounded.Favorite else Icons.Rounded.FavoriteBorder)
                        CompactPostAction(Icons.Rounded.ChatBubbleOutline, "View comments",
                            feedCount(post.comments), Modifier.weight(1f), onComments, online)
                        CompactPostAction(Icons.Rounded.Repeat,
                            if (reposted == true) "Undo repost" else "Repost",
                            feedCount(post.reposts), Modifier.weight(1f), onRepost,
                            online && !busyRepost,
                            if (reposted == true) MaterialTheme.colorScheme.primary
                                else MaterialTheme.colorScheme.onSurfaceVariant)
                        CompactPostAction(Icons.Rounded.Share, "Share post", null,
                            Modifier.weight(1f), onShare)
                        IconButton(onClick = onSave, enabled = online && !busySave,
                            modifier = Modifier.size(48.dp)) {
                            Icon(if (saved == true) Icons.Rounded.Bookmark else Icons.Rounded.BookmarkBorder,
                                if (saved == true) "Remove from saved" else "Save post",
                                modifier = Modifier.size(23.dp),
                                tint = if (saved == true) MaterialTheme.colorScheme.primary
                                    else MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            } else {
                Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("${post.likes} likes · ${post.comments} comments · ${post.reposts} reposts",
                        style = MaterialTheme.typography.labelMedium)
                    TextButton(onClick = onShare) {
                        Icon(Icons.Rounded.Share, "Share test post link", modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("Share link", style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
        }
    }
}

/** Compact accessible touch target; reaction counts stay beside their icons. */
@Composable
private fun CompactPostAction(
    icon: ImageVector,
    label: String,
    count: String?,
    modifier: Modifier,
    onClick: () -> Unit,
    enabled: Boolean = true,
    tint: Color = MaterialTheme.colorScheme.onSurfaceVariant,
    activeIcon: ImageVector = icon
) {
    Row(
        modifier = modifier.heightIn(min = 48.dp)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(horizontal = 1.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(activeIcon, contentDescription = label, tint = tint, modifier = Modifier.size(21.dp))
        if (count != null) {
            Spacer(Modifier.width(3.dp))
            Text(count, style = MaterialTheme.typography.labelSmall,
                color = tint, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}



/** Production comments and nested replies share SautiLink's existing guarded APIs.
 * Staging can browse, but may never send or delete content.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PostCommentsSheet(
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
    var trail by remember(post.id) { mutableStateOf<List<NativePostComment>>(emptyList()) }
    val parent = trail.lastOrNull()
    val targetId = parent?.id ?: post.id
    var comments by remember(post.id) { mutableStateOf<List<NativePostComment>>(emptyList()) }
    var loading by remember(post.id) { mutableStateOf(true) }
    var loadError by remember(post.id) { mutableStateOf<String?>(null) }
    var writeError by remember(post.id) { mutableStateOf<String?>(null) }
    var busySend by remember(post.id) { mutableStateOf(false) }
    var deletingId by remember(post.id) { mutableStateOf<String?>(null) }
    var confirmDelete by remember(post.id) { mutableStateOf<NativePostComment?>(null) }
    var refresh by remember(post.id) { mutableIntStateOf(0) }
    // Draft and idempotency key are scoped to their comment thread.
    var draft by rememberSaveable(post.id, targetId) { mutableStateOf("") }
    var requestId by remember(post.id, targetId) { mutableStateOf(UUID.randomUUID().toString()) }
    val mutating = busySend || deletingId != null

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

    ModalBottomSheet(onDismissRequest = onDismiss, shape = SautiShape.Sheet) {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 18.dp).padding(bottom = 20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                if (parent != null) {
                    IconButton(onClick = { trail = trail.dropLast(1); writeError = null }, enabled = !mutating) {
                        Icon(Icons.Rounded.ArrowBack, "Back to previous comments")
                    }
                }
                Column(Modifier.weight(1f)) {
                    Text(if (parent == null) "Comments" else "Replies", style = MaterialTheme.typography.titleLarge)
                    Text(
                        if (parent == null) "${post.authorName}'s post" else "Replying to ${parent.author}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                IconButton(onClick = { refresh++ }, enabled = !mutating && !loading) {
                    Icon(Icons.Rounded.Refresh, "Refresh comments")
                }
            }
            if (parent != null) {
                Surface(shape = SautiShape.Card, color = MaterialTheme.colorScheme.surfaceVariant) {
                    Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                        Text(parent.author + if (parent.handle.isNotBlank()) " · @${parent.handle}" else "",
                            style = MaterialTheme.typography.labelMedium)
                        Text(parent.body, style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
            if (loading) {
                Box(Modifier.fillMaxWidth().padding(12.dp), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            }
            if (loadError != null) {
                Text(loadError.orEmpty(), color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall)
                TextButton(onClick = { refresh++ }, enabled = !loading) { Text("Retry comments") }
            }
            if (!loading && loadError == null && comments.isEmpty()) {
                Text(if (parent == null) "No comments yet. Start the conversation." else "No replies yet.",
                    style = MaterialTheme.typography.bodyMedium)
            }
            LazyColumn(Modifier.fillMaxWidth().heightIn(max = 360.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
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
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                TextButton(
                                    onClick = { trail = trail + comment; writeError = null },
                                    enabled = !mutating
                                ) {
                                    Icon(Icons.Rounded.ChatBubbleOutline, null, Modifier.size(16.dp))
                                    Spacer(Modifier.width(5.dp))
                                    Text(if (comment.replyCount > 0) "Replies (${comment.replyCount})" else "Reply")
                                }
                                if (allowWrite && signedInUserId != null && comment.authorId == signedInUserId) {
                                    TextButton(
                                        onClick = { confirmDelete = comment },
                                        enabled = !mutating
                                    ) {
                                        if (deletingId == comment.id) {
                                            CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                                        } else {
                                            Icon(Icons.Rounded.DeleteOutline, null, Modifier.size(16.dp))
                                        }
                                        Spacer(Modifier.width(5.dp))
                                        Text("Delete", color = MaterialTheme.colorScheme.error)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            if (comments.size == 40) {
                Text("Showing the latest 40 in this thread.", style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
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
                        else Icon(Icons.Rounded.Send, if (parent == null) "Post comment" else "Post reply")
                    }
                }
            } else {
                Text("Read-only test environment", style = MaterialTheme.typography.bodySmall)
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
