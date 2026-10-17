package com.sautilink.nativeapp.ui.components

import android.content.Context
import android.content.BroadcastReceiver
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.upstream.BandwidthMeter
import androidx.media3.exoplayer.upstream.DefaultBandwidthMeter

/** Observe existing video transfers, validated connectivity, metering and Android Data Saver.
 * No probes/downloads are started to estimate a connection. The meter's initial guess is
 * never presented as a measurement. Its estimate expires after 30 seconds or a handoff.
 */
@Composable
@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
internal fun rememberNativeVideoNetwork(): NativeVideoNetwork {
    val context = LocalContext.current.applicationContext
    val manager = remember(context) {
        context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    }
    val meter = remember(context) { DefaultBandwidthMeter.getSingletonInstance(context) }
    val handler = remember { Handler(Looper.getMainLooper()) }
    fun current(): VideoConnection {
        val active = manager.activeNetwork
        val capabilities = manager.getNetworkCapabilities(active)
        return VideoConnection(active?.networkHandle,
            capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true &&
                capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET),
            manager.isActiveNetworkMetered,
            manager.restrictBackgroundStatus == ConnectivityManager.RESTRICT_BACKGROUND_STATUS_ENABLED)
    }
    var connection by remember(manager) { mutableStateOf(current()) }
    var measuredMbps by remember(meter) { mutableStateOf<Double?>(null) }
    var measuredAt by remember(meter) { mutableLongStateOf(0L) }
    DisposableEffect(manager, meter) {
        var observing = true
        fun refresh() {
            if (!observing) return
            val next = current()
            if (next.handle != connection.handle || !next.online) {
                measuredMbps = null
                measuredAt = 0L
            }
            connection = next
        }
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) { handler.post { refresh() } }
            override fun onLost(network: Network) { handler.post { refresh() } }
            override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
                handler.post { refresh() }
            }
        }
        val bandwidth = BandwidthMeter.EventListener { elapsedMs, bytes, estimate ->
            refresh()
            if (observing && connection.online && elapsedMs >= 200 && bytes >= 524_288L && estimate > 0L) {
                measuredMbps = estimate / 1_000_000.0
                measuredAt = SystemClock.elapsedRealtime()
            }
        }
        val saver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) { refresh() }
        }
        manager.registerDefaultNetworkCallback(callback)
        meter.addEventListener(handler, bandwidth)
        ContextCompat.registerReceiver(context, saver,
            IntentFilter(ConnectivityManager.ACTION_RESTRICT_BACKGROUND_CHANGED), ContextCompat.RECEIVER_NOT_EXPORTED)
        onDispose {
            observing = false
            manager.unregisterNetworkCallback(callback)
            meter.removeEventListener(bandwidth)
            context.unregisterReceiver(saver)
        }
    }
    return NativeVideoNetwork(
        measuredMbps.takeIf { connection.online && SystemClock.elapsedRealtime() - measuredAt <= 30_000L },
        connection.metered, connection.saveData)
}

private data class VideoConnection(val handle: Long?, val online: Boolean, val metered: Boolean, val saveData: Boolean)

/** Use the web thresholds, but do not restart a playing clip to upgrade every bandwidth
 * sample. Auto can step down during the clip; a new clip can start at a higher quality.
 * Explicit quality choices retain their existing behavior.
 */
@Composable
internal fun rememberNativeVideoQuality(
    mediaId: String?, preference: String, metadata: NativeVideoMetadata, network: NativeVideoNetwork
): String {
    val candidate = NativeVideoQualityPolicy.selectQuality(preference, metadata, network)
    var selected by remember(mediaId, preference, metadata) { mutableStateOf(candidate) }
    LaunchedEffect(candidate, mediaId, preference) {
        if (preference == "auto") {
            val currentRank = selected.toIntOrNull() ?: minOf(metadata.width, metadata.height)
            val nextRank = candidate.toIntOrNull() ?: minOf(metadata.width, metadata.height)
            if (nextRank < currentRank) selected = candidate
        } else selected = candidate
    }
    return selected
}
