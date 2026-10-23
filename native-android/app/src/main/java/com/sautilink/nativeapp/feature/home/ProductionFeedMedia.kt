package com.sautilink.nativeapp.feature.home

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.VolumeOff
import androidx.compose.material.icons.rounded.VolumeUp
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.material3.*
import com.sautilink.nativeapp.ui.components.SautiIcon as Icon
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.currentStateAsState
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.PlayerView
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.auth.StagingSessionState
import com.sautilink.nativeapp.ui.components.SautiPostGestureSurface
import com.sautilink.nativeapp.ui.components.SautiVideoGestureSurface
import com.sautilink.nativeapp.ui.components.videoSeekTarget
import com.sautilink.nativeapp.ui.components.VideoBufferingOverlay
import com.sautilink.nativeapp.ui.components.VideoPlaybackScope
import com.sautilink.nativeapp.ui.components.logVideoPlaybackFailure
import com.sautilink.nativeapp.ui.components.NativeVideoMetadata
import com.sautilink.nativeapp.ui.components.NativeVideoQualityPolicy
import com.sautilink.nativeapp.ui.components.VideoPlaybackControls
import com.sautilink.nativeapp.ui.components.VideoPlaybackSettingsSheet
import com.sautilink.nativeapp.ui.components.rememberVideoPlaybackQuality
import com.sautilink.nativeapp.ui.components.nativeVideoPlaybackResources
import com.sautilink.nativeapp.ui.components.rememberNativePlaybackSource
import com.sautilink.nativeapp.ui.components.NativeHlsQualitySelection
import com.sautilink.nativeapp.ui.components.rememberNativeHlsQualities
import com.sautilink.nativeapp.ui.components.NativeVideoStartupProbe
import com.sautilink.nativeapp.ui.components.NativeVideoStartupStage
import com.sautilink.nativeapp.ui.components.nativePlaybackNeedsRetry
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay

/** Media dimensions are known from social_post_media before the poster request:
 * ratio >= 4:5 is natural; extra-tall items letterbox inside a fixed 4:5 frame.
 * The layout never changes its height when image bytes finish loading.
 */
private fun stableFeedAspect(media: FeedMedia): Float {
    val original = if (media.width > 0 && media.height > 0)
        media.width.toFloat() / media.height else .8f
    return original.coerceIn(.8f, 3f)
}

/** boundsInWindow is clipped; the denominator must remain the full measured media height. */
internal fun measuredVideoVisibleFraction(coordinates: LayoutCoordinates, windowHeight: Float): Float {
    val rect = coordinates.boundsInWindow()
    val shownTop = rect.top.coerceAtLeast(0f)
    val shownBottom = rect.bottom.coerceAtMost(windowHeight)
    return ((shownBottom - shownTop).coerceAtLeast(0f) /
        coordinates.size.height.toFloat().coerceAtLeast(1f)).coerceIn(0f, 1f)
}

@Composable
internal fun PostMediaGallery(auth: StagingAuthClient, media: List<FeedMedia>,
    onDoubleTapLike: (() -> Unit)? = null,
    mediaPath: ((FeedMedia) -> String)? = null,
    bufferingOverlayEnabled: Boolean = false,
    adaptivePlaybackEnabled: Boolean = true) {
    if (media.isEmpty()) return
    var expandedPhoto by remember(auth) { mutableStateOf<FeedMedia?>(null) }
    val pager = androidx.compose.foundation.pager.rememberPagerState(pageCount = { media.size })
    // Use one measured frame across carousel pages, preventing vertical layout jumps on swipe.
    val carouselAspect = media.minOf(::stableFeedAspect)
    Column(Modifier.fillMaxWidth()) {
        Box(Modifier.fillMaxWidth()) {
            androidx.compose.foundation.pager.HorizontalPager(
                state = pager,
                modifier = Modifier.fillMaxWidth().aspectRatio(carouselAspect),
                key = { index -> media[index].id }
            ) { page ->
                val item = media[page]
                    val path = checkedPostMediaPath(item.id, mediaPath?.invoke(item))
                Box(
                    Modifier.fillMaxSize()
                        .background(if (item.kind == "video") Color.Black else MaterialTheme.colorScheme.surfaceVariant)
                        .clip(RoundedCornerShape(7.dp)),
                    contentAlignment = Alignment.Center
                ) {
                    if (item.kind == "video") {
                        InlineFeedVideo(auth, item, Modifier.fillMaxSize(), isCurrent = pager.currentPage == page,
                            onDoubleTapLike = onDoubleTapLike, mediaPath = path,
                            bufferingOverlayEnabled = bufferingOverlayEnabled,
                            adaptivePlaybackEnabled = adaptivePlaybackEnabled)
                    } else {
                        SautiPostGestureSurface(Modifier.fillMaxSize(), onLike = onDoubleTapLike,
                            onTap = { expandedPhoto = item }, feedbackColor = Color.White) {
                            AuthorizedImage(auth, "$path?w=960",
                                "Photo ${page + 1} of ${media.size}",
                                modifier = Modifier.fillMaxSize(),
                                crop = false)
                        }
                    }
                }
            }
            if (media.size > 1) {
                Surface(
                    shape = RoundedCornerShape(16.dp),
                    color = Color.Black.copy(alpha = .55f),
                    modifier = Modifier.align(Alignment.TopEnd).padding(12.dp)
                ) {
                    Text("${pager.currentPage + 1}/${media.size}", color = Color.White,
                        style = MaterialTheme.typography.labelMedium,
                        modifier = Modifier.padding(horizontal = 11.dp, vertical = 6.dp))
                }
            }
        }
        if (media.size > 1) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically
            ) {
                media.forEachIndexed { index, _ ->
                    Spacer(
                        Modifier.padding(horizontal = 3.dp)
                            .size(if (index == pager.currentPage) 7.dp else 5.dp)
                            .clip(CircleShape)
                            .background(
                                if (index == pager.currentPage) MaterialTheme.colorScheme.primary
                                else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .35f)
                            )
                    )
                }
            }
        }
    }
    // Images retain the old full-size viewer; videos never open a second player.
    expandedPhoto?.let { photo ->
        androidx.compose.ui.window.Dialog(onDismissRequest = { expandedPhoto = null }) {
            Surface(
                color = MaterialTheme.colorScheme.surface,
                shape = RoundedCornerShape(16.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column {
                    Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp),
                        verticalAlignment = Alignment.CenterVertically) {
                        Text("Photo", style = MaterialTheme.typography.titleSmall,
                            modifier = Modifier.weight(1f))
                        IconButton(onClick = { expandedPhoto = null }) {
                            Icon(Icons.Rounded.Close, contentDescription = "Close photo")
                        }
                    }
                    AuthorizedImage(auth, "${checkedPostMediaPath(photo.id, mediaPath?.invoke(photo))}?w=1440",
                        "Expanded photo", Modifier.fillMaxWidth()
                            .aspectRatio(stableFeedAspect(photo)), crop = false)
                }
            }
        }
    }
}

/** Same-player inline video, no popup/Dialog and no route transition.
 * Poster is kept visible until the first decoded frame, removing sudden video flashes.
 */
@Composable
@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
private fun InlineFeedVideo(
    auth: StagingAuthClient, media: FeedMedia, modifier: Modifier = Modifier,
    isCurrent: Boolean,
    onDoubleTapLike: (() -> Unit)?,
    mediaPath: String = "/api/sauti-media/${media.id}",
    bufferingOverlayEnabled: Boolean = false,
    adaptivePlaybackEnabled: Boolean = true
) {
    val context = LocalContext.current
    val owner = LocalLifecycleOwner.current
    val lifecycleState by owner.lifecycle.currentStateAsState()
    val accountId = auth.account?.id
    var quality by remember(auth, accountId, media.id) { mutableStateOf("auto") }
    var speed by remember(auth, accountId, media.id) { mutableFloatStateOf(1f) }
    var settingsOpen by remember(auth, accountId, media.id) { mutableStateOf(false) }
    // Published Home/Profile/Room media share the same rendition API. Protected
    // pending Room submissions remain original-only and never gain a rendition URL.
    val adaptive = publishedVideoAdaptivePlayback(media.id, mediaPath, adaptivePlaybackEnabled)
    val recoveryOnline = rememberNetworkAvailable()
    val metadata = NativeVideoMetadata(media.width, media.height, media.durationMs)
    val network = if (adaptive) com.sautilink.nativeapp.ui.components.rememberNativeVideoNetwork()
        else com.sautilink.nativeapp.ui.components.NativeVideoNetwork()
    val configuration = LocalConfiguration.current
    val density = LocalDensity.current
    val windowHeight = with(density) { configuration.screenHeightDp.dp.toPx() }
    var visibleFraction by remember(auth, accountId, media.id) { mutableFloatStateOf(0f) }
    var started by remember(auth, accountId, media.id) { mutableStateOf(false) }
    var wantsToPlay by remember(auth, accountId, media.id) { mutableStateOf(false) }
    var manualPaused by remember(auth, accountId, media.id) { mutableStateOf(false) }
    var userInitiatedPlayback by remember(auth, accountId, media.id) { mutableStateOf(false) }
    var tokenRetryAttempt by remember(auth, accountId, media.id) { mutableIntStateOf(0) }
    var tokenSawOffline by remember(auth, accountId, media.id) { mutableStateOf(false) }
    var requestError by remember(auth, accountId, media.id) { mutableStateOf<String?>(null) }
    val muted = NativePlaybackPreferences.sessionMuted
    val sessionReady = auth.sessionState == StagingSessionState.SIGNED_IN
    val tokenRead = rememberFeedVideoTokenRead(auth, accountId, media.id, started, sessionReady, tokenRetryAttempt,
        stillAccount = { auth.account?.id == accountId }, fetchToken = {
            NativeVideoStartupProbe.mark(media.id, NativeVideoStartupStage.TOKEN_BEGIN)
            auth.accessTokenForStagingRead().also { NativeVideoStartupProbe.mark(media.id, NativeVideoStartupStage.TOKEN_READY) }
        })
    LaunchedEffect(tokenRead.failure) {
        if (tokenRead.failure != null) requestError = if (tokenRead.canRecover)
            "Video could not load. Check your connection and retry."
        else "Video unavailable. Sign in and try again."
    }
    val recoverFailedToken: () -> Unit = {
        if (auth.account?.id == accountId && sessionReady && started && tokenRead.token == null &&
            wantsToPlay && !manualPaused && !tokenRead.loading && tokenRead.canRecover && recoveryOnline && isCurrent && visibleFraction >= .58f) {
            requestError = null
            tokenRetryAttempt++
        }
    }
    val currentTokenRecovery by rememberUpdatedState(recoverFailedToken)
    DisposableEffect(owner, auth, accountId, media.id) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) currentTokenRecovery()
        }
        owner.lifecycle.addObserver(observer)
        onDispose { owner.lifecycle.removeObserver(observer) }
    }
    LaunchedEffect(recoveryOnline, tokenRead.canRecover, lifecycleState) {
        if (!recoveryOnline) tokenSawOffline = true
        else if (tokenSawOffline && lifecycleState.isAtLeast(Lifecycle.State.STARTED) && tokenRead.canRecover) {
            tokenSawOffline = false
            currentTokenRecovery()
        }
    }
    val token = tokenRead.token
    val playbackRead = rememberNativePlaybackSource(auth, media.id,
        if (adaptive) "$mediaPath/playback" else null,
        // One partly visible current page may obtain metadata before playback.
        // The token/resource/player path above remains strictly started-only.
        enabled = feedVideoMetadataEligible(adaptive, sessionReady && accountId != null,
            lifecycleState.isAtLeast(Lifecycle.State.STARTED), isCurrent, visibleFraction,
            NativePlaybackPreferences.autoplayEnabled, started, userInitiatedPlayback, manualPaused), fallbackPath = mediaPath)
    val warmupHandoff = remember(auth, accountId, media.id, mediaPath) { FeedVideoWarmupHandoff() }
    LaunchedEffect(accountId, visibleFraction, isCurrent, NativePlaybackPreferences.autoplayEnabled) {
        val visible = visibleFraction >= .58f && isCurrent
        if ((NativePlaybackPreferences.autoplayEnabled || userInitiatedPlayback) && visible && !manualPaused) {
            if (!started) {
                NativeVideoStartupProbe.mark(media.id, NativeVideoStartupStage.VIEWPORT_INTENT)
                warmupHandoff.onAutoplayIntent(playbackRead, accountId, media.id,
                    auth.mediaOrigin, "$mediaPath/playback", System.currentTimeMillis(), allowed = adaptive && sessionReady)
            }
            started = true
            wantsToPlay = true
        } else if (!visible) {
            wantsToPlay = false
        } else if (!NativePlaybackPreferences.autoplayEnabled && !userInitiatedPlayback) {
            wantsToPlay = false
        }
    }
    val streamSource = playbackRead.source
    val hls = streamSource?.hls == true
    LaunchedEffect(playbackRead.denied) {
        if (playbackRead.denied) requestError = "This video is no longer available."
    }
    // Snapshot the latest real-network observation at first authorized playback,
    // not at precomposition. A healthy MP4 keeps that representation mid-view.
    val autoQuality = remember(auth, accountId, media.id, quality, token != null) {
        NativeVideoQualityPolicy.selectQuality(quality, metadata, network)
    }
    val baseQuality = if (adaptive) autoQuality else "original"
    val latestBearer by rememberUpdatedState(playbackRead.bearer ?: token)
    val replayOwner = com.sautilink.nativeapp.ui.components.LocalNativeVideoReplayOwner.current
    val resources = remember(auth, accountId, media.id, token, mediaPath, replayOwner) {
        if (token == null) null else {
            NativeVideoStartupProbe.mark(media.id, NativeVideoStartupStage.RESOURCES_BEGIN)
            nativeVideoPlaybackResources(context, auth.mediaOrigin, token, authorizationToken = { latestBearer },
                replay = accountId?.let { replayOwner?.bindingFor(auth, it, token) }) {
                accountId != null && auth.account?.id == accountId
            }.also { NativeVideoStartupProbe.mark(media.id, NativeVideoStartupStage.RESOURCES_READY) }
        }
    }
    val player = remember(resources) {
        resources?.let {
            NativeVideoStartupProbe.mark(media.id, NativeVideoStartupStage.PLAYER_BEGIN)
            ExoPlayer.Builder(context)
                .setBandwidthMeter(androidx.media3.exoplayer.upstream.DefaultBandwidthMeter.getSingletonInstance(context))
                .setMediaSourceFactory(DefaultMediaSourceFactory(it.dataSourceFactory))
                .setLoadControl(androidx.media3.exoplayer.DefaultLoadControl.Builder()
                    .setBufferDurationsMs(3_000, 15_000, 750, 1_500).setBackBuffer(5_000, true).build())
                .build().apply {
                    repeatMode = Player.REPEAT_MODE_ONE
                    volume = if (muted) 0f else 1f
                    // Published videos first ask the authorized backend which source is
                    // ready. Protected pending submissions remain MP4-only.
                    if (!adaptive) {
                        setMediaItem(MediaItem.Builder().setMediaId(media.id).setUri(auth.mediaOrigin + mediaPath).build())
                        prepare()
                    }
                    playWhenReady = false
                }.also { NativeVideoStartupProbe.mark(media.id, NativeVideoStartupStage.PLAYER_READY) }
        }
    }
    var firstFrame by remember(player) { mutableStateOf(false) }
    var stoppedOffscreen by remember(player) { mutableStateOf(false) }
    var stoppedPosition by remember(player) { mutableLongStateOf(0L) }
    val playbackOwner = remember(player) { accountId }
    val actualQuality = rememberVideoPlaybackQuality(player)
    val streamQualities = rememberNativeHlsQualities(player)
    NativeHlsQualitySelection(player, hls, quality)
    var playing by remember(player) { mutableStateOf(false) }
    var playbackState by remember(player) { mutableIntStateOf(player?.playbackState ?: Player.STATE_IDLE) }
    var playbackRequested by remember(player) { mutableStateOf(player?.playWhenReady == true) }
    var playbackSuppressed by remember(player) {
        mutableStateOf((player?.playbackSuppressionReason ?: Player.PLAYBACK_SUPPRESSION_REASON_NONE) != Player.PLAYBACK_SUPPRESSION_REASON_NONE)
    }
    DisposableEffect(player, owner) {
        if (player == null) return@DisposableEffect onDispose { }
        val listener = object : androidx.media3.common.Player.Listener {
            // Pausing can change only playWhenReady while the player remains BUFFERING.
            override fun onEvents(player: Player, events: Player.Events) {
                playbackState = player.playbackState
                playbackRequested = player.playWhenReady
                playbackSuppressed = player.playbackSuppressionReason != Player.PLAYBACK_SUPPRESSION_REASON_NONE
                // Let Media3 drain the final samples and repeat. Playback may briefly
                // pass the rounded timeline end; only explicit seek commands are clamped.
            }
            override fun onRenderedFirstFrame() {
                firstFrame = true
                NativeVideoStartupProbe.mark(media.id, NativeVideoStartupStage.FIRST_FRAME)
            }
            override fun onIsPlayingChanged(isPlaying: Boolean) { playing = isPlaying }
            override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                requestError = "Video could not play. Tap retry."
                if (adaptive) logVideoPlaybackFailure(VideoPlaybackScope.HOME, error, player)
            }
        }
        player.addListener(listener)
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP) player.pause()
        }
        owner.lifecycle.addObserver(observer)
        onDispose {
            owner.lifecycle.removeObserver(observer)
            player.removeListener(listener)
            player.release()
            resources?.close()
        }
    }
    val selectedQuality = rememberVideoRecoveryQuality(player, playbackOwner, media.id, metadata, quality, baseQuality,
        enabled = adaptive && !hls && quality == "auto", online = recoveryOnline, eligible = isCurrent && visibleFraction >= .58f &&
            lifecycleState.isAtLeast(Lifecycle.State.STARTED) && wantsToPlay && !manualPaused,
        requested = playbackRequested, playing = playing, playbackState = playbackState,
        suppressed = playbackSuppressed, hasError = requestError != null) {
        auth.account?.id == playbackOwner && isCurrent && visibleFraction >= .58f && wantsToPlay && !manualPaused &&
            owner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)
    }
    val playbackUri = if (hls) streamSource?.url else if (!adaptive || streamSource != null)
        auth.mediaOrigin + videoPlaybackPath(mediaPath, selectedQuality) else null
    LaunchedEffect(player, playbackUri, hls, playbackRead.denied) {
        if (player == null || auth.account?.id != playbackOwner) return@LaunchedEffect
        if (playbackRead.denied) { player.stop(); return@LaunchedEffect }
        val uri = playbackUri ?: return@LaunchedEffect
        streamSource?.let { resources?.hlsGrants?.authorize(it) }
        if (player.currentMediaItem?.localConfiguration?.uri?.toString() != uri) {
            requestError = null
            NativeVideoStartupProbe.mark(media.id, NativeVideoStartupStage.SOURCE_PREPARE)
            replaceVideoPlaybackSource(player, MediaItem.Builder().setMediaId(media.id).setUri(uri)
                .setMimeType(if (hls) androidx.media3.common.MimeTypes.APPLICATION_M3U8 else androidx.media3.common.MimeTypes.VIDEO_MP4).build(),
                keepPosition = true, requested = wantsToPlay && !manualPaused && isCurrent &&
                    owner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED))
        }
    }
    LaunchedEffect(player, muted) { player?.volume = if (muted) 0f else 1f }
    LaunchedEffect(player, speed) { player?.setPlaybackSpeed(speed) }
    LaunchedEffect(player, isCurrent, visibleFraction, wantsToPlay, requestError, lifecycleState, streamSource) {
        if (player != null) {
            if (!isCurrent || visibleFraction < .1f || !lifecycleState.isAtLeast(Lifecycle.State.STARTED)) {
                if (!stoppedOffscreen && player.playbackState != Player.STATE_IDLE) {
                    player.pause()
                    // A quick scroll past and back keeps its decoder/buffer.
                    // Cancellation when visible again preserves this same source;
                    // longer absences still release decoder buffers promptly.
                    if (lifecycleState.isAtLeast(Lifecycle.State.STARTED)) kotlinx.coroutines.delay(1_500L)
                    stoppedPosition = player.currentPosition.coerceAtLeast(0L)
                    player.stop()
                    stoppedOffscreen = true
                    firstFrame = false
                }
            } else if (wantsToPlay && requestError == null && (!adaptive || streamSource != null)) {
                if (stoppedOffscreen) {
                    player.seekTo(stoppedPosition)
                    player.prepare()
                    stoppedOffscreen = false
                }
                player.play()
            }
            else player.pause()
        }
    }
    val overlayEligible = bufferingOverlayEnabled && isCurrent && visibleFraction > 0f &&
        lifecycleState.isAtLeast(Lifecycle.State.STARTED) && started && wantsToPlay &&
        !manualPaused && requestError == null && !playbackSuppressed
    val showBufferingOverlay = overlayEligible &&
        (token == null || adaptive && streamSource == null && !playbackRead.denied || playbackRequested && playbackState == Player.STATE_BUFFERING)
    Box(modifier.background(Color.Black).onGloballyPositioned { coordinates ->
        visibleFraction = measuredVideoVisibleFraction(coordinates, windowHeight)
    }, contentAlignment = Alignment.Center) {
        if (player != null) {
            AndroidView(
                factory = { ctx -> PlayerView(ctx).apply {
                    useController = false
                    this.player = player
                    resizeMode = androidx.media3.ui.AspectRatioFrameLayout.RESIZE_MODE_FIT
                } },
                update = { it.player = player },
                onRelease = { it.player = null },
                modifier = Modifier.fillMaxSize()
                    .graphicsLayer { alpha = if (firstFrame) 1f else 0f }
            )
        }
        // Poster overlays any decoder/player surface until a real frame has arrived.
        if (!firstFrame) {
            if (mediaPath == "/api/sauti-media/${media.id}") {
                AuthorizedImage(auth, "$mediaPath?poster=1",
                    "Video cover", modifier = Modifier.fillMaxSize(), crop = false,
                    // A missing poster is not a playback error. Keep its error glyph
                    // from competing with Home's active video-buffering feedback.
                    showFailureFallback = !showBufferingOverlay)
            } else if (!bufferingOverlayEnabled && started && wantsToPlay && requestError == null) {
                // Protected submissions expose original bytes, not a generated poster.
                CircularProgressIndicator(Modifier.size(24.dp), color = Color.White, strokeWidth = 2.dp)
            }
        }
        val playPrompt = !playing && (firstFrame || manualPaused ||
            !NativePlaybackPreferences.autoplayEnabled || requestError != null || !started)
        val startPlayback = {
            warmupHandoff.consumeManualIntent()
            requestError = null
            if (tokenRead.token == null && !tokenRead.loading) tokenRetryAttempt++
            if (adaptive && nativePlaybackNeedsRetry(playbackRead, System.currentTimeMillis(), player?.playerError != null)) playbackRead.retry()
            if (!started) NativeVideoStartupProbe.mark(media.id, NativeVideoStartupStage.VIEWPORT_INTENT)
            started = true
            manualPaused = false
            userInitiatedPlayback = true
            wantsToPlay = true
            if (player?.playerError != null) {
                if (adaptive && playbackUri != null) replaceVideoPlaybackSource(player, MediaItem.Builder().setMediaId(media.id)
                    .setUri(playbackUri).setMimeType(if (hls) androidx.media3.common.MimeTypes.APPLICATION_M3U8 else androidx.media3.common.MimeTypes.VIDEO_MP4).build(),
                    keepPosition = true, requested = owner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED))
                else player.prepare()
            }
            if (player?.playbackState == androidx.media3.common.Player.STATE_ENDED) player.seekToDefaultPosition()
            player?.play()
        }
        val pausePlayback = {
            wantsToPlay = false
            manualPaused = true
            userInitiatedPlayback = false
            player?.pause()
        }
        val playRadius = with(density) { 30.dp.toPx() }
        val pauseRequested = playing || playbackState != Player.STATE_ENDED && requestError == null &&
            (playbackRequested || started && wantsToPlay && !manualPaused)
        SautiVideoGestureSurface(Modifier.fillMaxSize(),
            playbackLabel = if (pauseRequested) "Pause video in post" else if (playPrompt) "Play video in post" else null,
            onPlayback = { if (pauseRequested) pausePlayback() else if (playPrompt) startPlayback() },
            onTap = { position, frame ->
                if (pauseRequested) pausePlayback()
                else if (playPrompt && (position - androidx.compose.ui.geometry.Offset(frame.width / 2f, frame.height / 2f))
                        .getDistance() <= playRadius) startPlayback()
            },
            onSeek = { delta ->
                if (player?.isCurrentMediaItemSeekable == true) {
                    player.seekTo(videoSeekTarget(player.currentPosition, delta, player.duration))
                    true
                } else false
            }, onLike = onDoubleTapLike) {
            if (playPrompt && !showBufferingOverlay) Surface(shape = CircleShape,
                color = Color.Black.copy(alpha = .58f), modifier = Modifier.size(60.dp)) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(Icons.Rounded.PlayArrow, "Play video in post",
                        tint = Color.White, modifier = Modifier.size(32.dp))
                }
            }
        }
        if (bufferingOverlayEnabled) VideoBufferingOverlay(showBufferingOverlay, Modifier.align(Alignment.Center))
        if (!bufferingOverlayEnabled && started && token == null && requestError == null) {
            CircularProgressIndicator(Modifier.size(30.dp),
                color = Color.White, strokeWidth = 2.dp)
        }
        if (requestError != null) {
            Surface(
                color = Color.Black.copy(alpha = .72f),
                modifier = Modifier.align(Alignment.BottomCenter)
            ) {
                Text(requestError.orEmpty(), color = Color.White,
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.padding(10.dp))
            }
        }
        if (player != null && started && requestError == null) {
            VideoPlaybackControls(player, playbackRequested && !manualPaused, muted,
                onTogglePlayback = { if (pauseRequested) pausePlayback() else startPlayback() },
                onToggleSound = NativePlaybackPreferences::toggleSessionSound,
                onOpenSettings = { settingsOpen = true },
                modifier = Modifier.align(Alignment.BottomCenter))
        }
    }
    if (settingsOpen) VideoPlaybackSettingsSheet(
        preference = quality, currentQuality = actualQuality,
        availableQualities = if (hls) streamQualities.ifEmpty { streamSource?.qualities.orEmpty() }
            else NativeVideoQualityPolicy.availableQualities(metadata), speed = speed,
        onQuality = { quality = it }, onSpeed = { speed = it }, onDismiss = { settingsOpen = false },
        qualityEnabled = adaptive, adaptiveStream = hls)
}

/** Only callers that already validated a published media path may append a rendition. */
internal fun videoPlaybackPath(path: String, quality: String): String =
    if (quality in setOf("240", "360", "480", "720", "1080")) "$path?quality=$quality" else path

/** Published canonical video adaptation is independent of the surface's loading
 * chrome. Pending Room submissions and drafts never enter the Stream endpoint.
 */
internal fun publishedVideoAdaptivePlayback(mediaId: String, path: String, enabled: Boolean = true): Boolean =
    enabled && path == "/api/sauti-media/$mediaId"

/** Explicit pause wins over autoplay; connectivity and lifecycle always gate a resume. */
internal fun videoPlaybackRequested(manualIntent: Boolean?, autoplay: Boolean, online: Boolean,
    foreground: Boolean, currentMedia: Boolean, hasError: Boolean): Boolean =
    (manualIntent ?: autoplay) && online && foreground && currentMedia && !hasError

@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
internal fun replaceVideoPlaybackSource(player: Player, item: MediaItem, keepPosition: Boolean, requested: Boolean) {
    val position = if (keepPosition) player.currentPosition.coerceAtLeast(0L) else 0L
    val parameters = player.playbackParameters
    player.setMediaItem(item, position)
    player.prepare()
    player.playbackParameters = parameters
    player.playWhenReady = requested
}

/** A bounded, in-memory quality recovery budget; real player errors always remain user-visible. */
@Composable
@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
internal fun rememberVideoRecoveryQuality(
    player: Player?, ownerId: String?, mediaId: String?, metadata: NativeVideoMetadata,
    preference: String, baseQuality: String, enabled: Boolean, online: Boolean, eligible: Boolean,
    requested: Boolean, playing: Boolean, playbackState: Int, suppressed: Boolean, hasError: Boolean,
    isStillEligible: () -> Boolean
): String {
    val context = LocalContext.current.applicationContext
    val freshEligibility by rememberUpdatedState(isStillEligible)
    var recoveredQuality by remember(player, ownerId, mediaId, preference) { mutableStateOf<String?>(null) }
    var recoveries by remember(player, ownerId, mediaId) { mutableIntStateOf(0) }
    val available = NativeVideoQualityPolicy.availableQualities(metadata)
    val ceiling = baseQuality.toIntOrNull() ?: minOf(metadata.width, metadata.height)
    val selected = recoveredQuality?.takeIf { quality ->
        quality.toIntOrNull()?.let { it in available && it < ceiling } == true
    } ?: baseQuality
    LaunchedEffect(player, ownerId, mediaId, metadata, selected, enabled, online, eligible, requested, playing,
        playbackState, suppressed, hasError) {
        val current = player ?: return@LaunchedEffect
        if (!enabled || !online || ownerId == null || mediaId == null || !eligible || !requested || suppressed || hasError) return@LaunchedEffect
        fun valid() = freshEligibility() && current.currentMediaItem?.mediaId == mediaId &&
            current.playWhenReady && current.playerError == null &&
            current.playbackSuppressionReason == Player.PLAYBACK_SUPPRESSION_REASON_NONE && videoRecoveryOnline(context)
        if (!valid()) return@LaunchedEffect
        if (playing) {
            delay(10_000)
            if (valid() && current.isPlaying) recoveries = 0
            return@LaunchedEffect
        }
        if (playbackState != Player.STATE_BUFFERING || recoveries >= 2) return@LaunchedEffect
        var position = current.currentPosition
        var buffered = current.bufferedPosition
        while (valid() && current.playbackState == Player.STATE_BUFFERING) {
            delay(4_000)
            if (!valid() || current.playbackState != Player.STATE_BUFFERING) return@LaunchedEffect
            val nextPosition = current.currentPosition
            val nextBuffered = current.bufferedPosition
            if (nextPosition != position || nextBuffered > buffered) {
                position = nextPosition
                buffered = nextBuffered
                continue
            }
            val rank = selected.toIntOrNull() ?: minOf(metadata.width, metadata.height)
            recoveries++
            // Web's first stall targets 360, the second 240. A no-op target does not reload bytes.
            val lower = NativeVideoQualityPolicy.selectQuality("auto", metadata,
                stallCount = recoveries).toIntOrNull()?.takeIf { it < rank }
            if (lower != null) {
                recoveredQuality = lower.toString()
                return@LaunchedEffect
            }
            if (recoveries >= 2) return@LaunchedEffect
            position = nextPosition
            buffered = nextBuffered
        }
    }
    return if (enabled) selected else baseQuality
}

private fun videoRecoveryOnline(context: Context): Boolean = try {
    val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    manager.getNetworkCapabilities(manager.activeNetwork)?.let {
        it.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
            it.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    } == true
} catch (_: SecurityException) { false }
