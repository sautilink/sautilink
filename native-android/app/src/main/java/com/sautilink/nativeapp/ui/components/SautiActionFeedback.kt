package com.sautilink.nativeapp.ui.components

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.spring
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.Alignment
import androidx.compose.material3.Icon
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import com.sautilink.nativeapp.ui.theme.SautiColors
import com.sautilink.nativeapp.ui.theme.sautiChromeInk

@Composable
internal fun SautiPostHeart(
    active: Boolean, label: String?, modifier: Modifier = Modifier, tint: Color = sautiChromeInk()
) {
    val vector = requireNotNull(SautiHugeVectors.get(if (active) "heart-filled" else "heart"))
    val pulse = remember { Animatable(1f) }
    var previous by remember { mutableStateOf(active) }
    LaunchedEffect(active) {
        if (active && !previous) { pulse.animateTo(1.16f, tween(95)); pulse.animateTo(1f, spring(dampingRatio = .7f)) }
        previous = active
    }
    val artwork = modifier.graphicsLayer { scaleX = pulse.value; scaleY = pulse.value }
    if (active) {
        Icon(vector, label, tint = Color.White, modifier = artwork
            .graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }
            .drawWithCache {
                val fill = Brush.linearGradient(listOf(SautiColors.LogoOrange, SautiColors.LogoPink))
                onDrawWithContent {
                    drawContent()
                    drawRect(fill, blendMode = BlendMode.SrcIn)
                }
            })
    } else {
        Icon(vector, label, artwork, tint = tint)
    }
}

/** Animate the artwork, leaving its accessible touch target and surrounding layout fixed. */
@Composable
internal fun Modifier.sautiActionFeedback(interaction: MutableInteractionSource): Modifier {
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) .9f else 1f,
        animationSpec = tween(110), label = "Action press")
    return graphicsLayer { scaleX = scale; scaleY = scale }
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
