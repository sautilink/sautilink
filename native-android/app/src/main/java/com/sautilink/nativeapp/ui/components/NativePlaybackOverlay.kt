package com.sautilink.nativeapp.ui.components

import androidx.compose.runtime.staticCompositionLocalOf

/** Pause background players while a composer/editor overlays their mounted page. */
val LocalNativePlaybackBlocked = staticCompositionLocalOf { false }
