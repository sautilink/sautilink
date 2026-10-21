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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ArrowUpward
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.PullToRefreshDefaults
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import com.sautilink.nativeapp.ui.components.SautiIcon
import com.sautilink.nativeapp.ui.theme.SautiColors
import com.sautilink.nativeapp.ui.theme.SautiShape

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
                    Text(title, modifier = Modifier.fillMaxWidth(), style = MaterialTheme.typography.labelLarge,
                        fontWeight = if (active) FontWeight.SemiBold else FontWeight.Medium,
                        textAlign = TextAlign.Center, maxLines = 2,
                        color = if (active) MaterialTheme.colorScheme.onSurface
                            else MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

/** Tabs live above this scroll container. A new-post notice overlays the list;
 * arriving pointers never insert rows or move the reader's scroll position.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun FeedRefreshContainer(isRefreshing: Boolean, refreshEnabled: Boolean, newPostsAvailable: Boolean,
    onRefresh: () -> Unit, onNewPosts: () -> Unit, modifier: Modifier = Modifier,
    content: @Composable () -> Unit) {
    val pullState = rememberPullToRefreshState()
    PullToRefreshBox(isRefreshing = isRefreshing, onRefresh = { if (refreshEnabled && !isRefreshing) onRefresh() },
        modifier = modifier, state = pullState,
        indicator = {
            PullToRefreshDefaults.Indicator(state = pullState, isRefreshing = isRefreshing,
                modifier = Modifier.align(Alignment.TopCenter).padding(top = 8.dp),
                containerColor = MaterialTheme.colorScheme.surface,
                color = MaterialTheme.colorScheme.primary)
        }) {
        content()
        if (newPostsAvailable && !isRefreshing) {
            Button(onClick = onNewPosts, enabled = refreshEnabled, shape = SautiShape.Pill,
                modifier = Modifier.align(Alignment.TopCenter).padding(top = 10.dp).heightIn(min = 44.dp),
                colors = ButtonDefaults.buttonColors(containerColor = SautiColors.Blue, contentColor = androidx.compose.ui.graphics.Color.White),
                elevation = ButtonDefaults.buttonElevation(defaultElevation = 5.dp),
                contentPadding = PaddingValues(horizontal = 18.dp, vertical = 8.dp)) {
                SautiIcon(Icons.Rounded.ArrowUpward, null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(7.dp))
                Text("New Posts", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}
