package com.sautilink.nativeapp.ui.components

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp

/** Animate the artwork, leaving its accessible touch target and surrounding layout fixed. */
@Composable
internal fun Modifier.sautiActionFeedback(interaction: MutableInteractionSource): Modifier {
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) .9f else 1f,
        animationSpec = tween(110), label = "Action press")
    return graphicsLayer { scaleX = scale; scaleY = scale }
}

@Composable
internal fun SautiActionIconButton(icon: ImageVector, label: String, tint: Color,
    enabled: Boolean = true, onClick: () -> Unit) {
    val interaction = remember { MutableInteractionSource() }
    val animatedTint by animateColorAsState(tint, tween(150), label = "Action color")
    IconButton(onClick = onClick, enabled = enabled, interactionSource = interaction,
        modifier = Modifier.size(48.dp)) {
        Icon(icon, label, Modifier.size(24.dp).sautiActionFeedback(interaction), tint = animatedTint)
    }
}
