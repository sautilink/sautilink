package com.sautilink.nativeapp.ui

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.sautilink.nativeapp.feature.home.measuredVideoVisibleFraction
import com.sautilink.nativeapp.ui.theme.SautiTheme
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Real Compose clipping geometry, with no account, player or network. */
@RunWith(AndroidJUnit4::class)
class NativeFeedVideoVisibilityTest {
    @get:Rule val compose = createComposeRule()

    @Test fun clippedThirdOfMedia_remainsBelowAutoplayThreshold_andFullyOffscreenBecomesZero() {
        var fraction by mutableFloatStateOf(-1f)
        var offscreen by mutableStateOf(false)
        compose.setContent { SautiTheme(darkTheme = false) {
            Box(Modifier.width(300.dp).height(100.dp).clipToBounds()) {
                Box(Modifier.fillMaxWidth().requiredHeight(300.dp)
                    .offset(y = if (offscreen) 400.dp else 0.dp)
                    .onGloballyPositioned { fraction = measuredVideoVisibleFraction(it, Float.MAX_VALUE) })
            }
        } }
        compose.waitUntil(5_000) { fraction >= 0f }
        compose.runOnIdle {
            assertEquals("100dp of a 300dp video is one third visible", 1f / 3f, fraction, .02f)
            assertTrue("A clipped sliver must never autoplay as if the full video were visible", fraction < .58f)
            offscreen = true
        }
        compose.waitUntil(5_000) { fraction < .01f }
        compose.runOnIdle { assertTrue("The offscreen loader cancellation threshold is reached", fraction < .1f) }
    }

    @Test fun fullyVisibleMedia_canReachAutoplayThreshold() {
        var fraction by mutableFloatStateOf(-1f)
        compose.setContent { SautiTheme(darkTheme = true) {
            Box(Modifier.width(300.dp).height(320.dp).clipToBounds()) {
                Box(Modifier.fillMaxWidth().height(300.dp).onGloballyPositioned {
                    fraction = measuredVideoVisibleFraction(it, Float.MAX_VALUE)
                })
            }
        } }
        compose.waitUntil(5_000) { fraction >= 0f }
        compose.runOnIdle { assertEquals(1f, fraction, .01f); assertTrue(fraction >= .58f) }
    }
}
