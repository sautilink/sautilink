package com.sautilink.nativeapp.ui.components

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.airbnb.lottie.compose.LottieAnimation
import com.airbnb.lottie.compose.LottieCompositionSpec
import com.airbnb.lottie.compose.LottieConstants
import com.airbnb.lottie.compose.rememberLottieComposition
import com.sautilink.nativeapp.R
import kotlinx.coroutines.delay

/** Caller supplies active playback intent plus buffering; no player or input behavior lives here. */
@Composable
internal fun VideoBufferingOverlay(visible: Boolean, modifier: Modifier = Modifier) {
    if (!visible) return

    var graceElapsed by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { delay(150); graceElapsed = true }
    // RawRes detects the dotLottie ZIP; the process cache shares this one local composition.
    val composition by rememberLottieComposition(LottieCompositionSpec.RawRes(R.raw.sauti_buffering))
    if (!graceElapsed || composition == null) return

    Box(modifier.size(48.dp).clipToBounds().semantics {
        contentDescription = "Video buffering"
        progressBarRangeInfo = ProgressBarRangeInfo.Indeterminate
    }, contentAlignment = Alignment.Center) {
        // Original 500px artboard has large transparent margins. Keep its artwork intact,
        // center it at 160dp and crop only those margins inside a 48dp transparent viewport.
        LottieAnimation(composition = composition, iterations = LottieConstants.IterateForever,
            modifier = Modifier.requiredSize(160.dp))
    }
}
