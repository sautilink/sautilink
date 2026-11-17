package com.sautilink.nativeapp.feature.rooms

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.Reply
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import com.sautilink.nativeapp.ui.components.SautiIcon as Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import com.sautilink.nativeapp.ui.theme.SautiHeaderFont
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.home.AuthorizedImage
import com.sautilink.nativeapp.feature.home.PostMediaGallery
import com.sautilink.nativeapp.ui.components.*
import com.sautilink.nativeapp.ui.theme.SautiColors
import com.sautilink.nativeapp.ui.theme.SautiShape

internal enum class RoomsTab(val title: String) { YOURS("My Rooms"), DISCOVER("Discover"), INVITES("Invites") }
internal enum class RoomTab(val title: String) { DISCUSSION("Discussion"), ABOUT("About"), PEOPLE("People"), MEDIA("Media"), LINKS("Links") }

internal fun roomSectionIcon(title: String): ImageVector = when {
    title.contains("rule", true) -> Icons.Rounded.Rule
    title.contains("question", true) || title.contains("answer", true) || title.contains("Before you join", true) -> Icons.Rounded.QuestionAnswer
    title.contains("invite", true) || title.contains("invitation", true) -> Icons.Rounded.PersonAdd
    title.contains("request", true) || title.contains("approval", true) || title.contains("submission", true) -> Icons.Rounded.FactCheck
    title.contains("setting", true) || title.startsWith("Manage") -> Icons.Rounded.Settings
    title.contains("member", true) || title.contains("people", true) -> Icons.Rounded.People
    title.contains("post", true) || title.contains("discussion", true) -> Icons.Rounded.ChatBubbleOutline
    title.contains("about", true) -> Icons.Rounded.Info
    title.contains("media", true) -> Icons.Rounded.PhotoLibrary
    else -> Icons.Rounded.Groups
}

@Composable
internal fun RoomSectionHeading(title: String, icon: ImageVector = roomSectionIcon(title),
    modifier: Modifier = Modifier) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(9.dp)) {
        Icon(icon, null, Modifier.size(21.dp), tint = MaterialTheme.colorScheme.primary)
        Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
internal fun RoomActionLabel(text: String, icon: ImageVector) {
    Row(verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(7.dp)) {
        Icon(icon, null, Modifier.size(18.dp))
        Text(text)
    }
}

@Composable
internal fun RoomMenuAction(label: String, icon: ImageVector, enabled: Boolean = true, onClick: () -> Unit) {
    DropdownMenuItem(text = { Text(label) }, onClick = onClick, enabled = enabled,
        leadingIcon = { Icon(icon, null, Modifier.size(20.dp)) })
}

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
        Text(title, fontFamily = SautiHeaderFont, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, maxLines = 1,
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
    Row(Modifier.fillMaxWidth().height(50.dp).selectableGroup().padding(horizontal = 12.dp)) {
        RoomsTab.entries.forEach { tab ->
            val active = selected == tab
            Column(Modifier.weight(1f).fillMaxHeight()
                .selectable(active, role = Role.Tab, onClick = { onSelect(tab) }),
                horizontalAlignment = Alignment.CenterHorizontally) {
                Box(Modifier.weight(1f).padding(horizontal = 4.dp),
                    contentAlignment = Alignment.Center) {
                    Text(if (tab == RoomsTab.INVITES && invites > 0) "Invites ($invites)" else tab.title,
                        style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        color = if (active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Box(Modifier.width(32.dp).height(3.dp).background(
                    if (active) MaterialTheme.colorScheme.primary else Color.Transparent, CircleShape))
            }
        }
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = .5f))
}

@Composable
internal fun roomFilterChipColors() = FilterChipDefaults.filterChipColors(
    selectedContainerColor = MaterialTheme.colorScheme.primary.copy(alpha = .12f),
    selectedLabelColor = MaterialTheme.colorScheme.primary,
    selectedLeadingIconColor = MaterialTheme.colorScheme.primary
)

@Composable
internal fun RoomCard(auth: StagingAuthClient, room: NativeRoom, onOpen: () -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 76.dp).clickable(onClick = onOpen)
        .padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        RoomGroupAvatar(auth, room, Modifier.size(52.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                if (room.privacy == "private") Icon(Icons.Rounded.Lock, "Private", Modifier.size(14.dp),
                    tint = MaterialTheme.colorScheme.primary)
                Text(room.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold,
                    maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            val preview = room.lastPost?.let { post ->
                post.body.replace('\n', ' ').ifBlank { if (post.mediaCount > 0) "Media attachment" else "" }
            }
            Text(preview?.takeIf(String::isNotBlank) ?: room.description.ifBlank { roomMemberCount(room.memberCount) },
                style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(room.lastPost?.let { roomPreviewTime(it.createdAt) } ?: roomMemberCount(room.memberCount),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(when {
                room.isMember -> roomRoleLabel(if (room.isOwner) "owner" else room.role)
                room.requestStatus == "pending" -> "Pending"
                room.policy == "approval" -> "By approval"
                room.policy == "private" -> "Invite only"
                else -> NativeRoomRules.categories[room.category] ?: "Public"
            }, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary,
                maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 100.dp))
        }
    }
    HorizontalDivider(Modifier.padding(start = 80.dp), color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = .45f))
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
    Column(Modifier.fillMaxWidth().padding(vertical = 12.dp), horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp)) {
        RoomGroupAvatar(auth, room, Modifier.size(86.dp))
        Text(room.name, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold,
            maxLines = 2, overflow = TextOverflow.Ellipsis)
        RoomMeta(room)
        Text("${roomMemberCount(room.memberCount)} · ${roomPolicyLabel(room.policy)}",
            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
internal fun RoomNotice(message: String, isError: Boolean = false, onRetry: (() -> Unit)? = null) {
    Surface(Modifier.fillMaxWidth(), shape = SautiShape.Button,
        color = if (isError) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.surfaceContainer) {
        Row(Modifier.padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(if (isError) Icons.Rounded.ErrorOutline else Icons.Rounded.Info, null,
                Modifier.size(20.dp), tint = if (isError) MaterialTheme.colorScheme.onErrorContainer
                    else MaterialTheme.colorScheme.primary)
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
        Surface(shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.primary.copy(alpha = .08f)) {
            Icon(icon, null, Modifier.padding(17.dp).size(30.dp), tint = MaterialTheme.colorScheme.primary)
        }
        Text(title, style = MaterialTheme.typography.titleMedium)
        Text(detail, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (actionLabel != null && onAction != null) Button(onClick = onAction) { Text(actionLabel) }
    }
}

@Composable
internal fun RoomCardSkeleton() {
    Row(Modifier.fillMaxWidth().height(76.dp).padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        SautiSkeletonBlock(Modifier.size(52.dp), 26.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            SautiSkeletonBlock(Modifier.fillMaxWidth(.54f).height(16.dp))
            SautiSkeletonBlock(Modifier.fillMaxWidth(.78f).height(12.dp))
        }
    }
}

@Composable
internal fun RoomPerson(auth: StagingAuthClient, name: String, handle: String, role: String?,
    verified: Boolean, badgeType: String, hasAvatar: Boolean, onOpen: () -> Unit,
    trailing: @Composable RowScope.() -> Unit = {}) {
    Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        RoomMemberAvatar(auth, name, handle, hasAvatar, Modifier.size(42.dp), onOpen)
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

@Composable
private fun RoomMemberAvatar(auth: StagingAuthClient, name: String, handle: String, hasAvatar: Boolean,
    modifier: Modifier, onOpen: () -> Unit) {
    val description = "$name avatar"
    val fallback: @Composable () -> Unit = {
        SautiAvatar(roomInitials(name), Modifier.fillMaxSize().semantics { contentDescription = description })
    }
    Box(modifier.clip(CircleShape).clickable(enabled = NativeRoomRules.handle.matches(handle), onClick = onOpen)) {
        if (hasAvatar && NativeRoomRules.handle.matches(handle)) {
            AuthorizedImage(auth, "/api/profile-media/$handle/avatar", description,
                Modifier.matchParentSize(), showFallbackWhileLoading = true, fallback = fallback)
        } else fallback()
    }
}

internal data class RoomPostUi(val liked: Boolean? = null,
    val pending: Set<String> = emptySet(), val error: String? = null)

@Composable
internal fun RoomPostCard(auth: StagingAuthClient, post: NativeRoomPost, state: RoomPostUi,
    own: Boolean, grouped: Boolean, onOpenProfile: () -> Unit,
    onLike: (Boolean) -> Unit, onRetry: () -> Unit, onManagePost: (() -> Unit)? = null,
    endOfGroup: Boolean = !grouped, onReply: (() -> Unit)? = null,
    onJumpToReply: ((String) -> Unit)? = null, highlighted: Boolean = false) {
    val colors = MaterialTheme.colorScheme
    var menu by remember(post.id) { mutableStateOf(false) }
    val replyAction by rememberUpdatedState(onReply)
    val swipeDirection = if (LocalLayoutDirection.current == LayoutDirection.Ltr) -1f else 1f
    val threshold = with(LocalDensity.current) { 61.dp.toPx() }
    var drag by remember(post.id) { mutableFloatStateOf(0f) }
    val translation by animateFloatAsState(drag * swipeDirection,
        animationSpec = if (drag > 0f) snap() else tween(170), label = "Reply swipe")
    val replyGesture = if (onReply == null || post.media.isNotEmpty()) Modifier else Modifier
        .pointerInput(post.id, threshold, swipeDirection) {
            detectHorizontalDragGestures(
                onDragEnd = {
                    val shouldReply = drag >= threshold
                    drag = 0f
                    if (shouldReply) replyAction?.invoke()
                },
                onDragCancel = { drag = 0f },
            ) { _, dx -> drag = (drag + dx * swipeDirection).coerceIn(0f, threshold * 1.25f) }
        }
    val corner = if (endOfGroup) 5.dp else 16.dp
    val shape = RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp,
        bottomStart = if (own) 18.dp else corner, bottomEnd = if (own) corner else 18.dp)
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val bubbleWidth = (maxWidth - 43.dp).coerceAtLeast(1.dp) * .94f
        Row(Modifier.fillMaxWidth().then(replyGesture).graphicsLayer { translationX = translation }
            .padding(top = if (grouped) 1.dp else 5.dp, bottom = 3.dp),
            horizontalArrangement = if (own) Arrangement.End else Arrangement.Start,
            verticalAlignment = Alignment.Bottom) {
            if (!own) RoomBubbleAvatar(auth, post, endOfGroup, own, onOpenProfile)
            val width = if (post.media.isEmpty()) Modifier.width(IntrinsicSize.Max)
                else Modifier.width(bubbleWidth)
            Surface(modifier = Modifier.widthIn(max = bubbleWidth).then(width),
                shape = shape, color = if (highlighted) colors.tertiaryContainer
                    else if (own) colors.primaryContainer else colors.surface,
                contentColor = if (own) colors.onPrimaryContainer else colors.onSurface, shadowElevation = 1.dp) {
                Column(Modifier.padding(top = 6.dp)) {
                    val likeGesture = if (state.liked != null && "like" !in state.pending) ({ onLike(true) }) else null
                    if (!own && !grouped) {
                        Row(Modifier.fillMaxWidth().clickable(enabled = post.authorHandle.isNotBlank(), onClick = onOpenProfile)
                            .padding(horizontal = 12.dp, vertical = 3.dp),
                            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                            Text(post.authorName, color = colors.primary, style = MaterialTheme.typography.labelLarge,
                                fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.weight(1f, fill = false))
                            SautiVerificationBadge(post.verified, post.badgeType, post.authorName, size = 14.dp)
                        }
                    }
                    post.reply?.let { RoomMessageQuote(it, onJumpToReply) }
                    if (post.body.isNotBlank()) {
                        SautiPostGestureSurface(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 3.dp),
                            onLike = likeGesture, onTap = { menu = true }, tapLabel = "Message options",
                            onLongPress = { menu = true }) {
                            SautiPostText(post.body, style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                    if (post.media.isNotEmpty()) Box(Modifier.padding(horizontal = 5.dp).clip(RoundedCornerShape(13.dp))) {
                        PostMediaGallery(auth, post.media, onDoubleTapLike = likeGesture)
                    }
                    state.error?.let { RoomNotice(it, true, onRetry) }
                    Row(Modifier.fillMaxWidth().padding(start = 8.dp, end = 3.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.End) {
                        if (post.likes > 0) RoomCountAction(if (state.liked == true) "Unlike post" else "Like post", post.likes,
                            state.liked != null && "like" !in state.pending, state.liked == true, Modifier) { onLike(false) }
                        Spacer(Modifier.weight(1f))
                        Text(roomPostClock(post.createdAt), style = MaterialTheme.typography.labelSmall,
                            color = if (own) colors.onPrimaryContainer.copy(alpha = .75f) else colors.onSurfaceVariant,
                            maxLines = 1)
                        Box {
                            IconButton(onClick = { menu = true }, modifier = Modifier.size(36.dp)) {
                                Icon(Icons.Rounded.MoreHoriz, "Message options", Modifier.size(18.dp))
                            }
                            DropdownMenu(menu, { menu = false }) {
                                if (onReply != null) RoomMenuAction("Reply", Icons.AutoMirrored.Rounded.Reply) {
                                    menu = false; onReply()
                                }
                                RoomMenuAction(if (state.liked == true) "Unlike" else "Like", Icons.Rounded.FavoriteBorder,
                                    enabled = state.liked != null && "like" !in state.pending) { menu = false; onLike(false) }
                                if (onManagePost != null) RoomMenuAction("Moderate", Icons.Rounded.Shield) {
                                    menu = false; onManagePost()
                                }
                            }
                        }
                    }
                }
            }
            if (own) RoomBubbleAvatar(auth, post, endOfGroup, own, onOpenProfile)
        }
    }
}

@Composable
private fun RoomMessageQuote(reference: RoomMessageReference, onJump: ((String) -> Unit)?) {
    val colors = MaterialTheme.colorScheme
    val available = reference.author != null && onJump != null
    Surface(
        onClick = { onJump?.invoke(reference.id) },
        enabled = available,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 7.dp, vertical = 3.dp),
        color = colors.primary.copy(alpha = .12f),
        shape = RoundedCornerShape(8.dp),
    ) {
        Row(Modifier.height(IntrinsicSize.Min)) {
            Box(Modifier.width(3.dp).fillMaxHeight().background(colors.primary))
            Column(Modifier.padding(horizontal = 8.dp, vertical = 5.dp)) {
                Text(reference.author ?: "Message unavailable", color = colors.primary,
                    style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
                reference.excerpt?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
}

@Composable
private fun RoomBubbleAvatar(auth: StagingAuthClient, post: NativeRoomPost, visible: Boolean, own: Boolean,
    onOpenProfile: () -> Unit) {
    Box(Modifier.width(43.dp).padding(start = if (own) 7.dp else 0.dp, end = if (own) 0.dp else 7.dp),
        contentAlignment = Alignment.BottomCenter) {
        if (visible) RoomMemberAvatar(auth, post.authorName, post.authorHandle, post.hasAvatar,
            Modifier.size(36.dp), onOpenProfile)
    }
}

@Composable
private fun RoomCountAction(label: String, count: Int, enabled: Boolean,
    active: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val interaction = remember { MutableInteractionSource() }
    Row(modifier.sizeIn(minWidth = 48.dp, minHeight = 48.dp)
        .clickable(interactionSource = interaction, indication = ripple(), enabled = enabled,
            role = Role.Button, onClick = onClick), verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center) {
        SautiPostHeart(active, label, Modifier.size(20.dp).sautiActionFeedback(interaction))
        if (count > 0) Spacer(Modifier.width(2.dp))
        Text(if (count <= 0) "" else when { count >= 1_000_000 -> "${count / 1_000_000}m"
            count >= 1000 -> "${count / 1000}k"; else -> count.toString() }, style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
