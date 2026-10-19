package com.sautilink.nativeapp.feature.home

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

internal val homeFeedChoices = listOf("following" to "Following", "for_you" to "For You", "trending" to "Trending")

/** Kept outside the scrolling feed, beneath its app bar. */
@Composable
internal fun HomeFeedTabs(mode: String, onSelect: (String) -> Unit, modifier: Modifier = Modifier) {
    Surface(modifier.fillMaxWidth(), shape = RoundedCornerShape(18.dp),
        color = MaterialTheme.colorScheme.surfaceContainer,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = .55f))) {
        Row(Modifier.padding(4.dp).selectableGroup(), verticalAlignment = Alignment.CenterVertically) {
            homeFeedChoices.forEach { (key, title) ->
                val active = key == mode
                val background by animateColorAsState(if (active) MaterialTheme.colorScheme.surface
                    else MaterialTheme.colorScheme.surfaceContainer, label = "Feed selection")
                Box(Modifier.weight(1f).heightIn(min = 46.dp).clip(RoundedCornerShape(14.dp))
                    .background(background).selectable(selected = active, role = Role.Tab,
                        onClick = { onSelect(key) }).padding(horizontal = 4.dp, vertical = 10.dp),
                    contentAlignment = Alignment.Center) {
                    Text(title, style = MaterialTheme.typography.labelLarge,
                        fontWeight = if (active) FontWeight.SemiBold else FontWeight.Medium,
                        textAlign = TextAlign.Center, maxLines = 2,
                        color = if (active) MaterialTheme.colorScheme.onSurface
                            else MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}
