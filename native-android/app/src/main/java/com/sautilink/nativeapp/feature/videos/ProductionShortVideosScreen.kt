package com.sautilink.nativeapp.feature.videos

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
import com.sautilink.nativeapp.ui.components.LocalFloatingNavigationPadding
import com.sautilink.nativeapp.ui.components.SautiPostHeart
import com.sautilink.nativeapp.ui.theme.SautiHeaderFont
import androidx.compose.ui.graphics.graphicsLayer
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
import com.sautilink.nativeapp.ui.components.rememberNativePlaybackSource
import com.sautilink.nativeapp.ui.components.NativeShortsPreloading
import com.sautilink.nativeapp.ui.components.NativePlaybackRead
import com.sautilink.nativeapp.ui.components.shortsPreloadEligible
import com.sautilink.nativeapp.ui.components.videoDeviceStressed
import com.sautilink.nativeapp.ui.components.NativeHlsQualitySelection
import com.sautilink.nativeapp.ui.components.rememberNativeHlsQualities
import com.sautilink.nativeapp.ui.components.NativeVideoPlaybackResources
import com.sautilink.nativeapp.ui.state.rememberSessionScreenPresentationAccess
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

private data class LiveClip(val post: StagingFeedPost, val mediaId: String)
private data class ShortsReturnPresentation(val clips: List<LiveClip>, val nextOffset: Int,
    val hasMore: Boolean, val page: Int) : com.sautilink.nativeapp.ui.state.SessionScreenPresentation
private data class ShortsInitialPresentation(val clips: List<LiveClip>, val nextOffset: Int,
    val hasMore: Boolean, val page: Int, val revision: Long)

@Composable
private fun rememberShortsInitialPresentation(auth: StagingAuthClient, client: StagingFeedClient,
    presentations: com.sautilink.nativeapp.ui.state.SessionScreenPresentationStore?): ShortsInitialPresentation =
    remember(presentations, auth, auth.account?.id) {
        val read = presentations?.read<ShortsReturnPresentation>("short-videos")
        val value = read?.value
        val revision = read?.revision ?: -1L
        if (value != null) ShortsInitialPresentation(value.clips, value.nextOffset, value.hasMore, value.page, revision)
        else {
            val first = client.cached("short_videos")
            ShortsInitialPresentation(first?.posts?.toLiveClips().orEmpty(), first?.nextOffset ?: 0,
                first?.hasMore ?: false, 0, revision)
        }
    }

@Composable
@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
private fun PrepareNextShort(auth: StagingAuthClient, candidates: List<Pair<Int, String>>,
    retained: Map<String, NativePlaybackRead>, token: String?, player: ExoPlayer?,
    resources: NativeVideoPlaybackResources?, preloading: NativeShortsPreloading?, index: Int, currentId: String?,
    network: com.sautilink.nativeapp.ui.components.NativeVideoNetwork, foreground: Boolean,
    online: Boolean, playbackAllowed: Boolean, quality: String, denied: Boolean, currentIsMp4: Boolean) {
    val context = LocalContext.current
    var mayPreload by remember(player, currentId, quality) { mutableStateOf(false) }
    var stressed by remember(context) { mutableStateOf(videoDeviceStressed(context)) }
    LaunchedEffect(player, currentId, foreground, online, playbackAllowed, network, quality, preloading) {
        preloading?.setQualityPreference(quality)
        while (player != null && currentId != null && foreground) {
            stressed = videoDeviceStressed(context)
            mayPreload = shortsPreloadEligible(true, online, playbackAllowed,
                player.isPlaying && player.currentMediaItem?.mediaId == currentId,
                com.sautilink.nativeapp.ui.components.videoPreloadRunway(player.totalBufferedDuration,mayPreload),
                network.saveData, network.isMetered, network.measuredMbps,
                stressed, preloading?.qualityAligned(quality) == true)
            kotlinx.coroutines.delay(500L)
        }
        mayPreload = false
    }
    val metadataAllowed = token != null && com.sautilink.nativeapp.ui.components.videoMetadataWarmupEligible(
        foreground, online, playbackAllowed, network.saveData, stressed, denied)
    val reads = com.sautilink.nativeapp.ui.components.rememberVideoLookaheadReads(auth,
        candidates.map { it.second }, retained, metadataAllowed)
    val sources = reads.mapNotNull { (id, read) ->
        read.source?.takeIf { it.hls && !read.denied }?.let { source ->
            candidates.first { it.second == id }.first to source
        }
    }
    LaunchedEffect(preloading, index, sources, mayPreload, foreground, online, playbackAllowed, denied, currentIsMp4,
        metadataAllowed, quality) {
        preloading?.setQualityPreference(quality)
        sources.forEach { (_, source) -> resources?.hlsGrants?.authorize(source) }
        preloading?.updateWindow(index, sources, mayPreload && preloading.qualityAligned(quality) && online && foreground,
            retainIncoming = metadataAllowed && online && playbackAllowed && foreground && !denied)
    }
}

/** RLS-backed short-video feed. One authorized decoder is shared by all visible pages. */
@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun ProductionShortVideosScreen(
    auth: StagingAuthClient,
    onBack: () -> Unit,
    onSignIn: () -> Unit,
    onOpenProfile: (String) -> Unit,
    onOpenPost: (String) -> Unit = {}
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
    val presentations = rememberSessionScreenPresentationAccess()
    val hiddenPreferences = remember(context) { context.getSharedPreferences("sautilink_short_interests", Context.MODE_PRIVATE) }
    var hiddenPosts by remember(auth, accountId) { mutableStateOf(hiddenPreferences.getStringSet("hidden_$accountId", emptySet()).orEmpty().toSet()) }
    var offlineOpen by remember(auth, accountId) { mutableStateOf(false) }
    var reportPost by remember(auth, accountId) { mutableStateOf<String?>(null) }
    var reportBusy by remember { mutableStateOf(false) }
    var reportError by remember { mutableStateOf<String?>(null) }
    var offlineSaved by remember { mutableStateOf(false) }
    val initial = rememberShortsInitialPresentation(auth, client, presentations.store)
    var clips by remember(auth, auth.account?.id) { mutableStateOf(initial.clips.filterNot { it.post.id in hiddenPosts }) }
    var nextOffset by remember(auth, auth.account?.id) { mutableIntStateOf(initial.nextOffset) }
    var hasMore by remember(auth, auth.account?.id) { mutableStateOf(initial.hasMore) }
    var loading by remember(auth, auth.account?.id) { mutableStateOf(auth.account != null && clips.isEmpty()) }
    var error by remember(auth, auth.account?.id) { mutableStateOf<String?>(null) }
    var feedGeneration by remember(auth) { mutableIntStateOf(0) }
    var paginationError by remember(auth, auth.account?.id) { mutableStateOf<String?>(null) }
    var paginationLoading by remember(auth, auth.account?.id) { mutableStateOf(false) }
    var paginationGeneration by remember(auth) { mutableIntStateOf(0) }
    var reload by remember(auth) { mutableIntStateOf(0) }
    var pageRetry by remember(auth) { mutableIntStateOf(0) }
    var token by remember(auth, auth.account?.id) { mutableStateOf<String?>(null) }
    val muted = NativePlaybackPreferences.sessionMuted
    var autoplay by remember { mutableStateOf(preferences.getBoolean("autoplay", true)) }
    var quality by remember { mutableStateOf(preferences.getString("quality", "auto") ?: "auto") }
    var qualityOpen by remember { mutableStateOf(false) }
    var autoAdvance by remember { mutableStateOf(preferences.getBoolean("auto_advance", true)) }
    var captionsEnabled by remember { mutableStateOf(preferences.getBoolean("captions", false)) }
    var captionsAvailable by remember { mutableStateOf(false) }
    val viewerActivity = remember(context) { generateSequence(context) { (it as? android.content.ContextWrapper)?.baseContext }
        .filterIsInstance<android.app.Activity>().firstOrNull() }
    var fullscreen by remember { mutableStateOf(false) }
    val originalOrientation = remember(viewerActivity) { viewerActivity?.requestedOrientation }
    androidx.activity.compose.BackHandler(fullscreen) {
        viewerActivity?.requestedOrientation = originalOrientation ?: android.content.pm.ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        fullscreen = false
    }
    DisposableEffect(viewerActivity) { onDispose {
        if (fullscreen) viewerActivity?.requestedOrientation = originalOrientation ?: android.content.pm.ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
    } }
    var playbackSpeed by remember { mutableFloatStateOf(preferences.getFloat("playback_speed", 1f)
        .takeIf { it in ShortsPlaybackSpeeds } ?: 1f) }
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
        if (before == null) {
            // An unknown state is a read retry, never an inferred Like/Unlike.
            busyActions = busyActions + key
            val owner = auth.account?.id
            scope.launch {
                try {
                    val state = withTimeout(18_000L) { when (kind) {
                        "like" -> actions.getLikeStates(listOf(post.id))
                        "save" -> actions.getSavedStates(listOf(post.id))
                        else -> actions.getRepostStates(listOf(post.id))
                    } }
                    if (auth.account?.id == owner) when (kind) {
                        "like" -> likeStates = state + likeStates
                        "save" -> saveStates = state + saveStates
                        else -> repostStates = state + repostStates
                    }
                } catch (cancelled: CancellationException) { throw cancelled }
                catch (_: Exception) { feedback.showSnackbar("Could not check status. Please try again.") }
                finally { if (auth.account?.id == owner) busyActions = busyActions - key }
            }
            return
        }
        val desired = !before
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
                        clips = clips.map { clip ->
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
        if (auth.account == null) { clips = emptyList(); token = null; error = null; loading = false; return@LaunchedEffect }
        paginationError = null
        if (!online) { error = "Offline. Reconnect to play Short Videos."; loading = false; return@LaunchedEffect }
        loading = clips.isEmpty()
        try {
            val refreshedToken = auth.accessTokenForStagingRead()
            if (generation != feedGeneration) return@LaunchedEffect
            token = refreshedToken
            // A quick return keeps loaded pagination and the current page. The
            // credential is still read normally; no credential lives in UI state.
            if (reload == 0 && clips.isNotEmpty() && (client.cacheAgeMs("short_videos") ?: Long.MAX_VALUE) in 0L..44_999L) {
                error = null
                return@LaunchedEffect
            }
            val page = client.load("short_videos", 0)
            if (generation != feedGeneration) return@LaunchedEffect
            if (reload == 0 && clips.isNotEmpty()) {
                clips = com.sautilink.nativeapp.feature.home.mergeReturningFeedRows(
                    clips.map { it.post }.distinctBy { it.id }, page.posts).toLiveClips().filterNot { it.post.id in hiddenPosts }
                nextOffset = maxOf(nextOffset, page.nextOffset)
            } else {
                clips = page.posts.toLiveClips().filterNot { it.post.id in hiddenPosts }
                nextOffset = page.nextOffset
                hasMore = page.hasMore
            }
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
    val pager = rememberPagerState(initialPage = initial.page.coerceIn(0, clips.lastIndex.coerceAtLeast(0)), pageCount = {
        clips.size + if (clips.isNotEmpty() && (error != null || paginationError != null)) 1 else 0
    })
    DisposableEffect(presentations, auth, accountId) {
        onDispose {
            if (accountId != null && auth.account?.id == accountId && clips.isNotEmpty() && clips.size <= 60) {
                presentations.save("short-videos", initial.revision,
                    ShortsReturnPresentation(clips.toList(), nextOffset, hasMore, pager.settledPage))
            } else if (clips.size > 60) presentations.invalidate("short-videos")
        }
    }
    LaunchedEffect(clips.getOrNull(pager.settledPage)?.mediaId) {
        if (clips.getOrNull(pager.settledPage) != null) {
            com.sautilink.nativeapp.ui.components.NativeVideoStartupProbe.mark(
                clips[pager.settledPage].mediaId,
                com.sautilink.nativeapp.ui.components.NativeVideoStartupStage.VIEWPORT_INTENT)
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
            clips = (clips + page.posts.toLiveClips().filterNot { it.post.id in hiddenPosts }).distinctBy { it.mediaId }
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
    var playbackIntent by remember(auth, accountId, clip?.mediaId) { mutableStateOf<Boolean?>(null) }
    val musicSession = com.sautilink.nativeapp.feature.music.LocalNativeMusicComposer.current
    val audioCoordinator = com.sautilink.nativeapp.feature.home.LocalNativeFeedPlayback.current
    val overlayBlocked = com.sautilink.nativeapp.ui.components.LocalNativePlaybackBlocked.current
    val wantsPlayback = commentsFor == null && !overlayBlocked && !qualityOpen && !offlineOpen && reportPost == null && (playbackIntent ?: autoplay)
    SideEffect { musicSession?.commentsOpen = commentsFor != null }
    DisposableEffect(musicSession) { onDispose { musicSession?.commentsOpen = false } }
    DisposableEffect(clip?.post?.id, musicSession, audioCoordinator) {
        val current = clip?.post
        val audioKey = "shorts-audio:${current?.id}"
        if (current != null) {
            musicSession?.visiblePosts?.set(audioKey, com.sautilink.nativeapp.feature.music.VisiblePostAudio(current.id, current.audio, 100, 0))
            audioCoordinator?.update(audioKey, com.sautilink.nativeapp.feature.home.NativeFeedPlaybackCoordinator.Candidate(current.id, 1f, 0f))
        }
        onDispose { musicSession?.visiblePosts?.remove(audioKey); audioCoordinator?.remove(audioKey) }
    }
    SideEffect {
        clip?.post?.id?.let { id ->
            if (wantsPlayback) { audioCoordinator?.resumeGroup(id); musicSession?.manualPost = id }
            else audioCoordinator?.pauseGroup(id)
        }
    }
    val accessToken = token
    // Current + five upcoming grants, with two recent entries retained only
    // within this open viewer and their original owner/credential/deadline.
    // Immutable bytes remain separately bounded by the session replay pool.
    val handoff = remember(auth, accountId) { linkedMapOf<String, NativePlaybackRead>() }
    val upcoming = com.sautilink.nativeapp.ui.components.videoLookaheadIndices(pager.settledPage, clips.size)
        .map { it to clips[it].mediaId }
    val retainedIds = ((pager.settledPage - 2).coerceAtLeast(0)..minOf(clips.lastIndex, pager.settledPage + 5))
        .mapNotNull { clips.getOrNull(it)?.mediaId }.toSet()
    handoff.keys.toList().filterNot(retainedIds::contains).forEach(handoff::remove)
    val currentRead = clip?.let { handoff.getOrPut(it.mediaId) { NativePlaybackRead() } }
    val playbackRead = rememberNativePlaybackSource(auth, clip?.mediaId,
        clip?.let { "/api/sauti-media/${it.mediaId}/playback" },
        enabled = accessToken != null && clip != null && online && lifecycleState.isAtLeast(Lifecycle.State.STARTED),
        fallbackPath = clip?.let { "/api/sauti-media/${it.mediaId}" }, retainedRead = currentRead)
    val streamSource = playbackRead.source
    val hls = streamSource?.hls == true
    val latestBearerState: State<String?> = rememberUpdatedState(playbackRead.bearer ?: accessToken)
    val replayOwner = com.sautilink.nativeapp.ui.components.LocalNativeVideoReplayOwner.current
    val engine: ShortsPlaybackEngine? = remember(auth, accountId, accessToken, replayOwner) {
        createShortsPlaybackEngine(context, auth, accountId, accessToken, replayOwner,
            authorizationToken = { latestBearerState.value }, muted = muted, quality = quality)
    }
    val resources: NativeVideoPlaybackResources? = engine?.resources
    val preloading: NativeShortsPreloading? = engine?.preloading
    val player: ExoPlayer? = engine?.player
    val playbackOwner = remember(player) { accountId }
    val actualQuality = rememberVideoPlaybackQuality(player)
    val streamQualities = rememberNativeHlsQualities(player)
    NativeHlsQualitySelection(player, hls, NativeVideoQualityPolicy.normalizePreference(quality))
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
    var renderedMediaId by remember(player) { mutableStateOf<String?>(null) }
    DisposableEffect(player) {
        if (player == null) onDispose { } else {
            val listener = object : Player.Listener {
                // Include playWhenReady-only pause events and media switches, not just buffering changes.
                override fun onEvents(player: Player, events: Player.Events) {
                    playbackState = player.playbackState
                    playbackRequested = player.playWhenReady
                    playbackSuppressed = player.playbackSuppressionReason != Player.PLAYBACK_SUPPRESSION_REASON_NONE
                    currentMediaId = player.currentMediaItem?.mediaId
                    captionsAvailable = player.currentTracks.groups.any { group ->
                        group.type == androidx.media3.common.C.TRACK_TYPE_TEXT && (0 until group.length).any { group.isTrackSupported(it) }
                    }
                    playbackError = player.playerError?.let { "This video could not be played." }
                    // Let Media3 drain the final samples and repeat. Playback may briefly
                    // pass the rounded timeline end; only explicit seek commands are clamped.
                }
                override fun onIsPlayingChanged(isPlaying: Boolean) { playing = isPlaying }
                override fun onRenderedFirstFrame() {
                    renderedMediaId = player.currentMediaItem?.mediaId
                    renderedMediaId?.let { com.sautilink.nativeapp.ui.components.NativeVideoStartupProbe.mark(it,
                        com.sautilink.nativeapp.ui.components.NativeVideoStartupStage.FIRST_FRAME) }
                }
                override fun onPlayerError(e: PlaybackException) {
                    playbackError = "This video could not be played."
                    logVideoPlaybackFailure(VideoPlaybackScope.SHORTS, e, player)
                }
            }
            player.addListener(listener)
            onDispose { player.removeListener(listener); engine?.close() }
        }
    }
    DisposableEffect(owner, player) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP) player?.pause()
        }
        owner.lifecycle.addObserver(observer)
        onDispose { owner.lifecycle.removeObserver(observer) }
    }
    LaunchedEffect(player, muted, clip?.post?.audio) { player?.volume = if (muted) 0f else clip?.post?.audio?.originalVolume ?: 1f }
    LaunchedEffect(player, playbackSpeed) { player?.setPlaybackSpeed(playbackSpeed) }
    LaunchedEffect(player, captionsEnabled) {
        player?.let { it.trackSelectionParameters = it.trackSelectionParameters.buildUpon()
            .setTrackTypeDisabled(androidx.media3.common.C.TRACK_TYPE_TEXT, !captionsEnabled).build() }
    }
    val hasNextShort = clips.getOrNull(pager.settledPage + 1) != null
    LaunchedEffect(player, autoAdvance, hasNextShort) {
        player?.repeatMode = if (autoAdvance && hasNextShort) Player.REPEAT_MODE_OFF else Player.REPEAT_MODE_ONE
    }
    LaunchedEffect(playbackState, autoAdvance, clip?.mediaId, clips.size, wantsPlayback) {
        if (playbackState == Player.STATE_ENDED && autoAdvance && wantsPlayback &&
            clips.getOrNull(pager.settledPage + 1) != null && !pager.isScrollInProgress) {
            pager.animateScrollToPage(pager.settledPage + 1)
        }
    }
    LaunchedEffect(qualityOpen, offlineOpen, clip?.mediaId, accountId) {
        offlineSaved = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
            clip?.let { NativeOfflineShorts.contains(context, accountId, it.mediaId) } ?: false
        }
    }
    clip?.let { selectedClip ->
        com.sautilink.nativeapp.feature.music.BindNativePostVideoClock(player, selectedClip.post.id, selectedClip.mediaId,
            current = true, frameReady = renderedMediaId == selectedClip.mediaId, playing = playing)
    }
    val authorMetadata = rememberShortsAuthorMetadata(auth, actions, reload, player,
        lifecycleState.isAtLeast(Lifecycle.State.STARTED), online, clip?.post,
        currentFrameReady = clip != null && renderedMediaId == clip.mediaId,
        wantsPlayback = wantsPlayback,
        nearbyPosts = clips.drop(pager.settledPage).take(6).map { it.post })
    val statusWindow = clips.drop(pager.settledPage).take(6).map { it.post.id }.distinct()
    val readingStatuses = remember(auth, auth.account?.id) { mutableStateListOf<String>() }
    LaunchedEffect(auth.account?.id, statusWindow, online) {
        val accountId = auth.account?.id ?: return@LaunchedEffect
        if (!canInteract) return@LaunchedEffect
        // Keep batches alive across a page handoff. Only loaded feed IDs are
        // read and the current account must still own the response.
        listOf("like", "save", "repost").forEach { kind ->
            val known = when (kind) { "like" -> likeStates; "save" -> saveStates; else -> repostStates }
            val ids = statusWindow.filter { it !in known && "$kind:$it" !in readingStatuses }
            if (ids.isNotEmpty()) {
                val keys = ids.map { "$kind:$it" }
                readingStatuses += keys
                scope.launch {
                    try {
                        val states = withTimeout(18_000L) { when (kind) {
                            "like" -> actions.getLikeStates(ids)
                            "save" -> actions.getSavedStates(ids)
                            else -> actions.getRepostStates(ids)
                        } }
                        if (auth.account?.id == accountId) when (kind) {
                            "like" -> likeStates = states + likeStates
                            "save" -> saveStates = states + saveStates
                            else -> repostStates = states + repostStates
                        }
                    } catch (_: TimeoutCancellationException) { /* Tap to retry the read. */ }
                    catch (cancelled: CancellationException) { throw cancelled }
                    catch (_: Exception) { /* Unknown stays distinct from unselected. */ }
                    finally { readingStatuses -= keys }
                }
            }
        }
    }
    val selectedMedia = clip?.let { selected -> selected.post.media.firstOrNull { it.id == selected.mediaId } }
    val metadata = NativeVideoMetadata(selectedMedia?.width ?: 0, selectedMedia?.height ?: 0,
        selectedMedia?.durationMs ?: 0L)
    val preference = NativeVideoQualityPolicy.normalizePreference(quality)
    var appliedPreference by remember(player, clip?.mediaId) { mutableStateOf<String?>(null) }
    val network = com.sautilink.nativeapp.ui.components.rememberNativeVideoNetwork()
    upcoming.forEach { (_, id) -> handoff.getOrPut(id) { NativePlaybackRead() } }
    PrepareNextShort(auth, upcoming, handoff, accessToken, player, resources, preloading,
        pager.settledPage, clip?.mediaId, network, lifecycleState.isAtLeast(Lifecycle.State.STARTED),
        online, autoplay && wantsPlayback, preference, playbackRead.denied, streamSource?.hls == false)
    val baseQuality = remember(clip?.mediaId, preference) {
        NativeVideoQualityPolicy.selectQuality(preference, metadata, network)
    }
    val selectedQuality = rememberVideoRecoveryQuality(player, playbackOwner, clip?.mediaId, metadata, preference, baseQuality,
        enabled = !hls && preference == "auto", online = online, eligible = online && wantsPlayback &&
            lifecycleState.isAtLeast(Lifecycle.State.STARTED), requested = playbackRequested,
        playing = playing, playbackState = playbackState, suppressed = playbackSuppressed,
        hasError = playbackError != null) {
        auth.account?.id == playbackOwner && online && wantsPlayback &&
            clips.getOrNull(pager.settledPage)?.mediaId == clip?.mediaId &&
            owner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)
    }
    val sourceUri = if (hls) streamSource?.url else clip?.takeIf { streamSource != null }?.let {
        auth.mediaOrigin + videoPlaybackPath("/api/sauti-media/${it.mediaId}", selectedQuality) }
    LaunchedEffect(player, clip?.mediaId, sourceUri, preference, online, playbackRead.denied) {
        if (player == null || clip == null || !online || auth.account?.id != playbackOwner) {
            player?.pause(); return@LaunchedEffect
        }
        val sameClip = player.currentMediaItem?.mediaId == clip.mediaId
        if (playbackRead.denied) { playbackError = "This video is no longer available."; player.stop(); return@LaunchedEffect }
        val uri = sourceUri ?: run { if (!sameClip) { player.stop(); player.clearMediaItems(); renderedMediaId = null }; return@LaunchedEffect }
        streamSource?.let { resources?.hlsGrants?.authorize(it) }
        val explicitChoice = !hls && appliedPreference != null && appliedPreference != preference
        val renewedGrant = hls && player.currentMediaItem?.localConfiguration?.uri?.toString() != uri
        if (sameClip && player.playerError != null && !explicitChoice && !renewedGrant) return@LaunchedEffect
        if (sameClip && player.playerError == null && player.currentMediaItem?.localConfiguration?.uri?.toString() == uri) {
            appliedPreference = preference
            return@LaunchedEffect
        }
        playbackError = null
        appliedPreference = preference
        if (!sameClip) renderedMediaId = null
        com.sautilink.nativeapp.ui.components.NativeVideoStartupProbe.mark(clip.mediaId,
            com.sautilink.nativeapp.ui.components.NativeVideoStartupStage.SOURCE_PREPARE)
        val requested = videoPlaybackRequested(wantsPlayback, autoplay, online,
            owner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED), currentMedia = true, hasError = false)
        val position = if (sameClip) player.currentPosition.coerceAtLeast(0L) else 0L
        val attached = streamSource?.takeIf { hls }?.let {
            preloading?.attach(it, pager.settledPage, position, requested)
        } == true
        if (!attached) replaceVideoPlaybackSource(player, MediaItem.Builder().setMediaId(clip.mediaId).setUri(uri)
            .setMimeType(if (hls) androidx.media3.common.MimeTypes.APPLICATION_M3U8 else androidx.media3.common.MimeTypes.VIDEO_MP4).build(),
            keepPosition = sameClip, requested = requested)
    }
    LaunchedEffect(player, wantsPlayback, online, clip?.mediaId, lifecycleState, sourceUri) {
        if (player == null) return@LaunchedEffect
        player.playWhenReady = videoPlaybackRequested(wantsPlayback, autoplay, online,
            owner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED),
            currentMedia = clip != null && sourceUri != null && auth.account?.id == playbackOwner && player.currentMediaItem?.mediaId == clip.mediaId,
            hasError = player.playerError != null)
    }

    val downloadAction = clip?.let { rememberShortVideoDownloadAction(auth, it.mediaId, it.post.id) }
    val navClearance = LocalFloatingNavigationPadding.current
    BoxWithConstraints(Modifier.fillMaxSize().background(Color.Black)) {
        // Keep full-sized actions below the toolbar when landscape reduces height.
        val compactRail = maxHeight - navClearance < 456.dp
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
                TextButton(onClick = { offlineOpen = true }) { Text("Offline videos", color = Color.White) }
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
                            setBackgroundColor(android.graphics.Color.BLACK)
                            setShutterBackgroundColor(android.graphics.Color.BLACK)
                            resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
                            this.player = player
                        } }, update = { it.player = player; it.keepScreenOn = playing },
                            onRelease = { it.player = null }, modifier = Modifier.fillMaxSize()
                                .graphicsLayer { alpha = if (renderedMediaId == item.mediaId) 1f else 0f })
                        if (renderedMediaId != item.mediaId) ShortVideoCover(auth, item.mediaId, Modifier.fillMaxSize())
                        val downloadVideo = rememberShortVideoDownloadAction(auth, item.mediaId, item.post.id)
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
                            }) else null,
                            onLongPress = downloadVideo) {
                            val showBuffering = (playbackRead.loading || playbackState == Player.STATE_BUFFERING && playbackRequested &&
                                !playbackSuppressed && currentMediaId == item.mediaId &&
                                lifecycleState.isAtLeast(Lifecycle.State.STARTED)) && playbackError == null
                            if (showBuffering) VideoBufferingOverlay(true)
                            else if (!playing && commentsFor == null && playbackError == null) Icon(Icons.Rounded.PlayArrow,
                                "Play video", Modifier.size(58.dp), tint = Color.White)
                            else if (playbackError != null) Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Text(playbackError.orEmpty(), color = Color.White)
                                TextButton(onClick = {
                                    if (auth.account?.id == playbackOwner &&
                                        clips.getOrNull(pager.settledPage)?.mediaId == item.mediaId) {
                                        playbackIntent = true
                                        playbackError = null
                                        playbackRead.retry()
                                        if (sourceUri != null) replaceVideoPlaybackSource(player, MediaItem.Builder().setMediaId(item.mediaId)
                                            .setUri(sourceUri).setMimeType(if (hls) androidx.media3.common.MimeTypes.APPLICATION_M3U8 else androidx.media3.common.MimeTypes.VIDEO_MP4).build(),
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
                    Box(Modifier.fillMaxWidth().height(290.dp).align(Alignment.BottomCenter)
                        .background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = .82f)))))
                    Column(Modifier.align(Alignment.BottomStart).fillMaxWidth().padding(horizontal = 15.dp)
                        .padding(bottom = 76.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        ShortsAuthorIdentityRow(auth, item.post, authorMetadata.ranks[item.post.id],
                            authorMetadata.followFor(item.post.authorId),
                            enabled = canInteract && page == pager.settledPage && lifecycleState.isAtLeast(Lifecycle.State.STARTED),
                            onOpenProfile = onOpenProfile,
                            onFollow = { if (canInteract && page == pager.settledPage) scope.launch {
                                if (authorMetadata.follow(item.post) == ShortsFollowResult.FAILED)
                                    feedback.showSnackbar("Follow could not be confirmed. Check status before trying again.")
                            } }, onRetryRead = { if (canInteract && page == pager.settledPage) scope.launch {
                                authorMetadata.readFollow(item.post.authorId)
                            } })
                        if (item.post.body.isNotBlank()) com.sautilink.nativeapp.ui.components.SautiPostText(item.post.body,
                            color = Color.White, style = MaterialTheme.typography.bodyMedium.copy(fontSize = 15.sp, lineHeight = 21.sp),
                            maxLines = if (compactRail) 1 else 2, overflow = TextOverflow.Ellipsis, expandedMaxHeight = 160.dp)
                        ShortsActionBar(item.post.likes, item.post.comments, item.post.reposts,
                            liked = likeStates[item.post.id] == true, reposted = repostStates[item.post.id] == true,
                            saved = saveStates[item.post.id] == true, likeKnown = item.post.id in likeStates,
                            repostKnown = item.post.id in repostStates, saveKnown = item.post.id in saveStates,
                            likePending = "like:${item.post.id}" in readingStatuses || "like:${item.post.id}" in busyActions,
                            repostPending = "repost:${item.post.id}" in readingStatuses || "repost:${item.post.id}" in busyActions,
                            savePending = "save:${item.post.id}" in readingStatuses || "save:${item.post.id}" in busyActions,
                            likeEnabled = canInteract && "like:${item.post.id}" !in busyActions,
                            repostEnabled = canInteract && "repost:${item.post.id}" !in busyActions,
                            saveEnabled = canInteract && "save:${item.post.id}" !in busyActions,
                            onLike = { togglePostAction(item.post, "like") }, onComments = { commentsFor = item.post },
                            onRepost = { togglePostAction(item.post, "repost") }, onShare = { shareClip(item.post, false) },
                            onSave = { togglePostAction(item.post, "save") })
                    }
                    if (page == pager.settledPage && player != null && online) {
                        ShortsBottomPlayback(player, paused = !playbackRequested, playbackSpeed, muted,
                            onPlay = { playbackIntent = !player.playWhenReady
                                if (player.playWhenReady) player.pause() else if (player.playerError == null) player.play() },
                            onSpeed = { qualityOpen = true }, onMute = NativePlaybackPreferences::toggleSessionSound,
                            onFullscreen = {
                                fullscreen = !fullscreen
                                viewerActivity?.requestedOrientation = if (fullscreen)
                                    android.content.pm.ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                                else originalOrientation ?: android.content.pm.ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
                            }, modifier = Modifier.align(Alignment.BottomCenter), fullscreen = fullscreen)
                    }
                }
            }
        }
        SnackbarHost(hostState = feedback,
            modifier = Modifier.align(Alignment.TopCenter).padding(top = 54.dp))
        Row(Modifier.fillMaxWidth().align(Alignment.TopCenter).padding(horizontal = 15.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            ShortsCircleButton(Icons.AutoMirrored.Rounded.ArrowBack, "Back", onBack)
            ShortsCircleButton(Icons.Rounded.MoreVert, "Video options", { qualityOpen = true })
        }
    }
    val selectedPost = commentsFor
    if (selectedPost != null) commentStateHolder.SaveableStateProvider(selectedPost.id) {
        PostCommentsSheet(post = selectedPost, actions = actions, auth = auth, allowWrite = canInteract,
            signedInUserId = auth.account?.id, onDismiss = { commentsFor = null }, onOpenProfile = onOpenProfile,
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
    if (qualityOpen) ShortsOptionsSheet(speed = playbackSpeed, preference = preference, currentQuality = actualQuality,
        qualities = if (hls) streamQualities.ifEmpty { streamSource?.qualities.orEmpty() }
            else NativeVideoQualityPolicy.availableQualities(metadata),
        captions = captionsEnabled, captionsAvailable = captionsAvailable, autoAdvance = autoAdvance, offline = offlineSaved,
        onSpeed = { playbackSpeed = it; preferences.edit().putFloat("playback_speed", it).apply() },
        onQuality = { quality = it; preferences.edit().putString("quality", it).apply() },
        onCaptions = { captionsEnabled = it; preferences.edit().putBoolean("captions", it).apply() },
        onAutoAdvance = { autoAdvance = it; preferences.edit().putBoolean("auto_advance", it).apply() },
        onPost = { clip?.post?.id?.let { qualityOpen = false; onOpenPost(it) } },
        onDownload = { qualityOpen = false; downloadAction?.invoke() },
        onOffline = {
            qualityOpen = false
            clip?.let { selected ->
                if (!offlineSaved && !startOfflineShort(context, auth, selected.mediaId, selected.post.id))
                    scope.launch { feedback.showSnackbar("Could not start offline save. Check your connection or active download.") }
                offlineOpen = true
            }
        },
        onNotInterested = {
            clip?.let { selected ->
                hiddenPosts = (hiddenPosts + selected.post.id).toList().takeLast(500).toSet()
                hiddenPreferences.edit().putStringSet("hidden_$accountId", hiddenPosts).apply()
                clips = clips.filterNot { it.post.id == selected.post.id }
                presentations.store?.invalidate("short-videos")
                scope.launch { feedback.showSnackbar("This video is hidden from your Shorts.") }
            }
            qualityOpen = false
        },
        onReport = { reportPost = clip?.post?.id; reportError = null; qualityOpen = false },
        onDismiss = { qualityOpen = false })
    if (offlineOpen) OfflineShortsDialog(auth) { offlineOpen = false }
    if (reportPost != null) com.sautilink.nativeapp.feature.safety.NativeReportDialog("post", reportBusy, reportError,
        onDismiss = { if (!reportBusy) reportPost = null }, onSubmit = { reason, details ->
            val selected = reportPost
            if (selected != null && !reportBusy) {
                reportBusy = true
                scope.launch {
                    try {
                        com.sautilink.nativeapp.feature.safety.NativeSafetyClient(auth).report("post", selected, reason, details)
                        reportPost = null; feedback.showSnackbar("Report received. Thank you for helping keep SautiLink safe.")
                    } catch (cancelled: CancellationException) { throw cancelled }
                    catch (error: Exception) { reportError = error.message ?: "Could not send report." }
                    finally { reportBusy = false }
                }
            }
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
