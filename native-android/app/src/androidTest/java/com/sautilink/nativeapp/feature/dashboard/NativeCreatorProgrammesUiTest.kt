package com.sautilink.nativeapp.feature.dashboard

import android.graphics.Bitmap
import android.util.Log
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.requiredWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.sautilink.nativeapp.ui.theme.SautiTheme
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class NativeCreatorProgrammesUiTest {
    @get:Rule val compose = createComposeRule()
    private fun assertLockedPresentation(dark: Boolean) {
        compose.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, 1.5f)) {
                SautiTheme(darkTheme = dark) {
                    Column(Modifier.requiredWidth(320.dp).verticalScroll(rememberScrollState())) {
                        creatorProgrammes.forEach { CreatorProgrammeCard(it) }
                    }
                }
            }
        }
        creatorProgrammes.forEach { programme ->
            val card = compose.onNode(hasText(programme.title) and SemanticsMatcher.keyIsDefined(SemanticsProperties.Disabled))
            card.performScrollTo().assertIsDisplayed().assertIsNotEnabled()
            assertFalse("Locked programmes must not offer an activation action",
                card.fetchSemanticsNode().config.contains(SemanticsActions.OnClick))
            val layouts = mutableListOf<TextLayoutResult>()
            compose.onNodeWithText(programme.title, useUnmergedTree = true)
                .performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(layouts) }
            assertTrue(layouts.isNotEmpty())
            val ordinal = creatorProgrammes.indexOf(programme) + 1
            layouts.forEach { layout -> Log.i("SautiProgrammeUi",
                "dark=$dark programme=$ordinal width_px=${layout.size.width} height_px=${layout.size.height} " +
                    "lines=${layout.lineCount} overflow_width=${layout.didOverflowWidth} overflow_height=${layout.didOverflowHeight}") }
            // Synthetic fixture only. Capture before the assertion so a real
            // device failure retains the evidence instead of only its message.
            val directory = File(InstrumentationRegistry.getInstrumentation().targetContext.cacheDir, "programme-proof")
            check(directory.isDirectory || directory.mkdir())
            val screenshot = compose.onRoot().captureToImage().asAndroidBitmap()
            try {
                File(directory, "${if (dark) "dark" else "light"}-$ordinal.png").outputStream().use {
                    check(screenshot.compress(Bitmap.CompressFormat.PNG, 100, it))
                }
            } finally { screenshot.recycle() }
            assertTrue("Programme title must fit at enlarged text size", layouts.none { it.didOverflowWidth || it.didOverflowHeight })
        }
        compose.onAllNodesWithText("Not available yet", useUnmergedTree = true).assertCountEquals(3)
    }
    @Test fun lightProgrammesStayLockedAndFitAt320dpAndLargeText() = assertLockedPresentation(false)
    @Test fun darkProgrammesStayLockedAndFitAt320dpAndLargeText() = assertLockedPresentation(true)
}
