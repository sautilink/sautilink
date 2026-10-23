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
import androidx.compose.foundation.lazy.rememberLazyListState
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
import androidx.compose.material.icons.rounded.PeopleOutline
import androidx.compose.material.icons.rounded.TrendingUp
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material3.*
import com.sautilink.nativeapp.ui.components.SautiIcon as Icon
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
import androidx.compose.ui.unit.sp
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.auth.SautiBackend
import com.sautilink.nativeapp.feature.auth.StagingSessionState
import com.sautilink.nativeapp.feature.auth.AuthRequestException
import com.sautilink.nativeapp.ui.state.rememberSessionScreenPresentationAccess
import com.sautilink.nativeapp.feature.menu.AnimatedHamburgerButton
import com.sautilink.nativeapp.feature.marketplace.MarketplaceButton
import com.sautilink.nativeapp.feature.stories.StoriesButton
import com.sautilink.nativeapp.feature.stories.StoryProfileAvatarRing
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
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.currentStateAsState
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
    requestedFeed: HomeFeedRequest? = null,
    onFeedRequestConsumed: (HomeFeedRequest) -> Unit = {},
    onOpenNotifications: () -> Unit = {},
    onOpenSettings: () -> Unit = {},
    onOpenMenu: () -> Unit = {},
    onOpenMarketplace: () -> Unit = {},
    onOpenStories: () -> Unit = {},
    unseenStories: Int = 0,
    onOpenVideos: () -> Unit = {},
    onOpenRooms: () -> Unit = {},
    onOpenProfile: (String) -> Unit = {},
    onOpenPost: (String) -> Unit = {}
) {
    val account = auth.account
    val accountId = account?.id
    val sessionState = auth.sessionState
    var mode by rememberSaveable(auth.backend.id) {
        mutableStateOf(requestedFeed?.takeIf { it.ownerId == accountId }?.mode ?: if (savedRequestVersion > 0 && auth.backend == SautiBackend.PRODUCTION)
            "saved" else "for_you")
    }
    LaunchedEffect(savedRequestVersion) {
        if (mode == "short_videos") mode = "for_you" // Retire saved old tab state.
        if (savedRequestVersion > 0 && auth.backend == SautiBackend.PRODUCTION) mode = "saved"
    }
    var refreshVersion by remember { mutableIntStateOf(0) }
    val requested = requestedFeed?.takeIf { it.ownerId == accountId }
    var appliedRequest by remember(auth, accountId) { mutableStateOf(requested) }
    LaunchedEffect(requested) {
        if (requested != null) {
            val laterIntent = appliedRequest !== requested
            appliedRequest = requested
            mode = requested.mode
            if (laterIntent) refreshVersion++
        }
    }
    val presentations = rememberSessionScreenPresentationAccess()
    val returnKey = "feed:$mode"
    val returnInitial: FeedReturnInitialState = remember(presentations, accountId, mode) {
        readFeedReturnPresentation(presentations.store, returnKey)
    }
    // A new feed/account must start with its own loading state. Otherwise one frame can
    // show the previous tab's posts or the empty-state card before LaunchedEffect runs.
    var loading by remember(accountId, mode) { mutableStateOf(account != null) }
    var loadingMore by remember(accountId, mode) { mutableStateOf(false) }
    var error by remember(accountId, mode) { mutableStateOf<String?>(null) }
    var posts by remember(accountId, mode) { mutableStateOf<List<StagingFeedPost>>(returnInitial.snapshot.posts) }
    var offset by remember(accountId, mode) { mutableIntStateOf(returnInitial.snapshot.nextOffset) }
    var hasMore by remember(accountId, mode) { mutableStateOf(returnInitial.snapshot.hasMore) }
    val feedListState = rememberLazyListState(returnInitial.snapshot.firstIndex, returnInitial.snapshot.firstOffset)
    var lastPresentedMode by rememberSaveable(auth.backend.id, accountId) { mutableStateOf(mode) }
    var userRefreshing by remember(auth, accountId, mode) { mutableStateOf(false) }
    var scrollAfterRefresh by remember(auth, accountId, mode) { mutableStateOf(false) }
    var newPostsAvailable by remember(auth, accountId, mode) { mutableStateOf(false) }
    val newPostsTracker = remember(auth, accountId, mode) { FeedNewPostsTracker() }
    val farFromTop by remember(feedListState) { derivedStateOf { feedListState.firstVisibleItemIndex >= 3 } }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val online = rememberNetworkAvailable()
    val client = remember(auth) { StagingFeedClient(auth) }
    val actions = remember(auth) { PostInteractionsClient(auth) }
    val canInteract = auth.backend == SautiBackend.PRODUCTION && account != null && online
    val lifecycleOwner = LocalLifecycleOwner.current
    val lifecycleState by lifecycleOwner.lifecycle.currentStateAsState()
    val canReadFollow = canInteract && sessionState == StagingSessionState.SIGNED_IN &&
        lifecycleState.isAtLeast(Lifecycle.State.STARTED)
    // Separate Like and Save state: one slow lookup never disables the other.
    var likeStates by remember(auth, accountId) { mutableStateOf<Map<String, Boolean>>(returnInitial.snapshot.liked) }
    var savedStates by remember(auth, accountId) { mutableStateOf<Map<String, Boolean>>(returnInitial.snapshot.saved) }
    var repostStates by remember(auth, accountId) { mutableStateOf<Map<String, Boolean>>(returnInitial.snapshot.reposted) }
    var followingStates by remember(auth, accountId) { mutableStateOf<Map<String, Boolean>>(returnInitial.snapshot.following) }
    var followFeedbackVersion by remember(auth, accountId) { mutableStateOf<Map<String, Int>>(returnInitial.snapshot.followFeedback) }
    // Pending intent is separate from the state confirmed by the server.
    var pendingFollowStates by remember(auth, accountId) { mutableStateOf<Map<String, Boolean>>(emptyMap()) }
    // Keep confirmed artwork across refresh/offline; a late GET cannot undo a confirmed tap.
    val actionStateVersions = remember(auth, accountId) { FeedActionVersions() }
    var actionReadKey by remember(auth, accountId) { mutableStateOf<Triple<String, Int, Int>?>(
        if (returnInitial.restored && (client.cacheAgeMs(mode) ?: Long.MAX_VALUE) < 45_000L) Triple(mode, 0, 0) else null) }
    var followReadError by remember(auth, accountId) { mutableStateOf<String?>(null) }
    var followRetryVersion by remember(auth, accountId) { mutableIntStateOf(0) }
    var followReadInFlight by remember(auth, accountId) { mutableStateOf(false) }
    var followReadTransient by remember(auth, accountId) { mutableStateOf(false) }
    var failedFollowAuthors by remember(auth, accountId) { mutableStateOf<Set<String>>(emptySet()) }
    var followReadGeneration by remember(auth, accountId) { mutableIntStateOf(0) }
    var followRefreshKey by remember(auth, accountId) { mutableStateOf<Pair<Int, String>?>(null) }
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
    DisposableEffect(presentations, accountId, mode) {
        onDispose {
            if (accountId != null && auth.account?.id == accountId && posts.size <= MAX_RETURN_FEED_POSTS && posts.isNotEmpty()) {
                presentations.save(returnKey, returnInitial.revision, buildFeedReturnPresentation(
                    posts, offset, hasMore, feedListState.firstVisibleItemIndex,
                    feedListState.firstVisibleItemScrollOffset,
                    likeStates, savedStates, repostStates, followingStates, followFeedbackVersion,
                    busyKeys, pendingFollowStates))
            } else if (posts.size > MAX_RETURN_FEED_POSTS) presentations.invalidate(returnKey)
        }
    }

    val shownPostIds = remember(posts) { posts.map { it.id } }
    // Each request has a deadline and its own result/error. No mutation happens here.
    LaunchedEffect(auth, accountId, shownPostIds, actionRetryVersion, canInteract, refreshVersion, mode) {
        if (!canInteract || shownPostIds.isEmpty()) return@LaunchedEffect
        val expectedId = accountId
        val readVersions = actionStateVersions.snapshot()
        val key = Triple(mode, refreshVersion, actionRetryVersion)
        val force = actionReadKey != key
        actionReadKey = key
        val missingLikes = shownPostIds.filter { force || it !in likeStates }
        val missingSaved = shownPostIds.filter { force || it !in savedStates }
        val missingReposts = shownPostIds.filter { force || it !in repostStates }
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
    LaunchedEffect(auth, accountId, shownAuthorIds, followRetryVersion, canReadFollow, refreshVersion, mode) {
        val generation = ++followReadGeneration
        followReadInFlight = false
        if (!canReadFollow || shownAuthorIds.isEmpty()) return@LaunchedEffect
        val expectedAccountId = accountId
        val expectedMode = mode
        val readVersions = actionStateVersions.snapshot()
        val refreshKey = refreshVersion to mode
        val missing = if (followRefreshKey != refreshKey) shownAuthorIds else
            shownAuthorIds.filter { it !in followingStates || it in failedFollowAuthors }
        if (missing.isEmpty()) return@LaunchedEffect
        followRefreshKey = refreshKey
        followReadInFlight = true
        fun current() = auth.account?.id == expectedAccountId && mode == expectedMode && followReadGeneration == generation
        fun unmodifiedAuthors(): Set<String> {
            val now = actionStateVersions.snapshot()
            return missing.filter { now["follow:$it"] == readVersions["follow:$it"] }.toSet()
        }
        try {
            val loaded = withTimeout(18_000L) { actions.getFollowingStates(missing) }
            if (current()) {
                // A confirmed tap made while loading takes precedence over a late GET.
                followingStates = actionStateVersions.reconcile("follow", followingStates, loaded, readVersions)
                failedFollowAuthors = failedFollowAuthors - missing.toSet()
                if (failedFollowAuthors.isEmpty()) { followReadError = null; followReadTransient = false }
            }
        } catch (_: TimeoutCancellationException) {
            if (current() && unmodifiedAuthors().isNotEmpty()) {
                failedFollowAuthors = failedFollowAuthors + unmodifiedAuthors()
                followReadTransient = true
                followReadError = "Follow status timed out. Tap Retry."
            }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (e: Exception) {
            if (current() && unmodifiedAuthors().isNotEmpty()) {
                failedFollowAuthors = failedFollowAuthors + unmodifiedAuthors()
                followReadTransient = followReadRetryDelay(e) != null
                followReadError = e.message ?: "Follow status unavailable. Tap Retry."
            }
        } finally {
            if (current()) followReadInFlight = false
        }
    }

    // Healthy states never refetch just because the app resumes. Only a failed
    // transient GET gets one new bounded read cycle when the user returns.
    val recoverFailedFollow: () -> Unit = {
        if (canReadFollow && !followReadInFlight && followReadTransient &&
            failedFollowAuthors.any { it in shownAuthorIds }) {
            followReadTransient = false
            followRetryVersion++
        }
    }
    val currentFollowRecovery by rememberUpdatedState(recoverFailedFollow)
    DisposableEffect(lifecycleOwner, auth, accountId, mode) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) currentFollowRecovery()
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
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
        // A feed tap only adds the relationship. Unfollow stays on the profile.
        if (previous == true) return
        val desired = true
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
                followFeedbackVersion = followFeedbackVersion + (post.authorId to refreshVersion)
                failedFollowAuthors = failedFollowAuthors - post.authorId
                followReadError = null
            } catch (_: TimeoutCancellationException) {
                if (auth.account?.id == expectedUserId) {
                    actionStateVersions.changed("follow:${post.authorId}")
                    followingStates = followingStates - post.authorId
                    actionError = "Follow request timed out. Check current status before trying again."
                    actionErrorPostId = post.id
                    followReadError = "Follow state uncertain. Tap Retry."
                    failedFollowAuthors = failedFollowAuthors + post.authorId
                    followReadTransient = true
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

    val canRefresh = account != null && sessionState == StagingSessionState.SIGNED_IN && online && !loading && !loadingMore && !userRefreshing
    fun requestRefresh(scrollToTop: Boolean) {
        if (!canRefresh || userRefreshing) return
        userRefreshing = true
        scrollAfterRefresh = scrollToTop
        refreshVersion++
    }

    LaunchedEffect(client, accountId, mode, refreshVersion, online) {
        if (requested != null && mode != requested.mode) return@LaunchedEffect
        val readScope = FeedReadScope(accountId, mode, refreshVersion)
        fun current() = readScope.current(auth.account?.id, mode, refreshVersion)
        val cachedPage = if (account == null) null else client.cached(readScope.mode)
        // Existing rows/counts and confirmed viewer states stay visible during revalidation.
        // remember(account.id, mode) supplies an empty list for a genuinely different feed.
        if (posts.isEmpty()) {
            posts = cachedPage?.posts.orEmpty()
            offset = cachedPage?.nextOffset ?: 0
            hasMore = cachedPage?.hasMore ?: false
        }
        followReadError = null
        likeReadError = null
        savedReadError = null
        repostReadError = null
        actionError = null
        actionErrorPostId = null
        error = null
        if (account == null) { client.clearCache(); loading = false; userRefreshing = false; return@LaunchedEffect }
        if (!online) {
            loading = false
            userRefreshing = false
            scrollAfterRefresh = false
            error = if (posts.isEmpty()) "Offline. Reconnect to load posts."
                else "Offline. Showing recent posts saved in this session. Reconnect to refresh."
            return@LaunchedEffect
        }
        if (requested == null && cachedPage != null && refreshVersion == 0 && (client.cacheAgeMs(readScope.mode) ?: Long.MAX_VALUE) < 45_000L) {
            loading = false
            return@LaunchedEffect
        }
        if (readScope.refreshVersion > 0) client.beginRefresh(readScope.mode)
        loading = true
        try {
            val page = client.load(readScope.mode, 0)
            if (!current()) return@LaunchedEffect
            val retainReadingPosition = requested == null && returnInitial.restored && posts.isNotEmpty() && !userRefreshing
            if (retainReadingPosition) {
                if (page.posts.any { fresh -> posts.none { it.id == fresh.id } }) newPostsAvailable = true
                posts = mergeReturningFeedRows(posts, page.posts)
            } else posts = page.posts
            if (requested?.postId != null && readScope.mode == "for_you") {
                // The server/RLS confirms the newly published row before it is pinned.
                val ownPost = client.loadOne(requested.postId)
                if (!current()) return@LaunchedEffect
                if (ownPost != null && ownPost.authorId == accountId) posts = listOf(ownPost) + posts.filterNot { it.id == ownPost.id }
            }
            if (readScope.mode == "saved") {
                // The private saved relationship query itself confirms this state.
                savedStates = savedStates + page.posts.associate { it.id to true }
            }
            if (!retainReadingPosition) { offset = page.nextOffset; hasMore = page.hasMore }
            followFeedbackVersion = followFeedbackVersion.filterValues { it >= readScope.refreshVersion }
            newPostsTracker.refreshed()
            if (!retainReadingPosition) newPostsAvailable = false
            if (scrollAfterRefresh || requested != null) {
                scrollAfterRefresh = false
                feedListState.scrollToItem(0)
            }
            requested?.let(onFeedRequestConsumed)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (exception: Exception) {
            if (!current()) return@LaunchedEffect
            if ((exception as? AuthRequestException)?.httpStatus in listOf(401, 403)) {
                presentations.invalidate("feed:")
                client.clearCache()
                posts = emptyList(); likeStates = emptyMap(); savedStates = emptyMap(); repostStates = emptyMap()
                followingStates = emptyMap(); offset = 0; hasMore = false
            }
            scrollAfterRefresh = false
            error = if (posts.isNotEmpty()) "Could not refresh. Showing recent posts. ${exception.message.orEmpty()}"
                else exception.message ?: "Unable to load feed."
        } finally {
            if (current()) { loading = false; userRefreshing = false }
        }
    }

    // The activity owns system-bar insets. Avoid doubling the status-bar spacer.
    LaunchedEffect(accountId, mode) {
        // A route round trip restores its anchor. An explicit feed-tab change starts at the top.
        if (lastPresentedMode != mode || !returnInitial.restored) feedListState.scrollToItem(0)
        else feedListState.scrollToItem(returnInitial.snapshot.firstIndex, returnInitial.snapshot.firstOffset)
        lastPresentedMode = mode
    }
    val pollHome = asHome && mode in setOf("following", "for_you", "trending") &&
        accountId != null && sessionState == StagingSessionState.SIGNED_IN && online &&
        lifecycleState.isAtLeast(Lifecycle.State.RESUMED) && !loading
    LaunchedEffect(auth, accountId, mode, refreshVersion, pollHome) {
        if (!pollHome) return@LaunchedEffect
        val readScope = FeedReadScope(accountId, mode, refreshVersion)
        while (readScope.current(auth.account?.id, mode, refreshVersion)) {
            var nextPoll = 30_000L
            if (!loadingMore) try {
                val head = client.readHead(readScope.mode)
                if (!readScope.current(auth.account?.id, mode, refreshVersion)) return@LaunchedEffect
                newPostsAvailable = newPostsTracker.observe(head)
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (error: Exception) {
                // Quiet pointer polling never changes rows/errors or replays an action.
                val status = (error as? FollowReadHttpFailure)?.status
                    ?: (error as? com.sautilink.nativeapp.feature.auth.AuthRequestException)?.httpStatus
                if (status == 401 || status == 403) return@LaunchedEffect
                nextPoll = feedHeadPollDelay(error)
            }
            delay(nextPoll)
        }
    }
    Scaffold(
        containerColor = MaterialTheme.colorScheme.surfaceContainer,
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        topBar = {
          Column {
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
                            Text("SautiLink", style = MaterialTheme.typography.headlineSmall,
                                fontWeight = FontWeight.Bold,
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
                        IconButton(onClick = { requestRefresh(scrollToTop = true) }, enabled = canRefresh) {
                            Icon(Icons.Rounded.Refresh, "Refresh posts")
                        }
                    } else {
                        // Notifications already has a dedicated bottom-navigation destination.
                        StoriesButton(unreadCount = unseenStories, onClick = onOpenStories)
                        MarketplaceButton(onClick = onOpenMarketplace)
                        AnimatedHamburgerButton(onClick = onOpenMenu)
                    }
                },
                windowInsets = WindowInsets(0, 0, 0, 0)
            )
            HomeFeedTabs(mode, onSelect = { mode = it },
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp))
          }
        }
    ) { insets ->
        FeedRefreshContainer(isRefreshing = userRefreshing && loading, refreshEnabled = canRefresh,
            newPostsAvailable = asHome && farFromTop && newPostsAvailable,
            onRefresh = { requestRefresh(scrollToTop = false) },
            onNewPosts = { requestRefresh(scrollToTop = true) }, modifier = Modifier.fillMaxSize().padding(insets)) {
        LazyColumn(
            Modifier.fillMaxSize(),
            state = feedListState,
            contentPadding = PaddingValues(start = 12.dp, end = 12.dp, top = 6.dp,
                bottom = if (asHome) 90.dp else 24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
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
                    TextButton(onClick = { actionError = null; actionErrorPostId = null; requestRefresh(scrollToTop = false) }) {
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
                    OutlinedButton(onClick = { requestRefresh(scrollToTop = true) }, shape = SautiShape.Pill) { Text("Try again") }
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
                        showFollowingFeedback = post.authorId in followFeedbackVersion,
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
                            failedFollowAuthors = failedFollowAuthors + post.authorId
                            followReadTransient = false
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
                                    if (auth.account?.id == requestedUserId && mode == requestedMode && refreshVersion == requestedRefresh)
                                        loadingMore = false
                                }
                            }
                        }, shape = SautiShape.Pill) { Text("Load more posts") }
                    }
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
                auth = auth,
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

internal fun feedCount(count: Int): String = when {
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
internal fun FeedFollowButton(following: Boolean?, pending: Boolean?, enabled: Boolean,
    onFollow: () -> Unit) {
    val interaction = remember { MutableInteractionSource() }
    val label = if (pending == true) "Following…" else if (following == true) "Following" else "Follow"
    OutlinedButton(onClick = onFollow, enabled = enabled && following != true && pending != true, interactionSource = interaction,
        modifier = Modifier.heightIn(min = 40.dp), shape = RoundedCornerShape(13.dp),
        colors = ButtonDefaults.outlinedButtonColors(disabledContentColor = if (following == true)
            MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant),
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
                style = MaterialTheme.typography.bodyMedium.copy(fontSize = 15.sp, lineHeight = 21.sp),
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
    showFollowingFeedback: Boolean,
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
    val showFollow = feedFollowVisible(auth, post) && feedFollowButtonVisible(following, showFollowingFeedback, pendingFollow)
    Surface(
        shape = RoundedCornerShape(22.dp),
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
                StoryProfileAvatarRing(post.authorHandle) {
                if (post.hasAvatar && Regex("^[a-z0-9][a-z0-9._]{2,29}$").matches(post.authorHandle)) {
                    AuthorizedImage(
                        auth = auth,
                        route = "/api/profile-media/${post.authorHandle}/avatar",
                        description = "${post.authorName}'s avatar",
                        modifier = Modifier.size(44.dp).clip(CircleShape),
                        fallback = { SautiAvatar(initials, Modifier.size(44.dp), SautiColors.Blue) }
                    )
                } else SautiAvatar(initials, Modifier.size(44.dp), SautiColors.Blue)
                }
                Column(
                    modifier = Modifier.weight(1f).clickable(onClick = onOpenProfile),
                    verticalArrangement = Arrangement.spacedBy(2.dp)
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(post.authorName, style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.SemiBold,
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
                    FeedPostOptions(post, auth, online, onOpenProfile, onOpenPost, onShare)
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
                                selected = saved == true,
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
internal fun CompactPostAction(
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
        Icon(activeIcon, contentDescription = label, tint = animatedTint,
            selected = activeIcon != icon,
            modifier = Modifier.size(20.dp).sautiActionFeedback(interaction))
        if (count != null) {
            Spacer(Modifier.width(2.dp))
            Text(count, style = MaterialTheme.typography.labelSmall,
                color = tint, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}
