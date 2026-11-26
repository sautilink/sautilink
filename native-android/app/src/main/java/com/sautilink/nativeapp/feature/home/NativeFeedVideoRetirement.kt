package com.sautilink.nativeapp.feature.home

import android.os.Handler
import android.os.Looper
import android.os.Trace
import androidx.media3.common.Player
import java.io.Closeable

private val videoRetirementHandler by lazy { Handler(Looper.getMainLooper()) }
private fun postVideoRelease(release: () -> Unit) {
    videoRetirementHandler.postDelayed({
        Trace.beginSection("Sauti:release-retired-video")
        try { release() } finally { Trace.endSection() }
    }, 120L)
}

/** Stop playback/I/O and revoke this resource immediately. Let the playback
 * thread finish its queued stop before release waits for decoder shutdown;
 * disposing a feed row must not synchronously stall the scrolling frame.
 * All Player calls still run on its main application looper. */
internal fun retireFeedVideo(player: Player, resources: Closeable?,
    deferRelease: (() -> Unit) -> Unit = ::postVideoRelease) {
    player.pause()
    player.stop()
    try { resources?.close() } finally { deferRelease { player.release() } }
}
