package com.sautilink.nativeapp.feature.rooms

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import com.sautilink.nativeapp.ui.components.SautiIcon as Icon
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.profile.ProfileCropDialog
import com.sautilink.nativeapp.feature.profile.croppedProfileJpeg
import com.sautilink.nativeapp.feature.profile.decodeProfileCropSource
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.ui.theme.SautiShape
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun RoomSheet(title: String, onDismiss: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss, shape = SautiShape.Sheet,
        containerColor = MaterialTheme.colorScheme.surface,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().imePadding()) {
            Row(Modifier.fillMaxWidth().padding(start = 18.dp, end = 6.dp),
                verticalAlignment = Alignment.CenterVertically) {
                RoomSectionHeading(title, modifier = Modifier.weight(1f))
                IconButton(onClick = onDismiss) { Icon(Icons.Rounded.Close, "Close $title") }
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = .55f))
            Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState())
                .padding(start = 18.dp, end = 18.dp, top = 12.dp, bottom = 24.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp), content = content)
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
internal fun RoomSettingsScreen(auth: StagingAuthClient, accountId: String?, room: NativeRoom?,
    busy: Boolean, error: String?, onDismiss: () -> Unit,
    memberPrivacyAvailable: Boolean = room?.memberPrivacyAvailable == true,
    onSave: (NativeRoom?, NativeRoomSettings, ByteArray?) -> Unit) {
    val editingRoom = remember(accountId, room?.id) { room }
    var value by remember(accountId, room?.id) { mutableStateOf(room?.settings()?.copy(postApprovalRequired = false)
        ?: NativeRoomSettings("", "", "", "open")) }
    var cover by remember(accountId, room?.id) { mutableStateOf<ByteArray?>(null) }
    var cropSource by remember(accountId, room?.id) { mutableStateOf<Bitmap?>(null) }
    var coverError by remember(accountId, room?.id) { mutableStateOf<String?>(null) }
    var preparing by remember(accountId, room?.id) { mutableStateOf(false) }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val croppedPreview = remember(cover) {
        cover?.let { BitmapFactory.decodeByteArray(it, 0, it.size)?.asImageBitmap() }
    }
    var attempted by remember(accountId, room?.id) { mutableStateOf(false) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) scope.launch {
            preparing = true
            coverError = null
            try { cropSource = decodeProfileCropSource(context, uri) }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { coverError = failure.message ?: "This photo could not be opened." }
            finally { preparing = false }
        }
    }
    val validation = value.validationError(room?.privacy)
    val colors = MaterialTheme.colorScheme
    BackHandler { if (!busy) onDismiss() }
    Column(Modifier.fillMaxSize().background(colors.surface).imePadding()) {
        Surface(color = colors.surfaceContainerLow) {
            Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(horizontal = 6.dp),
                verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onDismiss, enabled = !busy) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back") }
                Text(if (room == null) "New group" else "Edit group", Modifier.weight(1f),
                    style = MaterialTheme.typography.titleMedium)
                FilledTonalButton(onClick = {
                    attempted = true
                    if (validation == null) onSave(editingRoom, value.normalized(), cover)
                }, enabled = !busy && !preparing) { Text(if (busy) "Saving…" else if (room == null) "Create" else "Save") }
            }
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 14.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (attempted && validation != null) RoomNotice(validation, true)
        if (error != null) RoomNotice(error, true)
        RoomSettingsSection {
            if (croppedPreview != null) {
                Image(croppedPreview, "Cropped group photo",
                    Modifier.align(Alignment.CenterHorizontally).size(76.dp).clip(CircleShape))
            } else if (room != null) RoomGroupAvatar(auth, room, Modifier.align(Alignment.CenterHorizontally).size(76.dp))
            OutlinedButton(onClick = { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                enabled = !busy && !preparing, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.Rounded.AddPhotoAlternate, null)
                Spacer(Modifier.width(8.dp))
                Text(if (preparing) "Preparing photo…" else if (cover != null) "Change group photo" else "Set group photo")
            }
        if (cropSource == null) coverError?.let { RoomNotice(it, true) }
        Text("Crop the photo for the round group avatar.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        OutlinedTextField(value.name, { value = value.copy(name = it.take(81)) }, enabled = !busy,
            label = { Text("Room name") }, leadingIcon = { Icon(Icons.Rounded.Groups, null) },
            singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(value.description, { value = value.copy(description = it.take(1001)) },
            label = { Text("About this Room") }, leadingIcon = { Icon(Icons.Rounded.Info, null) },
            supportingText = { Text("${value.description.length}/1000") },
            minLines = 3, enabled = !busy, modifier = Modifier.fillMaxWidth())
        }
        RoomSettingsSection {
        RoomSectionHeading("Group type", Icons.Rounded.Groups)
        OutlinedTextField(value.slug, { input -> value = value.copy(slug = input.lowercase(Locale.ROOT)
            .filter { it in 'a'..'z' || it in '0'..'9' || it == '-' }.take(50)) },
            label = { Text("Room address") }, leadingIcon = { Icon(Icons.Rounded.Link, null) },
            supportingText = { Text("sautilink.com/rooms/${value.slug}") },
            enabled = !busy, singleLine = true, modifier = Modifier.fillMaxWidth())
        RoomSelectField("Category", value.category, NativeRoomRules.categories.toList(), !busy) {
            value = value.copy(category = it)
        }
        RoomSelectField("Room privacy", value.privacy, listOf("public" to "Public", "private" to "Private"),
            enabled = !busy && (room == null || memberPrivacyAvailable && room.privacy != "private")) { privacy ->
            value = value.copy(privacy = privacy,
                policy = if (privacy == "private" && value.policy == "open") "approval" else value.policy)
        }
        if (room?.privacy == "private") Text("A private group cannot become public.",
            style = MaterialTheme.typography.bodySmall, color = colors.onSurfaceVariant)
        val policies = listOf("open" to "Open — anyone can join", "approval" to "Approval required", "private" to "Invite only")
            .filterNot { value.privacy == "private" && it.first == "open" }
        RoomSelectField("How people join", value.policy, policies, !busy) { value = value.copy(policy = it) }
        }
        RoomSettingsSection {
            RoomSectionHeading("Member privacy", Icons.Rounded.Shield)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Column(Modifier.weight(1f)) {
                    Text("Hide members", style = MaterialTheme.typography.titleSmall)
                    Text("Only the owner and admins appear to regular members.",
                        style = MaterialTheme.typography.bodySmall, color = colors.onSurfaceVariant)
                }
                Switch(checked = value.hideMembers, onCheckedChange = { value = value.copy(hideMembers = it) },
                    enabled = memberPrivacyAvailable && !busy,
                    modifier = Modifier.semantics { contentDescription = "Hide members" })
            }
            RoomSelectField("History for new members",
                if (value.showHistoryToNewMembers) "all" else "new",
                listOf("all" to "All messages", "new" to "Messages sent after joining"),
                memberPrivacyAvailable && !busy) {
                value = value.copy(showHistoryToNewMembers = it == "all")
            }
            Text(if (memberPrivacyAvailable) "This setting applies when someone joins the group."
                else "Member privacy settings require the Room server update.",
                style = MaterialTheme.typography.bodySmall, color = colors.onSurfaceVariant)
        }
        RoomSettingsSection {
        RoomSectionHeading("Permissions", Icons.Rounded.Key)
        RoomSelectField("Send messages", value.postPermission,
            listOf("all_members" to "All members", "staff_only" to "Admins and moderators"), !busy) {
            value = value.copy(postPermission = it)
        }
        RoomSelectField("Invite members", value.invitePermission,
            listOf("all_members" to "All members", "staff_only" to "Admins and moderators"), !busy) {
            value = value.copy(invitePermission = it)
        }
        }
        }
    }
    cropSource?.let { photo ->
        ProfileCropDialog(photo, "avatar", busy = preparing, error = coverError,
            onCancel = { cropSource = null; coverError = null },
            onSave = { zoom, x, y ->
                if (!preparing) scope.launch {
                    preparing = true
                    coverError = null
                    try {
                        cover = withContext(Dispatchers.Default) { croppedProfileJpeg(photo, "avatar", zoom, x, y) }
                        cropSource = null
                    } catch (cancelled: CancellationException) { throw cancelled }
                    catch (failure: Exception) { coverError = failure.message ?: "The photo could not be cropped." }
                    finally { preparing = false }
                }
            }, title = "Crop group photo", confirmLabel = "Use photo")
    }
}

@Composable
private fun RoomSettingsSection(content: @Composable ColumnScope.() -> Unit) {
    Surface(Modifier.fillMaxWidth(), shape = RoundedCornerShape(20.dp),
        color = MaterialTheme.colorScheme.surfaceContainerLow) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(9.dp), content = content)
    }
}

@Composable
internal fun RoomManageSheet(room: NativeRoom, state: RoomsState, onDismiss: () -> Unit,
    onSettings: () -> Unit, onPeople: () -> Unit, onInvites: () -> Unit, onDelete: () -> Unit, onOutgoing: (() -> Unit)? = null) {
    RoomSheet("Manage ${room.name}", onDismiss) {
        Text(roomRoleLabel(if (room.isOwner) "owner" else room.role), style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.primary)
        if (room.canManageSettings) RoomManageRow("Group info and permissions", "Name, photo, access, posting and invitations",
            Icons.Rounded.Settings, onSettings)
        if (onOutgoing != null && room.isMember) RoomManageRow("Outgoing invitations", "Review and revoke pending invitations",
            Icons.Rounded.Send, onOutgoing)
        if (room.canManagePeople) RoomManageRow("Members and administrators", "Roles, members and join requests",
            Icons.Rounded.People, onPeople)
        if (room.canInvite) RoomManageRow("Invite someone", "Invite a SautiLink account by username",
            Icons.Rounded.PersonAdd, onInvites)
        if (room.canManageSettings && room.coverPath != null) {
            TextButton(onClick = { state.removeCover(room) }, enabled = !state.busy("cover")) {
                RoomActionLabel("Remove Room photo", Icons.Rounded.HideImage)
            }
        }
        if (state.roomError != null) RoomNotice(state.roomError.orEmpty(), true)
        if (room.isOwner) TextButton(onClick = onDelete,
            colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)) {
            RoomActionLabel("Delete Room", Icons.Rounded.DeleteOutline)
        }
    }
}

@Composable
internal fun RoomManageRow(title: String, detail: String, icon: androidx.compose.ui.graphics.vector.ImageVector,
    onClick: () -> Unit) {
    ListItem(headlineContent = { Text(title, style = MaterialTheme.typography.titleSmall) },
        supportingContent = { Text(detail) },
        leadingContent = {
            Box(Modifier.size(38.dp).background(MaterialTheme.colorScheme.primaryContainer, CircleShape),
                contentAlignment = Alignment.Center) {
                Icon(icon, null, Modifier.size(20.dp), tint = MaterialTheme.colorScheme.onPrimaryContainer)
            }
        },
        trailingContent = { Icon(Icons.Rounded.ChevronRight, null) },
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick))
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = .5f))
}

@Composable
internal fun RoomInviteSheet(room: NativeRoom, state: RoomsState, onDismiss: () -> Unit, onOutgoing: () -> Unit) {
    var handle by remember(state.accountId, room.id) { mutableStateOf("") }
    RoomSheet("Invite to ${room.name}", onDismiss) {
        Text("They can accept or decline from their Rooms invitations.", style = MaterialTheme.typography.bodyMedium)
        TextButton(onClick = onOutgoing) { RoomActionLabel("Outgoing invitations", Icons.Rounded.Send) }
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
    onAnswers: ((String) -> Unit)? = null, onlineMemberIds: Set<String> = emptySet()) {
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
                if (member.id in onlineMemberIds) {
                    Text("Online", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
                }
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
