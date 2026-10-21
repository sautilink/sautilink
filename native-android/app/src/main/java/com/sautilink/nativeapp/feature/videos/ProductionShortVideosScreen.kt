package com.sautilink.nativeapp.feature.videos

import com.sautilink.nativeapp.ui.components.SautiVerificationBadge

import android.content.Context
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.pager.VerticalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.VolumeOff
import androidx.compose.material.icons.automirrored.rounded.VolumeUp
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import com.sautilink.nativeapp.ui.components.SautiIcon as Icon
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import com.sautilink.nativeapp.feature.home.PostCommentsSheet
import com.sautilink.nativeapp.ui.components.SautiPostIcons
import androidx.compose.ui.Alignment
import com.sautilink.nativeapp.ui.components.sautiActionFeedback
import androidx.compose.ui.unit.sp
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.currentStateAsState
import com.sautilink.nativeapp.ui.components.VideoBufferingOverlay
import com.sautilink.nativeapp.ui.components.VideoPlaybackScope
import com.sautilink.nativeapp.ui.components.logVideoPlaybackFailure
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.auth.SautiBackend
import com.sautilink.nativeapp.feature.home.PostInteractionsClient
import com.sautilink.nativeapp.feature.home.StagingFeedClient
import com.sautilink.nativeapp.feature.home.NativePlaybackPreferences
import com.sautilink.nativeapp.feature.home.StagingFeedPost
import com.sautilink.nativeapp.feature.home.rememberNetworkAvailable
import com.sautilink.nativeapp.feature.home.rememberVideoRecoveryQuality
import com.sautilink.nativeapp.feature.home.replaceVideoPlaybackSource
import com.sautilink.nativeapp.feature.home.videoPlaybackPath
import com.sautilink.nativeapp.feature.home.videoPlaybackRequested
import com.sautilink.nativeapp.ui.components.NativeVideoMetadata
import com.sautilink.nativeapp.ui.components.NativeVideoQualityPolicy
import com.sautilink.nativeapp.ui.components.VideoPlaybackSettingsSheet
import com.sautilink.nativeapp.ui.components.rememberVideoPlaybackQuality
import com.sautilink.nativeapp.ui.components.nativeVideoPlaybackResources
import com.sautilink.nativeapp.ui.components.ShortVideoProgressControls
import com.sautilink.nativeapp.ui.components.VideoSettingsButton
import com.sautilink.nativeapp.ui.components.SautiSkeletonBlock
import com.sautilink.nativeapp.ui.components.SautiVideoGestureSurface
import com.sautilink.nativeapp.ui.components.videoSeekTarget
import com.sautilink.nativeapp.ui.theme.SautiShape
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import java.util.Locale

private data class LiveClip(val post: StagingFeedPost, val mediaId: String)

/** RLS-backed short-video feed. One authorized decoder is shared by all visible pages. */
@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun ProductionShortVideosScreen(
    auth: StagingAuthClient,
    onBack: () -> Unit,
    onSignIn: () -> Unit,
    onOpenProfile: (String) -> Unit
) {
    val context = LocalContext.current
    val online = rememberNetworkAvailable()
    val accountId = auth.account?.id
    val owner = LocalLifecycleOwner.current
    val lifecycleState by owner.lifecycle.currentStateAsState()
    val client = remember(auth) { StagingFeedClient(auth) }
    val actions = remember(auth) { PostInteractionsClient(auth) }
    val scope = rememberCoroutineScope()
    val feedback = remember { SnackbarHostState() }
    val preferences = remember(context) { context.getSharedPreferences("sautilink_live_video", Context.MODE_PRIVATE) }
    var clips by remember(auth) { mutableStateOf<List<LiveClip>>(emptyList()) }
    var nextOffset by remember(auth) { mutableIntStateOf(0) }
    var hasMore by remember(auth) { mutableStateOf(false) }
    var loading by remember(auth, auth.account?.id) { mutableStateOf(auth.account != null) }
    var error by remember(auth, auth.account?.id) { mutableStateOf<String?>(null) }
    var feedGeneration by remember(auth) { mutableIntStateOf(0) }
    var paginationError by remember(auth, auth.account?.id) { mutableStateOf<String?>(null) }
    var paginationLoading by remember(auth, auth.account?.id) { mutableStateOf(false) }
    var paginationGeneration by remember(auth) { mutableIntStateOf(0) }
    var reload by remember(auth) { mutableIntStateOf(0) }
    var pageRetry by remember(auth) { mutableIntStateOf(0) }
    var token by remember(auth) { mutableStateOf<String?>(null) }
    val muted = NativePlaybackPreferences.sessionMuted
    var autoplay by remember { mutableStateOf(preferences.getBoolean("autoplay", true)) }
    var quality by remember { mutableStateOf(preferences.getString("quality", "auto") ?: "auto") }
    var qualityOpen by remember { mutableStateOf(false) }
    var playbackSpeed by remember { mutableFloatStateOf(preferences.getFloat("playback_speed", 1f)
        .takeIf { it in setOf(.5f, .75f, 1f, 1.25f, 1.5f, 1.75f, 2f) } ?: 1f) }
    // All interaction state is server-confirmed. Unknown state never implies an Unlike/Undo.
    var likeStates by remember(auth, auth.account?.id) { mutableStateOf<Map<String, Boolean>>(emptyMap()) }
    var saveStates by remember(auth, auth.account?.id) { mutableStateOf<Map<String, Boolean>>(emptyMap()) }
    var repostStates by remember(auth, auth.account?.id) { mutableStateOf<Map<String, Boolean>>(emptyMap()) }
    var busyActions by remember(auth, auth.account?.id) { mutableStateOf<Set<String>>(emptySet()) }
    var commentsFor by remember(auth, auth.account?.id) { mutableStateOf<StagingFeedPost?>(null) }
    var commentCountSyncVersion by remember(auth, auth.account?.id) { mutableIntStateOf(0) }
    val commentStateHolder = key(auth.backend.id, auth.account?.id) { rememberSaveableStateHolder() }
    val canInteract = auth.backend == SautiBackend.PRODUCTION && auth.account != null && online

    fun togglePostAction(post: StagingFeedPost, kind: String) {
        if (!canInteract) {
            scope.launch { feedback.showSnackbar("Reconnect to interact with this video.") }
            return
        }
        val key = "$kind:${post.id}"
        if (key in busyActions) return
        val before = when (kind) {
            "like" -> likeStates[post.id]
            "save" -> saveStates[post.id]
            "repost" -> repostStates[post.id]
            else -> return
        }
        val desired = before != true
        val accountId = auth.account?.id
        busyActions = busyActions + key
        scope.launch {
            try {
                withTimeout(20_000L) {
                    when (kind) {
                        "like" -> actions.setLike(post.id, desired)
                        "save" -> actions.setSaved(post.id, desired)
                        "repost" -> actions.setRepost(post.id, desired)
                    }
                }
                if (auth.account?.id != accountId) return@launch
                when (kind) {
                    "like" -> {
                        likeStates = likeStates + (post.id to desired)
                        if (before != null) clips = clips.map { clip ->
                            if (clip.post.id == post.id) clip.copy(post = clip.post.copy(
                                likes = (clip.post.likes + if (before) -1 else 1).coerceAtLeast(0)))
                            else clip
                        }
                    }
                    "save" -> saveStates = saveStates + (post.id to desired)
                    "repost" -> {
                        repostStates = repostStates + (post.id to desired)
                        // Resolve counts from the source of truth; a replay or unknown prior
                        // state must never invent a repost total.
                        try {
                            val total = withTimeout(12_000L) { actions.loadRepostCount(post.id) }
                            if (auth.account?.id == accountId) clips = clips.map { clip ->
                                if (clip.post.id == post.id) clip.copy(post = clip.post.copy(reposts = total)) else clip
                            }
                        } catch (cancelled: CancellationException) { throw cancelled }
                        catch (_: Exception) { /* Feed refresh reconciles a delayed count. */ }
                    }
                }
            } catch (cancelled: TimeoutCancellationException) {
                // A timed-out request may have succeeded; discard uncertain status.
                when (kind) {
                    "like" -> likeStates = likeStates - post.id
                    "save" -> saveStates = saveStates - post.id
                    "repost" -> repostStates = repostStates - post.id
                }
                feedback.showSnackbar("${kind.replaceFirstChar { it.uppercase() }} timed out. Check status before trying again.")
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (e: Exception) {
                feedback.showSnackbar(e.message ?: "Could not update this video. Please try again.")
            } finally {
                busyActions = busyActions - key
            }
        }
    }

    fun shareClip(post: StagingFeedPost, copyOnly: Boolean) {
        try {
            val url = actions.postShareUrl(post.id)
            if (copyOnly) {
                val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                clipboard.setPrimaryClip(ClipData.newPlainText("SautiLink video", url))
                scope.launch { feedback.showSnackbar("Link copied") }
            } else {
                val intent = Intent(Intent.ACTION_SEND).apply {
                    type = "text/plain"
                    putExtra(Intent.EXTRA_TEXT, url)
                }
                context.startActivity(Intent.createChooser(intent, "Share SautiLink video"))
            }
        } catch (_: Exception) {
            scope.launch { feedback.showSnackbar("Could not share this video.") }
        }
    }

    LaunchedEffect(auth, auth.account?.id, reload, online) {
        val generation = ++feedGeneration
        val cached = if (auth.account != null) client.cached("short_videos") else null
        clips = cached?.posts?.toLiveClips().orEmpty()
        nextOffset = cached?.nextOffset ?: 0
        hasMore = cached?.hasMore ?: false
        paginationError = null; token = null
        if (auth.account == null) { error = null; loading = false; return@LaunchedEffect }
        if (!online) { error = "Offline. Reconnect to play Short Videos."; loading = false; return@LaunchedEffect }
        loading = true
        try {
            val refreshedToken = auth.accessTokenForStagingRead()
            if (generation != feedGeneration) return@LaunchedEffect
            token = refreshedToken
            val page = client.load("short_videos", 0)
            if (generation != feedGeneration) return@LaunchedEffect
            clips = page.posts.toLiveClips()
            nextOffset = page.nextOffset
            hasMore = page.hasMore
            error = null
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (e: Exception) {
            if (generation == feedGeneration) error = e.message ?: "Could not load short videos."
        } finally {
            if (generation == feedGeneration) loading = false
        }
    }

    // Load failures own a separate page, never a label over a loaded video.
    // Retain it during pagination Retry so its index becomes the first new clip on success.
    val pager = rememberPagerState(pageCount = {
        clips.size + if (clips.isNotEmpty() && (error != null || paginationError != null)) 1 else 0
    })
    LaunchedEffect(clips.getOrNull(pager.settledPage)?.mediaId) {
        if (clips.getOrNull(pager.settledPage) != null) {
            try { token = auth.accessTokenForStagingRead() }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (e: Exception) { error = e.message ?: "Sign in again to watch videos." }
        }
    }
    LaunchedEffect(auth, auth.account?.id, pager.settledPage, clips.size, nextOffset, hasMore, pageRetry, online, loading, error) {
        val generation = ++paginationGeneration
        paginationLoading = false
        if (!online || clips.isEmpty() || !hasMore || loading || error != null || pager.settledPage < clips.lastIndex - 3) return@LaunchedEffect
        paginationLoading = true
        try {
            val page = client.load("short_videos", nextOffset)
            if (generation != paginationGeneration) return@LaunchedEffect
            clips = (clips + page.posts.toLiveClips()).distinctBy { it.mediaId }
            nextOffset = page.nextOffset
            hasMore = page.hasMore
            paginationError = null
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (e: Exception) {
            if (generation == paginationGeneration) paginationError = e.message ?: "Could not load more videos."
        } finally {
            if (generation == paginationGeneration) paginationLoading = false
        }
    }

    val clip = clips.getOrNull(pager.settledPage)
    var timelineExpanded by remember(auth, accountId, clip?.mediaId) { mutableStateOf(false) }
    var playbackIntent by remember(auth, accountId, clip?.mediaId) { mutableStateOf<Boolean?>(null) }
    val wantsPlayback = playbackIntent ?: autoplay
    val accessToken = token
    val resources = remember(auth, accountId, accessToken) {
        accessToken?.let { nativeVideoPlaybackResources(context, auth.mediaOrigin, it) {
            accountId != null && auth.account?.id == accountId
        } }
    }
    val player = remember(resources) {
        resources?.let {
            ExoPlayer.Builder(context)
                .setBandwidthMeter(androidx.media3.exoplayer.upstream.DefaultBandwidthMeter.getSingletonInstance(context))
                .setMediaSourceFactory(DefaultMediaSourceFactory(it.dataSourceFactory))
                .setLoadControl(DefaultLoadControl.Builder()
                    .setBufferDurationsMs(3_000, 15_000, 750, 1_500).setBackBuffer(5_000, true).build())
                .build().apply { repeatMode = Player.REPEAT_MODE_ONE; volume = if (muted) 0f else 1f }
        }
    }
    val playbackOwner = remember(player) { accountId }
    val actualQuality = rememberVideoPlaybackQuality(player)
    // Error ownership follows this decoder, including Media3's error-clear event after Retry.
    var playbackError by remember(player) {
        mutableStateOf(player?.playerError?.let { "This video could not be played." })
    }
    var playing by remember(player) { mutableStateOf(player?.isPlaying == true) }
    var playbackState by remember(player) { mutableIntStateOf(player?.playbackState ?: Player.STATE_IDLE) }
    var playbackRequested by remember(player) { mutableStateOf(player?.playWhenReady == true) }
    var playbackSuppressed by remember(player) {
        mutableStateOf((player?.playbackSuppressionReason ?: Player.PLAYBACK_SUPPRESSION_REASON_NONE) != Player.PLAYBACK_SUPPRESSION_REASON_NONE)
    }
    var currentMediaId by remember(player) { mutableStateOf(player?.currentMediaItem?.mediaId) }
    DisposableEffect(player) {
        if (player == null) onDispose { } else {
            val listener = object : Player.Listener {
                // Include playWhenReady-only pause events and media switches, not just buffering changes.
                override fun onEvents(player: Player, events: Player.Events) {
                    playbackState = player.playbackState
                    playbackRequested = player.playWhenReady
                    playbackSuppressed = player.playbackSuppressionReason != Player.PLAYBACK_SUPPRESSION_REASON_NONE
                    currentMediaId = player.currentMediaItem?.mediaId
                    playbackError = player.playerError?.let { "This video could not be played." }
                    // Let Media3 drain the final samples and repeat. Playback may briefly
                    // pass the rounded timeline end; only explicit seek commands are clamped.
                }
                override fun onIsPlayingChanged(isPlaying: Boolean) { playing = isPlaying }
                override fun onPlayerError(e: PlaybackException) {
                    playbackError = "This video could not be played."
                    logVideoPlaybackFailure(VideoPlaybackScope.SHORTS, e, player)
                }
            }
            player.addListener(listener)
            onDispose { player.removeListener(listener); player.release(); resources?.close() }
        }
    }
    DisposableEffect(owner, player) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP) player?.pause()
        }
        owner.lifecycle.addObserver(observer)
        onDispose { owner.lifecycle.removeObserver(observer) }
    }
    LaunchedEffect(player, muted) { player?.volume = if (muted) 0f else 1f }
    LaunchedEffect(player, playbackSpeed) { player?.setPlaybackSpeed(playbackSpeed) }
    LaunchedEffect(auth.account?.id, clip?.post?.id, online) {
        val postId = clip?.post?.id ?: return@LaunchedEffect
        val accountId = auth.account?.id ?: return@LaunchedEffect
        if (!canInteract) return@LaunchedEffect
        // Independent reads: a slow Save lookup never prevents Like or Repost.
        if (postId !in likeStates) launch {
            try {
                val states = withTimeout(18_000L) { actions.getLikeStates(listOf(postId)) }
                if (auth.account?.id == accountId) likeStates = states + likeStates
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { /* An explicit Like remains possible. */ }
        }
        if (postId !in saveStates) launch {
            try {
                val states = withTimeout(18_000L) { actions.getSavedStates(listOf(postId)) }
                if (auth.account?.id == accountId) saveStates = states + saveStates
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { /* An explicit Save remains possible. */ }
        }
        if (postId !in repostStates) launch {
            try {
                val states = withTimeout(18_000L) { actions.getRepostStates(listOf(postId)) }
                if (auth.account?.id == accountId) repostStates = states + repostStates
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { /* An explicit Repost remains possible. */ }
        }
    }
    val selectedMedia = clip?.let { selected -> selected.post.media.firstOrNull { it.id == selected.mediaId } }
    val metadata = NativeVideoMetadata(selectedMedia?.width ?: 0, selectedMedia?.height ?: 0,
        selectedMedia?.durationMs ?: 0L)
    val preference = NativeVideoQualityPolicy.normalizePreference(quality)
    var appliedPreference by remember(player, clip?.mediaId) { mutableStateOf<String?>(null) }
    val network = com.sautilink.nativeapp.ui.components.rememberNativeVideoNetwork()
    val baseQuality = remember(clip?.mediaId, preference) {
        NativeVideoQualityPolicy.selectQuality(preference, metadata, network)
    }
    val selectedQuality = rememberVideoRecoveryQuality(player, playbackOwner, clip?.mediaId, metadata, preference, baseQuality,
        enabled = preference == "auto", online = online, eligible = online && wantsPlayback &&
            lifecycleState.isAtLeast(Lifecycle.State.STARTED), requested = playbackRequested,
        playing = playing, playbackState = playbackState, suppressed = playbackSuppressed,
        hasError = playbackError != null) {
        auth.account?.id == playbackOwner && online && wantsPlayback &&
            clips.getOrNull(pager.settledPage)?.mediaId == clip?.mediaId &&
            owner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)
    }
    val sourceUri = clip?.let { auth.mediaOrigin + videoPlaybackPath("/api/sauti-media/${it.mediaId}", selectedQuality) }
    LaunchedEffect(player, clip?.mediaId, sourceUri, preference, online) {
        if (player == null || clip == null || !online || auth.account?.id != playbackOwner) {
            player?.pause(); return@LaunchedEffect
        }
        val sameClip = player.currentMediaItem?.mediaId == clip.mediaId
        val uri = checkNotNull(sourceUri)
        val explicitChoice = appliedPreference != null && appliedPreference != preference
        if (sameClip && player.playerError != null && !explicitChoice) return@LaunchedEffect
        if (sameClip && player.playerError == null && player.currentMediaItem?.localConfiguration?.uri?.toString() == uri) {
            appliedPreference = preference
            return@LaunchedEffect
        }
        playbackError = null
        appliedPreference = preference
        replaceVideoPlaybackSource(player, MediaItem.Builder().setMediaId(clip.mediaId).setUri(uri).build(),
            keepPosition = sameClip, requested = videoPlaybackRequested(playbackIntent, autoplay, online,
                owner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED), currentMedia = true, hasError = false))
    }
    LaunchedEffect(player, wantsPlayback, online, clip?.mediaId, lifecycleState) {
        if (player == null) return@LaunchedEffect
        player.playWhenReady = videoPlaybackRequested(playbackIntent, autoplay, online,
            owner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED),
            currentMedia = clip != null && auth.account?.id == playbackOwner && player.currentMediaItem?.mediaId == clip.mediaId,
            hasError = player.playerError != null)
    }

    BoxWithConstraints(Modifier.fillMaxSize().background(Color(0xFF07101B))) {
        // Keep full-sized actions below the toolbar when landscape reduces height.
        val compactRail = maxHeight < 456.dp
        val wideRail = maxHeight < 340.dp
        if (auth.account == null) {
            Column(Modifier.align(Alignment.Center).padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Text("Sign in to watch Short Videos", color = Color.White, style = MaterialTheme.typography.titleLarge)
                Button(onClick = onSignIn) { Text("Sign in") }
            }
        } else if (clips.isEmpty()) {
            Column(Modifier.align(Alignment.Center).padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(14.dp)) {
                if (loading) SautiSkeletonBlock(Modifier.fillMaxWidth().height(180.dp))
                else Text(error ?: "No short videos yet.", color = Color.White)
                if (!loading) Button(onClick = { reload++ }) { Text("Retry") }
            }
        } else {
            VerticalPager(state = pager, modifier = Modifier.fillMaxSize()) { page ->
                val item = clips.getOrNull(page)
                if (item == null) {
                    if (error != null || paginationError != null) ShortVideosRetryPage(online, loading || paginationLoading) {
                        if (error != null) reload++ else pageRetry++
                    }
                    return@VerticalPager
                }
                Box(Modifier.fillMaxSize().background(Color.Black)) {
                    if (page == pager.settledPage && player != null && online) {
                        AndroidView(factory = { viewContext -> PlayerView(viewContext).apply {
                            useController = false
                            resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
                            this.player = player
                        } }, update = { it.player = player; it.keepScreenOn = playing },
                            onRelease = { it.player = null }, modifier = Modifier.fillMaxSize())
                        SautiVideoGestureSurface(Modifier.fillMaxSize(),
                            playbackLabel = if (playbackRequested) "Pause video" else "Play video",
                            onPlayback = {
                                playbackIntent = !player.playWhenReady
                                if (player.playWhenReady) player.pause() else if (player.playerError == null) player.play()
                            },
                            onTap = { _, _ ->
                                playbackIntent = !player.playWhenReady
                                if (player.playWhenReady) player.pause() else if (player.playerError == null) player.play()
                            },
                            onSeek = { delta ->
                                if (player.isCurrentMediaItemSeekable) {
                                    player.seekTo(videoSeekTarget(player.currentPosition, delta, player.duration)); true
                                } else false
                            },
                            onLike = if (canInteract && "like:${item.post.id}" !in busyActions) ({
                                if (likeStates[item.post.id] != true) togglePostAction(item.post, "like")
                            }) else null) {
                            val showBuffering = playbackState == Player.STATE_BUFFERING && playbackRequested &&
                                !playbackSuppressed && currentMediaId == item.mediaId &&
                                lifecycleState.isAtLeast(Lifecycle.State.STARTED) && playbackError == null
                            if (showBuffering) VideoBufferingOverlay(true)
                            else if (!playing && playbackError == null) Icon(Icons.Rounded.PlayArrow,
                                "Play video", Modifier.size(58.dp), tint = Color.White)
                            else if (playbackError != null) Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Text(playbackError.orEmpty(), color = Color.White)
                                TextButton(onClick = {
                                    if (auth.account?.id == playbackOwner &&
                                        clips.getOrNull(pager.settledPage)?.mediaId == item.mediaId) {
                                        playbackIntent = true
                                        playbackError = null
                                        replaceVideoPlaybackSource(player, MediaItem.Builder().setMediaId(item.mediaId)
                                            .setUri(auth.mediaOrigin + videoPlaybackPath("/api/sauti-media/${item.mediaId}", selectedQuality)).build(),
                                            keepPosition = true, requested = online && owner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED))
                                    }
                                }) { Text("Retry playback") }
                            }
                        }
                    }
                    if (!online && page == pager.settledPage) {
                        Text("Offline. Reconnect to play this video.", color = Color.White,
                            modifier = Modifier.align(Alignment.Center).padding(24.dp))
                    }
                    Box(Modifier.fillMaxWidth().height(190.dp).align(Alignment.BottomCenter)
                        .background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = .85f)))))
                    Column(Modifier.align(Alignment.BottomStart).padding(start = 16.dp,
                        end = if (wideRail) 188.dp else if (compactRail) 132.dp else 76.dp,
                        bottom = if (timelineExpanded) 84.dp else 52.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                            Text(item.post.authorName, color = Color.White,
                                style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold,
                                maxLines = 1, overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.weight(1f, fill = false).clickable(enabled = item.post.authorHandle.isNotBlank()) {
                                    onOpenProfile(item.post.authorHandle)
                                })
                            SautiVerificationBadge(item.post.verified, item.post.badgeType,
                                item.post.authorName, size = 13.dp, onDarkSurface = true)
                        }
                        if (item.post.body.isNotBlank()) com.sautilink.nativeapp.ui.components.SautiPostText(item.post.body, color = Color.White,
                            style = MaterialTheme.typography.bodyMedium.copy(fontSize = 15.sp, lineHeight = 21.sp),
                            maxLines = 2, overflow = TextOverflow.Ellipsis)
                    }
                    val railActions: @Composable () -> Unit = {
                        val post = item.post
                        val liked = likeStates[post.id] == true
                        val saved = saveStates[post.id] == true
                        val reposted = repostStates[post.id] == true
                        VideoRailAction(
                            if (liked) Icons.Rounded.ThumbUp else Icons.Rounded.ThumbUpOffAlt,
                            "Like", formatVideoCount(post.likes), liked,
                            enabled = canInteract && "like:${post.id}" !in busyActions
                        ) { togglePostAction(post, "like") }
                        VideoRailAction(Icons.Rounded.ChatBubbleOutline, "Comments",
                            formatVideoCount(post.comments)) { commentsFor = post }
                        VideoRailAction(if (saved) Icons.Rounded.Bookmark else Icons.Rounded.BookmarkBorder,
                            "Save", null, saved,
                            enabled = canInteract && "save:${post.id}" !in busyActions
                        ) { togglePostAction(post, "save") }
                        VideoRailAction(Icons.Rounded.Repeat, "Repost", formatVideoCount(post.reposts),
                            reposted, enabled = canInteract && "repost:${post.id}" !in busyActions
                        ) { togglePostAction(post, "repost") }
                        VideoRailAction(SautiPostIcons.Share, "Share") { shareClip(post, false) }
                        VideoRailAction(Icons.Rounded.ContentCopy, "Copy link") { shareClip(post, true) }
                        VideoSettingsButton(onClick = { qualityOpen = true })
                    }
                    if (compactRail) {
                        FlowRow(Modifier.align(Alignment.BottomEnd)
                            .padding(end = 4.dp, bottom = if (timelineExpanded) 80.dp else 52.dp).width(if (wideRail) 169.dp else 113.dp),
                            maxItemsInEachRow = if (wideRail) 3 else 2,
                            horizontalArrangement = Arrangement.spacedBy(0.dp),
                            verticalArrangement = Arrangement.spacedBy(0.dp)) {
                            railActions()
                        }
                    } else {
                        Column(Modifier.align(Alignment.BottomEnd)
                            .padding(end = 4.dp, bottom = if (timelineExpanded) 80.dp else 52.dp),
                            verticalArrangement = Arrangement.spacedBy(0.dp),
                            horizontalAlignment = Alignment.CenterHorizontally) {
                            railActions()
                        }
                    }
                    if (page == pager.settledPage && player != null && online) {
                        ShortVideoProgressControls(player, paused = !playbackRequested,
                            onExpandedChanged = { timelineExpanded = it },
                            modifier = Modifier.align(Alignment.BottomCenter))
                    }
                }
            }
        }
        SnackbarHost(hostState = feedback,
            modifier = Modifier.align(Alignment.TopCenter).padding(top = 54.dp))
        Row(Modifier.fillMaxWidth().align(Alignment.TopCenter).padding(8.dp),
            verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back", tint = Color.White) }
            Text("Short Videos", color = Color.White, style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.weight(1f))
            IconButton(onClick = NativePlaybackPreferences::toggleSessionSound) { Icon(if (muted) Icons.AutoMirrored.Rounded.VolumeOff else Icons.AutoMirrored.Rounded.VolumeUp,
                if (muted) "Unmute" else "Mute", tint = Color.White) }
        }
    }
    val selectedPost = commentsFor
    if (selectedPost != null) commentStateHolder.SaveableStateProvider(selectedPost.id) {
        PostCommentsSheet(post = selectedPost, actions = actions, auth = auth, allowWrite = canInteract,
            signedInUserId = auth.account?.id, onDismiss = { commentsFor = null },
            onRootPosted = {}, onRootDeleted = {}, onCommentChanged = {
                val accountId = auth.account?.id
                val sequence = ++commentCountSyncVersion
                scope.launch {
                    try {
                        val total = withTimeout(12_000L) { actions.loadCommentCount(selectedPost.id) }
                        if (auth.account?.id == accountId && sequence == commentCountSyncVersion) {
                            clips = clips.map { item ->
                                if (item.post.id == selectedPost.id) item.copy(post = item.post.copy(comments = total)) else item
                            }
                        }
                    } catch (cancelled: CancellationException) { throw cancelled }
                    catch (_: Exception) { /* Keep the last confirmed count until feed refresh. */ }
                }
            })
    }
    if (qualityOpen) VideoPlaybackSettingsSheet(
        preference = preference, currentQuality = actualQuality,
        availableQualities = NativeVideoQualityPolicy.availableQualities(metadata), speed = playbackSpeed,
        onQuality = { quality = it; preferences.edit().putString("quality", it).apply() },
        onSpeed = { playbackSpeed = it; preferences.edit().putFloat("playback_speed", it).apply() },
        onDismiss = { qualityOpen = false }, autoplay = autoplay,
        onAutoplay = {
            playbackIntent = null
            autoplay = it; preferences.edit().putBoolean("autoplay", it).apply()
            if (!it) player?.pause()
        })
}

@Composable
private fun ShortVideosRetryPage(online: Boolean, loading: Boolean, onRetry: () -> Unit) {
    Column(Modifier.fillMaxSize().background(Color.Black).padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(14.dp, Alignment.CenterVertically)) {
        Text(when {
            loading -> "Loading videos…"
            !online -> "Reconnect to load videos."
            else -> "Could not load videos."
        }, color = Color.White)
        Button(onClick = onRetry, enabled = online && !loading) { Text("Retry") }
    }
}

private fun List<StagingFeedPost>.toLiveClips(): List<LiveClip> = mapNotNull { post ->
    post.media.firstOrNull { it.kind == "video" }?.let { LiveClip(post, it.id) }
}


private fun formatVideoCount(value: Int): String = when {
    value >= 1_000_000 -> String.format(Locale.US, "%.1fM", value / 1_000_000.0)
    value >= 1_000 -> String.format(Locale.US, "%.1fK", value / 1_000.0)
    else -> value.coerceAtLeast(0).toString()
}

/** Tap animation + explicit semantics for TalkBack and large-screen navigation. */
@Composable
private fun VideoRailAction(
    icon: ImageVector,
    label: String,
    count: String? = null,
    active: Boolean = false,
    enabled: Boolean = true,
    onClick: () -> Unit
) {
    val interaction = remember { MutableInteractionSource() }
    val tint by animateColorAsState(if (active) Color(0xFFFF5964) else Color.White,
        tween(150), label = "Video action color")
    Column(Modifier.width(56.dp).heightIn(min = 48.dp)
        .clickable(interactionSource = interaction, indication = null,
            enabled = enabled, role = Role.Button, onClick = onClick)
        .padding(vertical = 1.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center) {
        Icon(icon, contentDescription = label,
            modifier = Modifier.size(24.dp).sautiActionFeedback(interaction),
            tint = tint, selected = active)
        Spacer(Modifier.height(2.dp))
        Text(count ?: label, color = Color.White,
            style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp), maxLines = 1)
    }
}
