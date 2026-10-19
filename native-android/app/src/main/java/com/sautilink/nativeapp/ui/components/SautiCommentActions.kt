package com.sautilink.nativeapp.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Reply
import androidx.compose.material.icons.rounded.DeleteOutline
import androidx.compose.material.icons.rounded.Favorite
import androidx.compose.material.icons.rounded.FavoriteBorder
import androidx.compose.material.icons.rounded.ThumbDown
import androidx.compose.material.icons.rounded.ThumbDownOffAlt
import androidx.compose.material3.*
import com.sautilink.nativeapp.ui.components.SautiIcon as Icon
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.runtime.remember
import androidx.compose.runtime.getValue
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.ui.theme.SautiColors

/** The same accessible Love, Dislike and Reply rail on comments and nested replies. */
@Composable
internal fun SautiCommentActions(
    likes: Int, dislikes: Int, replyCount: Int, liked: Boolean, disliked: Boolean,
    reactionEnabled: Boolean, replyEnabled: Boolean,
    onLike: () -> Unit, onDislike: () -> Unit, onReply: () -> Unit,
    onDelete: (() -> Unit)? = null
) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        CommentAction(if (liked) Icons.Rounded.Favorite else Icons.Rounded.FavoriteBorder,
            if (liked) "Remove like from comment" else "Like comment", likes,
            liked, reactionEnabled, Modifier.weight(1f), onLike)
        CommentAction(if (disliked) Icons.Rounded.ThumbDown else Icons.Rounded.ThumbDownOffAlt,
            if (disliked) "Remove dislike from comment" else "Dislike comment", dislikes,
            disliked, reactionEnabled, Modifier.weight(1f), onDislike)
        CommentAction(Icons.AutoMirrored.Rounded.Reply, "Reply to comment", replyCount,
            false, replyEnabled, Modifier.weight(1f), onReply)
        if (onDelete != null) IconButton(onClick = onDelete, enabled = replyEnabled,
            modifier = Modifier.size(48.dp)) {
            Icon(Icons.Rounded.DeleteOutline, "Delete your comment", Modifier.size(24.dp),
                tint = MaterialTheme.colorScheme.error)
        }
    }
}

@Composable
private fun CommentAction(icon: ImageVector, label: String, count: Int,
    active: Boolean, enabled: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val interaction = remember { MutableInteractionSource() }
    val tint by animateColorAsState(
        if (active) SautiColors.Red else MaterialTheme.colorScheme.onSurfaceVariant,
        animationSpec = tween(150), label = "Comment reaction color")
    Row(modifier.heightIn(min = 48.dp).semantics { selected = active; contentDescription = label }
        .clickable(interactionSource = interaction, indication = ripple(), enabled = enabled, role = Role.Button, onClick = onClick)
        .padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center) {
        // Keep the confirmed artwork while the request runs, rather than swapping it for a spinner.
        Icon(icon, null, Modifier.size(24.dp).sautiActionFeedback(interaction), tint = tint)
        Spacer(Modifier.width(4.dp))
        Text(count.coerceAtLeast(0).toString(), modifier = Modifier.weight(1f, fill = false),
            style = MaterialTheme.typography.labelSmall, color = tint,
            maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}
