package com.sautilink.nativeapp.feature.home

import java.net.URI
import java.net.URLDecoder

/** Only the published image and Room-cover endpoints implement these server widths.
 * Review attachments, profile photos, DMs and video posters do not invent a thumbnail API.
 */
internal fun authorizedImagePreviewRoute(route: String): String? {
    // java.net.URI normalizes ///api/... into a single-slash raw path. Reject
    // noncanonical input before parsing rather than inventing a supported route.
    if (!route.startsWith("/api/")) return null
    val parsed = runCatching { URI(route) }.getOrNull() ?: return null
    if (parsed.scheme != null || parsed.rawAuthority != null || parsed.rawFragment != null) return null
    val uuid = "[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}"
    val path = parsed.rawPath ?: return null
    if (!Regex("^/api/sauti-media/$uuid$").matches(path) &&
        !Regex("^/api/room-media/[a-z0-9][a-z0-9-]{2,49}/cover$").matches(path)) return null
    val parts = parsed.rawQuery.orEmpty().split('&').filter(String::isNotBlank)
    fun key(part: String) = runCatching { URLDecoder.decode(part.substringBefore('='), "UTF-8") }.getOrNull()
    if (parts.any { key(it) in setOf("poster", "quality") }) return null
    val widths = parts.filter { key(it) == "w" }
    if (widths.size > 1) return null
    if (widths.singleOrNull()?.substringAfter('=')?.toIntOrNull()?.let { it <= 480 } == true) return null
    return path + "?" + (parts.filterNot { key(it) == "w" } + "w=480").joinToString("&")
}

/** Preview pixels are reusable for at most 30 seconds and never leave RAM. A late request from an old
 * account/session cannot insert into, clear or read the replacement session's cache.
 */
internal class SessionImagePreviewCache<T>(
    private val maxBytes: Int,
    private val sizeOf: (T) -> Int,
    private val lifetimeMs: Long = 30_000L
) {
    private data class Entry<T>(val value: T, val bytes: Int, val createdAt: Long)
    private val entries = LinkedHashMap<String, Entry<T>>(16, .75f, true)
    private var scope: String? = null
    private var generation = 0L
    private var bytes = 0

    @Synchronized fun activate(nextScope: String?): Long {
        if (nextScope != scope) {
            entries.clear()
            bytes = 0
            scope = nextScope
            generation++
        }
        return generation
    }

    @Synchronized fun get(expectedScope: String, stamp: Long, key: String, now: Long): T? {
        if (scope != expectedScope || generation != stamp) return null
        val entry = entries[key] ?: return null
        if (now < entry.createdAt || now - entry.createdAt > lifetimeMs) {
            entries.remove(key)
            bytes -= entry.bytes
            return null
        }
        return entry.value
    }

    @Synchronized fun put(expectedScope: String, stamp: Long, key: String, value: T, now: Long): Boolean {
        if (scope != expectedScope || generation != stamp) return false
        val cost = sizeOf(value)
        if (cost <= 0 || cost > maxBytes) return false
        entries.remove(key)?.let { bytes -= it.bytes }
        entries[key] = Entry(value, cost, now)
        bytes += cost
        val iterator = entries.entries.iterator()
        while (bytes > maxBytes && iterator.hasNext()) {
            bytes -= iterator.next().value.bytes
            iterator.remove()
        }
        return true
    }
}
