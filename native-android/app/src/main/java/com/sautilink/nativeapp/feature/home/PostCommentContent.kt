package com.sautilink.nativeapp.feature.home

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.DeleteOutline
import androidx.compose.material.icons.rounded.MoreHoriz
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.ui.components.SautiAvatar
import com.sautilink.nativeapp.ui.components.SautiEntityText
import com.sautilink.nativeapp.ui.components.SautiIcon as Icon
import com.sautilink.nativeapp.ui.components.SautiVerificationBadge
import com.sautilink.nativeapp.ui.theme.SautiColors

/** One author and caption layout for post, Short Video and nested comment surfaces. */
@Composable
internal fun PostCommentContent(
    auth: StagingAuthClient?,
    comment: NativePostComment,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    onOpenProfile: ((String) -> Unit)? = null,
    onDelete: (() -> Unit)? = null,
    maxBodyLines: Int = Int.MAX_VALUE,
    actions: @Composable ColumnScope.() -> Unit = {},
) {
    val initials = comment.author.split(" ").filter { it.isNotBlank() }.take(2)
        .joinToString("") { it.take(1).uppercase() }.ifBlank { "SL" }
    val openProfile = onOpenProfile?.takeIf { comment.handle.isNotBlank() }
    var menuOpen by rememberSaveable(comment.id) { mutableStateOf(false) }
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.Top) {
        val avatar = Modifier.size(36.dp).clip(CircleShape)
            .semantics { contentDescription = "${comment.author}'s profile photo" }
            .then(if (openProfile != null) Modifier.clickable(enabled = enabled,
                onClickLabel = "Open ${comment.author}'s profile") { openProfile(comment.handle) } else Modifier)
        if (auth != null && comment.hasAvatar && comment.handle.isNotBlank()) {
            AuthorizedImage(auth, "/api/profile-media/${comment.handle}/avatar", "${comment.author}'s profile photo",
                avatar, fallback = { SautiAvatar(initials, Modifier.fillMaxSize(), SautiColors.Blue) })
        } else SautiAvatar(initials, avatar, SautiColors.Blue)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(comment.author,
                        modifier = Modifier.weight(1f, fill = false).then(if (openProfile != null)
                            Modifier.clickable(enabled = enabled,
                                onClickLabel = "Open ${comment.author}'s profile") { openProfile(comment.handle) }
                            else Modifier),
                        style = MaterialTheme.typography.labelLarge.copy(lineHeight = 20.sp),
                        fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    SautiVerificationBadge(comment.verified, comment.badgeType, comment.author, size = 14.dp)
                    Text(relativePostTime(comment.createdAt), style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                if (onDelete != null) Box {
                    IconButton(onClick = { menuOpen = true }, enabled = enabled,
                        modifier = Modifier.size(48.dp)) {
                        Icon(Icons.Rounded.MoreHoriz, "Comment options", Modifier.size(20.dp))
                    }
                    DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                        DropdownMenuItem(text = { Text("Delete your comment") },
                            leadingIcon = { Icon(Icons.Rounded.DeleteOutline, null,
                                tint = MaterialTheme.colorScheme.error) },
                            enabled = enabled,
                            onClick = { menuOpen = false; onDelete() })
                    }
                }
            }
            SautiEntityText(comment.body,
                style = MaterialTheme.typography.bodyMedium.copy(fontSize = 15.sp, lineHeight = 21.sp),
                maxLines = maxBodyLines, overflow = TextOverflow.Ellipsis)
            actions()
        }
    }
}
