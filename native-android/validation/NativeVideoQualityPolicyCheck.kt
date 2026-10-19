package com.sautilink.nativeapp.ui.components

fun main() {
    val policy = NativeVideoQualityPolicy
    var checks = 0
    fun equal(actual: Any?, expected: Any?, name: String) {
        check(actual == expected) { "$name: expected=$expected actual=$actual" }
        checks++
    }
    val high = NativeVideoMetadata(1080, 1920, 30_000L)
    val medium = NativeVideoMetadata(480, 854, 30_000L)
    val low = NativeVideoMetadata(240, 426, 30_000L)
    equal(policy.availableQualities(low), emptyList<Int>(), "no source upscaling")
    equal(policy.availableQualities(medium), listOf(240, 360), "web medium choices")
    equal(policy.availableQualities(high), listOf(240, 360, 480, 720), "web high choices")
    equal(policy.availableQualities(null), emptyList<Int>(), "absent metadata")
    equal(policy.availableQualities(high.copy(durationMs = 0)), emptyList<Int>(), "unknown duration")
    equal(policy.availableQualities(high.copy(durationMs = -1)), emptyList<Int>(), "negative duration")
    equal(policy.availableQualities(high.copy(durationMs = 60_000)), listOf(240, 360, 480, 720), "one minute inclusive")
    equal(policy.availableQualities(high.copy(durationMs = 60_001)), emptyList<Int>(), "over one minute")
    equal(policy.availableQualities(high.copy(durationMs = Long.MAX_VALUE)), emptyList<Int>(), "large duration stays Long")
    equal(policy.variantDimensions(NativeVideoMetadata(1920, 820, 30_000), 360), NativeVideoDimensions(843, 360), "web landscape rounding")
    equal(policy.variantDimensions(NativeVideoMetadata(480, 4000, 60_000), 240), NativeVideoDimensions(240, 2000), "2000 edge inclusive")
    equal(policy.variantDimensions(NativeVideoMetadata(480, 4001, 60_000), 240), null, "rounded 2001 edge excluded")
    equal(policy.variantDimensions(high, 1080), null, "equal source edge uses original")
    equal(policy.variantDimensions(high, 600), null, "unsupported rendition")
    equal(policy.availableQualities(high.copy(width = 0)), emptyList<Int>(), "zero width")
    equal(policy.availableQualities(high.copy(height = -1)), emptyList<Int>(), "negative height")
    equal(policy.resolveQuality("720", medium), "original", "manual above source")
    equal(policy.resolveQuality("360", high), "360", "manual supported source")
    equal(policy.resolveQuality("data-saver", medium), "240", "web saver picks lowest")
    equal(policy.resolveQuality("original", high), "original", "explicit original")
    equal(policy.resolveQuality("invalid", high), "original", "invalid raw target")
    equal(policy.selectQuality(" DATA-SAVER ", high), "240", "normalized preference")
    equal(policy.selectQuality("invalid", high), "360", "invalid preference is Auto")
    equal(policy.selectQuality("auto", null), "original", "unknown metadata is original")
    equal(policy.selectQuality("auto", high), "360", "unknown capacity is web default")
    equal(policy.selectQuality("auto", high, NativeVideoNetwork(measuredMbps = 5.999)), "360", "below measured fast threshold")
    equal(policy.selectQuality("auto", high, NativeVideoNetwork(measuredMbps = 6.0)), "720", "measured fast threshold inclusive")
    equal(policy.selectQuality("auto", high, NativeVideoNetwork(measuredMbps = Double.NaN)), "360", "unknown invalid bandwidth")
    equal(policy.selectQuality("auto", high, NativeVideoNetwork(measuredMbps = Double.POSITIVE_INFINITY)), "360", "nonfinite bandwidth")
    equal(policy.selectQuality("auto", high, NativeVideoNetwork(measuredMbps = 12.0, isMetered = true)), "360", "metered does not infer fast")
    equal(policy.selectQuality("auto", high, NativeVideoNetwork(measuredMbps = 12.0, saveData = true)), "240", "system saver wins")
    equal(policy.selectQuality("auto", high, NativeVideoNetwork(measuredMbps = 12.0), 1), "360", "first stall")
    equal(policy.selectQuality("auto", high, NativeVideoNetwork(measuredMbps = 12.0), 2), "240", "repeated stall")
    equal(policy.selectQuality("auto", high, NativeVideoNetwork(measuredMbps = 12.0), -1), "720", "negative observation is no stall")
    equal(policy.selectQuality("720", high, NativeVideoNetwork(saveData = true), 3), "720", "manual choice remains explicit")
    equal(policy.selectQuality("original", high, NativeVideoNetwork(saveData = true), 3), "original", "original remains explicit")
    val observed = NativeVideoMetadata(362, 640, 115L)
    equal(policy.availableQualities(observed), listOf(240, 360), "observed metadata eligibility")
    equal(policy.selectQuality("auto", observed), "360", "observed source web default")
    equal(policy.selectQuality("720", observed), "original", "requested720 cannot upscale observed source")
    equal(policy.selectQuality("auto", high.copy(durationMs = 90_000)), "original", "long video complete original")

    // Emit input+result vectors for an independent check against the existing web functions.
    // All values are fixed public synthetic fixtures; this check does not access Android or a server.
    val vectors = listOf(null, low, medium, high, observed, high.copy(durationMs = 60_000),
        high.copy(durationMs = 60_001), high.copy(durationMs = 0),
        NativeVideoMetadata(480, 4000, 60_000), NativeVideoMetadata(480, 4001, 60_000),
        NativeVideoMetadata(1920, 820, 30_000))
    for ((index, media) in vectors.withIndex()) {
        for (request in listOf("240", "360", "480", "720", "1080", "original", "data-saver")) {
            val available = policy.availableQualities(media).joinToString(",")
            val dimensions = policy.variantDimensions(media, request.toIntOrNull() ?: 0)
            val dimensionJson = dimensions?.let { "[${it.width},${it.height}]" } ?: "null"
            val metadataJson = media?.let { "{\"width\":${it.width},\"height\":${it.height},\"duration_ms\":${it.durationMs}}" } ?: "null"
            println("WEB_PARITY {\"case\":$index,\"media\":$metadataJson,\"request\":\"$request\",\"available\":[$available],\"dimensions\":$dimensionJson,\"resolved\":\"${policy.resolveQuality(request, media)}\"}")
        }
    }
    println("PASS: $checks native quality choices, metadata boundaries, bandwidth observations and explicit preference checks.")
}
