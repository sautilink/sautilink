package com.sautilink.nativeapp.ui.components

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import com.sautilink.nativeapp.R

/** Same Huge artwork and native motion as all other SautiLink destinations. */
@Composable
internal fun SautiNavigationIcon(index: Int, label: String, selected: Boolean, tint: Color,
    modifier: Modifier = Modifier) {
    val artwork = when (index) {
        2 -> R.drawable.ic_pulso_brand_imessage
        4 -> R.drawable.ic_pulso_square_play
        else -> null
    }
    if (artwork != null) {
        SautiIcon(painterResource(artwork), label, modifier, tint, selected)
        return
    }
    val name = when (index) {
        0 -> "home-0-1"
        1 -> "search"
        3 -> "notification"
        else -> "user"
    }
    SautiGlyph(name, label, modifier, tint, selected)
}
