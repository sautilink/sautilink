package com.sautilink.nativeapp.feature.rooms

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import com.sautilink.nativeapp.ui.components.SautiIcon as Icon
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.ui.theme.SautiShape
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun RoomSheet(title: String, onDismiss: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss, shape = SautiShape.Sheet,
        containerColor = MaterialTheme.colorScheme.surface,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).imePadding()
            .padding(horizontal = 18.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                RoomSectionHeading(title, modifier = Modifier.weight(1f))
                IconButton(onClick = onDismiss) { Icon(Icons.Rounded.Close, "Close $title") }
            }
            content()
        }
    }
}

@Composable
internal fun RoomSelectField(title: String, value: String, options: List<Pair<String, String>>,
    enabled: Boolean = true, onSelect: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(title, style = MaterialTheme.typography.labelLarge)
        Box {
            OutlinedButton(onClick = { expanded = true }, enabled = enabled, modifier = Modifier.fillMaxWidth()) {
                Text(options.firstOrNull { it.first == value }?.second ?: value,
                    modifier = Modifier.weight(1f), maxLines = 2, overflow = TextOverflow.Ellipsis)
                Icon(Icons.Rounded.ExpandMore, null)
            }
            DropdownMenu(expanded, { expanded = false }, modifier = Modifier.heightIn(max = 350.dp)) {
                options.forEach { (key, label) ->
                    DropdownMenuItem(text = { Text(label) }, onClick = { expanded = false; onSelect(key) },
                        leadingIcon = { Icon(if (key == value) Icons.Rounded.CheckCircle else Icons.Rounded.RadioButtonUnchecked,
                            null, Modifier.size(20.dp), tint = if (key == value) MaterialTheme.colorScheme.primary
                                else MaterialTheme.colorScheme.onSurfaceVariant, selected = key == value) })
                }
            }
        }
    }
}

@Composable
internal fun RoomSettingsSheet(accountId: String?, room: NativeRoom?, approvalAvailable: Boolean,
    busy: Boolean, error: String?, onDismiss: () -> Unit, onSave: (NativeRoom?, NativeRoomSettings, Uri?) -> Unit) {
    val editingRoom = remember(accountId, room?.id) { room }
    var value by remember(accountId, room?.id) { mutableStateOf(room?.settings()
        ?: NativeRoomSettings("", "", "", "open")) }
    var cover by remember(accountId, room?.id) { mutableStateOf<Uri?>(null) }
    var attempted by remember(accountId, room?.id) { mutableStateOf(false) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { cover = it }
    val validation = value.validationError(room?.privacy)
    RoomSheet(if (room == null) "Create a Room" else "Room settings", onDismiss) {
        Text(if (room == null) "Bring your community together on SautiLink."
            else "Update the details and access settings for this Room.",
            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        OutlinedTextField(value.name, { value = value.copy(name = it.take(81)) }, enabled = !busy,
            label = { Text("Room name") }, leadingIcon = { Icon(Icons.Rounded.Groups, null) },
            singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(value.slug, { input -> value = value.copy(slug = input.lowercase(Locale.ROOT)
            .filter { it in 'a'..'z' || it in '0'..'9' || it == '-' }.take(50)) },
            label = { Text("Room address") }, leadingIcon = { Icon(Icons.Rounded.Link, null) },
            supportingText = { Text("sautilink.com/rooms/${value.slug}") },
            enabled = !busy, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(value.description, { value = value.copy(description = it.take(1001)) },
            label = { Text("About this Room") }, leadingIcon = { Icon(Icons.Rounded.Info, null) },
            supportingText = { Text("${value.description.length}/1000") },
            minLines = 3, enabled = !busy, modifier = Modifier.fillMaxWidth())
        RoomSelectField("Category", value.category, NativeRoomRules.categories.toList(), !busy) {
            value = value.copy(category = it)
        }
        RoomSelectField("Room privacy", value.privacy, listOf("public" to "Public", "private" to "Private"),
            enabled = room == null && !busy) { privacy ->
            value = value.copy(privacy = privacy,
                policy = if (privacy == "private" && value.policy == "open") "approval" else value.policy)
        }
        Text(if (room != null) "Existing Room privacy stays unchanged."
            else "Room details can be discovered. Join to read the discussion.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        val policies = listOf("open" to "Open — anyone can join", "approval" to "Approval required", "private" to "Invite only")
            .filterNot { value.privacy == "private" && it.first == "open" }
        RoomSelectField("How people join", value.policy, policies, !busy) { value = value.copy(policy = it) }
        RoomSelectField("Who can post", value.postPermission,
            listOf("all_members" to "All members", "staff_only" to "Admins and moderators"), !busy) {
            value = value.copy(postPermission = it)
        }
        RoomSelectField("Who can invite", value.invitePermission,
            listOf("all_members" to "All members", "staff_only" to "Admins and moderators"), !busy) {
            value = value.copy(invitePermission = it)
        }
        if (approvalAvailable && (editingRoom == null || editingRoom.supportsPostApproval)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Review member posts", style = MaterialTheme.typography.titleSmall)
                    Text("Member posts wait for staff approval before appearing.", style = MaterialTheme.typography.bodySmall)
                }
                Switch(value.postApprovalRequired, { value = value.copy(postApprovalRequired = it) }, enabled = !busy)
            }
        }
        OutlinedButton(onClick = { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
            enabled = !busy, modifier = Modifier.fillMaxWidth()) {
            Icon(Icons.Rounded.AddPhotoAlternate, null); Spacer(Modifier.width(8.dp))
            Text(if (cover != null) "Cover selected · change" else if (room?.coverPath != null) "Change cover" else "Add cover")
        }
        Text("JPEG, PNG or WebP · at least 600 × 200 px · up to 10 MB",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (attempted && validation != null) RoomNotice(validation, true)
        if (error != null) RoomNotice(error, true)
        Button(onClick = { attempted = true; if (validation == null) onSave(editingRoom, value.normalized(), cover) },
            enabled = !busy, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
            Text(if (busy) "Saving…" else if (room == null) "Create Room" else "Save changes")
        }
    }
}

@Composable
internal fun RoomManageSheet(room: NativeRoom, state: RoomsState, onDismiss: () -> Unit,
    onSettings: () -> Unit, onPeople: () -> Unit, onInvites: () -> Unit, onApprovals: () -> Unit,
    onDelete: () -> Unit, onCommunity: (() -> Unit)? = null, onOutgoing: (() -> Unit)? = null) {
    RoomSheet("Manage ${room.name}", onDismiss) {
        Text(roomRoleLabel(if (room.isOwner) "owner" else room.role), style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.primary)
        if (room.canManageSettings) RoomManageRow("Room settings", "Name, category, access and cover",
            Icons.Rounded.Settings, onSettings)
        if (onCommunity != null) RoomManageRow("Community settings", "Rules and membership questions",
            Icons.Rounded.Rule, onCommunity)
        if (onOutgoing != null && room.isMember) RoomManageRow("Outgoing invitations", "Review and revoke pending invitations",
            Icons.Rounded.Send, onOutgoing)
        if (room.canManagePeople) RoomManageRow("People and requests", "Members, roles and join requests",
            Icons.Rounded.People, onPeople)
        if (room.canInvite) RoomManageRow("Invite someone", "Invite a SautiLink account by username",
            Icons.Rounded.PersonAdd, onInvites)
        if (room.supportsPostApproval && room.isStaff) RoomManageRow("Post approvals", "Review member submissions",
            Icons.Rounded.FactCheck, onApprovals)
        if (room.canManageSettings && room.coverPath != null) {
            TextButton(onClick = { state.cover(room, null) }, enabled = !state.busy("cover")) { Text("Remove cover") }
        }
        if (state.roomError != null) RoomNotice(state.roomError.orEmpty(), true)
        if (room.isOwner) TextButton(onClick = onDelete) { Text("Delete Room", color = MaterialTheme.colorScheme.error) }
    }
}

@Composable
private fun RoomManageRow(title: String, detail: String, icon: androidx.compose.ui.graphics.vector.ImageVector,
    onClick: () -> Unit) {
    OutlinedButton(onClick = onClick, modifier = Modifier.fillMaxWidth(), shape = SautiShape.Button,
        contentPadding = PaddingValues(14.dp)) {
        Icon(icon, null); Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleSmall)
            Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Icon(Icons.Rounded.ChevronRight, null)
    }
}

@Composable
internal fun RoomInviteSheet(room: NativeRoom, state: RoomsState, onDismiss: () -> Unit, onOutgoing: () -> Unit) {
    var handle by remember(state.accountId, room.id) { mutableStateOf("") }
    RoomSheet("Invite to ${room.name}", onDismiss) {
        Text("They can accept or decline from their Rooms invitations.", style = MaterialTheme.typography.bodyMedium)
        TextButton(onClick = onOutgoing) { Text("Outgoing invitations") }
        OutlinedTextField(handle, { handle = it.take(31) }, label = { Text("Username") },
            prefix = { Text("@") }, singleLine = true, enabled = !state.busy("invite"), modifier = Modifier.fillMaxWidth())
        if (state.roomError != null) RoomNotice(state.roomError.orEmpty(), true)
        Button(onClick = { state.invite(room, handle.trim().removePrefix("@")) { onDismiss() } },
            enabled = !state.busy("invite") && NativeRoomRules.handle.matches(handle.trim().removePrefix("@").lowercase(Locale.ROOT)),
            modifier = Modifier.fillMaxWidth()) { Text(if (state.busy("invite")) "Inviting…" else "Send invitation") }
    }
}

@Composable
internal fun RoomPeopleContent(room: NativeRoom, state: RoomsState, onOpenProfile: (String) -> Unit,
    onAnswers: ((String) -> Unit)? = null) {
    var memberOptions by remember(state.accountId, room.id, room.role) { mutableStateOf<NativeRoomMember?>(null) }
    var removeConfirm by remember(state.accountId, room.id, room.role) { mutableStateOf<NativeRoomMember?>(null) }
    val height = (LocalConfiguration.current.screenHeightDp * .65f).dp
    LazyColumn(Modifier.fillMaxWidth().heightIn(max = height), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        if (state.peopleLoading && state.members.isEmpty()) items(3) { com.sautilink.nativeapp.ui.components.SautiExploreSkeleton() }
        if (state.peopleError != null) item { RoomNotice(state.peopleError.orEmpty(), true, { state.loadPeople() }) }
        if (state.roomError != null) item { RoomNotice(state.roomError.orEmpty(), true) }
        if (room.canManagePeople && state.requests.isNotEmpty()) {
            item { RoomSectionHeading("Join requests", modifier = Modifier.padding(vertical = 8.dp)) }
            items(state.requests, key = { "request:${it.requesterId}" }) { request ->
                RoomPerson(state.auth, request.name, request.handle, null, request.verified, request.badgeType,
                    request.hasAvatar, { onOpenProfile(request.handle) }) {
                    if (onAnswers != null) IconButton(onClick = { onAnswers(request.requesterId) }) {
                        Icon(Icons.Rounded.QuestionAnswer, "View membership answers")
                    }
                    TextButton(onClick = { state.mutate("request:${request.requesterId}", room,
                        { state.client.decide(room, request.requesterId, true) }) }, enabled = !state.busy("request:${request.requesterId}")) {
                        Text(if (state.busy("request:${request.requesterId}")) "Saving…" else "Approve")
                    }
                    IconButton(onClick = { state.mutate("request:${request.requesterId}", room,
                        { state.client.decide(room, request.requesterId, false) }) }, enabled = !state.busy("request:${request.requesterId}")) {
                        Icon(Icons.Rounded.Close, "Decline join request")
                    }
                }
            }
            if (state.requestsMore) item { OutlinedButton(onClick = { state.loadPeople(appendRequests = true) },
                enabled = !state.peopleLoading) { Text("Load more requests") } }
        }
        item { RoomSectionHeading("Members", modifier = Modifier.padding(vertical = 8.dp)) }
        items(state.members, key = { "member:${it.id}" }) { member ->
            RoomPerson(state.auth, member.name, member.handle, member.role, member.verified, member.badgeType,
                member.hasAvatar, { onOpenProfile(member.handle) }) {
                if (room.availableRolesFor(member).isNotEmpty() || room.canRemoveMember(member)) {
                    IconButton(onClick = { memberOptions = member }, enabled = !state.busy("member:${member.id}")) {
                        Icon(Icons.Rounded.MoreHoriz, "Manage ${member.name}")
                    }
                }
            }
        }
        if (state.membersMore) item { OutlinedButton(onClick = { state.loadPeople(appendMembers = true) },
            enabled = !state.peopleLoading) { Text("Load more members") } }
        if (!state.peopleLoading && state.peopleError == null && state.members.isEmpty()) item {
            RoomEmpty("No people to show", "Member information will appear here.", Icons.Rounded.People)
        }
    }
    memberOptions?.let { member ->
        AlertDialog(onDismissRequest = { memberOptions = null }, title = { Text(member.name) },
            text = { Column {
                room.availableRolesFor(member).filterNot { it == member.role }.forEach { role ->
                    TextButton(onClick = { memberOptions = null; state.mutate("member:${member.id}", room,
                        { state.client.changeMemberRole(room, member, role) }) }) { Text("Make ${roomRoleLabel(role).lowercase()}") }
                }
                if (room.canRemoveMember(member)) TextButton(onClick = { memberOptions = null; removeConfirm = member }) {
                    Text("Remove from Room", color = MaterialTheme.colorScheme.error)
                }
            } }, confirmButton = { TextButton(onClick = { memberOptions = null }) { Text("Done") } })
    }
    removeConfirm?.let { member ->
        AlertDialog(onDismissRequest = { removeConfirm = null }, title = { Text("Remove ${member.name}?") },
            text = { Text("They will lose member access to ${room.name}.") },
            confirmButton = { TextButton(onClick = { removeConfirm = null; state.mutate("member:${member.id}", room,
                { state.client.removeMember(room, member) }) }, enabled = room.canRemoveMember(member)) { Text("Remove") } },
            dismissButton = { TextButton(onClick = { removeConfirm = null }) { Text("Cancel") } })
    }
}
