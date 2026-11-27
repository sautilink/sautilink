package com.sautilink.nativeapp.feature.home

import android.content.Context
import android.os.Trace
import android.view.LayoutInflater
import androidx.media3.common.util.UnstableApi
import androidx.media3.ui.PlayerView
import com.sautilink.nativeapp.R

/** Keep video/subtitle surfaces; Compose already owns all feed controls. */
@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
internal fun createNativeFeedPlayerView(context: Context): PlayerView {
    Trace.beginSection("Sauti:create-feed-player-view")
    return try {
        LayoutInflater.from(context).inflate(R.layout.native_feed_player, null) as PlayerView
    } finally { Trace.endSection() }
}

/** AndroidView may reuse this Surface for another row. Stop its old decoder
 * before detaching it; the next update binds the new row's player. */
@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
internal fun detachNativeFeedPlayerView(view: PlayerView, preservePlayback: Boolean = false) {
    Trace.beginSection("Sauti:detach-feed-player-view")
    val mediaId=view.player?.currentMediaItem?.mediaId.orEmpty()
    com.sautilink.nativeapp.ui.components.NativeVideoStartupProbe.mark(mediaId,com.sautilink.nativeapp.ui.components.NativeVideoStartupStage.SURFACE_DETACH_BEGIN)
    try {
        view.player?.let {
            if (!preservePlayback && it.playbackState != androidx.media3.common.Player.STATE_IDLE) { it.pause(); it.stop() }
        }
        view.player = null
    } finally {
        com.sautilink.nativeapp.ui.components.NativeVideoStartupProbe.mark(mediaId,com.sautilink.nativeapp.ui.components.NativeVideoStartupStage.SURFACE_DETACH_END)
        Trace.endSection()
    }
}

/** One bounded copy on an explicit tap; feed scrolling keeps its faster SurfaceView. */
@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
internal fun captureFeedVideoFrame(view:PlayerView?, onResult:(android.graphics.Bitmap?)->Unit) {
    val surface=view?.videoSurfaceView as? android.view.SurfaceView
    if(surface==null || surface.width<=0 || surface.height<=0 || !surface.holder.surface.isValid) {onResult(null);return}
    val scale=minOf(1f,720f/maxOf(surface.width,surface.height))
    val bitmap=runCatching {android.graphics.Bitmap.createBitmap((surface.width*scale).toInt().coerceAtLeast(1),
        (surface.height*scale).toInt().coerceAtLeast(1),android.graphics.Bitmap.Config.ARGB_8888)}.getOrNull()
        ?: run {onResult(null);return}
    val handler=android.os.Handler(android.os.Looper.getMainLooper())
    val completed=java.util.concurrent.atomic.AtomicBoolean(false)
    val fallback=Runnable {if(completed.compareAndSet(false,true)) {
        onResult(null)
    }}
    handler.postDelayed(fallback,240)
    val copySurface=surface.holder.surface
    FrameCopyExecutor.execute { try {
        android.view.PixelCopy.request(copySurface,bitmap,{ result ->
            handler.removeCallbacks(fallback)
            if(completed.compareAndSet(false,true)) {
                if(result==android.view.PixelCopy.SUCCESS)onResult(bitmap) else {bitmap.recycle();onResult(null)}
            } else bitmap.recycle()
        },handler)
    } catch(_:Exception) {
        handler.removeCallbacks(fallback);bitmap.recycle()
        handler.post {
            if(completed.compareAndSet(false,true))onResult(null)
        }
    } }
}

private val FrameCopyExecutor=java.util.concurrent.Executors.newSingleThreadExecutor { task ->
    Thread(task,"Sauti-frame-copy").apply {isDaemon=true}
}
