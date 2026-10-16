package com.sautilink.nativeapp.feature.home

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.ImageNotSupported
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.VolumeOff
import androidx.compose.material.icons.rounded.VolumeUp
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
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
import com.sautilink.nativeapp.ui.components.SautiSkeletonBlock
import com.sautilink.nativeapp.ui.components.SautiPostGestureSurface
import com.sautilink.nativeapp.ui.components.SautiVideoGestureSurface
import com.sautilink.nativeapp.ui.components.videoSeekTarget
import com.sautilink.nativeapp.ui.components.VideoBufferingOverlay
import com.sautilink.nativeapp.ui.components.VideoPlaybackScope
import com.sautilink.nativeapp.ui.components.logVideoPlaybackFailure
import com.sautilink.nativeapp.ui.components.NativeVideoMetadata
import com.sautilink.nativeapp.ui.components.NativeVideoQualityPolicy
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.delay
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL

/** No image disk cache or persistence: a bounded, per-visible-item loader for RLS-backed media. */
@Composable
internal fun AuthorizedImage(
    auth: StagingAuthClient,
    route: String,
    description: String,
    modifier: Modifier = Modifier,
    crop: Boolean = true,
    naturalAspectRatio: Boolean = false,
    showFailureFallback: Boolean = true,
    fallback: @Composable () -> Unit = {
        Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surfaceVariant), contentAlignment = Alignment.Center) {
            Icon(Icons.Rounded.ImageNotSupported, contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(24.dp))
        }
    }
) {
    var bitmap by remember(auth, route) { mutableStateOf<Bitmap?>(null) }
    var loading by remember(auth, route) { mutableStateOf(true) }
    LaunchedEffect(auth, route, auth.account?.id) {
        bitmap = null
        loading = true
        try {
            val token = auth.accessTokenForStagingRead()
            bitmap = withContext(Dispatchers.IO) { fetchBoundedBitmap(auth.mediaOrigin + route, token) }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { bitmap = null }
        finally { loading = false }
    }
    // In-feed single media keeps its actual poster/image proportions rather than
    // forcing the previous cropped 1.35:1 tile used by the prototype.
    val naturalAspect = bitmap?.let { image ->
        if (image.height > 0) (image.width.toFloat() / image.height).coerceIn(.65f, 2.25f) else 1.35f
    } ?: 1.35f
    Box(if (naturalAspectRatio) modifier.aspectRatio(naturalAspect) else modifier,
        contentAlignment = Alignment.Center) {
        val image = bitmap
        if (image != null) {
            Image(image.asImageBitmap(), contentDescription = description,
                contentScale = if (crop) ContentScale.Crop else ContentScale.Fit,
                modifier = Modifier.fillMaxSize())
        } else if (loading) {
            SautiSkeletonBlock(Modifier.fillMaxSize(), 6.dp)
        } else if (showFailureFallback) fallback()
    }
}

private fun fetchBoundedBitmap(url: String, token: String): Bitmap {
    val target = URL(url)
    require(target.protocol == "https" && target.host in setOf("sautilink.com", "test.sautilink.com"))
    val conn = target.openConnection() as HttpURLConnection
    try {
        conn.requestMethod = "GET"
        conn.connectTimeout = 10_000
        conn.readTimeout = 15_000
        conn.useCaches = false
        conn.instanceFollowRedirects = false
        conn.setRequestProperty("Authorization", "Bearer $token")
        conn.setRequestProperty("Accept", "image/*")
        if (conn.responseCode !in 200..299) throw IllegalStateException("Media unavailable")
        if (conn.contentType?.substringBefore(';')?.trim()?.lowercase()?.startsWith("image/") != true) {
            throw IllegalStateException("Response was not an image")
        }
        // Hard cap image response size (12 MiB), including for chunked transfer encoding.
        val bytes = ByteArrayOutputStream()
        val buf = ByteArray(8192)
        conn.inputStream.use { stream ->
            var total = 0
            while (true) {
                val n = stream.read(buf)
                if (n < 0) break
                total += n
                if (total > 12 * 1024 * 1024) throw IllegalStateException("Image is too large")
                bytes.write(buf, 0, n)
            }
        }
        val raw = bytes.toByteArray()
        val opts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(raw, 0, raw.size, opts)
        if (opts.outWidth <= 0 || opts.outHeight <= 0) throw IllegalStateException("Invalid image")
        var sample = 1
        while (opts.outWidth / sample > 1440 || opts.outHeight / sample > 1440) sample *= 2
        val decoded = BitmapFactory.decodeByteArray(raw, 0, raw.size,
            BitmapFactory.Options().apply { inSampleSize = sample; inPreferredConfig = Bitmap.Config.ARGB_8888 })
        return decoded ?: throw IllegalStateException("Image not supported")
    } finally { conn.disconnect() }
}

/** Media dimensions are known from social_post_media before the poster request:
 * ratio >= 4:5 is natural; extra-tall items letterbox inside a fixed 4:5 frame.
 * The layout never changes its height when image bytes finish loading.
 */
private fun stableFeedAspect(media: FeedMedia): Float {
    val original = if (media.width > 0 && media.height > 0)
        media.width.toFloat() / media.height else .8f
    return original.coerceIn(.8f, 3f)
}

@Composable
internal fun PostMediaGallery(auth: StagingAuthClient, media: List<FeedMedia>,
    onDoubleTapLike: (() -> Unit)? = null,
    mediaPath: ((FeedMedia) -> String)? = null,
    bufferingOverlayEnabled: Boolean = false) {
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
                        .background(Color.Black)
                        .clip(RoundedCornerShape(7.dp)),
                    contentAlignment = Alignment.Center
                ) {
                    if (item.kind == "video") {
                        InlineFeedVideo(auth, item, Modifier.fillMaxSize(), isCurrent = pager.currentPage == page,
                            onDoubleTapLike = onDoubleTapLike, mediaPath = path,
                            bufferingOverlayEnabled = bufferingOverlayEnabled)
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
                    AuthorizedImage(auth, "${checkedPostMediaPath(photo.id, mediaPath?.invoke(photo))}?w=1280",
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
    bufferingOverlayEnabled: Boolean = false
) {
    val context = LocalContext.current
    val owner = LocalLifecycleOwner.current
    val lifecycleState by owner.lifecycle.currentStateAsState()
    val accountId = auth.account?.id
    val adaptive = bufferingOverlayEnabled && mediaPath == "/api/sauti-media/${media.id}"
    val recoveryOnline = if (adaptive) rememberNetworkAvailable() else false
    val metadata = NativeVideoMetadata(media.width, media.height, media.durationMs)
    val baseQuality = if (adaptive) NativeVideoQualityPolicy.selectQuality("auto", metadata) else "original"
    val configuration = LocalConfiguration.current
    val density = LocalDensity.current
    val windowHeight = with(density) { configuration.screenHeightDp.dp.toPx() }
    var visibleFraction by remember(auth, media.id) { mutableFloatStateOf(0f) }
    var started by remember(auth, media.id) { mutableStateOf(false) }
    var wantsToPlay by remember(auth, media.id) { mutableStateOf(false) }
    var manualPaused by remember(auth, media.id) { mutableStateOf(false) }
    var accessToken by remember(auth, media.id) { mutableStateOf<String?>(null) }
    var requestError by remember(auth, media.id) { mutableStateOf<String?>(null) }
    val muted = NativePlaybackPreferences.sessionMuted
    var firstFrame by remember(auth, media.id) { mutableStateOf(false) }
    LaunchedEffect(visibleFraction, isCurrent, NativePlaybackPreferences.autoplayEnabled) {
        val visible = visibleFraction >= .58f && isCurrent
        if (NativePlaybackPreferences.autoplayEnabled && visible && !manualPaused) {
            started = true
            wantsToPlay = true
        } else if (!visible) {
            wantsToPlay = false
            manualPaused = false
        } else if (!NativePlaybackPreferences.autoplayEnabled) {
            wantsToPlay = false
        }
    }
    LaunchedEffect(started, auth.account?.id, media.id) {
        if (!started) return@LaunchedEffect
        try { accessToken = auth.accessTokenForStagingRead() }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { requestError = "Video unavailable. Sign in and try again." }
    }
    val token = accessToken
    val player = remember(auth, media.id, token, mediaPath) {
        token?.let {
            val http = DefaultHttpDataSource.Factory()
                .setDefaultRequestProperties(mapOf("Authorization" to "Bearer $it"))
                .setAllowCrossProtocolRedirects(false)
            ExoPlayer.Builder(context)
                .setMediaSourceFactory(DefaultMediaSourceFactory(http))
                .build().apply {
                    volume = if (muted) 0f else 1f
                    setMediaItem(if (adaptive) MediaItem.Builder().setMediaId(media.id)
                        .setUri(auth.mediaOrigin + videoPlaybackPath(mediaPath, baseQuality)).build()
                    else MediaItem.fromUri("${auth.mediaOrigin}$mediaPath"))
                    prepare()
                    playWhenReady = false
                }
        }
    }
    val playbackOwner = remember(player) { accountId }
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
                if (adaptive && player.playbackState == Player.STATE_READY && player.duration > 0 &&
                    player.currentPosition > player.duration) player.seekTo(player.duration)
            }
            override fun onRenderedFirstFrame() { firstFrame = true }
            override fun onIsPlayingChanged(isPlaying: Boolean) { playing = isPlaying }
            override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                requestError = "Video could not play. Tap retry."
                if (bufferingOverlayEnabled) logVideoPlaybackFailure(VideoPlaybackScope.HOME, error, player)
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
        }
    }
    val selectedQuality = rememberVideoRecoveryQuality(player, playbackOwner, media.id, metadata, "auto", baseQuality,
        enabled = adaptive, online = recoveryOnline, eligible = isCurrent && visibleFraction >= .58f &&
            lifecycleState.isAtLeast(Lifecycle.State.STARTED) && wantsToPlay && !manualPaused,
        requested = playbackRequested, playing = playing, playbackState = playbackState,
        suppressed = playbackSuppressed, hasError = requestError != null) {
        auth.account?.id == playbackOwner && isCurrent && visibleFraction >= .58f && wantsToPlay && !manualPaused &&
            owner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)
    }
    LaunchedEffect(player, selectedQuality) {
        if (!adaptive || player == null || auth.account?.id != playbackOwner ||
            player.playerError != null || requestError != null) return@LaunchedEffect
        val uri = auth.mediaOrigin + videoPlaybackPath(mediaPath, selectedQuality)
        if (player.currentMediaItem?.localConfiguration?.uri?.toString() != uri) {
            replaceVideoPlaybackSource(player, MediaItem.Builder().setMediaId(media.id).setUri(uri).build(),
                keepPosition = true, requested = wantsToPlay && !manualPaused && isCurrent &&
                    owner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED))
        }
    }
    LaunchedEffect(player, muted) { player?.volume = if (muted) 0f else 1f }
    LaunchedEffect(player, isCurrent, wantsToPlay, requestError, if (adaptive) lifecycleState else null) {
        if (player != null) {
            if (!isCurrent) player.pause()
            else if (adaptive && !lifecycleState.isAtLeast(Lifecycle.State.STARTED)) player.pause()
            else if (wantsToPlay && requestError == null) player.play()
            else if (!wantsToPlay) player.pause()
        }
    }
    val overlayEligible = bufferingOverlayEnabled && isCurrent && visibleFraction > 0f &&
        lifecycleState.isAtLeast(Lifecycle.State.STARTED) && started && wantsToPlay &&
        !manualPaused && requestError == null && !playbackSuppressed
    val showBufferingOverlay = overlayEligible &&
        (token == null || playbackRequested && playbackState == Player.STATE_BUFFERING)
    Box(modifier.background(Color.Black).onGloballyPositioned { coordinates ->
        val rect = coordinates.boundsInWindow()
        val shownTop = rect.top.coerceAtLeast(0f)
        val shownBottom = rect.bottom.coerceAtMost(windowHeight)
        visibleFraction = ((shownBottom - shownTop).coerceAtLeast(0f) /
            rect.height.coerceAtLeast(1f)).coerceIn(0f, 1f)
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
        val playPrompt = !playing && (firstFrame || adaptive && manualPaused ||
            !NativePlaybackPreferences.autoplayEnabled || requestError != null || !started)
        val startPlayback = {
            requestError = null
            started = true
            manualPaused = false
            wantsToPlay = true
            if (player?.playerError != null) {
                if (adaptive) replaceVideoPlaybackSource(player, MediaItem.Builder().setMediaId(media.id)
                    .setUri(auth.mediaOrigin + videoPlaybackPath(mediaPath, selectedQuality)).build(),
                    keepPosition = true, requested = owner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED))
                else player.prepare()
            }
            if (player?.playbackState == androidx.media3.common.Player.STATE_ENDED) player.seekToDefaultPosition()
            player?.play()
        }
        val pausePlayback = {
            wantsToPlay = false
            manualPaused = true
            player?.pause()
        }
        val playRadius = with(density) { 30.dp.toPx() }
        val pauseRequested = playing || adaptive && playbackState != Player.STATE_ENDED && requestError == null &&
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
        if (player != null && firstFrame) {
            IconButton(
                onClick = NativePlaybackPreferences::toggleSessionSound,
                modifier = Modifier.align(Alignment.BottomStart).padding(7.dp)
                    .background(Color.Black.copy(alpha = .56f), CircleShape)
                    .size(44.dp)
            ) {
                Icon(if (muted) Icons.Rounded.VolumeOff else Icons.Rounded.VolumeUp,
                    contentDescription = if (muted) "Unmute video" else "Mute video",
                    tint = Color.White, modifier = Modifier.size(23.dp))
            }
        }
    }
}

/** Only callers that already validated a published media path may append a rendition. */
internal fun videoPlaybackPath(path: String, quality: String): String =
    if (quality in setOf("240", "360", "480", "720", "1080")) "$path?quality=$quality" else path

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
