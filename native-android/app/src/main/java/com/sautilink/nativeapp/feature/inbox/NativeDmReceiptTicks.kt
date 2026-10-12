package com.sautilink.nativeapp.feature.inbox

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.animation.core.*
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberInfiniteTransition
import androidx.compose.ui.Alignment
import kotlin.math.abs
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

/** Compact iOS / Telegram-like typing bubble that animates while the peer is composing. */
@Composable
internal fun NativeDmTypingBubble() {
    val transition = rememberInfiniteTransition(label = "typingDots")
    val progress by transition.animateFloat(
        initialValue = 0f, targetValue = 3f,
        animationSpec = infiniteRepeatable(animation = tween(950, easing = LinearEasing)),
        label = "dots"
    )
    Surface(shape = RoundedCornerShape(18.dp, 18.dp, 18.dp, 5.dp),
        color = MaterialTheme.colorScheme.surface,
        shadowElevation = 1.dp,
        modifier = Modifier.padding(start = 8.dp, top = 6.dp)) {
        Row(Modifier.padding(horizontal = 13.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(5.dp)) {
            repeat(3) { i ->
                Box(Modifier.size(if (abs(progress - i) < .6f) 8.dp else 6.dp)
                    .background(
                        if (abs(progress - i) < .6f) MaterialTheme.colorScheme.primary
                        else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .55f),
                        CircleShape))
            }
            Spacer(Modifier.width(3.dp))
            Text("typing", style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
