package com.sautilink.nativeapp.ui.components

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import android.os.PowerManager
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.source.MediaSource
import androidx.media3.exoplayer.source.preload.DefaultPreloadManager
import androidx.media3.exoplayer.source.preload.PreloadManagerListener
import androidx.media3.exoplayer.source.preload.TargetPreloadStatusControl
import androidx.media3.exoplayer.upstream.DefaultBandwidthMeter
import java.io.Closeable

/** Speculation never outranks visible playback. Metered networks need a recent
 * real transfer measurement; Data Saver, heat, memory pressure and pause opt out.
 */
internal fun shortsPreloadEligible(foreground: Boolean, online: Boolean, autoplay: Boolean,
    playing: Boolean, bufferedMs: Long, saveData: Boolean, metered: Boolean,
    measuredMbps: Double?, stressed: Boolean, autoQuality: Boolean): Boolean =
    foreground && online && autoplay && playing && bufferedMs >= 6_000L &&
        !saveData && !stressed && autoQuality &&
        (!metered || measuredMbps?.let { it.isFinite() && it >= 3.0 } == true)

internal enum class ShortsPreloadTarget { NONE, RETAIN_CURRENT, LOAD_NEXT }

internal fun shortsPreloadTarget(index: Int, current: Int, next: Int?, permitted: Boolean,
    retainCurrent: Boolean, closed: Boolean): ShortsPreloadTarget = when {
    closed -> ShortsPreloadTarget.NONE
    retainCurrent && index == current -> ShortsPreloadTarget.RETAIN_CURRENT
    permitted && index == next && index == current + 1 -> ShortsPreloadTarget.LOAD_NEXT
    else -> ShortsPreloadTarget.NONE
}

internal fun videoDeviceStressed(context: Context): Boolean {
    val memory = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
    if (memory.isLowRamDevice) return true
    val info = ActivityManager.MemoryInfo().also(memory::getMemoryInfo)
    if (info.lowMemory) return true
    val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
    return power.isPowerSaveMode || Build.VERSION.SDK_INT >= 29 &&
        power.currentThermalStatus >= PowerManager.THERMAL_STATUS_MODERATE
}

/** One decoder, one adjacent preloaded source, at most three source records.
 * Media3 shares its allocator, bandwidth meter and renderers with the visible
 * player. It never creates an offscreen playing/muted decoder. Signed grants
 * remain memory-only and every data source uses the normal authorization path.
 */
@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
internal class NativeShortsPreloading(context: Context, resources: NativeVideoPlaybackResources,
    onPreloadCompleted: (String) -> Unit = {}) : Closeable {
    private var currentIndex = 0
    private var nextIndex: Int? = null
    private var permitted = false
    private var closed = false
    private var retainCurrent = false
    private var pendingUpdate: Triple<Int, NativeVideoSource?, Boolean>? = null
    private val items = linkedMapOf<String, Pair<MediaItem, Int>>()
    private val control = TargetPreloadStatusControl<Int, DefaultPreloadManager.PreloadStatus> { index ->
        when (shortsPreloadTarget(index, currentIndex, nextIndex, permitted, retainCurrent, closed)) {
            // prepare() does not synchronously transfer the preloaded period.
            // NOT_PRELOADED calls clear() even after prepare was enqueued, so
            // retain it until the player actually claims its sample queues.
            ShortsPreloadTarget.RETAIN_CURRENT -> DefaultPreloadManager.PreloadStatus.PRELOAD_STATUS_TRACKS_SELECTED
            ShortsPreloadTarget.LOAD_NEXT -> DefaultPreloadManager.PreloadStatus.specifiedRangeLoaded(2_000L)
            ShortsPreloadTarget.NONE -> DefaultPreloadManager.PreloadStatus.PRELOAD_STATUS_NOT_PRELOADED
        }
    }
    private val builder = DefaultPreloadManager.Builder(context, control)
        .setMediaSourceFactory(DefaultMediaSourceFactory(resources.dataSourceFactory))
        .setBandwidthMeter(DefaultBandwidthMeter.getSingletonInstance(context))
        .setLoadControl(DefaultLoadControl.Builder()
            .setBufferDurationsMs(3_000, 15_000, 750, 1_500)
            .setBackBuffer(5_000, true)
            .setPlayerTargetBufferBytes("preload", 1_024 * 1_024)
            .build())
    private val manager = builder.build()
    val player: ExoPlayer = builder.buildExoPlayer()
    init {
        manager.addListener(object : PreloadManagerListener {
            override fun onCompleted(mediaItem: MediaItem) { onPreloadCompleted(mediaItem.mediaId) }
        })
    }

    fun sourceFor(source: NativeVideoSource, index: Int): MediaSource? {
        if (closed || !source.hls || (source.expiresAtMillis ?: 0L) <= System.currentTimeMillis() + 5_000L) return null
        val existing = items[source.mediaId]
        val item = if (existing?.first?.localConfiguration?.uri?.toString() == source.url) existing.first else {
            existing?.let { manager.remove(it.first) }
            MediaItem.Builder().setMediaId(source.mediaId).setUri(source.url)
                .setMimeType(MimeTypes.APPLICATION_M3U8).build().also {
                    items[source.mediaId] = it to index
                    manager.add(it, index)
                }
        }
        trim(index)
        return manager.getMediaSource(item)
    }

    fun update(current: Int, next: NativeVideoSource?, allow: Boolean, retainIncoming: Boolean = true) {
        if (closed) return
        if (!retainIncoming) {
            retainCurrent = false
            pendingUpdate = null
            applyUpdate(current, null, false)
            return
        }
        // Compose can report the new pager page before the visible player has
        // taken its prepared MediaSource. NOT_PRELOADED would clear that very
        // sample queue. Keep the old ranking until attach() transfers ownership.
        val incoming = items.values.firstOrNull { it.second == current }?.first?.mediaId
        if (current != currentIndex && (incoming == null || player.currentMediaItem?.mediaId != incoming)) {
            pendingUpdate = Triple(current, next, allow)
            return
        }
        applyUpdate(current, next, allow)
    }

    fun attach(source: NativeVideoSource, index: Int, positionMs: Long, requested: Boolean): Boolean {
        val mediaSource = sourceFor(source, index) ?: return false
        retainCurrent = true
        player.setMediaSource(mediaSource, positionMs.coerceAtLeast(0L))
        player.prepare()
        player.playWhenReady = requested
        // Keep the incoming period's sample queues while Media3 asynchronously
        // transfers them to the visible player; the next clip alone may load.
        val waiting = pendingUpdate?.takeIf { it.first == index }
        pendingUpdate = null
        applyUpdate(index, waiting?.second, waiting?.third ?: false)
        return true
    }

    private fun applyUpdate(current: Int, next: NativeVideoSource?, allow: Boolean) {
        currentIndex = current
        nextIndex = if (next != null && allow) current + 1 else null
        permitted = allow && next != null
        next?.takeIf { permitted }?.let { sourceFor(it, current + 1) }
        trim(current)
        manager.setCurrentPlayingIndex(current)
        manager.invalidate()
    }

    private fun trim(current: Int) {
        val remove = items.filterValues { it.second !in current - 1..current + 1 }.keys.toList()
        remove.forEach { id -> items.remove(id)?.let { manager.remove(it.first) } }
        while (items.size > 3) items.remove(items.keys.first())?.let { manager.remove(it.first) }
    }

    override fun close() {
        if (closed) return
        closed = true
        permitted = false
        player.release()
        manager.release()
        items.clear()
        pendingUpdate = null
    }
}
