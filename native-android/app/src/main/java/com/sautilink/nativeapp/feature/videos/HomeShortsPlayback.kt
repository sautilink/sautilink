package com.sautilink.nativeapp.feature.videos

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.home.retireFeedVideo
import com.sautilink.nativeapp.ui.components.NativePlaybackRead
import com.sautilink.nativeapp.ui.components.NativeVideoPlaybackResources
import com.sautilink.nativeapp.ui.components.nativePlaybackReusableDelay
import java.io.Closeable

internal fun homeShortsPlayerState(state:Int):Boolean = state==Player.STATE_READY || state==Player.STATE_BUFFERING

internal fun homeShortsTransferWindow(offeredAt:Long, now:Long):Boolean =
    offeredAt>=0 && now>=offeredAt && now-offeredAt<3_000L

internal fun homeShortsReadReusable(read:NativePlaybackRead,owner:String,mediaId:String,
    origin:String,token:String?,now:Long):Boolean = !token.isNullOrBlank() &&
    !read.failure && !read.denied && read.sourceAttempt==read.attempt && read.bearer==token &&
    nativePlaybackReusableDelay(read,owner,mediaId,origin,"/api/sauti-media/$mediaId/playback",now)!=null

/** A one-use transfer of a live authorized decoder, not a cross-session player cache.
 * Home relinquishes teardown once offered; Shorts closes it on its first swipe/exit.
 * An unclaimed transfer retires itself after three seconds, including failed navigation.
 */
@androidx.annotation.OptIn(markerClass=[UnstableApi::class])
internal class HomeShortsPlayback private constructor(
    private val auth: StagingAuthClient, val owner: String, val mediaId: String,
    val player: ExoPlayer, val resources: NativeVideoPlaybackResources, val read: NativePlaybackRead,
    private val bearer: java.util.concurrent.atomic.AtomicReference<String?>,
    private val onPosition: (Long)->Unit,
) : Closeable {
    private val offeredAt = SystemClock.elapsedRealtime()
    private val handler = Handler(Looper.getMainLooper())
    private val expire = Runnable { if (!claimed) close() }
    private var claimed = false
    var closed = false; private set
    var finalPosition = 0L; private set
    init { handler.postDelayed(expire, 3_000L) }

    fun owns(candidate: Player?) = candidate === player
    fun claim(current: StagingAuthClient, account: String?): HomeShortsPlayback? {
        if (claimed || closed) return null
        if (current !== auth || account != owner || auth.account?.id != owner ||
            !homeShortsTransferWindow(offeredAt,SystemClock.elapsedRealtime()) || !healthy()) {
            close(); return null
        }
        claimed = true; handler.removeCallbacks(expire)
        com.sautilink.nativeapp.ui.components.NativeVideoStartupProbe.mark(mediaId,com.sautilink.nativeapp.ui.components.NativeVideoStartupStage.HANDOFF_CLAIM)
        return this
    }
    private fun healthy() = player.currentMediaItem?.mediaId == mediaId &&
        homeShortsPlayerState(player.playbackState) && player.playerError == null &&
        homeShortsReadReusable(read,owner,mediaId,auth.mediaOrigin,bearer.get(),System.currentTimeMillis())

    fun updateBearer(value: String?) { if (!closed && !value.isNullOrBlank()) bearer.set(value) }
    override fun close() {
        if (closed) return
        closed = true; handler.removeCallbacks(expire)
        finalPosition = player.currentPosition.coerceAtLeast(0L)
        onPosition(finalPosition)
        try {retireFeedVideo(player,resources)} finally {bearer.set(null)}
    }
    companion object {
        fun offer(auth: StagingAuthClient, owner: String?, mediaId: String,
            player: ExoPlayer?, resources: NativeVideoPlaybackResources?, read: NativePlaybackRead,
            bearer: java.util.concurrent.atomic.AtomicReference<String?>, onPosition: (Long)->Unit): HomeShortsPlayback? {
            if (owner == null || auth.account?.id != owner || player == null || resources == null ||
                player.currentMediaItem?.mediaId != mediaId || !homeShortsPlayerState(player.playbackState) || player.playerError != null ||
                !homeShortsReadReusable(read,owner,mediaId,auth.mediaOrigin,bearer.get(),System.currentTimeMillis())) return null
            return HomeShortsPlayback(auth,owner,mediaId,player,resources,read,bearer,onPosition)
        }
    }
}
