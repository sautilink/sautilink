package com.sautilink.nativeapp.feature.notifications

internal data class NativePushCopy(val title: String, val body: String)

/** Shared display copy for notification and data-only FCM deliveries. */
internal fun nativePushCopy(data: Map<String, String>, title: String?, body: String?): NativePushCopy {
    val displayedTitle = (title?.takeIf { it.isNotBlank() } ?: data["title"])
        .orEmpty().trim().take(90).ifBlank { "SautiLink" }
    // A data payload must not expose a private message on the lock screen.
    val displayedBody = if (data["type"] == "message") "You have a new message."
        else (body?.takeIf { it.isNotBlank() } ?: data["body"])
            .orEmpty().trim().take(180).ifBlank { "New activity on SautiLink." }
    return NativePushCopy(displayedTitle, displayedBody)
}
