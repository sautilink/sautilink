package com.sautilink.nativeapp.feature.inbox

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp

/** Pick a neutral theme surface that stays distinct from the actual selected wallpaper. */
internal fun incomingMessageBubbleColor(wallpaper: Color, scheme: ColorScheme): Color {
    fun contrast(color: Color): Float {
        val first = color.luminance()
        val second = wallpaper.luminance()
        return (maxOf(first, second) + .05f) / (minOf(first, second) + .05f)
    }
    val modern = if (scheme.surface.luminance() < .5f) Color(0xFF1F2C34) else Color.White
    if (contrast(modern) >= 1.1f) return modern
    return if (contrast(scheme.surface) >= contrast(scheme.surfaceContainerHighest))
        scheme.surface else scheme.surfaceContainerHighest
}

/** Shared actual message surface; content, gesture modifiers and outgoing appearance are preserved. */
@Composable
internal fun NativeDmMessageBubbleSurface(
    own: Boolean,
    outgoingChoice: String,
    wallpaper: Color,
    modifier: Modifier = Modifier,
    tail: Boolean = true,
    content: @Composable () -> Unit
) {
    Surface(
        shape = if (tail) NativeDmBubbleShape(own) else RoundedCornerShape(12.dp),
        color = if (own) outgoingBubble(outgoingChoice)
            else incomingMessageBubbleColor(wallpaper, MaterialTheme.colorScheme),
        tonalElevation = 0.dp,
        shadowElevation = 0.dp,
        modifier = modifier,
        content = content
    )
}

/** The small shoulder belongs to the first bubble in a sender's group. */
private class NativeDmBubbleShape(private val own: Boolean) : Shape {
    override fun createOutline(size: Size, layoutDirection: LayoutDirection, density: Density): Outline {
        val w = size.width; val h = size.height
        val r = with(density) { 12.dp.toPx() }.coerceAtMost(h / 2)
        val t = with(density) { 6.dp.toPx() }.coerceAtMost(w / 4)
        fun x(value: Float) = if (own) value else w - value
        return Outline.Generic(Path().apply {
            moveTo(x(r),0f); lineTo(x(w),0f)
            quadraticTo(x(w - 1), t, x(w - t), t * 1.7f)
            lineTo(x(w - t),h-r); quadraticTo(x(w-t),h,x(w-t-r),h)
            lineTo(x(r),h); quadraticTo(x(0f),h,x(0f),h-r)
            lineTo(x(0f),r); quadraticTo(x(0f),0f,x(r),0f); close()
        })
    }
}

internal fun dmBubbleInk(fill: Color): Color = if (fill.luminance() > .45f) Color(0xFF172126) else Color.White
