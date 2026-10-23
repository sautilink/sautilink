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

internal const val NATIVE_VIDEO_LOOKAHEAD = 5
internal const val NATIVE_VIDEO_RETAIN_BEHIND = 2

internal fun videoPreloadTarget(index: Int, current: Int, next: Set<Int>, permitted: Boolean,
    retainCurrent: Boolean, closed: Boolean, preparedNext: Set<Int> = emptySet(),
    incomingIndex: Int? = null): ShortsPreloadTarget = when {
    closed -> ShortsPreloadTarget.NONE
    retainCurrent && index == current -> ShortsPreloadTarget.RETAIN_CURRENT
    index == incomingIndex -> ShortsPreloadTarget.RETAIN_CURRENT
    index in next && index in preparedNext && index > current &&
        index.toLong() <= current.toLong() + NATIVE_VIDEO_LOOKAHEAD && !permitted -> ShortsPreloadTarget.RETAIN_CURRENT
    permitted && index in next && index > current && index.toLong() <= current.toLong() + NATIVE_VIDEO_LOOKAHEAD -> ShortsPreloadTarget.LOAD_NEXT
    else -> ShortsPreloadTarget.NONE
}

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

/** One visible decoder and a moving five-source, sequential Media3 preload queue.
 * Media3 shares its allocator, bandwidth meter and renderers with the visible
 * player. It never creates an offscreen playing/muted decoder. Signed grants
 * remain memory-only and every data source uses the normal authorization path.
 */
@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
internal class NativeShortsPreloading(context: Context, resources: NativeVideoPlaybackResources,
    createPlayer: Boolean = true, onPreloadCompleted: (String) -> Unit = {}) : Closeable {
    private var currentIndex = 0
    private var nextIndices: Set<Int> = emptySet()
    private var permitted = false
    private var closed = false
    private var retainCurrent = false
    private var keepPreparedNext = false
    private val completed = mutableSetOf<String>()
    private data class Update(val current: Int, val next: List<Pair<Int, NativeVideoSource>>, val allow: Boolean)
    private var pendingUpdate: Update? = null
    private var incomingHandoffIndex: Int? = null
    private var desiredNext: List<Pair<Int, NativeVideoSource>> = emptyList()
    private val items = linkedMapOf<String, Pair<MediaItem, Int>>()
    private val control = TargetPreloadStatusControl<Int, DefaultPreloadManager.PreloadStatus> { index ->
        when (targetFor(index)) {
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
            .setPlayerTargetBufferBytes("preload", 6 * 1_024 * 1_024)
            .build())
    private val manager = builder.build()
    private val ownedPlayer: ExoPlayer? = if (createPlayer) builder.buildExoPlayer() else null
    val player: ExoPlayer get() = checkNotNull(ownedPlayer)
    init {
        manager.addListener(object : PreloadManagerListener {
            override fun onCompleted(mediaItem: MediaItem) {
                val index = items[mediaItem.mediaId]?.second ?: return
                // TRACKS_SELECTED also emits onCompleted. Retaining a partial
                // incoming period must not advertise it as two seconds loaded.
                if (targetFor(index) == ShortsPreloadTarget.LOAD_NEXT) {
                    completed += mediaItem.mediaId
                    onPreloadCompleted(mediaItem.mediaId)
                }
            }
        })
    }

    private fun targetFor(index: Int): ShortsPreloadTarget {
        val prepared = if (keepPreparedNext) items.values.filter { it.first.mediaId in completed }.map { it.second }.toSet() else emptySet()
        return videoPreloadTarget(index, currentIndex, nextIndices, permitted, retainCurrent, closed, prepared, incomingHandoffIndex)
    }

    fun sourceFor(source: NativeVideoSource, index: Int): MediaSource? {
        if (closed || !source.hls || (source.expiresAtMillis ?: 0L) <= System.currentTimeMillis() + 5_000L) return null
        val existing = items[source.mediaId]
        val item = if (existing?.first?.localConfiguration?.uri?.toString() == source.url) existing.first else {
            existing?.let { completed.remove(it.first.mediaId); manager.remove(it.first) }
            MediaItem.Builder().setMediaId(source.mediaId).setUri(source.url)
                .setMimeType(MimeTypes.APPLICATION_M3U8).build().also {
                    items[source.mediaId] = it to index
                    manager.add(it, index)
                }
        }
        trim(currentIndex)
        return manager.getMediaSource(item)
    }

    fun update(current: Int, next: NativeVideoSource?, allow: Boolean, retainIncoming: Boolean = true) {
        updateWindow(current, listOfNotNull(next?.let { current + 1 to it }), allow, retainIncoming)
    }

    fun updateWindow(current: Int, next: List<Pair<Int, NativeVideoSource>>, allow: Boolean, retainIncoming: Boolean = true) {
        if (closed) return
        if (!retainIncoming) {
            retainCurrent = false
            keepPreparedNext = false
            completed.clear()
            pendingUpdate = null
            incomingHandoffIndex = null
            applyUpdate(current, emptyList(), false)
            return
        }
        keepPreparedNext = true
        // Compose can report the new pager page before the visible player has
        // taken its prepared MediaSource. NOT_PRELOADED would clear that very
        // sample queue. Keep the old ranking until attach() transfers ownership.
        val incoming = items.values.firstOrNull { it.second == current }?.first?.mediaId
        if (current != currentIndex && incoming != null && ownedPlayer?.currentMediaItem?.mediaId != incoming) {
            pendingUpdate = Update(current, next, allow)
            incomingHandoffIndex = current
            // The incoming player has priority even before its source attaches.
            // Preserve its existing partial queues without continuing the old
            // page's speculative sample downloads during that gap.
            permitted = false
            manager.invalidate()
            return
        }
        // A jump outside the retained window has no incoming queues to protect.
        // Advance the anchor before sourceFor() trims/creates the new current.
        pendingUpdate = null
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
        val waiting = pendingUpdate?.takeIf { it.current == index }
        pendingUpdate = null
        val future = waiting?.next ?: desiredNext.filter { it.first > index && it.first <= index + NATIVE_VIDEO_LOOKAHEAD }
        applyUpdate(index, future, waiting?.allow ?: false)
        return true
    }

    /** Feed uses only the loader/cache, with no offscreen ExoPlayer or decoder. */
    fun warmWindow(current: Int, next: List<Pair<Int, NativeVideoSource>>, allow: Boolean, retainPrepared: Boolean = true) {
        if (closed) return
        check(ownedPlayer == null)
        retainCurrent = false
        keepPreparedNext = retainPrepared
        if (!retainPrepared) completed.clear()
        applyUpdate(current, next, allow)
    }

    private fun applyUpdate(current: Int, next: List<Pair<Int, NativeVideoSource>>, allow: Boolean) {
        incomingHandoffIndex = null
        currentIndex = current
        val bounded = next.filter { it.first > current && it.first <= current + NATIVE_VIDEO_LOOKAHEAD }
            .distinctBy { it.first }.distinctBy { it.second.mediaId }.take(NATIVE_VIDEO_LOOKAHEAD)
        desiredNext = bounded
        nextIndices = bounded.map { it.first }.toSet()
        permitted = allow && bounded.isNotEmpty()
        if (permitted) bounded.forEach { (index, source) -> sourceFor(source, index) }
        trim(current)
        manager.setCurrentPlayingIndex(current)
        manager.invalidate()
    }

    private fun trim(current: Int) {
        val remove = items.filterValues { it.second !in current - NATIVE_VIDEO_RETAIN_BEHIND..current + NATIVE_VIDEO_LOOKAHEAD }.keys.toList()
        remove.forEach { id -> items.remove(id)?.let { completed.remove(it.first.mediaId); manager.remove(it.first) } }
        while (items.size > 8) items.remove(items.keys.first())?.let { completed.remove(it.first.mediaId); manager.remove(it.first) }
    }

    override fun close() {
        if (closed) return
        closed = true
        permitted = false
        ownedPlayer?.release()
        manager.release()
        items.clear()
        completed.clear()
        pendingUpdate = null
        incomingHandoffIndex = null
        desiredNext = emptyList()
    }
}
