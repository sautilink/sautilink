package com.sautilink.nativeapp.feature.rooms

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AttachFile
import androidx.compose.material.icons.rounded.PushPin
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.feature.home.relativePostTime
import com.sautilink.nativeapp.ui.components.SautiPostSkeleton
import com.sautilink.nativeapp.ui.components.SautiPostText
import java.util.concurrent.atomic.AtomicBoolean

@Composable
internal fun RoomManagementAvailabilityNotice(room: NativeRoom, state: RoomManagementState) {
    state.capabilityError?.let { RoomNotice(it, true, { state.retry(room) }) }
    if (state.available) state.configurationError?.let { RoomNotice(it, true, { state.loadConfiguration(room) }) }
}

@Composable
internal fun RoomRulesPanel(room: NativeRoom, state: RoomManagementState) {
    if (!state.available) return
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (state.configurationLoading && state.configuration == null) SautiPostSkeleton()
        state.configuration?.takeIf { it.roomId == room.id }?.let { RoomRulesContent(it.rules) }
    }
}

@Composable
internal fun RoomRulesContent(rules: List<NativeRoomRule>) {
    if (rules.isEmpty()) return
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Room rules", style = MaterialTheme.typography.titleMedium)
        rules.forEachIndexed { index, rule ->
            Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Text("${index + 1}. ${rule.title}", style = MaterialTheme.typography.titleSmall)
                if (rule.body.isNotBlank()) Text(rule.body, style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
internal fun RoomFeaturedPosts(room: NativeRoom, state: RoomManagementState, onOpenPost: (String) -> Unit,
    onOpenProfile: (String) -> Unit) {
    if (!state.available || !room.canReadPosts) return
    if (state.pinnedPosts.isEmpty() && !state.pinsLoading && state.pinsError == null) return
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
            Icon(Icons.Rounded.PushPin, null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.primary)
            Text("Featured", style = MaterialTheme.typography.titleMedium)
            if (state.pinnedPosts.isNotEmpty()) Text("${state.pinnedPosts.size}/3", style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        state.pinsError?.let { RoomNotice(it, true, { state.loadPins(room) }) }
        if (state.pinsLoading && state.pinnedPosts.isEmpty()) SautiPostSkeleton()
        state.pinnedPosts.forEach { post -> RoomFeaturedPreview(room, state, post, onOpenPost, onOpenProfile) }
    }
}

@Composable
private fun RoomFeaturedPreview(room: NativeRoom, state: RoomManagementState, post: NativeRoomPost,
    onOpenPost: (String) -> Unit, onOpenProfile: (String) -> Unit) {
    Surface(shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surfaceContainer) {
        Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            RoomPerson(state.auth, post.authorName, post.authorHandle, null, post.verified, post.badgeType,
                post.hasAvatar, { onOpenProfile(post.authorHandle) })
            if (post.body.isNotBlank()) SautiPostText(post.body, style = MaterialTheme.typography.bodyMedium,
                maxLines = 3, overflow = TextOverflow.Ellipsis)
            if (post.mediaCount > 0) Row(verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                Icon(Icons.Rounded.AttachFile, null, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("${post.mediaCount} ${if (post.mediaCount == 1) "attachment" else "attachments"}",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = { onOpenPost(post.id) }, modifier = Modifier.weight(1f)) { Text("View post") }
                if (room.isStaff && state.isPinned(post.id) == true) TextButton(onClick = { state.setPinned(room, post, false) },
                    enabled = !state.busy("pin:${post.id}") && !state.busy("remove:${post.id}")) { Text(if (state.busy("pin:${post.id}")) "Saving…" else "Unpin") }
            }
            state.postError(post.id)?.let { RoomNotice(it, true) }
        }
    }
}

@Composable
internal fun RoomOutgoingInvitationsSheet(room: NativeRoom, state: RoomManagementState, onDismiss: () -> Unit,
    onOpenProfile: (String) -> Unit) {
    if (!room.isMember) return
    var revoke by remember(state.accountId, room.id) { mutableStateOf<NativeRoomOutgoingInvitation?>(null) }
    LaunchedEffect(state.accountId, room.id, room.role) { state.loadOutgoing(room) }
    RoomSheet("Outgoing invitations", onDismiss) {
        Text(if (room.isStaff) "Pending invitations sent to this Room." else "Pending invitations you sent to this Room.",
            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        TextButton(onClick = { state.loadOutgoing(room) }, enabled = !state.outgoingLoading) { Text("Refresh invitations") }
        state.outgoingError?.let { RoomNotice(it, true, { state.loadOutgoing(room) }) }
        if (state.outgoingLoading && state.outgoing.isEmpty()) SautiPostSkeleton()
        state.outgoing.forEach { invite ->
            RoomOutgoingInvitationRow(room, state, invite, onOpenProfile) { revoke = invite }
        }
        if (!state.outgoingLoading && state.outgoingError == null && state.outgoing.isEmpty())
            RoomEmpty("No pending invitations", "Accepted and declined invitations are not pending.")
        if (state.outgoingNextOffset != null) OutlinedButton(onClick = { state.loadOutgoing(room, true) },
            enabled = !state.outgoingLoading, modifier = Modifier.fillMaxWidth()) { Text("Load more invitations") }
    }
    revoke?.let { invitation ->
        AlertDialog(onDismissRequest = { revoke = null }, title = { Text("Revoke this invitation?") },
            text = { Text("${invitation.name} will no longer be able to accept this pending invitation.") },
            confirmButton = { TextButton(onClick = { revoke = null; state.revokeInvitation(room, invitation) },
                enabled = !state.revoking(room, invitation)) { Text("Revoke") } },
            dismissButton = { TextButton(onClick = { revoke = null }) { Text("Cancel") } })
    }
}

@Composable
private fun RoomOutgoingInvitationRow(room: NativeRoom, state: RoomManagementState, invitation: NativeRoomOutgoingInvitation,
    onOpenProfile: (String) -> Unit, onRevoke: () -> Unit) {
    Surface(shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.surfaceContainer) {
        Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            RoomPerson(state.auth, invitation.name, invitation.handle, null, invitation.verified, invitation.badgeType,
                invitation.hasAvatar, { onOpenProfile(invitation.handle) }) {
                if (room.isStaff || invitation.invitedBy == state.accountId) TextButton(onClick = onRevoke,
                    enabled = !state.revoking(room, invitation)) {
                    Text(if (state.revoking(room, invitation)) "Revoking…" else "Revoke")
                }
            }
            Text("Sent ${relativePostTime(invitation.createdAt)}", style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
internal fun RoomPublishedPostManagementSheet(room: NativeRoom, state: RoomManagementState, post: NativeRoomPost,
    onDismiss: () -> Unit, onOpenPost: (String) -> Unit, onRemoved: (String) -> Unit) {
    if (!state.available || !room.isStaff) return
    var removal by remember(state.accountId, room.id, post.id) { mutableStateOf(false) }
    val attached = remember(state.accountId, room.id, post.id) { AtomicBoolean(true) }
    DisposableEffect(attached) { onDispose { attached.set(false) } }
    LaunchedEffect(state.accountId, room.id, room.role, post.id) { state.loadPostAccess(room, post) }
    RoomSheet("Manage Room post", onDismiss) {
        Text(post.authorName, style = MaterialTheme.typography.titleSmall)
        if (post.body.isNotBlank()) SautiPostText(post.body, maxLines = 3, overflow = TextOverflow.Ellipsis,
            style = MaterialTheme.typography.bodyMedium)
        TextButton(onClick = { onDismiss(); onOpenPost(post.id) }) { Text("View post") }
        if (state.busy("permissions:${post.id}")) LinearProgressIndicator(Modifier.fillMaxWidth())
        state.postError(post.id)?.let { RoomNotice(it, true, { state.refreshPostManagement(room, post) }) }
        val access = state.postAccess(post.id)
        if (access?.canPin == true) {
            val pinned = state.isPinned(post.id)
            OutlinedButton(onClick = { if (pinned != null) state.setPinned(room, post, !pinned) },
                enabled = pinned != null && !state.busy("pin:${post.id}") && !state.busy("remove:${post.id}"), modifier = Modifier.fillMaxWidth()) {
                Text(if (state.busy("pin:${post.id}")) "Saving…" else if (pinned == true) "Unpin from Featured" else "Pin to Featured")
            }
            Text("Up to three posts can be featured in this Room.", style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (pinned == null) TextButton(onClick = { state.loadPins(room) }, enabled = !state.pinsLoading) { Text("Load Featured status") }
        }
        if (access?.canRemove == true) TextButton(onClick = { removal = true },
            enabled = !state.busy("remove:${post.id}") && !state.busy("pin:${post.id}")) {
            Text("Remove from Room", color = MaterialTheme.colorScheme.error)
        }
    }
    if (removal) RoomPublishedPostRemovalDialog(room, state, post, { removal = false }) { id ->
        removal = false; onRemoved(id)
        if (attached.get()) onDismiss()
    }
}

@Composable
private fun RoomPublishedPostRemovalDialog(room: NativeRoom, state: RoomManagementState, post: NativeRoomPost,
    onDismiss: () -> Unit, onRemoved: (String) -> Unit) {
    var reason by remember(state.accountId, room.id, post.id) { mutableStateOf("") }
    val busy = state.busy("remove:${post.id}")
    AlertDialog(onDismissRequest = onDismiss, title = { Text("Remove this post?") },
        text = { Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("It will no longer appear in this Room. A reason is required.", style = MaterialTheme.typography.bodyMedium)
            OutlinedTextField(reason, { reason = boundedCommunityText(it, 501) }, enabled = !busy,
                label = { Text("Removal reason") }, minLines = 2,
                supportingText = { Text("${NativeRoomCommunityRules.textLength(reason)}/500") })
            state.postError(post.id)?.let { RoomNotice(it, true) }
        } },
        confirmButton = { TextButton(onClick = { state.removePost(room, post, reason, onRemoved) },
            enabled = !busy && NativeRoomCommunityRules.textLength(reason.trim()) in 1..500) { Text(if (busy) "Removing…" else "Remove post") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } })
}
