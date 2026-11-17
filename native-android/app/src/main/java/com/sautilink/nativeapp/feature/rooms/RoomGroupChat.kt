package com.sautilink.nativeapp.feature.rooms

import android.text.format.DateFormat
import androidx.compose.animation.Crossfade
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.home.AuthorizedImage
import com.sautilink.nativeapp.ui.components.SautiAvatar
import com.sautilink.nativeapp.ui.components.SautiIcon as Icon
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Date

internal fun roomMemberCount(count: Int): String = "$count ${if (count == 1) "member" else "members"}"

@Composable
internal fun RoomGroupAvatar(auth: StagingAuthClient, room: NativeRoom, modifier: Modifier) {
    val accent = when ((room.id.hashCode() and Int.MAX_VALUE) % 3) {
        0 -> MaterialTheme.colorScheme.primary
        1 -> MaterialTheme.colorScheme.tertiary
        else -> MaterialTheme.colorScheme.secondary
    }
    Box(modifier.clip(CircleShape)) {
        val path = room.coverPath
        if (path == null) SautiAvatar(roomInitials(room.name), Modifier.matchParentSize(), accent)
        else AuthorizedImage(auth, path, "${room.name} cover", Modifier.matchParentSize(),
            showFallbackWhileLoading = true,
            fallback = { SautiAvatar(roomInitials(room.name), Modifier.fillMaxSize(), accent) })
    }
}

@Composable
internal fun RoomGroupHeader(auth: StagingAuthClient, room: NativeRoom, status: String?,
    onBack: () -> Unit, onInfo: () -> Unit, onRefresh: () -> Unit, onSearch: (() -> Unit)?,
    onManage: (() -> Unit)?, onMembers: (() -> Unit)? = null, onMedia: (() -> Unit)? = null, membersLabel: String = "Members") {
    var menu by remember(room.id) { mutableStateOf(false) }
    Surface(color = MaterialTheme.colorScheme.surface, shadowElevation = 3.dp) {
        Row(Modifier.fillMaxWidth().heightIn(min = 63.dp).padding(end = 4.dp),
            verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back") }
            Row(Modifier.weight(1f).clip(RoundedCornerShape(14.dp)).clickable(onClick = onInfo)
                .padding(vertical = 7.dp, horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                RoomGroupAvatar(auth, room, Modifier.size(40.dp))
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(room.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold,
                        maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Crossfade(status, label = "Room activity") { activity ->
                        Text(activity ?: roomMemberCount(room.memberCount), style = MaterialTheme.typography.bodySmall,
                            color = if (activity == null) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.primary,
                            maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
            if (onSearch != null) IconButton(onClick = onSearch) {
                Icon(Icons.Rounded.Search, "Search discussion")
            }
            Box {
                IconButton(onClick = { menu = true }) { Icon(Icons.Rounded.MoreVert, "Room options") }
                DropdownMenu(menu, { menu = false }) {
                    RoomMenuAction("Room info", Icons.Rounded.Info) { menu = false; onInfo() }
                    if (onMembers != null) RoomMenuAction(membersLabel, Icons.Rounded.People) { menu = false; onMembers() }
                    if (onMedia != null) RoomMenuAction("Shared media", Icons.Rounded.PhotoLibrary) { menu = false; onMedia() }
                    if (onManage != null) RoomMenuAction("Manage Room", Icons.Rounded.Settings) { menu = false; onManage() }
                    RoomMenuAction("Refresh", Icons.Rounded.Refresh) { menu = false; onRefresh() }
                }
            }
        }
    }
}

@Composable
internal fun RoomWallpaper() {
    val colors = MaterialTheme.colorScheme
    val brush = Brush.verticalGradient(listOf(colors.primaryContainer.copy(alpha = .53f),
        colors.surfaceContainer, colors.tertiaryContainer.copy(alpha = .35f)))
    Canvas(Modifier.fillMaxSize().background(brush)) {
        val step = 36.dp.toPx()
        val radius = 1.2.dp.toPx()
        val ink = colors.onSurface.copy(alpha = .075f)
        var y = step / 2
        var stagger = false
        while (y < size.height) {
            var x = if (stagger) step / 3 else 2 * step / 3
            while (x < size.width) {
                drawCircle(ink, radius, Offset(x, y))
                x += step
            }
            stagger = !stagger
            y += step
        }
    }
}

@Composable
internal fun RoomPinnedStrip(post: NativeRoomPost, count: Int, onOpen: (String) -> Unit) {
    val colors = MaterialTheme.colorScheme
    Surface(color = colors.surfaceContainerLow, onClick = { onOpen(post.id) }) {
        Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).padding(horizontal = 15.dp, vertical = 7.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Icon(Icons.Rounded.PushPin, null, Modifier.size(19.dp), tint = colors.primary)
            Column(Modifier.weight(1f)) {
                Text(if (count == 1) "Pinned message" else "Pinned message · ${count} total",
                    style = MaterialTheme.typography.labelMedium, color = colors.primary)
                Text(post.body.ifBlank { "Media attachment" }.replace('\n', ' '), maxLines = 1,
                    overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall)
            }
            Icon(Icons.Rounded.ChevronRight, null, tint = colors.onSurfaceVariant)
        }
    }
}

internal fun roomPostDay(date: String): LocalDate? = runCatching {
    OffsetDateTime.parse(date).atZoneSameInstant(ZoneId.systemDefault()).toLocalDate()
}.getOrNull()

@Composable
internal fun RoomDayMarker(day: LocalDate) {
    val today = LocalDate.now()
    val label = when (day) {
        today -> "Today"
        today.minusDays(1) -> "Yesterday"
        else -> day.format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM))
    }
    Box(Modifier.fillMaxWidth().padding(vertical = 8.dp), contentAlignment = Alignment.Center) {
        Surface(shape = CircleShape, color = MaterialTheme.colorScheme.surfaceContainerHighest.copy(alpha = .91f)) {
            Text(label, Modifier.padding(horizontal = 13.dp, vertical = 5.dp),
                style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
internal fun roomPostClock(date: String): String {
    val context = LocalContext.current
    return remember(context, date) {
        runCatching { DateFormat.getTimeFormat(context).format(Date.from(OffsetDateTime.parse(date).toInstant())) }
            .getOrDefault("")
    }
}

@Composable
internal fun roomPreviewTime(date: String): String {
    val day = roomPostDay(date) ?: return ""
    return if (day == LocalDate.now()) roomPostClock(date)
    else day.format(DateTimeFormatter.ofPattern("d MMM"))
}

@Composable
internal fun RoomSearchField(value: String, onValue: (String) -> Unit, placeholder: String,
    modifier: Modifier = Modifier, requestFocus: Boolean = false) {
    val colors = MaterialTheme.colorScheme
    val focus = remember { FocusRequester() }
    LaunchedEffect(requestFocus) { if (requestFocus) focus.requestFocus() }
    TextField(value, onValue, modifier = modifier.fillMaxWidth().focusRequester(focus), singleLine = true,
        shape = RoundedCornerShape(22.dp), placeholder = { Text(placeholder) },
        leadingIcon = { Icon(Icons.Rounded.Search, null) },
        trailingIcon = if (value.isNotEmpty()) ({
            IconButton(onClick = { onValue("") }) { Icon(Icons.Rounded.Close, "Clear search") }
        }) else null,
        colors = TextFieldDefaults.colors(focusedContainerColor = colors.surfaceContainerHigh,
            unfocusedContainerColor = colors.surfaceContainer, focusedIndicatorColor = Color.Transparent,
            unfocusedIndicatorColor = Color.Transparent))
}

@Composable
internal fun RoomInfoTopBar(onBack: () -> Unit, onEdit: (() -> Unit)?, onManage: (() -> Unit)?) {
    val colors = MaterialTheme.colorScheme
    Surface(color = colors.surfaceContainerLow) {
        Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(horizontal = 6.dp),
            verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back to messages") }
            Text("Group info", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
            if (onEdit != null) IconButton(onClick = onEdit) { Icon(Icons.Rounded.Edit, "Edit group") }
            if (onManage != null) IconButton(onClick = onManage) { Icon(Icons.Rounded.MoreVert, "Manage group") }
        }
    }
}

@Composable
internal fun RoomInfoOverview(auth: StagingAuthClient, room: NativeRoom, activity: RoomChatActivity,
    onMessage: () -> Unit, onInvite: (() -> Unit)?, onLeave: (() -> Unit)?, onShare: () -> Unit) {
    val colors = MaterialTheme.colorScheme
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp)) {
        RoomGroupAvatar(auth, room, Modifier.padding(top = 4.dp).size(90.dp))
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(room.name, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold,
                textAlign = TextAlign.Center)
            Text(activity.onlineCount.takeIf { it > 0 }?.let { "${roomMemberCount(room.memberCount)}, $it online" }
                ?: roomMemberCount(room.memberCount),
                color = colors.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            RoomInfoAction("Message", Icons.Rounded.ChatBubble, Modifier.weight(1f), onMessage)
            RoomInfoAction("Share link", Icons.Rounded.Link, Modifier.weight(1f), onShare)
            if (onLeave != null) RoomInfoAction("Leave", Icons.Rounded.Logout, Modifier.weight(1f), onLeave)
        }
        Surface(Modifier.fillMaxWidth(), shape = RoundedCornerShape(20.dp), color = colors.surfaceContainerLow) {
            Column(Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (room.description.isNotBlank()) Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(room.description, style = MaterialTheme.typography.bodyMedium)
                    Text("Description", style = MaterialTheme.typography.labelMedium, color = colors.onSurfaceVariant)
                }
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text("sautilink.com/rooms/${room.slug}", style = MaterialTheme.typography.bodyMedium,
                            color = colors.primary)
                        Text(if (room.privacy == "public") "Public link" else "Group link",
                            style = MaterialTheme.typography.labelMedium, color = colors.onSurfaceVariant)
                    }
                    IconButton(onClick = onShare) { Icon(Icons.Rounded.IosShare, "Share group link", tint = colors.primary) }
                }
            }
        }
        if (onInvite != null) Surface(onClick = onInvite, modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(18.dp), color = colors.surfaceContainerLow) {
            Row(Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Icon(Icons.Rounded.PersonAdd, null, tint = colors.primary)
                Text("Add members", color = colors.primary, style = MaterialTheme.typography.titleSmall)
            }
        }
    }
}

@Composable
private fun RoomInfoAction(label: String, icon: androidx.compose.ui.graphics.vector.ImageVector,
    modifier: Modifier, onClick: () -> Unit) {
    val colors = MaterialTheme.colorScheme
    Surface(onClick = onClick, modifier = modifier, shape = RoundedCornerShape(16.dp),
        color = colors.secondaryContainer.copy(alpha = .76f)) {
        Column(Modifier.padding(vertical = 11.dp, horizontal = 4.dp), horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Icon(icon, null, Modifier.size(21.dp), tint = colors.primary)
            Text(label, style = MaterialTheme.typography.labelMedium, textAlign = TextAlign.Center)
        }
    }
}

@Composable
internal fun RoomInfoTabs(selected: RoomTab, onSelect: (RoomTab) -> Unit, members: Boolean, media: Boolean, adminsOnly: Boolean = false) {
    val colors = MaterialTheme.colorScheme
    val tabs = buildList {
        add(RoomTab.ABOUT to "Overview")
        if (members) add(RoomTab.PEOPLE to if (adminsOnly) "Admins" else "Members")
        if (media) {
            add(RoomTab.MEDIA to "Media")
            add(RoomTab.LINKS to "Links")
        }
    }
    Row(Modifier.fillMaxWidth().clip(CircleShape).background(colors.surfaceContainerLow)
        .selectableGroup().padding(4.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        tabs.forEach { (tab, label) ->
            val active = tab == selected
            Box(Modifier.weight(1f).clip(CircleShape)
                .background(if (active) colors.primaryContainer else Color.Transparent)
                .selectable(selected = active, role = Role.Tab, onClick = { onSelect(tab) })
                .heightIn(min = 44.dp).padding(horizontal = 4.dp), contentAlignment = Alignment.Center) {
                Text(label, textAlign = TextAlign.Center, style = MaterialTheme.typography.labelMedium,
                    color = if (active) colors.onPrimaryContainer else colors.onSurfaceVariant)
            }
        }
    }
}

private val roomLinkPattern = Regex("""https?://[^\s<>"\[\]]+""", RegexOption.IGNORE_CASE)

internal fun roomMessageLinks(post: NativeRoomPost): List<String> =
    roomLinkPattern.findAll(post.body)
        .map { it.value.trimEnd('.', ',', ':', ';', '!', '?', ')') }
        .filter { runCatching { !java.net.URI(it).host.isNullOrBlank() }.getOrDefault(false) }
        .distinct().toList()
