package com.sautilink.nativeapp.feature.rooms

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.home.AuthorizedImage
import com.sautilink.nativeapp.feature.home.PostMediaGallery
import com.sautilink.nativeapp.feature.home.relativePostTime
import com.sautilink.nativeapp.ui.components.*
import com.sautilink.nativeapp.ui.theme.SautiColors
import com.sautilink.nativeapp.ui.theme.SautiShape

internal enum class RoomsTab(val title: String) { DISCOVER("Discover"), YOURS("Your rooms"), INVITES("Invites") }
internal enum class RoomTab(val title: String) { DISCUSSION("Discussion"), ABOUT("About"), PEOPLE("People"), MEDIA("Media") }

internal fun roomPolicyLabel(policy: String) = when (policy) {
    "approval" -> "Approval to join"
    "private" -> "Invite only"
    else -> "Open to join"
}

internal fun roomRoleLabel(role: String?) = role?.replaceFirstChar { it.uppercase() } ?: "Not joined"
internal fun roomInitials(name: String) = name.trim().split(Regex("\\s+"))
    .filter(String::isNotBlank).take(2).joinToString("") { it.take(1) }.uppercase().ifBlank { "SL" }

@Composable
internal fun RoomsTopBar(title: String, refreshing: Boolean, onBack: () -> Unit,
    onRefresh: () -> Unit, onCreate: (() -> Unit)? = null) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back") }
        Text(title, style = MaterialTheme.typography.titleLarge, maxLines = 1,
            overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        IconButton(onClick = onRefresh, enabled = !refreshing) {
            Icon(Icons.Rounded.Refresh, "Refresh Rooms")
        }
        if (onCreate != null) IconButton(onClick = onCreate) {
            Icon(Icons.Rounded.Add, "Create Room", tint = MaterialTheme.colorScheme.primary)
        }
    }
}

@Composable
internal fun RoomsTabs(selected: RoomsTab, invites: Int, onSelect: (RoomsTab) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        RoomsTab.entries.forEach { tab ->
            FilterChip(selected = tab == selected, onClick = { onSelect(tab) },
                label = { Text(if (tab == RoomsTab.INVITES && invites > 0) "Invites ($invites)" else tab.title,
                    style = MaterialTheme.typography.labelMedium, maxLines = 1) },
                modifier = Modifier.weight(1f), shape = SautiShape.Pill)
        }
    }
}

@Composable
internal fun RoomContentTabs(selected: RoomTab, onSelect: (RoomTab) -> Unit) {
    ScrollableTabRow(selectedTabIndex = selected.ordinal, edgePadding = 8.dp,
        containerColor = MaterialTheme.colorScheme.surface, divider = {}) {
        RoomTab.entries.forEach { tab ->
            Tab(selected = tab == selected, onClick = { onSelect(tab) },
                text = { Text(tab.title, style = MaterialTheme.typography.labelLarge) })
        }
    }
}

@Composable
internal fun RoomCover(auth: StagingAuthClient, room: NativeRoom, modifier: Modifier = Modifier) {
    Box(modifier.background(Brush.linearGradient(listOf(SautiColors.Blue, SautiColors.DarkSurface))),
        contentAlignment = Alignment.Center) {
        Icon(Icons.Rounded.Groups, null, Modifier.size(64.dp), tint = Color.White.copy(alpha = .75f))
        room.coverPath?.let { path ->
            AuthorizedImage(auth, path, "${room.name} cover", Modifier.matchParentSize(),
                fallback = { Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Icon(Icons.Rounded.Groups, null, Modifier.size(64.dp), tint = Color.White.copy(alpha = .75f))
                } })
        }
    }
}

@Composable
internal fun RoomCard(auth: StagingAuthClient, room: NativeRoom, onOpen: () -> Unit) {
    Surface(modifier = Modifier.fillMaxWidth(), shape = SautiShape.Card,
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = .5f))) {
        Column(Modifier.clickable(onClick = onOpen)) {
            RoomCover(auth, room, Modifier.fillMaxWidth().height(132.dp))
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                Text(room.name, style = MaterialTheme.typography.titleMedium, maxLines = 2,
                    overflow = TextOverflow.Ellipsis)
                RoomMeta(room)
                if (room.description.isNotBlank()) Text(room.description,
                    style = MaterialTheme.typography.bodyMedium, maxLines = 2,
                    overflow = TextOverflow.Ellipsis, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text("${room.memberCount} ${if (room.memberCount == 1) "member" else "members"}",
                        style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f),
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(when {
                        room.isMember -> if (room.isOwner) "Owner" else "Joined"
                        room.requestStatus == "pending" -> "Request pending"
                        else -> roomPolicyLabel(room.policy)
                    }, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                }
            }
        }
    }
}

@Composable
internal fun RoomMeta(room: NativeRoom) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Icon(if (room.privacy == "private") Icons.Rounded.Lock else Icons.Rounded.Public,
            null, Modifier.size(15.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Text("${if (room.privacy == "private") "Private" else "Public"} · ${NativeRoomRules.categories[room.category] ?: "General"}",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
internal fun RoomDetailHeading(auth: StagingAuthClient, room: NativeRoom) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        RoomCover(auth, room, Modifier.fillMaxWidth().height(180.dp).clip(SautiShape.Card))
        Text(room.name, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        RoomMeta(room)
        Text("${room.memberCount} ${if (room.memberCount == 1) "member" else "members"} · ${roomPolicyLabel(room.policy)}",
            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
internal fun RoomNotice(message: String, isError: Boolean = false, onRetry: (() -> Unit)? = null) {
    Surface(Modifier.fillMaxWidth(), shape = SautiShape.Button,
        color = if (isError) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.surfaceContainer) {
        Row(Modifier.padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(message, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f),
                color = if (isError) MaterialTheme.colorScheme.onErrorContainer else MaterialTheme.colorScheme.onSurfaceVariant)
            if (onRetry != null) TextButton(onClick = onRetry) { Text("Retry") }
        }
    }
}

@Composable
internal fun RoomEmpty(title: String, detail: String, icon: ImageVector = Icons.Rounded.Groups,
    actionLabel: String? = null, onAction: (() -> Unit)? = null) {
    Column(Modifier.fillMaxWidth().padding(vertical = 28.dp, horizontal = 16.dp),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Surface(shape = CircleShape, color = MaterialTheme.colorScheme.surfaceContainer) {
            Icon(icon, null, Modifier.padding(17.dp).size(30.dp), tint = MaterialTheme.colorScheme.primary)
        }
        Text(title, style = MaterialTheme.typography.titleMedium)
        Text(detail, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (actionLabel != null && onAction != null) Button(onClick = onAction) { Text(actionLabel) }
    }
}

@Composable
internal fun RoomCardSkeleton() {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        SautiSkeletonBlock(Modifier.fillMaxWidth().height(132.dp), 24.dp)
        SautiSkeletonBlock(Modifier.fillMaxWidth(.65f).height(18.dp))
        SautiSkeletonBlock(Modifier.fillMaxWidth(.85f).height(13.dp))
        Spacer(Modifier.height(10.dp))
    }
}

@Composable
internal fun RoomPerson(auth: StagingAuthClient, name: String, handle: String, role: String?,
    verified: Boolean, badgeType: String, hasAvatar: Boolean, onOpen: () -> Unit,
    trailing: @Composable RowScope.() -> Unit = {}) {
    Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        val avatar = Modifier.size(42.dp).clip(CircleShape)
        if (hasAvatar && NativeRoomRules.handle.matches(handle)) AuthorizedImage(auth,
            "/api/profile-media/$handle/avatar", "$name avatar", avatar,
            fallback = { SautiAvatar(roomInitials(name), avatar) })
        else SautiAvatar(roomInitials(name), avatar)
        Column(Modifier.weight(1f).clickable(enabled = handle.isNotBlank(), onClick = onOpen),
            verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(name, style = MaterialTheme.typography.titleSmall,
                    modifier = Modifier.weight(1f, fill = false), maxLines = 1, overflow = TextOverflow.Ellipsis)
                SautiVerificationBadge(verified, badgeType, name, size = 15.dp)
            }
            Text(if (role != null) "${if (handle.isNotBlank()) "@$handle · " else ""}${roomRoleLabel(role)}" else "@$handle",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        trailing()
    }
}

internal data class RoomPostUi(val liked: Boolean? = null, val saved: Boolean? = null,
    val reposted: Boolean? = null, val pending: Set<String> = emptySet(), val error: String? = null)

@Composable
internal fun RoomPostCard(auth: StagingAuthClient, post: NativeRoomPost, state: RoomPostUi,
    onOpenProfile: () -> Unit, onOpenPost: () -> Unit, onComments: () -> Unit,
    onLike: (Boolean) -> Unit, onSave: () -> Unit, onRepost: () -> Unit, onShare: () -> Unit,
    onRetry: () -> Unit) {
    Surface(shape = SautiShape.Card, color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = .45f))) {
        Column(Modifier.fillMaxWidth()) {
            Row(Modifier.padding(start = 14.dp, end = 4.dp, top = 7.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.weight(1f)) {
                    RoomPerson(auth, post.authorName, post.authorHandle, null, post.verified, post.badgeType,
                        post.hasAvatar, onOpenProfile)
                }
                IconButton(onClick = onOpenPost) { Icon(Icons.Rounded.MoreHoriz, "Open post") }
            }
            Text(relativePostTime(post.createdAt), Modifier.padding(horizontal = 14.dp),
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            val likeGesture: (() -> Unit)? = if (state.liked != null && "like" !in state.pending) ({ onLike(true) }) else null
            SautiPostGestureSurface(Modifier.fillMaxWidth().padding(14.dp), onLike = likeGesture,
                onTap = onOpenPost, tapLabel = "Open Room post") {
                SautiPostText(post.body, style = MaterialTheme.typography.bodyLarge)
            }
            PostMediaGallery(auth, post.media, onDoubleTapLike = likeGesture)
            if (state.error != null) Box(Modifier.padding(horizontal = 12.dp, vertical = 6.dp)) {
                RoomNotice(state.error, true, onRetry)
            }
            HorizontalDivider(Modifier.padding(horizontal = 14.dp), color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = .5f))
            RoomPostActions(post, state, { onLike(false) }, onSave, onRepost, onComments, onShare)
        }
    }
}

@Composable
private fun RoomPostActions(post: NativeRoomPost, state: RoomPostUi, onLike: () -> Unit,
    onSave: () -> Unit, onRepost: () -> Unit, onComments: () -> Unit, onShare: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 5.dp, vertical = 3.dp), verticalAlignment = Alignment.CenterVertically) {
        RoomCountAction(if (state.liked == true) Icons.Rounded.ThumbUp else Icons.Rounded.ThumbUpOffAlt,
            if (state.liked == true) "Unlike post" else "Like post", post.likes, state.liked != null && "like" !in state.pending,
            state.liked == true, Modifier.weight(1f), onLike)
        RoomCountAction(Icons.Rounded.ChatBubbleOutline, "View comments", post.comments, true, false,
            Modifier.weight(1f), onComments)
        RoomCountAction(Icons.Rounded.Repeat, if (state.reposted == true) "Undo repost" else "Repost", post.reposts,
            state.reposted != null && "repost" !in state.pending, state.reposted == true, Modifier.weight(1f), onRepost)
        SautiActionIconButton(SautiPostIcons.Share, "Share post", MaterialTheme.colorScheme.onSurfaceVariant, onClick = onShare)
        SautiActionIconButton(if (state.saved == true) Icons.Rounded.Bookmark else Icons.Rounded.BookmarkBorder,
            if (state.saved == true) "Remove from saved" else "Save post", if (state.saved == true) MaterialTheme.colorScheme.primary
                else MaterialTheme.colorScheme.onSurfaceVariant, state.saved != null && "save" !in state.pending, onSave)
    }
}

@Composable
private fun RoomCountAction(icon: ImageVector, label: String, count: Int, enabled: Boolean,
    active: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        SautiActionIconButton(icon, label, if (active) SautiColors.Red else MaterialTheme.colorScheme.onSurfaceVariant,
            enabled, onClick)
        Text(if (count <= 0) "" else when { count >= 1_000_000 -> "${count / 1_000_000}m"
            count >= 1000 -> "${count / 1000}k"; else -> count.toString() }, style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
