package com.sautilink.nativeapp.ui.components

import com.sautilink.nativeapp.ui.theme.sautiChromeInk
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import com.sautilink.nativeapp.ui.components.SautiIcon as Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.platform.testTag
import com.sautilink.nativeapp.ui.theme.SautiColors

@Composable
fun SautiAvatar(initials: String, modifier: Modifier = Modifier, accent: Color = SautiColors.Blue) {
    Box(
        modifier = modifier.clip(CircleShape)
            .background(brush = Brush.linearGradient(listOf(accent.copy(alpha = .72f), accent)))
            .border(1.dp, Color.White.copy(alpha = .2f), CircleShape),
        contentAlignment = Alignment.Center
    ) {
        Text(initials, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 16.sp)
    }
}

data class NativeTab(val title: String)
val nativeTabs = listOf(
    NativeTab("Home"),
    NativeTab("Explore"),
    NativeTab("Messages"),
    NativeTab("Notifications"),
    NativeTab("Short Videos"),
    NativeTab("Profile")
)

internal val LocalFloatingNavigationPadding = staticCompositionLocalOf { 0.dp }

/** Web-inspired six-icon bottom navigation. All destinations have >=48dp touch targets. */
@Composable
fun SautiBottomBar(selected: Int, unreadNotifications: Int = 0, onSelect: (Int) -> Unit) {
    val colors = MaterialTheme.colorScheme
    val dark = colors.surface.luminance() < .2f
    val shape = RoundedCornerShape(27.dp)
    val ink = sautiChromeInk()
    val navigationSurface = if (dark) Color.Black else Color.White
    val rim = if (dark) Color.White.copy(alpha = .16f) else Color.Black.copy(alpha = .07f)
    BoxWithConstraints(
        Modifier.fillMaxWidth().navigationBarsPadding().padding(bottom = 9.dp),
        contentAlignment = Alignment.Center
    ) {
        // Keep six full-width touch targets on compact phones.
        val side = ((maxWidth - 288.dp) / 2f).coerceIn(0.dp, 14.dp)
        val barWidth = (maxWidth - side * 2).coerceAtMost(490.dp)
        val itemWidth = barWidth / nativeTabs.size
        val position by animateFloatAsState(selected.toFloat(),
            spring(dampingRatio = Spring.DampingRatioNoBouncy, stiffness = Spring.StiffnessMediumLow),
            label = "Selected navigation position")
        Box(Modifier.width(barWidth).height(54.dp)
            .shadow(9.dp, shape, ambientColor = colors.onSurface.copy(alpha = .28f),
                spotColor = colors.onSurface.copy(alpha = .34f))
            .clip(shape).background(navigationSurface).border(1.dp, rim, shape)
            .then(Modifier.testTag("sauti-navigation-surface"))) {
            val indicatorWidth = 18.dp
            Box(Modifier.align(Alignment.BottomStart)
                .offset(x = itemWidth * position + (itemWidth - indicatorWidth) / 2, y = (-7).dp)
                .size(width = indicatorWidth, height = 3.dp)
                .background(colors.primary, CircleShape))
            Row(
                Modifier.fillMaxSize().selectableGroup(),
                verticalAlignment = Alignment.CenterVertically
            ) {
                nativeTabs.forEachIndexed { index, tab ->
                    val active = index == selected
                    val interaction = remember { MutableInteractionSource() }
                    val pressed by interaction.collectIsPressedAsState()
                    val tint by animateColorAsState(
                        targetValue = ink.copy(alpha = if (pressed) .72f else 1f),
                        animationSpec = tween(if (pressed) 80 else 140),
                        label = "Navigation color"
                    )
                    Box(
                        Modifier.weight(1f).fillMaxHeight()
                            .selectable(selected = active, role = Role.Tab, interactionSource = interaction,
                                indication = null, onClick = { onSelect(index) }),
                        contentAlignment = Alignment.Center
                    ) {
                        Box(contentAlignment = Alignment.Center,
                            modifier = Modifier.offset(y = (-2).dp).size(30.dp)) {
                            SautiNavigationIcon(index = index,
                                label = if (index == 3 && unreadNotifications > 0)
                                    "Notifications, $unreadNotifications unread" else tab.title,
                                selected = active, tint = tint, modifier = Modifier.size(26.dp))
                            if (index == 3 && unreadNotifications > 0) {
                                Badge(
                                    modifier = Modifier.align(Alignment.TopEnd)
                                        .offset(x = 6.dp, y = (-2).dp),
                                    containerColor = colors.primaryContainer,
                                    contentColor = colors.onPrimaryContainer
                                ) {
                                    Text(if (unreadNotifications >= 50) "50+" else unreadNotifications.toString(),
                                        style = MaterialTheme.typography.labelSmall)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun SautiSectionLabel(title: String, subtitle: String? = null) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(title, style = MaterialTheme.typography.titleLarge)
        if (subtitle != null) Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
