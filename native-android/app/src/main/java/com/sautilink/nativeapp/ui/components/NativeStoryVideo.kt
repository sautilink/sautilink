package com.sautilink.nativeapp.ui.components

import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.currentStateAsState
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import kotlinx.coroutines.delay

/** Story chrome owns tap navigation/hold/progress. This player owns only authorized
 * media; it never loops, advances only once, and cannot load while backgrounded.
 */
@Composable
@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
internal fun NativeStoryVideo(auth: StagingAuthClient, storyId: String, playbackPath: String,
    active: Boolean, paused: Boolean, modifier: Modifier = Modifier,
    onProgress: (Long, Long) -> Unit, onEnded: () -> Unit, onError: (String) -> Unit,
    onReady: () -> Unit = {}, playbackRead: NativePlaybackRead? = null) {
    val context = LocalContext.current
    val owner = LocalLifecycleOwner.current
    val lifecycle by owner.lifecycle.currentStateAsState()
    val account = auth.account?.id
    val freshProgress by rememberUpdatedState(onProgress)
    val freshEnded by rememberUpdatedState(onEnded)
    val freshError by rememberUpdatedState(onError)
    val freshReady by rememberUpdatedState(onReady)
    val freshPaused by rememberUpdatedState(paused)
    val eligible = active && lifecycle.isAtLeast(Lifecycle.State.STARTED)
    val read = rememberNativePlaybackSource(auth, storyId, playbackPath, eligible, retainedRead = playbackRead)
    val source = read.source
    val latestBearer by rememberUpdatedState(read.bearer)
    // Descriptor auth supplies the credential directly; there is no preliminary
    // token effect/recomposition before starting the descriptor request.
    val resources = remember(auth, account, storyId, read.bearer != null) {
        read.bearer?.let { nativeVideoPlaybackResources(context, auth.mediaOrigin, it, authorizationToken = { latestBearer }) {
            account != null && auth.account?.id == account
        } }
    }
    val player = remember(resources) {
        resources?.let {
            ExoPlayer.Builder(context).setMediaSourceFactory(DefaultMediaSourceFactory(it.dataSourceFactory))
                .setBandwidthMeter(androidx.media3.exoplayer.upstream.DefaultBandwidthMeter.getSingletonInstance(context))
                .setLoadControl(DefaultLoadControl.Builder().setBufferDurationsMs(3_000, 15_000, 750, 1_500)
                    .setBackBuffer(5_000, true).build()).build().apply { repeatMode = Player.REPEAT_MODE_OFF }
        }
    }
    var firstFrame by remember(player) { mutableStateOf(false) }
    var finished by remember(auth, account, storyId) { mutableStateOf(false) }
    var stopped by remember(player) { mutableStateOf(false) }
    var stoppedPosition by remember(player) { mutableLongStateOf(0L) }
    fun finish() { if (!finished && auth.account?.id == account) { finished = true; player?.pause(); freshEnded() } }
    DisposableEffect(player, owner) {
        if (player == null) return@DisposableEffect onDispose { resources?.close() }
        val listener = object : Player.Listener {
            override fun onRenderedFirstFrame() {
                firstFrame = true
                NativeVideoStartupProbe.mark(storyId, NativeVideoStartupStage.FIRST_FRAME)
                freshReady()
            }
            override fun onPlaybackStateChanged(playbackState: Int) { if (playbackState == Player.STATE_ENDED && !freshPaused) finish() }
            override fun onPlayerError(error: PlaybackException) { freshError("Could not play this story. Please retry.") }
        }
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_STOP) player.pause() }
        player.addListener(listener); owner.lifecycle.addObserver(observer)
        onDispose { owner.lifecycle.removeObserver(observer); player.removeListener(listener); player.release(); resources?.close() }
    }
    LaunchedEffect(read.denied, read.failure, read.loading) {
        if (read.denied) { player?.stop(); freshError("This story is no longer available.") }
        else if (read.failure && source == null && !read.loading) freshError("Could not load this story. Please retry.")
    }
    LaunchedEffect(player, source, eligible) {
        if (player == null || source == null || !eligible || auth.account?.id != account || finished) return@LaunchedEffect
        resources?.hlsGrants?.authorize(source)
        if (player.currentMediaItem?.localConfiguration?.uri?.toString() != source.url) {
            NativeVideoStartupProbe.mark(storyId, NativeVideoStartupStage.SOURCE_PREPARE)
            val position = if (player.currentMediaItem?.mediaId == storyId) player.currentPosition.coerceAtLeast(0L) else 0L
            player.setMediaItem(MediaItem.Builder().setMediaId(storyId).setUri(source.url)
                .setMimeType(if (source.hls) MimeTypes.APPLICATION_M3U8 else MimeTypes.VIDEO_MP4).build(), position)
            player.prepare(); player.playWhenReady = eligible && !paused
        }
    }
    NativeHlsQualitySelection(player, source?.hls == true, "auto")
    LaunchedEffect(player, eligible, paused, source, finished) {
        if (player == null) return@LaunchedEffect
        if (!eligible || finished) {
            if (!stopped && player.mediaItemCount > 0) {
                stoppedPosition = player.currentPosition.coerceAtLeast(0L)
                player.pause(); player.stop(); stopped = true
            }
        } else if (source != null) {
            if (stopped) { player.seekTo(stoppedPosition); player.prepare(); stopped = false }
            player.playWhenReady = !paused
        }
    }
    LaunchedEffect(player, eligible, finished) {
        if (player == null || !eligible || finished) return@LaunchedEffect
        while (!finished) {
            val duration = player.duration.takeIf { it != C.TIME_UNSET && it > 0L }?.coerceAtMost(30_000L) ?: 30_000L
            val position = player.currentPosition.coerceIn(0L, duration)
            if (firstFrame) freshProgress(position, duration)
            if (firstFrame && position >= duration && !freshPaused) finish()
            delay(50L)
        }
    }
    AndroidView(factory = { PlayerView(it).apply {
        useController = false; resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT; this.player = player
    } }, update = { it.player = player; it.keepScreenOn = player?.isPlaying == true },
        onRelease = { it.player = null }, modifier = modifier.graphicsLayer { alpha = if (firstFrame) 1f else 0f })
}
