package com.sautilink.nativeapp.ui.components

import androidx.compose.foundation.Image
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.res.painterResource
import com.sautilink.nativeapp.R

@Composable
internal fun SautiWordmark(modifier: Modifier = Modifier) {
    val artwork = if (MaterialTheme.colorScheme.surface.luminance() < .5f) {
        R.drawable.sautilink_wordmark_white
    } else {
        R.drawable.sautilink_wordmark_black
    }
    Image(painterResource(artwork), contentDescription = "SautiLink", modifier = modifier)
}
