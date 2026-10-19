package com.sautilink.nativeapp.ui.components

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import com.sautilink.nativeapp.ui.components.SautiIcon as Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.Alignment

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
    enabled: Boolean = true, iconSize: Dp = 24.dp, onClick: () -> Unit) {
    val interaction = remember { MutableInteractionSource() }
    val animatedTint by animateColorAsState(tint, tween(150), label = "Action color")
    IconButton(onClick = onClick, enabled = enabled, interactionSource = interaction,
        modifier = Modifier.size(48.dp)) {
        Icon(icon, label, Modifier.size(iconSize).sautiActionFeedback(interaction), tint = animatedTint)
    }
}

/** Compact leading actions keep their touch sizes; only overflow scrolls, while Save stays visible. */
@Composable
internal fun SautiPostActionRow(modifier: Modifier = Modifier,
    actions: @Composable RowScope.() -> Unit, trailing: @Composable () -> Unit) {
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Row(Modifier.weight(1f).horizontalScroll(rememberScrollState()),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(0.dp), content = actions)
        trailing()
    }
}
