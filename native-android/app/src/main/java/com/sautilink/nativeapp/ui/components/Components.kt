package com.sautilink.nativeapp.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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

/** A native Android bottom bar using iOS-inspired geometry, not an iOS control clone. */
@Composable
fun SautiBottomBar(selected: Int, onSelect: (Int) -> Unit) {
    Surface(
        shadowElevation = 12.dp,
        tonalElevation = 2.dp,
        color = MaterialTheme.colorScheme.surface,
        shape = SautiShape.Pill,
        modifier = Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 14.dp, vertical = 7.dp)
            .border(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = .26f), SautiShape.Pill)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 7.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            nativeTabs.forEachIndexed { index, tab ->
                val active = index == selected
                val create = index == 2
                val fill by animateColorAsState(
                    targetValue = when {
                        create -> SautiColors.Blue
                        active -> MaterialTheme.colorScheme.primary.copy(alpha = .12f)
                        else -> Color.Transparent
                    },
                    label = "navigation background"
                )
                val tint by animateColorAsState(
                    targetValue = if (create) Color.White else if (active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                    label = "navigation icon"
                )
                val iconSize by animateDpAsState(
                    targetValue = if (active) 25.dp else 23.dp,
                    animationSpec = spring(), label = "navigation icon size"
                )
                Column(
                    modifier = Modifier.weight(1f).clip(SautiShape.Button).clickable { onSelect(index) }
                        .padding(vertical = 2.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center
                ) {
                    Box(
                        modifier = Modifier.size(if (create) 42.dp else 34.dp)
                            .clip(if (create) CircleShape else SautiShape.Button)
                            .background(fill),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(tab.icon, contentDescription = tab.title, tint = tint,
                            modifier = Modifier.size(if (create) 27.dp else iconSize))
                    }
                    if (!create) Text(
                        tab.title, fontSize = 10.sp,
                        color = tint, maxLines = 1,
                        fontWeight = if (active) FontWeight.Bold else FontWeight.Normal
                    )
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
