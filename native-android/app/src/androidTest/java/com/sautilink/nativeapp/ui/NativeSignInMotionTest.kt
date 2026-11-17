package com.sautilink.nativeapp.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.sautilink.nativeapp.feature.auth.NativeSignInIntro
import com.sautilink.nativeapp.ui.theme.SautiTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@OptIn(ExperimentalTestApi::class)
@RunWith(AndroidJUnit4::class)
class NativeSignInMotionTest {
    @get:Rule val compose = createComposeRule()

    @Test fun skyChangesBetweenFrames() {
        compose.mainClock.autoAdvance = false
        compose.setContent {
            SautiTheme {
                Box(Modifier.fillMaxSize().testTag("intro-scene")) {
                    NativeSignInIntro(onCreateAccount = {}, onLogin = {})
                }
            }
        }
        compose.mainClock.advanceTimeBy(240)
        val scene = compose.onNodeWithTag("intro-scene")
        val first = scene.captureToImage().toPixelMap()
        compose.mainClock.advanceTimeBy(3300)
        val next = scene.captureToImage().toPixelMap()
        val changed = ((first.height * .18).toInt() until (first.height * .32).toInt() step 4).sumOf { y ->
            (0 until first.width step 4).count { x -> first[x, y] != next[x, y] }
        }
        assertTrue("Clouds and birds move in the sky independently of the photo", changed > 20)
    }
}
