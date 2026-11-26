package com.sautilink.nativeapp.feature.music

import androidx.compose.runtime.*
import androidx.media3.common.Player
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlin.math.abs

/** Position is read from the player on demand. Scrolling and the running video
 * clock never publish per-frame snapshot state into the feed composition. */
internal data class NativePostVideoClock(val postId: String, val mediaId: String,
    val player: Player?, val current: Boolean, val frameReady: Boolean, val playing: Boolean)

internal fun soundtrackVideoPosition(positionMs: Long, clipDurationMs: Long): Long =
    if (clipDurationMs <= 0L) 0L else positionMs.coerceAtLeast(0L) % clipDurationMs

internal fun soundtrackCircularDrift(positionMs: Long, targetMs: Long, clipDurationMs: Long): Long {
    if (clipDurationMs <= 0L) return 0L
    val delta = abs(soundtrackVideoPosition(positionMs, clipDurationMs) - soundtrackVideoPosition(targetMs, clipDurationMs))
    return minOf(delta, clipDurationMs - delta)
}

internal fun videoSoundtrackReady(video: NativePostVideoClock?): Boolean = video == null ||
    video.current && video.frameReady && video.playing && video.player?.isPlaying == true &&
        video.player?.currentMediaItem?.mediaId == video.mediaId

/** Register even while the source/player is still loading, so music cannot
 * mistake a video placeholder for a photo. Noncurrent carousel videos do not
 * block the soundtrack of the photo currently being viewed. */
@Composable
internal fun BindNativePostVideoClock(player: Player?, postId: String, mediaId: String,
    current: Boolean, frameReady: Boolean, playing: Boolean) {
    val session = LocalNativeMusicComposer.current ?: return
    val key = remember(postId, mediaId) { "video-clock:$mediaId:${java.util.UUID.randomUUID()}" }
    val clock = NativePostVideoClock(postId, mediaId, player, current,
        frameReady && player?.currentMediaItem?.mediaId == mediaId, playing)
    SideEffect { session.videoClocks[key] = clock }
    DisposableEffect(session, key) { onDispose { session.videoClocks.remove(key) } }
}

/** Prepare music silently, then follow the actual video's first frame, pause,
 * buffering, seek, repeat and speed. Photos/text have no video clock and start
 * normally. Only the player changes; this loop never recomposes the UI. */
@Composable
internal fun NativeSyncedPostSoundtrack(player: Player, playbackKey: Any?, allowed: Boolean,
    video: NativePostVideoClock?, clipDurationMs: Long, prepare: () -> Boolean,
    start: () -> Unit = { player.play() }) {
    val latestPrepare by rememberUpdatedState(prepare)
    val latestStart by rememberUpdatedState(start)
    DisposableEffect(player) { onDispose { player.pause() } }
    LaunchedEffect(player, playbackKey, allowed, video, clipDurationMs) {
        player.pause()
        if (!latestPrepare() || !allowed || !videoSoundtrackReady(video) || video != null && clipDurationMs <= 0L) return@LaunchedEffect
        if (video == null) { player.setPlaybackSpeed(1f); latestStart(); return@LaunchedEffect }
        val videoPlayer = video.player ?: return@LaunchedEffect
        player.setPlaybackSpeed(videoPlayer.playbackParameters.speed)
        player.seekTo(soundtrackVideoPosition(videoPlayer.currentPosition, clipDurationMs))
        latestStart()
        while (isActive) {
            if (!videoSoundtrackReady(video)) player.pause()
            else {
                val speed = videoPlayer.playbackParameters.speed
                if (player.playbackParameters.speed != speed) player.setPlaybackSpeed(speed)
                if (!player.playWhenReady) latestStart()
                // Do not repeatedly seek a buffering music source. Correct its
                // phase once it can actually advance, including after a seek.
                if (player.isPlaying) {
                    val target = soundtrackVideoPosition(videoPlayer.currentPosition, clipDurationMs)
                    if (player.currentPosition >= clipDurationMs || soundtrackCircularDrift(player.currentPosition, target, clipDurationMs) > 120L) player.seekTo(target)
                }
            }
            delay(100L)
        }
    }
}
