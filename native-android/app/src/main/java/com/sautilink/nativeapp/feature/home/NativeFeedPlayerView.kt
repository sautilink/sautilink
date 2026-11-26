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
internal fun detachNativeFeedPlayerView(view: PlayerView) {
    Trace.beginSection("Sauti:detach-feed-player-view")
    try {
        view.player?.let {
            if (it.playbackState != androidx.media3.common.Player.STATE_IDLE) { it.pause(); it.stop() }
        }
        view.player = null
    } finally { Trace.endSection() }
}
