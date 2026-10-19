package com.sautilink.nativeapp.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.sautilink.nativeapp.feature.home.NativePostComment
import com.sautilink.nativeapp.feature.home.PostCommentContent
import com.sautilink.nativeapp.feature.home.relativePostTime
import com.sautilink.nativeapp.ui.components.SautiCommentActions
import com.sautilink.nativeapp.ui.theme.SautiTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Offline production comment renderer fixtures: no account, client or network requests. */
@RunWith(AndroidJUnit4::class)
class NativeCommentIdentityTest {
    @get:Rule val compose = createComposeRule()

    private fun comment(name: String = "Mariam Thabit", verified: Boolean = true) = NativePostComment(
        id = "comment-fixture", author = name, handle = "private_handle_fixture",
        body = "Karibu kwenye mazungumzo ya SautiLink.", createdAt = "2026-10-19T06:00:00Z",
        authorId = "fixture-author", replyCount = 2, verified = verified, badgeType = "standard",
        likes = 4, dislikes = 1,
    )

    @Composable
    private fun Frame(fontScale: Float = 1f, content: @Composable () -> Unit) {
        val density = LocalDensity.current
        CompositionLocalProvider(LocalDensity provides Density(density.density, fontScale)) {
            SautiTheme(darkTheme = false) {
                Surface(color = MaterialTheme.colorScheme.surface) {
                    Box(Modifier.width(320.dp).padding(12.dp).testTag("comment-frame")) { content() }
                }
            }
        }
    }

    @Test fun sharedCommentIdentity_keepsAvatarNameBadgeAndTimestamp_withoutVisibleHandle() {
        val comment = comment()
        compose.setContent { Frame {
            PostCommentContent(auth = null, comment = comment)
        } }
        val avatar = compose.onNodeWithContentDescription("Mariam Thabit's profile photo").assertIsDisplayed()
            .fetchSemanticsNode().boundsInRoot
        val name = compose.onNodeWithText("Mariam Thabit").assertIsDisplayed().fetchSemanticsNode().boundsInRoot
        val badge = compose.onNodeWithContentDescription("Verified account").assertIsDisplayed()
            .fetchSemanticsNode().boundsInRoot
        assertTrue("The circular avatar precedes the author name", avatar.right <= name.left)
        assertTrue("Verification immediately follows the display name", badge.left >= name.right)
        compose.onNodeWithText("private_handle_fixture", substring = true).assertDoesNotExist()
        val timestamp = compose.onNodeWithText(relativePostTime(comment.createdAt)).assertIsDisplayed()
            .fetchSemanticsNode().boundsInRoot
        assertTrue("Timestamp immediately follows verification on the identity row", timestamp.left >= badge.right)
        assertTrue("Timestamp remains on the name's row", timestamp.top < name.bottom && timestamp.bottom > name.top)
        compose.onNodeWithText(comment.body).assertIsDisplayed()
    }

    @Test fun sharedCommentIdentity_largeText_keepsBadgeOptionsAndExistingActionsAccessible() {
        val comment = comment("Mariam Thabit With A Long Display Name")
        var deleted = 0
        var likes = 0
        var dislikes = 0
        var replies = 0
        compose.setContent { Frame(fontScale = 1.5f) {
            PostCommentContent(auth = null, comment = comment, onDelete = { deleted++ }) {
                SautiCommentActions(likes = 4, dislikes = 1, replyCount = 2, liked = false, disliked = false,
                    reactionEnabled = true, replyEnabled = true,
                    onLike = { likes++ }, onDislike = { dislikes++ }, onReply = { replies++ })
            }
        } }
        val frame = compose.onNodeWithTag("comment-frame").fetchSemanticsNode().boundsInRoot
        val badge = compose.onNodeWithContentDescription("Verified account").assertIsDisplayed()
            .fetchSemanticsNode().boundsInRoot
        val options = compose.onNodeWithContentDescription("Comment options").assertIsDisplayed()
            .fetchSemanticsNode().boundsInRoot
        val timestamp = compose.onNodeWithText(relativePostTime(comment.createdAt)).assertIsDisplayed()
            .fetchSemanticsNode().boundsInRoot
        assertTrue("Badge stays within the narrow large-text layout", badge.left >= frame.left && badge.right <= frame.right)
        assertTrue("Options stay within the narrow large-text layout", options.right <= frame.right)
        assertTrue("Timestamp stays visible after the badge at large text", timestamp.left >= badge.right && timestamp.right <= frame.right)
        compose.onNodeWithText("private_handle_fixture", substring = true).assertDoesNotExist()
        compose.onNodeWithContentDescription("Like comment").performClick()
        compose.onNodeWithContentDescription("Dislike comment").performClick()
        compose.onNodeWithContentDescription("Reply to comment").performClick()
        compose.onNodeWithContentDescription("Comment options").performClick()
        compose.onNodeWithText("Delete your comment").assertIsDisplayed().performClick()
        compose.runOnIdle {
            assertEquals(1, likes)
            assertEquals(1, dislikes)
            assertEquals(1, replies)
            assertEquals(1, deleted)
        }
    }

    @Test fun unverifiedComment_hasNoBadge_andDisabledDeleteCannotOpen() {
        compose.setContent { Frame {
            PostCommentContent(auth = null, comment = comment(verified = false),
                enabled = false, onDelete = {})
        } }
        compose.onNodeWithContentDescription("Verified account").assertDoesNotExist()
        compose.onNodeWithContentDescription("Comment options").assertIsNotEnabled()
        compose.onNodeWithText("Delete your comment").assertDoesNotExist()
    }
}
