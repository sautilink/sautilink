package com.sautilink.nativeapp.feature.rooms

import android.content.Intent
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.home.NativePostDetailScreen
import com.sautilink.nativeapp.feature.home.PostCommentsSheet
import com.sautilink.nativeapp.ui.components.SautiPostSkeleton

private enum class RoomsSheet { CREATE, SETTINGS, MANAGE, INVITE, PEOPLE, COMPOSE, APPROVALS }

@Composable
fun NativeRoomsScreen(auth: StagingAuthClient, onBack: () -> Unit, onSignIn: () -> Unit,
    onOpenProfile: (String) -> Unit, initialRoomSlug: String? = null,
    onOpenPost: ((String) -> Unit)? = null) {
    val accountId = auth.account?.id
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val state = remember(auth, accountId) { RoomsState(auth, accountId, context, scope) }
    val entry = remember(state, initialRoomSlug) { state.restoreEntry(initialRoomSlug) }
    var sheet by remember(accountId) { mutableStateOf<RoomsSheet?>(null) }
    var detailPost by remember(accountId) { mutableStateOf(entry.postId) }
    var commentPost by remember(accountId, state.selected?.id) { mutableStateOf<NativeRoomPost?>(null) }
    var confirmation by remember(accountId, state.selected?.id) { mutableStateOf<String?>(null) }
    val room = state.selected
    val listState = remember(accountId, room?.id) { LazyListState() }
    DisposableEffect(state) { onDispose { state.dispose() } }
    LaunchedEffect(state, initialRoomSlug) {
        if (accountId != null) { state.loadLanding(); entry.slug?.let(state::openSlug) }
    }
    val openProfile: (String) -> Unit = { handle ->
        state.rememberProfileReturn(initialRoomSlug, detailPost); onOpenProfile(handle)
    }
    val openPost: (String) -> Unit = { id -> if (onOpenPost != null) onOpenPost(id) else detailPost = id }
    val postId = detailPost
    BackHandler(postId != null) { detailPost = null; postId?.let(state::refreshPost) }
    if (postId != null) {
        NativePostDetailScreen(auth, postId, onBack = { detailPost = null; state.refreshPost(postId) },
            onSignIn = onSignIn, onOpenProfile = openProfile)
        return
    }
    BackHandler(room != null || state.openingSlug) { state.closeRoom(); sheet = null }
    Column(Modifier.fillMaxSize()) {
        RoomsTopBar(room?.name ?: "Rooms", state.discoverLoading || state.postsLoading,
            onBack = { if (room != null || state.openingSlug) state.closeRoom() else onBack() },
            onRefresh = { if (room != null) state.refreshRoom() else state.loadLanding() },
            onCreate = if (room == null && accountId != null) ({ sheet = RoomsSheet.CREATE }) else null)
        when {
            accountId == null -> RoomEmpty("Your communities on SautiLink", "Sign in to discover, join and create Rooms.",
                actionLabel = "Sign in", onAction = onSignIn)
            state.openingSlug && room == null -> Column(Modifier.padding(16.dp)) { repeat(2) { RoomCardSkeleton() } }
            room == null -> RoomsLanding(state, { sheet = RoomsSheet.CREATE })
            else -> RoomDetail(state, room, listState, openProfile, openPost,
                onComments = { commentPost = it }, onCompose = { sheet = RoomsSheet.COMPOSE },
                onManage = { sheet = RoomsSheet.MANAGE }, onInvite = { sheet = RoomsSheet.INVITE },
                onLeave = { confirmation = "leave" }, onApprovals = { sheet = RoomsSheet.APPROVALS })
        }
    }
    val closeSheet = { sheet = null }
    when (sheet) {
        RoomsSheet.CREATE -> RoomSettingsSheet(accountId, null, state.approvalAvailable,
            state.busy("create"), state.roomError, closeSheet) { _, settings, cover -> state.create(settings, cover, closeSheet) }
        RoomsSheet.SETTINGS -> if (room?.canManageSettings == true) RoomSettingsSheet(accountId, room,
            room.supportsPostApproval, state.busy("settings"), state.roomError, closeSheet) { snapshot, settings, cover ->
            if (snapshot != null) state.saveSettings(snapshot, settings, cover, closeSheet)
        }
        RoomsSheet.MANAGE -> if (room != null) RoomManageSheet(room, state, closeSheet,
            { sheet = RoomsSheet.SETTINGS }, { state.loadPeople(); sheet = RoomsSheet.PEOPLE }, { sheet = RoomsSheet.INVITE },
            { sheet = RoomsSheet.APPROVALS }, { sheet = null; confirmation = "delete" })
        RoomsSheet.INVITE -> if (room?.canInvite == true) RoomInviteSheet(room, state, closeSheet)
        RoomsSheet.PEOPLE -> if (room?.canSeeMembers == true) RoomSheet("People in ${room.name}", closeSheet) {
            RoomPeopleContent(room, state, openProfile)
        }
        RoomsSheet.COMPOSE -> if (room?.canPost == true) RoomComposerSheet(room, state, closeSheet)
        RoomsSheet.APPROVALS -> if (room?.supportsPostApproval == true) RoomApprovalSheet(room, state,
            closeSheet, openProfile, openPost)
        null -> Unit
    }
    commentPost?.let { post ->
        if (room?.canReadPosts == true) PostCommentsSheet(post.asFeedPost(), state.interactions,
            allowWrite = accountId != null && auth.account?.id == accountId, signedInUserId = accountId,
            onDismiss = { commentPost = null }, onRootPosted = { state.commentCount(post.id, 1) },
            onRootDeleted = { state.commentCount(post.id, -1) }, onCommentChanged = {})
    }
    if (confirmation != null && room != null) RoomDestructiveConfirmation(room, state,
        confirmation == "delete", { confirmation = null })
}

@Composable
private fun RoomsLanding(state: RoomsState, onCreate: () -> Unit) {
    RoomsTabs(state.tab, state.invitations.size) { state.tab = it }
    val loading = when (state.tab) { RoomsTab.DISCOVER -> state.discoverLoading
        RoomsTab.YOURS -> state.yoursLoading; RoomsTab.INVITES -> state.invitesLoading }
    val error = when (state.tab) { RoomsTab.DISCOVER -> state.discoverError
        RoomsTab.YOURS -> state.yoursError; RoomsTab.INVITES -> state.invitesError }
    val source = if (state.tab == RoomsTab.YOURS) state.yours else state.discover
    val query = state.search.trim()
    val rooms = source.filter { query.isBlank() || it.name.contains(query, true) || it.description.contains(query, true) }
    LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        item { Text("Communities, conversations and shared interests.", style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant) }
        if (state.openError != null) item { RoomNotice(state.openError.orEmpty(), true) }
        if (state.notice != null) item { RoomNotice(state.notice.orEmpty()) }
        if (state.tab != RoomsTab.INVITES) {
            item { OutlinedTextField(state.search, { state.search = it }, label = { Text("Search these Rooms") },
                leadingIcon = { Icon(Icons.Rounded.Search, null) }, singleLine = true, modifier = Modifier.fillMaxWidth()) }
            if (state.tab == RoomsTab.DISCOVER) item {
                RoomSelectField("Category", state.category ?: "all",
                    listOf("all" to "All categories") + NativeRoomRules.categories.toList()) {
                    state.category = it.takeUnless { value -> value == "all" }; state.loadDiscover()
                }
            }
        }
        if (error != null) item { RoomNotice(error, true, state::loadLanding) }
        if (state.tab == RoomsTab.INVITES) {
            items(state.invitations, key = { it.room.id }) { invitation ->
                RoomInvitationCard(state, invitation)
            }
            if (!loading && error == null && state.invitations.isEmpty()) item {
                RoomEmpty("No invitations yet", "Invitations from your communities will appear here.", Icons.Rounded.MailOutline)
            }
        } else {
            items(rooms, key = { it.id }) { room -> RoomCard(state.auth, room) { state.openRoom(room) } }
            if (!loading && error == null && rooms.isEmpty()) item {
                RoomEmpty(if (query.isNotBlank()) "No matching Rooms here" else if (state.tab == RoomsTab.YOURS) "Find your first Room" else "No Rooms here yet",
                    if (query.isNotBlank()) "Try another name or load more results." else "Explore a community or create a space for your people.",
                    actionLabel = "Create Room", onAction = onCreate)
            }
            if (state.tab == RoomsTab.DISCOVER && state.discoverMore) item {
                OutlinedButton(onClick = { state.loadDiscover(true) }, enabled = !loading,
                    modifier = Modifier.fillMaxWidth()) { Text("Load more Rooms") }
            }
        }
        if (loading) items(if (source.isEmpty()) 3 else 1) { RoomCardSkeleton() }
    }
}

@Composable
private fun RoomInvitationCard(state: RoomsState, invitation: NativeRoomInvitation) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        RoomCard(state.auth, invitation.room) { state.openRoom(invitation.room) }
        Text("Invited by ${invitation.invitedByName}", style = MaterialTheme.typography.bodySmall)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { state.respond(invitation, true) }, enabled = !state.busy("invite:${invitation.room.id}"),
                modifier = Modifier.weight(1f)) { Text("Accept") }
            OutlinedButton(onClick = { state.respond(invitation, false) }, enabled = !state.busy("invite:${invitation.room.id}"),
                modifier = Modifier.weight(1f)) { Text("Decline") }
        }
        if (state.roomError != null) RoomNotice(state.roomError.orEmpty(), true)
    }
}

@Composable
private fun RoomDetail(state: RoomsState, room: NativeRoom, listState: LazyListState,
    onOpenProfile: (String) -> Unit, onOpenPost: (String) -> Unit, onComments: (NativeRoomPost) -> Unit,
    onCompose: () -> Unit, onManage: () -> Unit, onInvite: () -> Unit, onLeave: () -> Unit, onApprovals: () -> Unit) {
    val context = LocalContext.current
    LazyColumn(state = listState, contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        item { RoomDetailHeading(state.auth, room) }
        item { RoomMembershipActions(state, room, onCompose, onManage) }
        if (state.roomError != null) item { RoomNotice(state.roomError.orEmpty(), true, state::refreshRoom) }
        if (state.notice != null) item { RoomNotice(state.notice.orEmpty()) }
        item { RoomContentTabs(state.roomTab) { state.roomTab = it; if (it == RoomTab.PEOPLE) state.loadPeople() } }
        when (state.roomTab) {
            RoomTab.ABOUT -> item {
                RoomAbout(room, onInvite, onLeave) {
                    runCatching { context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
                        type = "text/plain"; putExtra(Intent.EXTRA_TEXT, "${state.auth.backend.siteOrigin}/rooms/${room.slug}")
                    }, "Share Room")) }.onFailure { state.reportError("No sharing app is available.") }
                }
            }
            RoomTab.PEOPLE -> item {
                if (room.canSeeMembers) RoomPeopleContent(room, state, onOpenProfile)
                else RoomEmpty("Meet this community", "Join this Room to see its members.", Icons.Rounded.People)
            }
            RoomTab.DISCUSSION, RoomTab.MEDIA -> {
                if (state.roomTab == RoomTab.DISCUSSION && room.supportsPostApproval) item {
                    TextButton(onClick = onApprovals) { Text(if (room.isStaff) "Post approvals" else "Your submissions") }
                }
                if (!room.canReadPosts) item { RoomEmpty("Join the conversation", "Join this Room to read its discussion and media.") }
                else {
                    val rows = if (state.roomTab == RoomTab.MEDIA) state.posts.filter { it.media.isNotEmpty() } else state.posts
                    items(rows, key = { it.id }) { post ->
                        RoomPostCard(state.auth, post, state.postUi(post.id), { onOpenProfile(post.authorHandle) },
                            { onOpenPost(post.id) }, { onComments(post) }, { only -> state.postAction(post, "like", only) },
                            { state.postAction(post, "save") }, { state.postAction(post, "repost") },
                            { runCatching { context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
                                type = "text/plain"; putExtra(Intent.EXTRA_TEXT, state.interactions.postShareUrl(post.id))
                            }, "Share post")) }.onFailure { state.reportError("No sharing app is available.") } },
                            { state.retryActions(post.id) })
                    }
                    if (state.postsLoading) item { SautiPostSkeleton() }
                    if (!state.postsLoading && rows.isEmpty() && state.roomError == null) item {
                        RoomEmpty(if (state.roomTab == RoomTab.MEDIA) "No media in these posts" else "Start a conversation",
                            if (state.postsMore) "Load more posts to continue." else "Posts from this community will appear here.")
                    }
                    if (state.postsMore) item { OutlinedButton(onClick = { state.loadPosts(true) },
                        enabled = !state.postsLoading, modifier = Modifier.fillMaxWidth()) { Text("Load more posts") } }
                }
            }
        }
    }
}

@Composable
private fun RoomMembershipActions(state: RoomsState, room: NativeRoom, onCompose: () -> Unit, onManage: () -> Unit) {
    when {
        room.isMember -> Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (room.canPost) Button(onClick = onCompose, modifier = Modifier.weight(1f)) { Text("Write a post") }
            OutlinedButton(onClick = onManage, modifier = Modifier.weight(1f)) {
                Text(if (room.canManagePeople || room.canManageSettings) "Manage" else "Joined")
            }
        }
        state.invitations.any { it.room.id == room.id } -> {
            val invitation = state.invitations.first { it.room.id == room.id }
            Button(onClick = { state.respond(invitation, true) }, enabled = !state.busy("invite:${room.id}")) { Text("Accept invitation") }
        }
        room.requestStatus == "pending" -> Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = {}, enabled = false) { Text("Request pending") }
            TextButton(onClick = { state.mutate("join", room, { state.client.cancelJoinRequest(room) }) },
                enabled = !state.busy("join")) { Text("Cancel request") }
        }
        room.policy == "open" -> Button(onClick = { state.mutate("join", room, { state.client.join(room) }) },
            enabled = !state.busy("join")) { Text(if (state.busy("join")) "Joining…" else "Join Room") }
        room.policy == "approval" -> Button(onClick = { state.mutate("join", room, { state.client.requestJoin(room) }) },
            enabled = !state.busy("join")) { Text(if (state.busy("join")) "Requesting…" else "Request to join") }
        else -> RoomNotice("An invitation is needed to join this Room.")
    }
}

@Composable
private fun RoomAbout(room: NativeRoom, onInvite: () -> Unit, onLeave: () -> Unit, onShare: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text("About this Room", style = MaterialTheme.typography.titleMedium)
        Text(room.description.ifBlank { "No description yet." }, style = MaterialTheme.typography.bodyLarge)
        Text("/rooms/${room.slug}", style = MaterialTheme.typography.bodySmall)
        Text("Posting: ${if (room.postPermission == "staff_only") "admins and moderators" else "all members"}", style = MaterialTheme.typography.bodyMedium)
        Text("Invitations: ${if (room.invitePermission == "staff_only") "admins and moderators" else "all members"}", style = MaterialTheme.typography.bodyMedium)
        if (room.canInvite) OutlinedButton(onClick = onInvite) { Text("Invite someone") }
        OutlinedButton(onClick = onShare) { Text("Share Room") }
        if (room.isMember && !room.isOwner) TextButton(onClick = onLeave) { Text("Leave Room", color = MaterialTheme.colorScheme.error) }
    }
}

@Composable
private fun RoomDestructiveConfirmation(room: NativeRoom, state: RoomsState, delete: Boolean, onDismiss: () -> Unit) {
    AlertDialog(onDismissRequest = onDismiss, title = { Text(if (delete) "Delete ${room.name}?" else "Leave ${room.name}?") },
        text = { Text(if (delete) "This permanently removes the Room, its posts and membership."
            else "You will lose member access to this Room.") },
        confirmButton = { TextButton(onClick = {
            onDismiss(); state.mutate(if (delete) "delete" else "leave", room,
                { if (delete) state.client.delete(room) else state.client.leave(room) }, { state.closeRoom() })
        }) { Text(if (delete) "Delete Room" else "Leave Room", color = MaterialTheme.colorScheme.error) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } })
}
