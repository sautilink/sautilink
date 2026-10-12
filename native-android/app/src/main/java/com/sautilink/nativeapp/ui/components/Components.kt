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
import androidx.compose.material.icons.rounded.PersonOutline
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
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
    NativeTab("Create", Icons.Rounded.Add),
    NativeTab("Messages", Icons.Rounded.ChatBubbleOutline),
    NativeTab("Profile", Icons.Rounded.PersonOutline)
)

/** Floating, accessible iOS-inspired navigation; remains native Jetpack Compose. */
@Composable
fun SautiBottomBar(selected: Int, onSelect: (Int) -> Unit) {
    Surface(
        shadowElevation = 8.dp,
        tonalElevation = 0.dp,
        color = MaterialTheme.colorScheme.surface.copy(alpha = .96f),
        shape = SautiShape.Pill,
        modifier = Modifier.fillMaxWidth().navigationBarsPadding()
            .padding(horizontal = 16.dp, vertical = 8.dp)
            .border(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = .22f), SautiShape.Pill)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.SpaceEvenly,
            verticalAlignment = Alignment.CenterVertically
        ) {
            nativeTabs.forEachIndexed { index, tab ->
                val create = index == 2
                val active = index == selected && !create
                val fill by animateColorAsState(
                    targetValue = when {
                        create -> MaterialTheme.colorScheme.primary
                        active -> MaterialTheme.colorScheme.primary.copy(alpha = .12f)
                        else -> Color.Transparent
                    },
                    label = "Bottom navigation background"
                )
                val tint by animateColorAsState(
                    targetValue = when {
                        create -> MaterialTheme.colorScheme.onPrimary
                        active -> MaterialTheme.colorScheme.primary
                        else -> MaterialTheme.colorScheme.onSurfaceVariant
                    },
                    label = "Bottom navigation tint"
                )
                Column(
                    modifier = Modifier.weight(1f).heightIn(min = 54.dp)
                        .clip(SautiShape.Button)
                        .then(if (create) Modifier.clickable { onSelect(index) }
                            else Modifier.selectable(selected = active, role = Role.Tab,
                                onClick = { onSelect(index) }))
                        .padding(vertical = 3.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center
                ) {
                    Box(
                        modifier = Modifier.size(if (create) 42.dp else 33.dp)
                            .clip(if (create) CircleShape else SautiShape.Pill)
                            .background(fill),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(tab.icon, contentDescription = tab.title, tint = tint,
                            modifier = Modifier.size(if (create) 24.dp else 22.dp))
                    }
                    if (!create) {
                        Text(
                            tab.title,
                            fontSize = 11.sp,
                            color = tint,
                            maxLines = 1,
                            fontWeight = if (active) FontWeight.SemiBold else FontWeight.Medium
                        )
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
