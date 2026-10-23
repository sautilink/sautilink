package com.sautilink.nativeapp.feature.dashboard

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
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.sautilink.nativeapp.ui.theme.SautiTheme
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

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
            assertTrue("Programme title must fit at enlarged text size", layouts.none { it.didOverflowWidth || it.didOverflowHeight })
        }
        compose.onAllNodesWithText("Not available yet", useUnmergedTree = true).assertCountEquals(3)
    }
    @Test fun lightProgrammesStayLockedAndFitAt320dpAndLargeText() = assertLockedPresentation(false)
    @Test fun darkProgrammesStayLockedAndFitAt320dpAndLargeText() = assertLockedPresentation(true)
}
