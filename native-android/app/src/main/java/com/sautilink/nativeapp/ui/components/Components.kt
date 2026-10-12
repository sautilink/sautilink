package com.sautilink.nativeapp.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.ChatBubbleOutline
import androidx.compose.material.icons.rounded.Home
import androidx.compose.material.icons.rounded.NotificationsNone
import androidx.compose.material.icons.rounded.Theaters
import androidx.compose.material.icons.rounded.PersonOutline
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sautilink.nativeapp.ui.theme.SautiColors
import com.sautilink.nativeapp.ui.theme.SautiShape

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

data class NativeTab(val title: String, val icon: ImageVector)
val nativeTabs = listOf(
    NativeTab("Home", Icons.Rounded.Home),
    NativeTab("Explore", Icons.Rounded.Search),
    NativeTab("Messages", Icons.Rounded.ChatBubbleOutline),
    NativeTab("Notifications", Icons.Rounded.NotificationsNone),
    NativeTab("Short Videos", Icons.Rounded.Theaters),
    NativeTab("Profile", Icons.Rounded.PersonOutline)
)

/** Web-inspired six-icon bottom navigation. All destinations have >=48dp touch targets. */
@Composable
fun SautiBottomBar(selected: Int, onSelect: (Int) -> Unit) {
    Surface(
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = 0.dp,
        shadowElevation = 1.dp,
        modifier = Modifier.fillMaxWidth().navigationBarsPadding()
    ) {
        Column {
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = .45f))
            Row(
                Modifier.fillMaxWidth().height(62.dp).padding(horizontal = 7.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceEvenly
            ) {
                nativeTabs.forEachIndexed { index, tab ->
                    val active = index == selected
                    val tint by animateColorAsState(
                        targetValue = if (active) MaterialTheme.colorScheme.onSurface
                            else MaterialTheme.colorScheme.onSurfaceVariant,
                        animationSpec = androidx.compose.animation.core.tween(180),
                        label = "Navigation color"
                    )
                    val scale by androidx.compose.animation.core.animateFloatAsState(
                        targetValue = if (active) 1.09f else 1f,
                        animationSpec = androidx.compose.animation.core.spring(
                            dampingRatio = .65f,
                            stiffness = androidx.compose.animation.core.Spring.StiffnessMedium),
                        label = "Navigation icon spring"
                    )
                    Column(
                        Modifier.weight(1f).heightIn(min = 52.dp)
                            .clip(SautiShape.Button)
                            .selectable(selected = active, role = Role.Tab,
                                onClick = { onSelect(index) }),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center
                    ) {
                        Icon(tab.icon, contentDescription = tab.title,
                            tint = tint,
                            modifier = Modifier.size(27.dp)
                                .graphicsLayer { scaleX = scale; scaleY = scale })
                        Spacer(Modifier.height(4.dp))
                        Box(Modifier.width(18.dp).height(3.dp)
                            .clip(CircleShape)
                            .background(if (active) SautiColors.Red else Color.Transparent))
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
