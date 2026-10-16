package com.sautilink.nativeapp.feature.home

import android.content.Intent
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.interaction.MutableInteractionSource
import com.sautilink.nativeapp.ui.components.sautiActionFeedback
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ArrowBack
import androidx.compose.material.icons.rounded.MoreHoriz
import androidx.compose.material.icons.rounded.NotificationsNone
import androidx.compose.material.icons.rounded.ChatBubbleOutline
import androidx.compose.material.icons.rounded.ThumbUp
import androidx.compose.material.icons.rounded.ThumbUpOffAlt
import androidx.compose.material.icons.rounded.Bookmark
import androidx.compose.material.icons.rounded.BookmarkBorder
import androidx.compose.material.icons.rounded.PhotoLibrary
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Repeat
import androidx.compose.material.icons.rounded.Share
import androidx.compose.material.icons.rounded.PersonAdd
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import com.sautilink.nativeapp.ui.components.SautiPostIcons
import com.sautilink.nativeapp.ui.components.SautiPostActionRow
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
import com.sautilink.nativeapp.feature.menu.AnimatedHamburgerButton
import com.sautilink.nativeapp.ui.components.SautiPostSkeleton
import com.sautilink.nativeapp.ui.components.SautiAvatar
import com.sautilink.nativeapp.ui.components.SautiVerificationBadge
import com.sautilink.nativeapp.ui.theme.SautiColors
import com.sautilink.nativeapp.ui.theme.SautiShape
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.TimeoutCancellationException
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
    savedRequestVersion: Int = 0,
    onOpenNotifications: () -> Unit = {},
    onOpenSettings: () -> Unit = {},
    onOpenMenu: () -> Unit = {},
    onOpenVideos: () -> Unit = {},
    onOpenRooms: () -> Unit = {},
    onOpenProfile: (String) -> Unit = {},
    onOpenPost: (String) -> Unit = {}
) {
    val account = auth.account
    val accountId = account?.id
    val sessionState = auth.sessionState
    var mode by rememberSaveable(auth.backend.id) {
        mutableStateOf(if (savedRequestVersion > 0 && auth.backend == SautiBackend.PRODUCTION)
            "saved" else "for_you")
    }
    LaunchedEffect(savedRequestVersion) {
        if (mode == "short_videos") mode = "for_you" // Retire saved old tab state.
        if (savedRequestVersion > 0 && auth.backend == SautiBackend.PRODUCTION) mode = "saved"
    }
    var refreshVersion by remember { mutableIntStateOf(0) }
    // A new feed/account must start with its own loading state. Otherwise one frame can
    // show the previous tab's posts or the empty-state card before LaunchedEffect runs.
    var loading by remember(accountId, mode) { mutableStateOf(account != null) }
    var loadingMore by remember(accountId, mode) { mutableStateOf(false) }
    var error by remember(accountId, mode) { mutableStateOf<String?>(null) }
    var posts by remember(accountId, mode) { mutableStateOf<List<StagingFeedPost>>(emptyList()) }
    var offset by remember(accountId, mode) { mutableIntStateOf(0) }
    var hasMore by remember(accountId, mode) { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val online = rememberNetworkAvailable()
    val client = remember(auth) { StagingFeedClient(auth) }
    val actions = remember(auth) { PostInteractionsClient(auth) }
    val canInteract = auth.backend == SautiBackend.PRODUCTION && account != null && online
    // Separate Like and Save state: one slow lookup never disables the other.
    var likeStates by remember(auth, accountId) { mutableStateOf<Map<String, Boolean>>(emptyMap()) }
    var savedStates by remember(auth, accountId) { mutableStateOf<Map<String, Boolean>>(emptyMap()) }
    var repostStates by remember(auth, accountId) { mutableStateOf<Map<String, Boolean>>(emptyMap()) }
    var followingStates by remember(auth, accountId) { mutableStateOf<Map<String, Boolean>>(emptyMap()) }
    // Pending intent is separate from the state confirmed by the server.
    var pendingFollowStates by remember(auth, accountId) { mutableStateOf<Map<String, Boolean>>(emptyMap()) }
    // Keep confirmed artwork across refresh/offline; a late GET cannot undo a confirmed tap.
    val actionStateVersions = remember(auth, accountId) { FeedActionVersions() }
    var followReadError by remember(auth, accountId) { mutableStateOf<String?>(null) }
    var followRetryVersion by remember(auth, accountId) { mutableIntStateOf(0) }
    var likeReadError by remember(auth, accountId) { mutableStateOf<String?>(null) }
    var savedReadError by remember(auth, accountId) { mutableStateOf<String?>(null) }
    var repostReadError by remember(auth, accountId) { mutableStateOf<String?>(null) }
    var repostCountSyncVersion by remember(auth, accountId) { mutableIntStateOf(0) }
    var actionError by remember(auth, accountId) { mutableStateOf<String?>(null) }
    var actionErrorPostId by remember(auth, accountId) { mutableStateOf<String?>(null) }
    var actionRetryVersion by remember(auth, accountId) { mutableIntStateOf(0) }
    var busyKeys by remember(auth, accountId) { mutableStateOf<Set<String>>(emptySet()) }
    var commentsFor by remember(auth, accountId) { mutableStateOf<StagingFeedPost?>(null) }
    var commentCountSyncVersion by remember(auth, accountId) { mutableIntStateOf(0) }

    val shownPostIds = remember(posts) { posts.map { it.id } }
    // Each request has a deadline and its own result/error. No mutation happens here.
    LaunchedEffect(auth, accountId, shownPostIds, actionRetryVersion, canInteract, refreshVersion, mode) {
        if (!canInteract || shownPostIds.isEmpty()) return@LaunchedEffect
        val expectedId = accountId
        val readVersions = actionStateVersions.snapshot()
        val missingLikes = shownPostIds
        val missingSaved = shownPostIds
        val missingReposts = shownPostIds
        if (missingLikes.isNotEmpty()) {
            launch {
                try {
                    val loaded = withTimeout(18_000L) { actions.getLikeStates(missingLikes) }
                    if (auth.account?.id == expectedId) {
                        likeStates = actionStateVersions.reconcile("like", likeStates, loaded, readVersions)
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
                        savedStates = actionStateVersions.reconcile("saved", savedStates, loaded, readVersions)
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
                        repostStates = actionStateVersions.reconcile("repost", repostStates, loaded, readVersions)
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

    val shownAuthorIds = remember(posts, accountId) {
        posts.map { it.authorId }.filter { it.isNotBlank() && it != accountId }.distinct()
    }
    // Independent from Like/Save/Repost: a slow Follow lookup never stalls a post action.
    LaunchedEffect(auth, accountId, shownAuthorIds, followRetryVersion, canInteract, refreshVersion, mode) {
        if (!canInteract || shownAuthorIds.isEmpty()) return@LaunchedEffect
        val expectedAccountId = accountId
        val readVersions = actionStateVersions.snapshot()
        val missing = shownAuthorIds
        if (missing.isEmpty()) return@LaunchedEffect
        try {
            val loaded = withTimeout(18_000L) { actions.getFollowingStates(missing) }
            if (auth.account?.id == expectedAccountId) {
                // A confirmed tap made while loading takes precedence over a late GET.
                followingStates = actionStateVersions.reconcile("follow", followingStates, loaded, readVersions)
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
    LaunchedEffect(auth, accountId, shownPostIds, actionRetryVersion, canInteract, refreshVersion, mode) {
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

    fun changeAction(post: StagingFeedPost, kind: String, addOnly: Boolean = false) {
        if (!canInteract) return
        val key = "$kind:${post.id}"
        if (key in busyKeys) return
        val expectedUser = auth.account?.id
        val previous = if (kind == "like") likeStates[post.id] else savedStates[post.id]
        if (addOnly && previous == true) return
        // When state is unknown, a user tap means explicit Like/Save (idempotent POST),
        // NEVER Unlike/Unsave. This avoids a stuck status lookup disabling both buttons.
        val desired = addOnly || previous != true
        busyKeys = busyKeys + key
        actionError = null
        actionErrorPostId = null
        scope.launch {
            try {
                if (kind == "like") actions.setLike(post.id, desired)
                else actions.setSaved(post.id, desired)
                if (auth.account?.id != expectedUser) return@launch
                if (kind == "like") {
                    actionStateVersions.changed("like:${post.id}")
                    likeStates = likeStates + (post.id to desired)
                    // An unknown prior state may already be liked: do not invent a count.
                    if (previous != null) posts = posts.map { item -> if (item.id == post.id) item.copy(likes =
                        (item.likes + if (previous) -1 else 1).coerceAtLeast(0)) else item }
                } else {
                    actionStateVersions.changed("saved:${post.id}")
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
                actionStateVersions.changed("repost:${post.id}")
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
                    actionStateVersions.changed("repost:${post.id}")
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
        pendingFollowStates = pendingFollowStates + (post.authorId to desired)
        actionError = null
        actionErrorPostId = null
        scope.launch {
            try {
                withTimeout(20_000L) { actions.setFollow(post.authorHandle, desired) }
                if (auth.account?.id != expectedUserId) return@launch
                client.invalidateFollowing()
                actionStateVersions.changed("follow:${post.authorId}")
                followingStates = followingStates + (post.authorId to desired)
                followReadError = null
                // Following must not continue showing an author the user has just unfollowed.
                if (mode == "following" && !desired) refreshVersion++
            } catch (_: TimeoutCancellationException) {
                if (auth.account?.id == expectedUserId) {
                    actionStateVersions.changed("follow:${post.authorId}")
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
                pendingFollowStates = pendingFollowStates - post.authorId
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

    LaunchedEffect(client, accountId, mode, refreshVersion, online) {
        val cachedPage = if (account == null) null else client.cached(mode)
        // Existing rows/counts and confirmed viewer states stay visible during revalidation.
        // remember(account.id, mode) supplies an empty list for a genuinely different feed.
        if (posts.isEmpty()) posts = cachedPage?.posts.orEmpty()
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
                        Row(verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                            androidx.compose.foundation.Image(
                                painter = androidx.compose.ui.res.painterResource(
                                    com.sautilink.nativeapp.R.drawable.sautilink_logo),
                                contentDescription = "SautiLink logo",
                                modifier = Modifier.width(42.dp).height(28.dp),
                                contentScale = androidx.compose.ui.layout.ContentScale.Fit)
                            Text("SautiLink", style = MaterialTheme.typography.titleLarge,
                                fontWeight = FontWeight.ExtraBold,
                                color = MaterialTheme.colorScheme.onSurface,
                                maxLines = 1)
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
                        // Notifications already has a dedicated bottom-navigation destination.
                        AnimatedHamburgerButton(onClick = onOpenMenu)
                    }
                },
                windowInsets = WindowInsets(0, 0, 0, 0)
            )
        }
    ) { insets ->
        LazyColumn(
            Modifier.fillMaxSize().padding(insets),
            contentPadding = PaddingValues(start = 10.dp, end = 10.dp, top = 6.dp,
                bottom = if (asHome) 90.dp else 24.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            item {
                Row(modifier = Modifier.horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FeedModePill("For You", mode == "for_you") { mode = "for_you" }
                    FeedModePill("Following", mode == "following") { mode = "following" }
                    FeedModePill("Trending", mode == "trending") { mode = "trending" }
                }
            }
            if (mode == "saved" && auth.backend == SautiBackend.PRODUCTION) item {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text("Saved posts", modifier = Modifier.weight(1f),
                        fontWeight = FontWeight.SemiBold,
                        style = MaterialTheme.typography.titleMedium)
                    TextButton(onClick = { mode = "for_you" }) { Text("Back to For You") }
                }
            }
            if (mode == "trending") item {
                Text("Top 20 trending · public posts from the last 7 days",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 3.dp))
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
                    StagingSessionState.CHECKING -> items(2) { SautiPostSkeleton() }
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
                if (loading && posts.isEmpty()) items(3) { SautiPostSkeleton() }
                if (error != null) item { FeedMessageCard(error.orEmpty()) {
                    OutlinedButton(onClick = { refreshVersion++ }, shape = SautiShape.Pill) { Text("Try again") }
                } }
                if (!loading && error == null && posts.isEmpty()) item {
                    FeedMessageCard(when (mode) {
                        "following" -> "No posts from followed accounts yet."
                        "short_videos" -> "No accessible short videos available yet."
                        "trending" -> "No trending public posts available in the last 7 days."
                        "saved" -> "No saved posts yet. Save a post from For You or Following to find it here."
                        else -> "No accessible posts available for this account."
                    })
                }
                itemsIndexed(posts, key = { _, post -> post.id }) { index, post ->
                    RealPostCard(
                        post, auth,
                        trendingRank = if (mode == "trending") index + 1 else null,
                        online = online,
                        bufferingOverlayEnabled = asHome,
                        following = followingStates[post.authorId],
                        pendingFollow = pendingFollowStates[post.authorId],
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
                            actionStateVersions.changed("like:${post.id}")
                            likeStates = likeStates - post.id
                            actionRetryVersion++
                        },
                        onRetrySaved = {
                            savedReadError = null
                            actionStateVersions.changed("saved:${post.id}")
                            savedStates = savedStates - post.id
                            actionRetryVersion++
                        },
                        onRetryRepost = {
                            repostReadError = null
                            actionStateVersions.changed("repost:${post.id}")
                            repostStates = repostStates - post.id
                            actionRetryVersion++
                        },
                        onLike = { changeAction(post, "like") },
                        onDoubleTapLike = { changeAction(post, "like", addOnly = true) },
                        onSave = { changeAction(post, "save") },
                        onComments = { commentsFor = post },
                        onRepost = { changeRepost(post) },
                        onShare = { sharePost(post) },
                        onOpenProfile = { if (post.authorHandle.isNotBlank()) onOpenProfile(post.authorHandle) },
                        onOpenPost = { onOpenPost(post.id) },
                        onFollow = { changeFollow(post) },
                        onRetryFollow = {
                            followReadError = null
                            actionStateVersions.changed("follow:${post.authorId}")
                            followingStates = followingStates - post.authorId
                            followRetryVersion++
                        }
                    )
                }
                if (hasMore && error == null && !loading) item {
                    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                        if (loadingMore) SautiPostSkeleton()
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
    val commentStateHolder = key(auth.backend.id, accountId) { rememberSaveableStateHolder() }
    val selectedPost = commentsFor
    if (selectedPost != null) {
        commentStateHolder.SaveableStateProvider(selectedPost.id) {
            PostCommentsSheet(
                post = selectedPost, actions = actions,
                allowWrite = canInteract,
                signedInUserId = accountId,
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

private fun feedFollowVisible(auth: StagingAuthClient, post: StagingFeedPost): Boolean {
    if (auth.backend != SautiBackend.PRODUCTION) return false
    val account = auth.account ?: return false
    return post.authorId != account.id &&
        Regex("^[a-z0-9][a-z0-9._]{2,29}$").matches(post.authorHandle)
}

private fun feedLikeGesture(auth: StagingAuthClient, online: Boolean, busy: Boolean,
    onLike: () -> Unit): (() -> Unit)? {
    if (!online || busy) return null
    if (auth.account == null || auth.backend != SautiBackend.PRODUCTION) return null
    return onLike
}

@Composable
private fun FeedFollowButton(following: Boolean?, pending: Boolean?, enabled: Boolean,
    onFollow: () -> Unit) {
    val interaction = remember { MutableInteractionSource() }
    val label = when (pending) {
        true -> "Following…"
        false -> "Unfollowing…"
        null -> if (following == true) "Following" else "Follow"
    }
    OutlinedButton(onClick = onFollow, enabled = enabled, interactionSource = interaction,
        modifier = Modifier.heightIn(min = 40.dp), shape = RoundedCornerShape(13.dp),
        contentPadding = PaddingValues(horizontal = 9.dp, vertical = 0.dp)) {
        Text(label, modifier = Modifier.sautiActionFeedback(interaction),
            style = MaterialTheme.typography.labelMedium, maxLines = 1)
    }
}

@Composable
private fun FeedPostBodyAndMedia(post: StagingFeedPost, auth: StagingAuthClient,
    onDoubleTapLike: (() -> Unit)?, bufferingOverlayEnabled: Boolean) {
    if (post.body.isNotBlank()) {
        com.sautilink.nativeapp.ui.components.SautiPostGestureSurface(
            Modifier.fillMaxWidth(), onLike = onDoubleTapLike) {
            com.sautilink.nativeapp.ui.components.SautiPostText(post.body,
                style = MaterialTheme.typography.bodyLarge,
                modifier = Modifier.fillMaxWidth().padding(start = 14.dp, end = 14.dp, bottom = 10.dp))
        }
    }
    // Gallery is flush with card edges; caption is never overlaid onto the media.
    if (post.media.isNotEmpty()) {
        PostMediaGallery(auth, post.media, onDoubleTapLike = onDoubleTapLike,
            bufferingOverlayEnabled = bufferingOverlayEnabled)
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
}

@Composable
private fun RealPostCard(
    post: StagingFeedPost,
    auth: StagingAuthClient,
    trendingRank: Int?,
    online: Boolean,
    bufferingOverlayEnabled: Boolean,
    following: Boolean?,
    pendingFollow: Boolean?,
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
    onDoubleTapLike: () -> Unit,
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
    val doubleTapLike = feedLikeGesture(auth, online, busyLike, onDoubleTapLike)
    val showFollow = feedFollowVisible(auth, post)
    Surface(
        shape = RoundedCornerShape(14.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = .18f)),
        shadowElevation = 0.dp,
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(0.dp)) {
            if (trendingRank != null) {
                Text("#$trendingRank on Trending",
                    color = SautiColors.Red,
                    fontWeight = FontWeight.SemiBold,
                    style = MaterialTheme.typography.labelMedium,
                    modifier = Modifier.padding(start = 14.dp, top = 9.dp))
            }
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
                if (showFollow) {
                    FeedFollowButton(following, pendingFollow, online && !busyFollow, onFollow)
                }
                if (auth.backend == SautiBackend.PRODUCTION) {
                    IconButton(onClick = onOpenPost, enabled = online, modifier = Modifier.size(48.dp)) {
                        Icon(Icons.Rounded.MoreHoriz, contentDescription = "Post options",
                            modifier = Modifier.size(23.dp))
                    }
                }
            }
            if (showFollow && followReadError != null) {
                Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp),
                    verticalAlignment = Alignment.CenterVertically) {
                    Text("Follow status unavailable", style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error, modifier = Modifier.weight(1f))
                    TextButton(onClick = onRetryFollow) { Text("Retry Follow") }
                }
            }
            FeedPostBodyAndMedia(post, auth, doubleTapLike, bufferingOverlayEnabled)
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
                    // The leading actions wrap their content instead of expanding into equal columns.
                    SautiPostActionRow(actions = {
                        CompactPostAction(Icons.Rounded.ThumbUpOffAlt,
                            if (liked == true) "Unlike post" else "Like post", feedCount(post.likes),
                            Modifier, onLike, online && !busyLike,
                            if (liked == true) SautiColors.Red else MaterialTheme.colorScheme.onSurfaceVariant,
                            if (liked == true) Icons.Rounded.ThumbUp else Icons.Rounded.ThumbUpOffAlt)
                        CompactPostAction(Icons.Rounded.ChatBubbleOutline, "View comments",
                            feedCount(post.comments), Modifier, onComments, online)
                        CompactPostAction(Icons.Rounded.Repeat,
                            if (reposted == true) "Undo repost" else "Repost",
                            feedCount(post.reposts), Modifier, onRepost,
                            online && !busyRepost,
                            if (reposted == true) MaterialTheme.colorScheme.primary
                                else MaterialTheme.colorScheme.onSurfaceVariant)
                        CompactPostAction(SautiPostIcons.Share, "Share post", null,
                            Modifier, onShare)
                    }, trailing = {
                        val saveInteraction = remember { MutableInteractionSource() }
                        IconButton(onClick = onSave, enabled = online && !busySave,
                            interactionSource = saveInteraction, modifier = Modifier.size(48.dp)) {
                            Icon(if (saved == true) Icons.Rounded.Bookmark else Icons.Rounded.BookmarkBorder,
                                if (saved == true) "Remove from saved" else "Save post",
                                modifier = Modifier.size(24.dp).sautiActionFeedback(saveInteraction),
                                tint = if (saved == true) MaterialTheme.colorScheme.primary
                                    else MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    })
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
    val interaction = remember { MutableInteractionSource() }
    val animatedTint by animateColorAsState(tint, tween(150), label = "Post action color")
    Row(
        modifier = modifier.sizeIn(minWidth = 48.dp, minHeight = 48.dp)
            .clickable(interactionSource = interaction, indication = ripple(), enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(horizontal = 1.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(activeIcon, contentDescription = label, tint = animatedTint, modifier = Modifier.size(20.dp).sautiActionFeedback(interaction))
        if (count != null) {
            Spacer(Modifier.width(2.dp))
            Text(count, style = MaterialTheme.typography.labelSmall,
                color = tint, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}
