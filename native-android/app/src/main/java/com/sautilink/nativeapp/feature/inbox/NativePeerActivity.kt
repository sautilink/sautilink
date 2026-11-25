package com.sautilink.nativeapp.feature.inbox

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

internal data class NativePeerActivity(val visibility: String, val lastSeenAt: String? = null) {
    fun label(online: Boolean, typing: Boolean, zone: ZoneId = ZoneId.systemDefault(), now: Instant = Instant.now()): String = when {
        visibility == "hidden" -> "Privacy Mode"
        visibility != "visible" -> ""
        typing -> "typing"
        online -> "Online"
        else -> lastSeenAt?.let { value -> runCatching {
            val seen = Instant.parse(value)
            val format = if (seen.atZone(zone).year == now.atZone(zone).year) "d MMM, HH:mm" else "d MMM yyyy, HH:mm"
            "Last seen " + DateTimeFormatter.ofPattern(format, Locale.ENGLISH).withZone(zone).format(seen)
        }.getOrNull() }.orEmpty()
    }
}
