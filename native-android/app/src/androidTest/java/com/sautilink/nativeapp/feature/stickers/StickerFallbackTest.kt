package com.sautilink.nativeapp.feature.stickers

import androidx.compose.foundation.layout.Column
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import com.sautilink.nativeapp.ui.components.SautiPostText
import com.sautilink.nativeapp.ui.components.SautiEntityText
import org.junit.Rule
import org.junit.Test

class StickerFallbackTest {
    @get:Rule val compose = createComposeRule()

    @Test fun unavailableStickerStaysReadableWithoutRecursiveRendering() {
        compose.setContent {
            MaterialTheme {
                Column {
                    SautiPostText("Before [[sl-sticker:not-a-real-sticker]] after")
                    SautiEntityText("Reply :slv-not-a-real-emoji:")
                }
            }
        }
        compose.onNodeWithText("Before ").assertIsDisplayed()
        compose.onNodeWithText("[[sl-sticker:not-a-real-sticker]]").assertDoesNotExist()
        compose.onNodeWithText(":slv-not-a-real-emoji:").assertDoesNotExist()
        compose.onNodeWithText(" after").assertIsDisplayed()
    }
}
