package com.sautilink.nativeapp.feature.home

import androidx.compose.foundation.layout.Column
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import com.sautilink.nativeapp.feature.posts.NativeOwnPost
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class FeedOwnedPostActionsTest {
    @get:Rule val compose = createComposeRule()

    @Test fun ownerCanChooseEditAndDeleteButOtherViewersCannot() {
        var owner by mutableStateOf(true)
        var edit = 0; var delete = 0
        compose.setContent { MaterialTheme { Column {
            FeedOwnerPostMenuItems(owner, true, { edit++ }, { delete++ })
        } } }
        compose.onNodeWithText("Edit post").performClick()
        compose.onNodeWithText("Delete post").performClick()
        assertEquals(1, edit); assertEquals(1, delete)
        compose.runOnIdle { owner = false }
        compose.onNodeWithText("Edit post").assertDoesNotExist()
        compose.onNodeWithText("Delete post").assertDoesNotExist()
    }

    @Test fun deleteRequiresConfirmationAndCancelDoesNotDelete() {
        var open by mutableStateOf(true)
        var deleted = 0
        compose.setContent { MaterialTheme {
            if (open) FeedDeletePostDialog(false, true, null, { open = false }) { deleted++; open = false }
        } }
        compose.onNodeWithText("Delete post?").assertIsDisplayed()
        compose.onNodeWithText("Cancel").performClick()
        assertEquals(0, deleted)
        compose.runOnIdle { open = true }
        compose.onNodeWithText("Delete").performClick()
        assertEquals(1, deleted)
    }

    @Test fun editKeepsCaptionUntilAnExplicitSaveAndRespectsExistingEditLimit() {
        val original = NativeOwnPost("test-post", "Original caption", "2026-11-25", 0, 1, "public")
        var post by mutableStateOf(original)
        var draft by mutableStateOf(original.body)
        var saved: String? = null
        compose.setContent { MaterialTheme {
            FeedEditPostDialog(post, draft, false, false, true, null, { draft = it }, {}) { saved = draft }
        } }
        compose.onNodeWithText("Save changes").assertIsNotEnabled()
        compose.onNodeWithText("Original caption").performTextReplacement("Updated caption")
        assertNull(saved)
        compose.onNodeWithText("Save changes").performClick()
        assertEquals("Updated caption", saved)
        compose.runOnIdle { post = original.copy(editCount = 1) }
        compose.onNodeWithText("Save changes").assertIsNotEnabled()
        compose.onNodeWithText("This post has already used its edit.").assertIsDisplayed()
    }
}
