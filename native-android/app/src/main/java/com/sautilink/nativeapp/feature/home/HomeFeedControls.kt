package com.sautilink.nativeapp.feature.home

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.unit.IntOffset
import kotlin.math.roundToInt
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ArrowUpward
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.PullToRefreshDefaults
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import com.sautilink.nativeapp.ui.components.SautiIcon
import com.sautilink.nativeapp.ui.theme.SautiColors
import com.sautilink.nativeapp.ui.theme.SautiShape
import com.sautilink.nativeapp.ui.theme.SautiHeaderFont
import com.sautilink.nativeapp.ui.theme.sautiChromeInk

internal val homeFeedChoices = listOf("following" to "Following", "for_you" to "For You", "trending" to "Trending")

/** Kept outside the scrolling feed, beneath its app bar. */
@Composable
internal fun HomeFeedTabs(mode: String, onSelect: (String) -> Unit, modifier: Modifier = Modifier) {
    val dark = MaterialTheme.colorScheme.surface.luminance() < .2f
    val ink = sautiChromeInk()
    val shape = RoundedCornerShape(16.dp)
    val selectedShape = RoundedCornerShape(12.dp)
    val density = LocalDensity.current
    val labelLines = if (density.fontScale > 1.4f) 2 else 1
    val labelStyle = MaterialTheme.typography.labelLarge.copy(fontFamily = SautiHeaderFont)
    // The app theme intentionally leaves lineHeight unspecified. Density only
    // converts sp, so use the existing 14sp label's normal 20sp line fallback.
    val lineHeight = when {
        labelStyle.lineHeight.isSp -> labelStyle.lineHeight
        labelStyle.lineHeight.isEm && labelStyle.fontSize.isSp ->
            (labelStyle.lineHeight.value * labelStyle.fontSize.value).sp
        else -> 20.sp
    }
    val slotHeight = with(density) { lineHeight.toDp() * labelLines + 12.dp }
        .coerceAtLeast(48.dp)
    val selectedIndex = homeFeedChoices.indexOfFirst { it.first == mode }
    val position by animateFloatAsState(selectedIndex.coerceAtLeast(0).toFloat(),
        tween(220, easing = FastOutSlowInEasing), label = "Home feed tab position")
    val glass = if (dark) listOf(Color(0xFF39414E).copy(alpha = .82f), Color(0xFF171D27).copy(alpha = .72f))
        else listOf(Color.White.copy(alpha = .92f), Color(0xFFE8EDF5).copy(alpha = .78f))
    BoxWithConstraints(modifier.fillMaxWidth().height(slotHeight).testTag("home-feed-tabs")) {
        val segment = (maxWidth - 6.dp) / homeFeedChoices.size
        // 44dp visible glass with 48dp touch targets; no live backdrop blur on scrolling videos.
        Box(Modifier.fillMaxWidth().height(slotHeight - 4.dp).align(Alignment.Center)
            .clip(shape).background(Brush.verticalGradient(glass))
            .border(.75.dp, if (dark) Color.White.copy(alpha = .18f) else Color.White.copy(alpha = .85f), shape)
            .testTag("home-feed-glass"))
        if (selectedIndex >= 0) Box(Modifier.align(Alignment.CenterStart)
            .offset { IntOffset(with(density) { (3.dp.toPx() + segment.toPx() * position).roundToInt() }, 0) }
            .width(segment).height(slotHeight - 12.dp)
            .clip(selectedShape).background(if (dark) Color(0xFF4A5361).copy(alpha = .78f) else Color.White.copy(alpha = .94f)))
        Row(Modifier.fillMaxSize().padding(horizontal = 3.dp).selectableGroup(), verticalAlignment = Alignment.CenterVertically) {
            homeFeedChoices.forEach { (key, title) ->
                val active = key == mode
                val interaction = remember { MutableInteractionSource() }
                Box(Modifier.weight(1f).fillMaxHeight()
                    .selectable(selected = active, role = Role.Tab, interactionSource = interaction,
                        indication = null, onClick = { onSelect(key) }).padding(horizontal = 4.dp),
                    contentAlignment = Alignment.Center) {
                    Text(title, modifier = Modifier.wrapContentWidth(),
                        style = labelStyle.copy(background = Color.Transparent),
                        fontWeight = if (active) FontWeight.SemiBold else FontWeight.Medium,
                        textAlign = TextAlign.Center, maxLines = labelLines, color = ink)
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
