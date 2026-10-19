package com.sautilink.nativeapp.ui.components

import kotlin.math.floor

/** Source metadata, not the dimensions of a potentially substituted delivery. */
data class NativeVideoMetadata(val width: Int = 0, val height: Int = 0, val durationMs: Long = 0L)

/** A bandwidth estimate is optional; Wi-Fi alone does not establish its capacity. */
data class NativeVideoNetwork(
    val measuredMbps: Double? = null,
    val isMetered: Boolean = false,
    val saveData: Boolean = false
)

data class NativeVideoDimensions(val width: Int, val height: Int)

/** Pure counterparts of the web quality/variant rules. This never changes a player or a URL. */
object NativeVideoQualityPolicy {
    val variantQualities: List<Int> = listOf(240, 360, 480, 720, 1080)
    private val preferences = setOf("auto", "data-saver", "original") + variantQualities.map(Int::toString)

    fun normalizePreference(value: String?): String =
        value?.trim()?.lowercase()?.takeIf { it in preferences } ?: "auto"

    fun variantDimensions(media: NativeVideoMetadata?, quality: Int): NativeVideoDimensions? {
        if (media == null || quality !in variantQualities || media.width <= 0 || media.height <= 0 ||
            media.durationMs <= 0L || media.durationMs > 60_000L) return null
        val shortEdge = minOf(media.width, media.height)
        if (shortEdge <= quality) return null
        val longEdge = maxOf(media.width, media.height)
        // Match JavaScript Math.round for these positive values before enforcing the transform bound.
        val targetLongEdge = floor(quality.toDouble() * longEdge / shortEdge + 0.5).toLong()
        if (targetLongEdge > 2000L) return null
        return if (media.width <= media.height) NativeVideoDimensions(quality, targetLongEdge.toInt())
        else NativeVideoDimensions(targetLongEdge.toInt(), quality)
    }

    fun availableQualities(media: NativeVideoMetadata?): List<Int> =
        variantQualities.filter { variantDimensions(media, it) != null }

    fun adaptiveQuality(network: NativeVideoNetwork = NativeVideoNetwork(), stallCount: Int = 0): Int = when {
        network.saveData || stallCount >= 2 -> 240
        network.isMetered || stallCount >= 1 -> 360
        network.measuredMbps?.let { it.isFinite() && it >= 6.0 } == true -> 720
        else -> 360
    }

    fun resolveQuality(requested: String, media: NativeVideoMetadata?): String {
        val available = availableQualities(media)
        if (media == null || available.isEmpty() || requested == "original") return "original"
        if (requested == "data-saver") return available.first().toString()
        val target = requested.toDoubleOrNull()?.takeIf { it.isFinite() } ?: return "original"
        if (minOf(media.width, media.height) <= target) return "original"
        return (available.lastOrNull { it <= target } ?: available.first()).toString()
    }

    /** Manual choices remain explicit. Only Auto responds to connection/stall observations. */
    fun selectQuality(
        preference: String?,
        media: NativeVideoMetadata?,
        network: NativeVideoNetwork = NativeVideoNetwork(),
        stallCount: Int = 0
    ): String {
        val normalized = normalizePreference(preference)
        val requested = if (normalized == "auto") adaptiveQuality(network, stallCount).toString() else normalized
        return resolveQuality(requested, media)
    }
}
