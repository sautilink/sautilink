package com.sautilink.nativeapp.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ThumbUp
import androidx.compose.material.icons.rounded.ThumbUpOffAlt
import androidx.compose.material.icons.rounded.ThumbDown
import androidx.compose.material.icons.rounded.ThumbDownOffAlt
import androidx.compose.material3.*
import com.sautilink.nativeapp.ui.components.SautiIcon as Icon
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.runtime.remember
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.ui.theme.sautiChromeInk

/** The same accessible Like, Dislike and Reply rail on comments and nested replies. */
@Composable
internal fun SautiCommentActions(
    likes: Int, dislikes: Int, replyCount: Int, liked: Boolean, disliked: Boolean,
    reactionEnabled: Boolean, replyEnabled: Boolean,
    onLike: () -> Unit, onDislike: () -> Unit, onReply: () -> Unit,
    onViewReplies: (() -> Unit)? = null
) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        CommentAction(if (liked) Icons.Rounded.ThumbUp else Icons.Rounded.ThumbUpOffAlt,
            if (liked) "Remove like from comment" else "Like comment", likes,
            liked, reactionEnabled, Modifier.widthIn(min = 32.dp), onLike)
        CommentAction(if (disliked) Icons.Rounded.ThumbDown else Icons.Rounded.ThumbDownOffAlt,
            if (disliked) "Remove dislike from comment" else "Dislike comment", dislikes,
            disliked, reactionEnabled, Modifier.widthIn(min = 32.dp), onDislike)
        CommentTextAction("Reply", "Reply to comment", replyEnabled, onReply)
        if (replyCount > 0 && onViewReplies != null) {
            CommentTextAction(if (replyCount == 1) "View 1 reply" else "View $replyCount replies",
                null, replyEnabled, onViewReplies)
        }
    }
}

@Composable
private fun CommentTextAction(text: String, label: String?, enabled: Boolean, onClick: () -> Unit) {
    Box(Modifier.heightIn(min = 34.dp).semantics { if (label != null) contentDescription = label }
        .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
        .padding(horizontal = 5.dp), contentAlignment = Alignment.Center) {
        Text(text, style = MaterialTheme.typography.labelSmall,
            color = if (enabled) sautiChromeInk() else MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun CommentAction(icon: ImageVector, label: String, count: Int,
    active: Boolean, enabled: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val interaction = remember { MutableInteractionSource() }
    val tint = if (active) MaterialTheme.colorScheme.primary else sautiChromeInk()
    Row(modifier.heightIn(min = 34.dp).semantics {
        selected = active; contentDescription = label; stateDescription = count.coerceAtLeast(0).toString()
    }
        .clickable(interactionSource = interaction, indication = null, enabled = enabled, role = Role.Button, onClick = onClick)
        .padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center) {
        // Keep the confirmed artwork while the request runs, rather than swapping it for a spinner.
        Icon(icon, null, Modifier.size(18.dp).sautiActionFeedback(interaction), tint = tint)
        if (count > 0) {
            Spacer(Modifier.width(2.dp))
            Text(count.toString(), style = MaterialTheme.typography.labelSmall, color = tint,
                maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}
