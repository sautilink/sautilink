package com.sautilink.nativeapp.feature.inbox

import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Done
import androidx.compose.material.icons.rounded.DoneAll
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import java.time.Instant
import java.time.OffsetDateTime

private fun asTimestamp(raw: String?): Instant? {
    if (raw.isNullOrBlank() || raw == "null") return null
    return runCatching { Instant.parse(raw) }.getOrNull()
        ?: runCatching { OffsetDateTime.parse(raw).toInstant() }.getOrNull()
}

/**
 * Server-confirmed message states only.
 * One tick: persisted ("sent").
 * Two grey ticks: receiver acknowledged device delivery.
 * Two blue ticks: receiver opened/read, if reciprocal read-receipts privacy allows.
 */
@Composable
internal fun NativeDmReceiptTicks(
    messageSentAt: String,
    peer: NativePeerReceipts,
    color: Color
) {
    val sent = asTimestamp(messageSentAt)
    val seen = sent != null && asTimestamp(peer.readAt)?.let { !it.isBefore(sent) } == true
    val delivered = seen || (sent != null &&
        asTimestamp(peer.deliveredAt)?.let { !it.isBefore(sent) } == true)
    Icon(
        imageVector = if (delivered) Icons.Rounded.DoneAll else Icons.Rounded.Done,
        contentDescription = when {
            seen -> "Seen"
            delivered -> "Delivered"
            else -> "Sent"
        },
        tint = if (seen) Color(0xFF53C8FF) else color,
        modifier = Modifier.size(16.dp)
    )
}
