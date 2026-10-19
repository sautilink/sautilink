package com.sautilink.nativeapp.ui.components

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color

/** Same Huge artwork and native motion as all other SautiLink destinations. */
@Composable
internal fun SautiNavigationIcon(index: Int, label: String, selected: Boolean, tint: Color,
    modifier: Modifier = Modifier) {
    val name = when (index) {
        0 -> "home-0-1"
        1 -> "search"
        2 -> "message-0-1"
        3 -> "notification"
        4 -> "video-0-1"
        else -> "user"
    }
    SautiGlyph(name, label, modifier, tint, selected)
}
