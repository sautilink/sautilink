package com.sautilink.nativeapp.feature.inbox

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.unit.dp

/** Pick a neutral theme surface that stays distinct from the actual selected wallpaper. */
internal fun incomingMessageBubbleColor(wallpaper: Color, scheme: ColorScheme): Color {
    fun contrast(color: Color): Float {
        val first = color.luminance()
        val second = wallpaper.luminance()
        return (maxOf(first, second) + .05f) / (minOf(first, second) + .05f)
    }
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
    content: @Composable () -> Unit
) {
    Surface(
        shape = if (own) RoundedCornerShape(20.dp, 20.dp, 6.dp, 20.dp)
            else RoundedCornerShape(20.dp, 20.dp, 20.dp, 6.dp),
        color = if (own) outgoingBubble(outgoingChoice)
            else incomingMessageBubbleColor(wallpaper, MaterialTheme.colorScheme),
        border = if (own) null else BorderStroke(.7.dp, MaterialTheme.colorScheme.outline),
        tonalElevation = 0.dp,
        shadowElevation = 0.dp,
        modifier = modifier,
        content = content
    )
}
