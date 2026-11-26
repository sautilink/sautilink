package com.sautilink.nativeapp.feature.home

import android.os.SystemClock
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class NativeFeedScrollReadinessTest {
    @get:Rule val compose = createComposeRule()
    @Test fun freshAutoplayWaitsForSettledScroll_andAnotherGestureClosesTheGateAgain() {
        lateinit var list: LazyListState
        lateinit var ready: State<Boolean>
        lateinit var scope: CoroutineScope
        compose.setContent {
            list = rememberLazyListState()
            ready = rememberFeedAutoplayReady(list)
            scope = rememberCoroutineScope()
            LazyColumn(Modifier.height(300.dp), state = list) {
                items(30) { Text("Post $it", Modifier.height(100.dp)) }
            }
        }
        compose.waitUntil(5_000) { ready.value }
        repeat(2) {
            val drag = compose.runOnIdle { scope.launch { list.scroll { scrollBy(100f); awaitCancellation() } } }
            compose.waitUntil(5_000) { list.isScrollInProgress && !ready.value }
            val stopped = SystemClock.elapsedRealtime()
            compose.runOnIdle { drag.cancel() }
            compose.waitUntil(5_000) { !list.isScrollInProgress && ready.value }
            assertTrue("Fresh autoplay must wait for the 120ms quiet window", SystemClock.elapsedRealtime()-stopped >= 110L)
        }
    }
}
