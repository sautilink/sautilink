package com.sautilink.nativeapp.feature.home

import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.runtime.*
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest

private val ReadyFeed: State<Boolean> = object : State<Boolean> { override val value = true }
internal val LocalFeedAutoplayReady = staticCompositionLocalOf { ReadyFeed }

/** Keep metadata/posters warm during a fling, without starting a decoder for
 * each row the reader merely passes. Existing visible playback is unaffected. */
@Composable
internal fun rememberFeedAutoplayReady(list: LazyListState): State<Boolean> {
    val ready = remember(list) { mutableStateOf(false) }
    FeedScrollReadinessWorker(list, ready)
    return ready
}

@Composable
private fun FeedScrollReadinessWorker(list: LazyListState, ready: MutableState<Boolean>) {
    LaunchedEffect(list) {
        snapshotFlow { list.isScrollInProgress }.collectLatest { scrolling ->
            ready.value = false
            if (!scrolling) {
                delay(120L)
                ready.value = true
            }
        }
    }
}
