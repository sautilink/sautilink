package com.sautilink.nativeapp.ui.components

internal data class RecentVideoTransferSample(val measuredMbps: Double, val measuredAtMillis: Long)

/** One process-memory observation, shared by newly composed video cells. It can
 * only be populated by a completed, substantial transfer sample—not the bandwidth
 * meter's initial estimate. A network handoff/offline state forgets it immediately.
 */
internal class RecentVideoTransferObservation(private val lifetimeMs: Long = 30_000L) {
    private var handle: Long? = null
    private var validated = false
    private var connectedAtMillis = 0L
    private var lastClockMillis = 0L
    private var sample: RecentVideoTransferSample? = null

    @Synchronized fun observeConnection(nextHandle: Long?, online: Boolean, now: Long): RecentVideoTransferSample? {
        val nextValidated = online && nextHandle != null
        if (now < 0L || now < lastClockMillis || nextHandle != handle || nextValidated != validated) {
            sample = null
            connectedAtMillis = now.coerceAtLeast(0L)
        }
        handle = nextHandle
        validated = nextValidated
        lastClockMillis = now.coerceAtLeast(0L)
        if (!validated) { sample = null; return null }
        val current = sample ?: return null
        if (now < current.measuredAtMillis || now - current.measuredAtMillis >= lifetimeMs) {
            sample = null
            return null
        }
        return current
    }

    @Synchronized fun recordTransfer(
        networkHandle: Long?, online: Boolean, elapsedMs: Int, bytes: Long, bitrateEstimate: Long, now: Long
    ): RecentVideoTransferSample? {
        val previous = observeConnection(networkHandle, online, now)
        if (!validated || elapsedMs < 200 || bytes < 524_288L || bitrateEstimate <= 0L ||
            now < elapsedMs.toLong() || now - elapsedMs.toLong() < connectedAtMillis) return previous
        return RecentVideoTransferSample(bitrateEstimate / 1_000_000.0, now).also { sample = it }
    }
}
