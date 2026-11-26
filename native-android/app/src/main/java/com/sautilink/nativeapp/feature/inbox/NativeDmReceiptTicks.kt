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
import androidx.compose.ui.Alignment
import kotlin.math.abs
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Done
import androidx.compose.material.icons.rounded.DoneAll
import com.sautilink.nativeapp.ui.components.SautiIcon as Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.Canvas
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
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
internal enum class NativeDmReceiptState { Sent, Delivered, Seen }
internal fun dmReceiptState(messageSentAt: String, peer: NativePeerReceipts): NativeDmReceiptState {
    val sent = asTimestamp(messageSentAt)
    val seen = sent != null && asTimestamp(peer.readAt)?.let { !it.isBefore(sent) } == true
    val delivered = seen || (sent != null &&
        asTimestamp(peer.deliveredAt)?.let { !it.isBefore(sent) } == true)
    return when { seen -> NativeDmReceiptState.Seen; delivered -> NativeDmReceiptState.Delivered; else -> NativeDmReceiptState.Sent }
}

@Composable
internal fun NativeDmReceiptTicks(messageSentAt: String, peer: NativePeerReceipts, color: Color) {
    val state = dmReceiptState(messageSentAt, peer)
    val ink = if (state == NativeDmReceiptState.Seen)
        if (color.luminance() > .5f) Color(0xFFA8EAFF) else Color(0xFF008DDB) else color
    Canvas(Modifier.size(19.dp,13.dp).semantics { contentDescription = state.name }) {
        fun point(x: Float,y: Float) = Offset(x / 22f * size.width, y / 16f * size.height)
        val stroke = 1.65.dp.toPx()
        if (state == NativeDmReceiptState.Sent) {
            drawLine(ink,point(4f,8f),point(8f,12f),stroke,StrokeCap.Round)
            drawLine(ink,point(8f,12f),point(17f,2f),stroke,StrokeCap.Round)
        } else {
            drawLine(ink,point(1f,8f),point(5f,12f),stroke,StrokeCap.Round)
            drawLine(ink,point(5f,12f),point(14f,2f),stroke,StrokeCap.Round)
            drawLine(ink,point(10f,10f),point(12f,12f),stroke,StrokeCap.Round)
            drawLine(ink,point(12f,12f),point(21f,2f),stroke,StrokeCap.Round)
        }
    }
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
